import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { IS_PRODUCTION } from '../config.js';
import { query } from '../db.js';
import { asyncHandler, parsePositiveInt } from '../lib/http.js';
import {
  EXPERT_SESSION_COOKIE,
  signExpertSession,
  verifyExpertSession,
} from '../lib/expert-session.js';
import { readCookie } from '../lib/team-session.js';
import { optionalText } from '../lib/validation.js';
import { rateLimit } from '../middleware/rate-limit.js';
// Этапы конкурса: те же значения, что и в остальных маршрутах.
const STAGES = ['selection', 'stage1', 'debate'] as const;

// Контур эксперта (ТЗ 07, п. 2.5).
//
// Эксперт входит по разовой ссылке, выданной администратором, видит работы
// своего этапа и вносит оценки по критериям. Доступа к админке, кабинету команд
// и персональным данным участников у него нет: в выдаче только название команды,
// направление и сведения об инициативе — то, что нужно для оценки (Приложение № 9).

const router = Router();

/** Хэш токена: в базе хранится только он. */
export function hashExpertToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Случайный токен ссылки: 32 байта энтропии. */
export function generateExpertToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

interface ExpertContext {
  expertId: number;
  stage: string;
  fullName: string;
  tokenId: number;
}

/** Проверяет сессионную cookie эксперта. */
async function expertFromRequest(req: Request): Promise<ExpertContext | null> {
  const session = verifyExpertSession(readCookie(req, EXPERT_SESSION_COOKIE));
  if (!session) return null;
  const result = await query(
    'SELECT id, full_name, stage, is_active FROM experts WHERE id = $1 LIMIT 1',
    [session.expertId]
  );
  const row = result.rows[0];
  if (!row || row.is_active !== true) return null;
  return { expertId: Number(row.id), stage: String(row.stage ?? session.stage), fullName: String(row.full_name), tokenId: session.tokenId };
}

/** Закрывает маршруты контура: без сессии — 401 с понятным сообщением. */
function requireExpert(req: Request, res: Response, next: NextFunction): void {
  void expertFromRequest(req).then((context) => {
    if (!context) {
      res.status(401).json({
        error: 'Ссылка доступа недействительна или срок её действия истёк. Запросите новую у Оргкомитета.',
      });
      return;
    }
    (res.locals as { expert?: ExpertContext }).expert = context;
    next();
  });
}

function expertOf(res: Response): ExpertContext {
  return (res.locals as { expert?: ExpertContext }).expert as ExpertContext;
}

/** Запись обращения эксперта в журнал контура. */
async function logExpert(expertId: number, event: string, req: Request, teamId?: number): Promise<void> {
  try {
    await query(
      `INSERT INTO expert_access_log (expert_id, event, team_id, ip) VALUES ($1, $2, $3, $4)`,
      [expertId, event, teamId ?? null, String(req.ip || req.socket.remoteAddress || '').slice(0, 64)]
    );
  } catch (error) {
    console.error('Не удалось записать обращение эксперта:', (error as Error).message);
  }
}

// POST /api/expert/access — обмен разовой ссылки на сессию эксперта.
router.post(
  '/access',
  rateLimit(10, 60_000),
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (token === '') {
      res.status(400).json({ error: 'Передайте ссылку доступа: без неё вход невозможен.' });
      return;
    }

    const result = await query(
      `SELECT t.id, t.expert_id, t.expires_at, t.revoked_at, e.full_name, e.stage, e.is_active
         FROM expert_access_tokens t
         JOIN experts e ON e.id = t.expert_id
        WHERE t.token_hash = $1
        LIMIT 1`,
      [hashExpertToken(token)]
    );
    const row = result.rows[0];
    if (!row || row.revoked_at !== null || new Date(String(row.expires_at)).getTime() < Date.now()) {
      res.status(401).json({
        error: 'Ссылка доступа недействительна, отозвана или истекла. Запросите новую у Оргкомитета.',
      });
      return;
    }
    if (row.is_active !== true) {
      res.status(403).json({ error: 'Доступ эксперта закрыт Оргкомитетом.' });
      return;
    }

    const stage = String(row.stage ?? '');
    if (!STAGES.includes(stage as (typeof STAGES)[number])) {
      res.status(409).json({ error: 'Этап эксперта не определён: обратитесь в Оргкомитет.' });
      return;
    }

    await query(
      `UPDATE expert_access_tokens
          SET last_used_at = now(), used_count = used_count + 1
        WHERE id = $1`,
      [row.id]
    );

    res.cookie(EXPERT_SESSION_COOKIE, signExpertSession({ expertId: Number(row.expert_id), stage, tokenId: Number(row.id) }), {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: 'lax',
      path: '/',
      maxAge: 12 * 60 * 60 * 1000,
    });

    await logExpert(Number(row.expert_id), 'expert_login', req);
    res.json({ success: true, expert: { id: Number(row.expert_id), full_name: String(row.full_name), stage } });
  })
);

