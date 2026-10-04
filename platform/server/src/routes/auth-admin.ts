import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import {
  bearerToken,
  clientIpOf,
  journalAdminLogin,
  loginAdmin,
  loginBlockedFor,
  revokeAdminToken,
  verifyAdminToken,
} from '../middleware/admin-auth.js';
import { rateLimit } from '../middleware/rate-limit.js';

// Вход и выход администратора. Остальные админские маршруты подключаются
// отдельным роутером с middleware requireAdmin (см. index.ts).

const router = Router();

// POST /api/admin/login — 5 попыток в минуту с одного IP.
router.post(
  '/login',
  rateLimit(5, 60_000),
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
      await journalAdminLogin(req, false, 'bad_credentials');
      res.status(result.status).json({ error: result.error ?? 'Неверный логин или пароль' });
      return;
    }

    await journalAdminLogin(req, true);
    res.json({ token: result.token, token_type: 'Bearer' });
  })
);

// GET /api/admin/verify — проверка текущей сессии.
router.get(
  '/verify',
  asyncHandler(async (req, res) => {
    const valid = await verifyAdminToken(bearerToken(req));
    res.status(valid ? 200 : 401).json({ valid });
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

export default router;
