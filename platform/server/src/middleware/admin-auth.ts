import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import {
  ADMIN_IDLE_MINUTES,
  ADMIN_LOGIN_BLOCK_MINUTES,
  ADMIN_LOGIN_FAIL_MAX,
  ADMIN_LOGIN,
  ADMIN_PASSWORD,
  ADMIN_SESSION_SECRET,
  ADMIN_SESSION_TTL_HOURS,
} from '../config.js';
import { query } from '../db.js';

// ─── Админ-сессии: stateless HMAC-токен ──────────────────────────────────────
// Токен вида v3.<payload>.<sig> переживает рестарт процесса: он не хранится в
// памяти, а проверяется по подписи. В payload входит аудитория, время выпуска,
// срок и случайный jti — два входа никогда не дают одинаковый токен, а токен
// другого назначения нельзя подсунуть в админку. Отзыв хранится в таблице
// admin_session_revocations (только SHA-256 токена, не сам токен).

const AUDIENCE = 'liders-admin';
const SESSION_TTL_MS = ADMIN_SESSION_TTL_HOURS * 60 * 60 * 1000;

export type AdminRole = 'admin' | 'operator';

export type AdminPrincipal =
  | { kind: 'env'; role: 'admin' }
  | { kind: 'user'; userId: number; authVersion: number; role: AdminRole };

/** Опознанное действующее лицо админ-панели. */
export interface AdminIdentity {
  kind: 'env' | 'user';
  userId: number | null;
  email: string | null;
  fullName: string | null;
  role: AdminRole;
  jti: string;
  expiresAt: number;
  /** Пароль выдан администратором и ещё не заменён (ТЗ 11, п. 45). */
  mustChangePassword: boolean;
}

export type AdminAuthFailReason = 'invalid' | 'revoked' | 'idle' | 'unavailable';

export type AdminAuthResult =
  | { ok: true; identity: AdminIdentity }
  | { ok: false; status: number; reason: AdminAuthFailReason; message: string };

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

/** Роль допустима, если она объявлена или отсутствует (старые токены версии 3). */
function isAdminRoleOrAbsent(principal: { role?: unknown }): boolean {
  const raw = principal.role;
  return raw === undefined || raw === 'admin' || raw === 'operator';
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
          Number.isInteger(payload.principal.authVersion) &&
          isAdminRoleOrAbsent(payload.principal))) &&
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

// ─── Полная проверка сессии ──────────────────────────────────────────────────
// Подпись и срок проверяются без обращения к базе (verifyTokenSignature), но
// роль, блокировка и бездействие — только по базе: смена роли или блокировка
// учётной записи должны действовать немедленно, а не после истечения токена.

const IDLE_MS = ADMIN_IDLE_MINUTES * 60_000;
/** Отметку активности обновляем не чаще раза в минуту, чтобы не писать на каждый запрос. */
const ACTIVITY_WRITE_INTERVAL_MS = 60_000;

function identityFailure(reason: AdminAuthFailReason, message: string, status = 401): AdminAuthResult {
  return { ok: false, status, reason, message };
}

/**
 * Отметка активности сессии и проверка бездействия (ТЗ 07, п. 1.2).
 * Возвращает `false`, если сеанс пора завершить из-за бездействия.
 */
async function touchAdminSession(token: string, identity: AdminIdentity): Promise<boolean> {
  const hash = tokenHash(token);
  const existing = await query(
    'SELECT last_seen_at, expires_at FROM admin_session_activity WHERE token_hash = $1 LIMIT 1',
    [hash]
  );
  const row = existing.rows[0];

  if (!row) {
    await query(
      `INSERT INTO admin_session_activity (token_hash, user_id, principal, role, last_seen_at, expires_at)
       VALUES ($1, $2, $3, $4, now(), to_timestamp($5 / 1000.0))
       ON CONFLICT (token_hash) DO NOTHING`,
      [
        hash,
        identity.userId,
        identity.kind === 'env' ? 'env:owner' : `user:${identity.userId}`,
        identity.role,
        identity.expiresAt,
      ]
    );
    return true;
  }

  const lastSeen = new Date(row.last_seen_at).getTime();
  if (Date.now() - lastSeen > IDLE_MS) {
    await query('DELETE FROM admin_session_activity WHERE token_hash = $1', [hash]);
    return false;
  }
  if (Date.now() - lastSeen > ACTIVITY_WRITE_INTERVAL_MS) {
    await query(
      `UPDATE admin_session_activity SET last_seen_at = now()
        WHERE token_hash = $1 AND last_seen_at < now() - interval '60 seconds'`,
      [hash]
    );
  }
  return true;
}