// POST /api/expert/logout — завершение работы.
router.post(
  '/logout',
  asyncHandler(async (_req, res) => {
    res.clearCookie(EXPERT_SESSION_COOKIE, { path: '/' });
    res.json({ success: true });
  })
);

// GET /api/expert/session — состояние сессии эксперта.
router.get(
  '/session',
  asyncHandler(async (req, res) => {
    const context = await expertFromRequest(req);
    if (!context) {
      res.status(401).json({ authenticated: false });
      return;
    }
    res.json({ authenticated: true, expert: { id: context.expertId, full_name: context.fullName, stage: context.stage } });
  })
);

// GET /api/expert/assignments — работы этапа с оценкой этого эксперта.
router.get(
  '/assignments',
  requireExpert,
  asyncHandler(async (req, res) => {
    const context = expertOf(res);

    const teams = await query(
      `SELECT t.id AS team_id, t.name AS team_name, t.status AS team_status,
              d.title AS direction_title,
              a.law_title, a.act_level, a.annotation,
              e.id AS evaluation_id, e.total_score, e.scores, e.comment, e.recommendations,
              e.is_chair_extra, e.is_conflicted, e.conflict_reason, e.updated_at
         FROM teams t
         JOIN seasons s ON s.id = t.season_id
         LEFT JOIN directions d ON d.id = t.direction_id
         LEFT JOIN applications a ON a.team_id = t.id
         LEFT JOIN evaluations e
           ON e.team_id = t.id AND e.stage = $1 AND e.expert_id = $2
        WHERE s.is_active = TRUE
          AND t.status NOT IN ('draft', 'submitted', 'tech_check', 'tech_rejected', 'disqualified', 'withdrawn')
        ORDER BY t.name`,
      [context.stage, context.expertId]
    );

    const criteria = await query(
      `SELECT id, code, title, description, max_score, sort_order
         FROM criteria
        WHERE stage = $1 AND is_active = TRUE
        ORDER BY sort_order, id`,
      [context.stage]
    );

    res.json({
      expert: { id: context.expertId, full_name: context.fullName, stage: context.stage },
      criteria: criteria.rows,
      teams: teams.rows,
    });
  })
);

