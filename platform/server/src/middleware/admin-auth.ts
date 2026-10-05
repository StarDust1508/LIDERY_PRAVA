import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import { ADMIN_LOGIN, ADMIN_PASSWORD, ADMIN_SESSION_SECRET, ADMIN_SESSION_TTL_HOURS } from '../config.js';
import { query } from '../db.js';

// ─── Админ-сессии: stateless HMAC-токен ──────────────────────────────────────
// Токен вида v3.<payload>.<sig> переживает рестарт процесса: он не хранится в
// памяти, а проверяется по подписи. В payload входит аудитория, время выпуска,
// срок и случайный jti — два входа никогда не дают одинаковый токен, а токен
// другого назначения нельзя подсунуть в админку. Отзыв хранится в таблице
// admin_session_revocations (только SHA-256 токена, не сам токен).

const AUDIENCE = 'liders-admin';
const SESSION_TTL_MS = ADMIN_SESSION_TTL_HOURS * 60 * 60 * 1000;

export type AdminPrincipal = { kind: 'env' } | { kind: 'user'; userId: number; authVersion: number };

export interface AdminSessionPayload {
  aud: typeof AUDIENCE;
  iat: number;
  exp: number;
  jti: string;
  principal: AdminPrincipal;
}

function b64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBuffer(value: string): Buffer {
  let normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4) normalized += '=';
  return Buffer.from(normalized, 'base64');
}

function signPayload(payloadB64: string): string {
  return b64url(crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(payloadB64).digest());
}

export function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Сравнение строк за постоянное время — защита от timing-атак на входе. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function bearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  const match = typeof header === 'string' ? header.match(/^Bearer ([^\s]+)$/) : null;
  return match?.[1];
}

function createSession(principal: AdminPrincipal): string {
  const iat = Date.now();
  const payload = b64url(
    Buffer.from(
      JSON.stringify({
        aud: AUDIENCE,
        iat,
        exp: iat + SESSION_TTL_MS,
        jti: b64url(crypto.randomBytes(18)),
        principal,
      }),
      'utf8'
    )
  );
  return `v3.${payload}.${signPayload(payload)}`;
}

/** Синхронно проверяет формат, подпись и срок жизни токена. */
export function verifyTokenSignature(token: string | undefined): AdminSessionPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v3') return null;

  const [, payloadB64, signature] = parts;
  let expected: string;
  try {
    expected = signPayload(payloadB64);
  } catch {
    return null;
  }

  const provided = Buffer.from(signature, 'utf8');
  const reference = Buffer.from(expected, 'utf8');
  if (provided.length !== reference.length || !crypto.timingSafeEqual(provided, reference)) return null;

  try {
    const payload = JSON.parse(b64urlToBuffer(payloadB64).toString('utf8')) as Partial<AdminSessionPayload>;
    const now = Date.now();
    const valid =
      payload.aud === AUDIENCE &&
      typeof payload.iat === 'number' &&
      typeof payload.exp === 'number' &&
      typeof payload.jti === 'string' &&
      payload.jti.length >= 16 &&
      typeof payload.principal === 'object' &&
      payload.principal !== null &&
      (payload.principal.kind === 'env' ||
        (payload.principal.kind === 'user' &&
          Number.isInteger(payload.principal.userId) &&
          Number.isInteger(payload.principal.authVersion))) &&
      payload.iat <= now + 30_000 &&
      payload.exp > payload.iat &&
      payload.exp - payload.iat <= 24 * 60 * 60 * 1000 &&
      now <= payload.exp;

    return valid
      ? {
          aud: AUDIENCE,
          iat: payload.iat as number,
          exp: payload.exp as number,
          jti: payload.jti as string,
          principal: payload.principal as AdminPrincipal,
        }
      : null;
  } catch {
    return null;
  }
}

