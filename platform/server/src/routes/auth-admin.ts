import { Router, type NextFunction, type Request, type Response } from 'express';
import { ADMIN_IDLE_MINUTES, ADMIN_LOGIN_RATE_MAX, ADMIN_SESSION_TTL_HOURS } from '../config.js';
import { asyncHandler } from '../lib/http.js';
import {
  bearerToken,
  clientIpOf,
  journalAdminLogin,
  loginAdmin,
  loginBlockedFor,
  recordLoginFail,
  requireAdmin,
  resolveAdminIdentity,
  revokeAdminToken,
} from '../middleware/admin-auth.js';
import { rateLimit } from '../middleware/rate-limit.js';

// Вход и выход администратора. Остальные админские маршруты подключаются
// отдельным роутером с middleware requireAdmin (см. index.ts).

const router = Router();

/** Сведения о сеансе, которые нужны интерфейсу: роль, срок и окно бездействия. */
function sessionPayload(identity: {
  userId: number | null;
  role: string;
  email: string | null;
  fullName: string | null;
  mustChangePassword: boolean;
}) {
  return {
    // Идентификатор нужен интерфейсу для кнопки «Завершить все сеансы»;
    // для входа по паролю из окружения учётной записи нет — null.
    user_id: identity.userId,
    role: identity.role,
    email: identity.email,
    full_name: identity.fullName,
    must_change_password: identity.mustChangePassword,
    session_ttl_hours: ADMIN_SESSION_TTL_HOURS,
    idle_minutes: ADMIN_IDLE_MINUTES,
  };
}

// POST /api/admin/login — 5 попыток в минуту с одного IP.
router.post(
  '/login',
  // «Долгая» блокировка проверяется до burst-лимита: иначе при исчерпанном
  // лимите запросы отсекались бы общим сообщением, и блокировка адреса
  // оставалась невидимой (ТЗ 11, п. 5.4).
  (req: Request, res: Response, next: NextFunction) => {
    const blockedSeconds = loginBlockedFor(clientIpOf(req));
    if (blockedSeconds > 0) {
      res.set('Retry-After', String(blockedSeconds));
      res.status(429).json({ error: 'Слишком много неудачных попыток входа. Попробуйте позже.' });
      return;
    }
    next();
  },
  // Попытка, отсечённая burst-лимитом, — тоже признак перебора: учитываем её в
  // «долгой» блокировке по IP и пишем в журнал входов (ТЗ 11, п. 22–23).
  rateLimit(ADMIN_LOGIN_RATE_MAX, 60_000, (req) => {
    recordLoginFail(clientIpOf(req));
    void journalAdminLogin(req, false, 'rate_limited');
  }),
  asyncHandler(async (req, res) => {
    const blockedSeconds = loginBlockedFor(clientIpOf(req));
    if (blockedSeconds > 0) {
      res.set('Retry-After', String(blockedSeconds));
      res.status(429).json({ error: 'Слишком много неудачных попыток входа. Попробуйте позже.' });
      return;
    }

    const body = (req.body ?? {}) as { email?: unknown; login?: unknown; password?: unknown };
    const loginValue = body.login ?? body.email;
    const result = await loginAdmin(loginValue, body.password);

    if (result.status !== 200 || !result.token) {
      await journalAdminLogin(req, false, result.reason ?? 'bad_credentials', {
        email: typeof loginValue === 'string' ? loginValue.trim().toLowerCase().slice(0, 200) : null,
        userId: result.userId ?? null,
      });
      res.status(result.status).json({ error: result.error ?? 'Неверный логин или пароль' });
      return;
    }

    await journalAdminLogin(req, true, undefined, { email: result.email ?? null, userId: result.userId ?? null });
    res.json({
      token: result.token,
      token_type: 'Bearer',
      ...sessionPayload({
        userId: result.userId ?? null,
        role: result.role ?? 'admin',
        email: result.email ?? null,
        fullName: result.fullName ?? null,
        mustChangePassword: result.mustChangePassword === true,
      }),
    });
  })
);

// GET /api/admin/verify — проверка текущей сессии и сведения о роли.
router.get(
  '/verify',
  asyncHandler(async (req, res) => {
    const result = await resolveAdminIdentity(req);
    if (!result.ok) {
      res.status(result.status).json({ valid: false, reason: result.reason, error: result.message });
      return;
    }
    res.json({ valid: true, ...sessionPayload(result.identity) });
  })
);

// POST /api/admin/logout — отзыв текущего токена до истечения срока.
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await revokeAdminToken(bearerToken(req));
    res.json({ success: true });
  })
);

// POST /api/admin/sessions/heartbeat — отметка активности без чтения данных.
// Нужна интерфейсу, чтобы не считать бездействием долгую работу в одной форме.
router.post(
  '/sessions/heartbeat',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ success: true, idle_minutes: ADMIN_IDLE_MINUTES });
  })
);

export default router;