// POST /api/expert/evaluations — оценка работы (Приложение № 9).
router.post(
  '/evaluations',
  requireExpert,
  asyncHandler(async (req, res) => {
    const context = expertOf(res);
    const body = (req.body ?? {}) as Record<string, unknown>;

    const teamId = parsePositiveInt(body.team_id);
    if (teamId === null) {
      res.status(400).json({ error: 'Укажите команду' });
      return;
    }

    // Работа должна принадлежать этапу эксперта: иначе оценка ушла бы не туда.
    const team = await query(
      `SELECT t.id
         FROM teams t
         JOIN seasons s ON s.id = t.season_id
        WHERE t.id = $1 AND s.is_active = TRUE
          AND t.status NOT IN ('draft', 'submitted', 'tech_check', 'tech_rejected', 'disqualified', 'withdrawn')
        LIMIT 1`,
      [teamId]
    );
    if (team.rows.length === 0) {
      res.status(404).json({ error: 'Работа не найдена среди назначенных вам на этом этапе.' });
      return;
    }

    const criteriaResult = await query(
      'SELECT id, max_score FROM criteria WHERE stage = $1 AND is_active = TRUE',
      [context.stage]
    );
    const maxById = new Map<number, number>();
    for (const row of criteriaResult.rows) maxById.set(Number(row.id), Number(row.max_score));
    if (maxById.size === 0) {
      res.status(409).json({ error: 'Для этапа не заданы критерии оценки: обратитесь в Оргкомитет.' });
      return;
    }

    const rawScores = Array.isArray(body.scores) ? body.scores : [];
    if (rawScores.length === 0) {
      res.status(400).json({ error: 'Передайте баллы по критериям' });
      return;
    }

    const scores: Array<{ criterion_id: number; score: number; comment: string | null }> = [];
    let total = 0;
    for (const raw of rawScores) {
      const item = raw as Record<string, unknown>;
      const criterionId = parsePositiveInt(item?.criterion_id);
      if (criterionId === null || !maxById.has(criterionId)) {
        res.status(400).json({ error: 'Критерий не относится к вашему этапу' });
        return;
      }
      const score = Number(item?.score);
      const maxScore = maxById.get(criterionId) as number;
      if (!Number.isFinite(score) || score < 0 || score > maxScore) {
        res.status(400).json({ error: `Балл по критерию должен быть от 0 до ${maxScore}` });
        return;
      }
      total += score;
      // Приложение № 9: у каждого критерия — балл и обоснование.
      scores.push({
        criterion_id: criterionId,
        score: Math.round(score * 100) / 100,
        comment: optionalText(item?.comment, 1000),
      });
    }

    const totalScore = Math.round(total * 100) / 100;
    const comment = optionalText(body.comment, 3000);
    const recommendations = optionalText(body.recommendations, 3000);
    const isConflicted = body.is_conflicted === true;
    const conflictReason = optionalText(body.conflict_reason, 1000);
    if (isConflicted && !conflictReason) {
      res.status(400).json({
        error: 'Укажите причину конфликта интересов: оценка сохранится, но не будет учитываться.',
      });
      return;
    }

    const existing = await query(
      'SELECT id FROM evaluations WHERE team_id = $1 AND stage = $2 AND expert_id = $3 LIMIT 1',
      [teamId, context.stage, context.expertId]
    );

    const saved = existing.rows[0]
      ? await query(
          `UPDATE evaluations
              SET scores = $1::jsonb, total_score = $2, comment = $3, recommendations = $4,
                  is_conflicted = $5, conflict_reason = $6, updated_at = now()
            WHERE id = $7
            RETURNING id, total_score, updated_at`,
          [
            JSON.stringify(scores),
            totalScore,
            comment,
            recommendations,
            isConflicted,
            conflictReason,
            existing.rows[0].id,
          ]
        )
      : await query(
          `INSERT INTO evaluations
             (team_id, stage, expert_id, scores, total_score, comment, recommendations,
              is_conflicted, conflict_reason, created_by)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, NULL)
           RETURNING id, total_score, updated_at`,
          [
            teamId,
            context.stage,
            context.expertId,
            JSON.stringify(scores),
            totalScore,
            comment,
            recommendations,
            isConflicted,
            conflictReason,
          ]
        );

    await logExpert(context.expertId, existing.rows[0] ? 'evaluation_updated' : 'evaluation_created', req, teamId);

    res.status(existing.rows[0] ? 200 : 201).json({
      success: true,
      evaluation_id: Number(saved.rows[0].id),
      total_score: saved.rows[0].total_score,
      updated_at: saved.rows[0].updated_at,
    });
  })
);

// GET /api/expert/log — краткая история работы эксперта (для Оргкомитета в админке).
router.get(
  '/log',
  requireExpert,
  asyncHandler(async (_req, res) => {
    const context = expertOf(res);
    const result = await query(
      `SELECT event, team_id, created_at FROM expert_access_log
        WHERE expert_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [context.expertId]
    );
    res.json(result.rows);
  })
);

// Служебный экспорт для админских маршрутов (выдача и отзыв ссылок).
export { EXPERT_SESSION_COOKIE };
export default router;
