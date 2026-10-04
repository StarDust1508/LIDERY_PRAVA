import crypto from 'crypto';
import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../lib/http.js';
import {
  TEAM_SESSION_COOKIE,
  clearTeamSessionCookie,
  readCookie,
  setTeamSessionCookie,
  signTeamSession,
  verifyTeamSession,
} from '../lib/team-session.js';
import { isEmail, normalizeEmail, requiredText } from '../lib/validation.js';
import { rateLimit } from '../middleware/rate-limit.js';
import {
  authenticateTeamToken,
  loadTeamContext,
  logAccess,
  type TeamContext,
} from '../middleware/team-auth.js';

// Вход в личный кабинет. Маршруты этого файла подключаются ДО cabinetRouter:
// кабинет целиком закрыт requireTeam, а экран входа обязан работать без сессии
// (ТЗ 06, п. 7).
//
// Пароля у команды нет. Два способа входа:
//   1) ссылка-токен доступа, выданная при подаче заявки или администратором;
//   2) номер заявки и адрес электронной почты капитана — на случай утери ссылки
//      (почта не отправляется, решение Р7).
// Оба способа обмениваются на подписанную сессионную cookie.

const router = Router();

// Сообщение одинаково для «заявка не найдена» и «почта не совпала»:
// перебор номеров заявок не должен показывать, какие номера существуют.
const ACCESS_DENIED =
  'Не удалось войти: проверьте номер заявки и адрес электронной почты капитана команды.';

/** Сравнение без утечки времени: значения хэшируются и сравниваются побайтово. */
function sameSecret(left: string, right: string): boolean {
  const a = crypto.createHash('sha256').update(left).digest();
  const b = crypto.createHash('sha256').update(right).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Контекст команды по паре «номер заявки + почта капитана». */
async function contextByPublicNumber(publicNumber: string, email: string): Promise<TeamContext | null> {
  const application = await query(
    `SELECT t.id AS team_id
       FROM applications a
       JOIN teams t ON t.id = a.team_id
      WHERE upper(a.public_number) = upper($1)
      LIMIT 1`,
    [publicNumber]
  );
  const teamId = application.rows[0]?.team_id;
  if (teamId === undefined) return null;

  const captain = await query(
    `SELECT email
       FROM participants
      WHERE team_id = $1 AND role = 'captain'
      ORDER BY id
      LIMIT 1`,
    [teamId]
  );
  const captainEmail = captain.rows[0]?.email;
  if (!captainEmail) return null;
  if (!sameSecret(normalizeEmail(String(captainEmail)), normalizeEmail(email))) return null;

  return loadTeamContext(Number(teamId), null, 'вход по номеру заявки');
}

// POST /api/cabinet/access — вход по ссылке-токену либо по номеру заявки.
router.post(
  '/access',
  rateLimit(10, 60_000),
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const token = requiredText(body.token, 500);

    let context: TeamContext | null = null;
    if (token) {
      context = await authenticateTeamToken(token);
    } else {
      const publicNumber = requiredText(body.public_number, 32);
      if (!publicNumber) {
        res.status(400).json({
          error: 'Передайте ссылку-токен доступа либо номер заявки и адрес электронной почты капитана.',
        });
        return;
      }
      if (!isEmail(body.email)) {
        res.status(400).json({ error: 'Укажите корректный адрес электронной почты капитана команды.' });
        return;
      }
      context = await contextByPublicNumber(publicNumber, String(body.email));
    }

    if (!context) {
      res.status(401).json({ error: token ? 'Ссылка доступа недействительна, отозвана или истекла.' : ACCESS_DENIED });
      return;
    }
    if (context.teamStatus === 'disqualified' || context.teamStatus === 'withdrawn') {
      res.status(403).json({ error: 'Доступ к личному кабинету для этой команды закрыт.' });
      return;
    }

    setTeamSessionCookie(res, signTeamSession(context.teamId, context.tokenId));
    void logAccess(context, req, token ? 'cabinet_login_by_token' : 'cabinet_login_by_number');

    res.json({
      success: true,
      team: { id: context.teamId, name: context.teamName, status: context.teamStatus },
      cabinet_url: '/cabinet',
    });
  })
);

// POST /api/cabinet/logout — выход из кабинета.
router.post(
  '/logout',
  asyncHandler(async (_req, res) => {
    clearTeamSessionCookie(res);
    res.json({ success: true });
  })
);

// GET /api/cabinet/session — состояние сессии кабинета.
router.get(
  '/session',
  asyncHandler(async (req, res) => {
    const session = verifyTeamSession(readCookie(req, TEAM_SESSION_COOKIE));
    if (!session) {
      res.json({ authenticated: false });
      return;
    }
    const context = await loadTeamContext(session.teamId, session.accessTokenId);
    if (!context) {
      clearTeamSessionCookie(res);
      res.json({ authenticated: false });
      return;
    }
    res.json({
      authenticated: true,
      team: { id: context.teamId, name: context.teamName, status: context.teamStatus },
    });
  })
);

export default router;