/** Полная проверка: подпись плюс отсутствие отзыва и актуальность записи users. */
export async function verifyAdminToken(token: string | undefined): Promise<boolean> {
  const payload = verifyTokenSignature(token);
  if (!payload || !token) return false;
  try {
    const revoked = await query(
      'SELECT 1 FROM admin_session_revocations WHERE token_hash = $1 AND expires_at > now() LIMIT 1',
      [tokenHash(token)]
    );
    if (revoked.rows.length !== 0) return false;
    if (payload.principal.kind === 'env') return true;

    const current = await query('SELECT role, is_active, auth_version FROM users WHERE id = $1 LIMIT 1', [
      payload.principal.userId,
    ]);
    const user = current.rows[0];
    return Boolean(
      user &&
        user.role === 'admin' &&
        user.is_active === true &&
        Number(user.auth_version || 1) === payload.principal.authVersion
    );
  } catch (error) {
    console.error('Проверка админ-сессии не удалась:', (error as Error).message);
    return false;
  }
}

/** Middleware защиты админских маршрутов. */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = bearerToken(req);
  if (!(await verifyAdminToken(token))) {
    res.status(401).json({ error: 'Требуется авторизация администратора' });
    return;
  }
  next();
}

// ─── Anti-brute-force входа ──────────────────────────────────────────────────
// Поверх burst-лимита rateLimit(5/мин) держим «долгую» блокировку по IP.
const loginFails = new Map<string, { count: number; firstAt: number; until: number }>();
const LF_WINDOW_MS = 15 * 60_000;
const LF_MAX = 10;
const LF_BLOCK_MS = 15 * 60_000;

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginFails) {
    if (entry.until < now && now - entry.firstAt > LF_WINDOW_MS) loginFails.delete(ip);
  }
}, 5 * 60_000).unref?.();

export function clientIpOf(req: Request): string {
  return String(req.ip || req.socket.remoteAddress || 'unknown').slice(0, 64);
}

export function loginBlockedFor(ip: string): number {
  const entry = loginFails.get(ip);
  if (entry && entry.until > Date.now()) return Math.ceil((entry.until - Date.now()) / 1000);
  return 0;
}

function recordLoginFail(ip: string): void {
  const now = Date.now();
  let entry = loginFails.get(ip);
  if (!entry || now - entry.firstAt > LF_WINDOW_MS) entry = { count: 0, firstAt: now, until: 0 };
  entry.count += 1;
  if (entry.count >= LF_MAX) entry.until = now + LF_BLOCK_MS;
  loginFails.set(ip, entry);
}

function clearLoginFails(ip: string): void {
  loginFails.delete(ip);
}

// ─── Журнал входов (ст. 16 149-ФЗ) ───────────────────────────────────────────
// Best-effort: сбой записи журнала не должен ломать вход администратора.
export async function journalAdminLogin(req: Request, success: boolean, reason?: string): Promise<void> {
  const ip = clientIpOf(req);
  if (success) clearLoginFails(ip);
  else recordLoginFail(ip);

  try {
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 500);
    await query(
      `INSERT INTO auth_log (event, email, user_id, ip, user_agent, reason)
       VALUES ($1, NULL, NULL, $2, $3, $4)`,
      [success ? 'admin_login_success' : 'admin_login_fail', ip, userAgent, success ? null : reason ?? 'bad_credentials']
    );
  } catch (error) {
    console.error('Не удалось записать вход администратора в журнал:', (error as Error).message);
  }
}

/**
 * Проверка общего логина/пароля администратора (используется для входа и для
 * повторного подтверждения критических действий).
 */
export async function verifyAdminCredentials(loginValue: unknown, passwordValue: unknown): Promise<boolean> {
  if (typeof passwordValue !== 'string' || passwordValue.length === 0) return false;
  const login = typeof loginValue === 'string' ? loginValue.trim() : '';

  if (ADMIN_LOGIN && safeEqual(login, ADMIN_LOGIN) && safeEqual(passwordValue, ADMIN_PASSWORD)) {
    return true;
  }
  // Режим без логина: только пароль из окружения.
  if (!ADMIN_LOGIN && !login && safeEqual(passwordValue, ADMIN_PASSWORD)) {
    return true;
  }
  if (!login) return false;

  try {
    const result = await query(
      'SELECT password_hash, role, is_active FROM users WHERE email = $1 LIMIT 1',
      [login.toLowerCase()]
    );
    const user = result.rows[0];
    return Boolean(
      user &&
        user.role === 'admin' &&
        user.is_active === true &&
        user.password_hash &&
        (await bcrypt.compare(passwordValue, user.password_hash))
    );
  } catch (error) {
    console.error('Ошибка проверки админских учётных данных:', (error as Error).message);
    return false;
  }
}