/** Подпись, срок, отзыв, роль, блокировка и бездействие — одним вызовом. */
export async function resolveAdminIdentity(req: Request): Promise<AdminAuthResult> {
  const token = bearerToken(req);
  const payload = verifyTokenSignature(token);
  if (!payload || !token) {
    return identityFailure('invalid', 'Требуется авторизация администратора');
  }

  try {
    const revoked = await query(
      'SELECT 1 FROM admin_session_revocations WHERE token_hash = $1 AND expires_at > now() LIMIT 1',
      [tokenHash(token)]
    );
    if (revoked.rows.length !== 0) {
      return identityFailure('revoked', 'Сеанс завершён. Войдите заново.');
    }

    let identity: AdminIdentity;
    if (payload.principal.kind === 'env') {
      identity = {
        kind: 'env',
        userId: null,
        email: ADMIN_LOGIN ?? null,
        fullName: 'Владелец (пароль из окружения)',
        role: 'admin',
        jti: payload.jti,
        expiresAt: payload.exp,
        mustChangePassword: false,
      };
    } else {
      const current = await query(
        `SELECT id, email, full_name, role, is_active, auth_version, must_change_password
           FROM users WHERE id = $1 LIMIT 1`,
        [payload.principal.userId]
      );
      const user = current.rows[0];
      const role: AdminRole = user?.role === 'admin' ? 'admin' : 'operator';
      if (
        !user ||
        user.is_active !== true ||
        (user.role !== 'admin' && user.role !== 'operator') ||
        Number(user.auth_version || 1) !== payload.principal.authVersion
      ) {
        return identityFailure('revoked', 'Сеанс завершён. Войдите заново.');
      }
      identity = {
        kind: 'user',
        userId: Number(user.id),
        email: String(user.email),
        fullName: user.full_name ? String(user.full_name) : null,
        role,
        jti: payload.jti,
        expiresAt: payload.exp,
        mustChangePassword: user.must_change_password === true,
      };
    }

    if (!(await touchAdminSession(token, identity))) {
      return identityFailure(
        'idle',
        `Сеанс завершён: бездействие более ${ADMIN_IDLE_MINUTES} минут. Войдите заново.`
      );
    }

    return { ok: true, identity };
  } catch (error) {
    console.error('Проверка админ-сессии не удалась:', (error as Error).message);
    return identityFailure('unavailable', 'Не удалось проверить сеанс. Повторите попытку.', 503);
  }
}

/**
 * Проверка сессии для отдачи приватных файлов: тот же набор правил, что и у
 * админских маршрутов, включая выход по бездействию.
 */
export async function verifyAdminToken(req: Request): Promise<boolean> {
  return (await resolveAdminIdentity(req)).ok;
}

/** Middleware защиты админских маршрутов: пускает обе роли. */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const result = await resolveAdminIdentity(req);
  if (!result.ok) {
    res.status(result.status).json({ error: result.message, reason: result.reason });
    return;
  }
  res.locals.admin = result.identity;
  next();
}

/**
 * Middleware для разделов, доступных только роли `admin` (ТЗ 07, п. 1.3):
 * пользователи, настройки, эксперты, публикация протоколов, выгрузка ПДн.
 * Ставится после requireAdmin — тот уже положил действующее лицо в res.locals.
 */
export function requireAdminRole(role: AdminRole) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const identity = res.locals.admin as AdminIdentity | undefined;
    if (!identity) {
      res.status(401).json({ error: 'Требуется авторизация администратора' });
      return;
    }
    if (identity.role !== role) {
      res.status(403).json({
        error:
          'Недостаточно прав: раздел доступен только роли «администратор». ' +
          'Обратитесь к администратору платформы.',
        required_role: role,
      });
      return;
    }
    next();
  };
}

/** Действующее лицо текущего запроса (после requireAdmin). */
export function currentAdmin(res: Response): AdminIdentity | undefined {
  return res.locals.admin as AdminIdentity | undefined;
}

/**
 * Тот же запрет, что и requireAdminRole('admin'), но только для изменяющих
 * запросов. Справочники (сезоны, направления, критерии, эксперты) оператору
 * нужно читать, чтобы работать с заявками и оценками, а менять их — нет
 * (ТЗ 07, п. 1.3).
 */
export function requireAdminForWrites(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  requireAdminRole('admin')(req, res, next);
}

/** Роль по токену без обращения к базе — для записей журнала. */
export function adminRoleOfRequest(req: Request): AdminRole {
  const principal = verifyTokenSignature(bearerToken(req))?.principal;
  return principal?.kind === 'user' && principal.role === 'operator' ? 'operator' : 'admin';
}

// ─── Anti-brute-force входа ──────────────────────────────────────────────────
// Поверх burst-лимита rateLimit(5/мин) держим «долгую» блокировку по IP.
const loginFails = new Map<string, { count: number; firstAt: number; until: number }>();
const LF_WINDOW_MS = 15 * 60_000;
const LF_MAX = ADMIN_LOGIN_FAIL_MAX;
const LF_BLOCK_MS = ADMIN_LOGIN_BLOCK_MINUTES * 60_000;

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginFails) {
    if (entry.until < now && now - entry.firstAt > LF_WINDOW_MS) loginFails.delete(ip);
  }
  void cleanupAdminSessionActivity().catch((error: unknown) =>
    console.error('Уборка отметок активности сессий не удалась:', (error as Error).message)
  );
}, 5 * 60_000).unref?.();

export function clientIpOf(req: Request): string {
  return String(req.ip || req.socket.remoteAddress || 'unknown').slice(0, 64);
}

export function loginBlockedFor(ip: string): number {
  const entry = loginFails.get(ip);
  if (entry && entry.until > Date.now()) return Math.ceil((entry.until - Date.now()) / 1000);
  return 0;
}

/**
 * Учитывает неудачную попытку входа для «долгой» блокировки по IP.
 * Экспортируется, чтобы burst-лимит (429) тоже приближал блокировку: без этого
 * LF_MAX был недостижим — запросы отсекались раньше, чем набиралось 10 неудач.
 */