// ─── Вспомогательные экспорты ────────────────────────────────────────────────

/** Псевдоним сессии для истории ревизий. Сам bearer-токен не сохраняется. */
export function adminAuditActor(req: Request): string {
  const payload = verifyTokenSignature(bearerToken(req));
  return payload ? `admin-session:${payload.jti.slice(0, 12)}` : 'admin-session:unknown';
}

/** Устойчивая личность администратора (env:owner или user:<id>) для аудита. */
export function adminStablePrincipal(req: Request): string | null {
  const principal = verifyTokenSignature(bearerToken(req))?.principal;
  if (!principal) return null;
  return principal.kind === 'env' ? 'env:owner' : `user:${principal.userId}`;
}

/**
 * Числовой идентификатор администратора, если вход был под учётной записью.
 * Для входа по паролю из окружения учётной записи нет — возвращается null.
 */
export function adminUserIdOf(req: Request): number | null {
  const principal = verifyTokenSignature(bearerToken(req))?.principal;
  if (!principal || principal.kind === 'env') return null;
  return principal.userId;
}

// ─── Выпуск и отзыв сессии ───────────────────────────────────────────────────

export interface LoginResult {
  token?: string;
  status: number;
  error?: string;
}

/**
 * Вход администратора. Приоритет:
 *   (A) ADMIN_LOGIN + ADMIN_PASSWORD из окружения — основной режим;
 *   (B) запись в users с ролью admin (email + bcrypt);
 *   (C) общий ADMIN_PASSWORD без логина — только если ADMIN_LOGIN не задан.
 */
export async function loginAdmin(loginInput: unknown, passwordInput: unknown): Promise<LoginResult> {
  if (typeof passwordInput !== 'string' || passwordInput.length === 0) {
    return { status: 401, error: 'Неверный логин или пароль' };
  }
  const login = typeof loginInput === 'string' ? loginInput.trim() : '';

  if (ADMIN_LOGIN && safeEqual(login, ADMIN_LOGIN) && safeEqual(passwordInput, ADMIN_PASSWORD)) {
    return { status: 200, token: createSession({ kind: 'env' }) };
  }

  if (login) {
    try {
      const result = await query(
        'SELECT id, password_hash, role, is_active, auth_version FROM users WHERE email = $1 LIMIT 1',
        [login.toLowerCase()]
      );
      const user = result.rows[0];
      if (
        user &&
        user.role === 'admin' &&
        user.is_active === true &&
        user.password_hash &&
        (await bcrypt.compare(passwordInput, user.password_hash))
      ) {
        return {
          status: 200,
          token: createSession({
            kind: 'user',
            userId: Number(user.id),
            authVersion: Number(user.auth_version || 1),
          }),
        };
      }
    } catch (error) {
      console.error('Ошибка входа по учётной записи:', (error as Error).message);
    }
  }

  if (!ADMIN_LOGIN && !login && safeEqual(passwordInput, ADMIN_PASSWORD)) {
    return { status: 200, token: createSession({ kind: 'env' }) };
  }

  return { status: 401, error: 'Неверный логин или пароль' };
}

/** Отзывает текущий токен до истечения срока. */
export async function revokeAdminToken(token: string | undefined): Promise<void> {
  const payload = verifyTokenSignature(token);
  if (!token || !payload) return;
  await query(
    `INSERT INTO admin_session_revocations (token_hash, expires_at)
     VALUES ($1, to_timestamp($2 / 1000.0))
     ON CONFLICT (token_hash) DO NOTHING`,
    [tokenHash(token), payload.exp]
  );
}