export function recordLoginFail(ip: string): void {
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
export interface LoginJournalContext {
  email?: string | null;
  userId?: number | null;
}

export async function journalAdminLogin(
  req: Request,
  success: boolean,
  reason?: string,
  context: LoginJournalContext = {}
): Promise<void> {
  const ip = clientIpOf(req);
  if (success) clearLoginFails(ip);
  else recordLoginFail(ip);

  try {
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 500);
    await query(
      `INSERT INTO auth_log (event, email, user_id, ip, user_agent, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        success ? 'admin_login_success' : 'admin_login_fail',
        context.email ?? null,
        context.userId ?? null,
        ip,
        userAgent,
        success ? null : reason ?? 'bad_credentials',
      ]
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
  /** Причина отказа для журнала входов: различает пароль и блокировку. */
  reason?: 'bad_credentials' | 'account_blocked';
  userId?: number | null;
  role?: AdminRole;
  email?: string | null;
  fullName?: string | null;
  mustChangePassword?: boolean;
}

/**
 * Вход в админ-панель. Приоритет:
 *   (A) ADMIN_LOGIN + ADMIN_PASSWORD из окружения — роль `admin`;
 *   (B) запись в users с ролью `admin` или `operator` (email + bcrypt, ТЗ 07 п. 1.3);
 *   (C) общий ADMIN_PASSWORD без логина — только если ADMIN_LOGIN не задан.
 * Заблокированная запись (`is_active = false`) не пускается ни при верном пароле.
 */
export async function loginAdmin(loginInput: unknown, passwordInput: unknown): Promise<LoginResult> {
  if (typeof passwordInput !== 'string' || passwordInput.length === 0) {
    return { status: 401, error: 'Неверный логин или пароль' };
  }
  const login = typeof loginInput === 'string' ? loginInput.trim() : '';

  if (ADMIN_LOGIN && safeEqual(login, ADMIN_LOGIN) && safeEqual(passwordInput, ADMIN_PASSWORD)) {
    return { status: 200, token: createSession({ kind: 'env', role: 'admin' }), role: 'admin', email: ADMIN_LOGIN };
  }

  if (login) {
    try {
      const result = await query(
        `SELECT id, email, full_name, password_hash, role, is_active, auth_version, must_change_password
           FROM users WHERE email = $1 LIMIT 1`,
        [login.toLowerCase()]
      );
      const user = result.rows[0];
      const userRole: AdminRole | null =
        user?.role === 'admin' ? 'admin' : user?.role === 'operator' ? 'operator' : null;
      if (user && user.password_hash && (await bcrypt.compare(passwordInput, user.password_hash))) {
        if (userRole && user.is_active === true) {
          await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
          return {
            status: 200,
            token: createSession({
              kind: 'user',
              userId: Number(user.id),
              authVersion: Number(user.auth_version || 1),
              role: userRole,
            }),
            userId: Number(user.id),
            role: userRole,
            email: String(user.email),
            fullName: user.full_name ? String(user.full_name) : null,
            mustChangePassword: user.must_change_password === true,
          };
        }
        // Пароль верный, но учётная запись заблокирована или роль снята:
        // клиенту — общий отказ, в журнал — причина и автор попытки.
        return {
          status: 401,
          error: 'Неверный логин или пароль',
          reason: user.is_active === true ? 'bad_credentials' : 'account_blocked',
          userId: Number(user.id),
        };
      }
      if (user) {
        // Учётная запись существует: запись в журнал должна быть привязана к ней,
        // иначе разбор «кто подбирал пароль» упирается в один сетевой адрес.
        return { status: 401, error: 'Неверный логин или пароль', reason: 'bad_credentials', userId: Number(user.id) };
      }
    } catch (error) {
      console.error('Ошибка входа по учётной записи:', (error as Error).message);
    }
  }

  if (!ADMIN_LOGIN && !login && safeEqual(passwordInput, ADMIN_PASSWORD)) {
    return { status: 200, token: createSession({ kind: 'env', role: 'admin' }), role: 'admin', email: null };
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
  await query('DELETE FROM admin_session_activity WHERE token_hash = $1', [tokenHash(token)]);
}

/**
 * Завершает все сеансы учётной записи: смена пароля и кнопка «Завершить все
 * сеансы» (ТЗ 07, п. 1.2). Версия авторизации входит в токен, поэтому выданные
 * ранее токены перестают проходить проверку немедленно.
 */
export async function revokeAllAdminSessions(userId: number): Promise<number> {
  const result = await query(
    `UPDATE users SET auth_version = auth_version + 1, updated_at = now()
      WHERE id = $1 RETURNING auth_version`,
    [userId]
  );
  await query('DELETE FROM admin_session_activity WHERE user_id = $1', [userId]);
  return result.rows.length;
}

/** Сколько активных сеансов у учётной записи: показывается в списке пользователей. */
export async function countActiveAdminSessions(userId: number): Promise<number> {
  const result = await query(
    `SELECT count(*)::int AS total FROM admin_session_activity
      WHERE user_id = $1 AND expires_at > now() AND last_seen_at > now() - ($2 || ' minutes')::interval`,
    [userId, String(ADMIN_IDLE_MINUTES)]
  );
  return Number(result.rows[0]?.total ?? 0);
}

/** Уборка протухших отметок активности: вызывается вместе с очисткой блокировок. */
export async function cleanupAdminSessionActivity(): Promise<void> {
  await query('DELETE FROM admin_session_activity WHERE expires_at < now()');
}
