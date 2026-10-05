import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { query } from '../db.js';
import { TEAM_SESSION_COOKIE, readCookie, verifyTeamSession } from '../lib/team-session.js';

// ─── Доступ команды в личный кабинет ─────────────────────────────────────────
// Команда входит двумя способами: по ссылке-токену доступа (в БД лежит только
// SHA-256 токена) либо парой «номер заявки + адрес электронной почты капитана».
// Оба способа обмениваются на подписанную сессионную cookie; после этого
// кабинет работает по cookie.

export interface TeamContext {
  /** Токен доступа, если вход был по ссылке; для входа по номеру заявки — null. */
  tokenId: number | null;
  teamId: number;
  teamName: string;
  teamStatus: string;
  seasonId: number;
  label: string | null;
}

export function hashAccessToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Генерирует новый токен доступа (показывается команде один раз). */
export function generateAccessToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** Токен команды: Authorization: Bearer … либо заголовок X-Team-Token. */
export function teamTokenFromRequest(req: Request): string | undefined {
  const header = req.headers.authorization;
  const bearer = typeof header === 'string' ? header.match(/^Bearer ([^\s]+)$/) : null;
  if (bearer?.[1]) return bearer[1];
  const direct = req.headers['x-team-token'];
  if (typeof direct === 'string' && direct.trim() !== '') return direct.trim();
  return undefined;
}

/** Загружает контекст команды по идентификатору (общий путь для обоих входов). */
export async function loadTeamContext(
  teamId: number,
  tokenId: number | null,
  label: string | null = null,
  sessionEpoch: number | null = null
): Promise<TeamContext | null> {
  try {
    const teamResult = await query(
      `SELECT id, name, status, season_id, session_epoch FROM teams WHERE id = $1 LIMIT 1`,
      [teamId]
    );
    const team = teamResult.rows[0];
    if (!team) return null;
    // Сессия выдана до «Завершить все сеансы» — она больше не действует.
    if (sessionEpoch !== null && Number(team.session_epoch ?? 1) !== sessionEpoch) return null;

    return {
      tokenId,
      teamId: Number(team.id),
      teamName: String(team.name),
      teamStatus: String(team.status),
      seasonId: Number(team.season_id),
      label,
    };
  } catch (error) {
    console.error('Не удалось загрузить команду:', (error as Error).message);
    return null;
  }
}

/**
 * Проверяет токен и атомарно увеличивает счётчик использований.
 * Возвращает контекст команды либо null.
 */
export async function authenticateTeamToken(token: string | undefined): Promise<TeamContext | null> {
  if (!token) return null;
  try {
    const result = await query(
      `UPDATE access_tokens token
          SET used_count = token.used_count + 1,
              last_used_at = now()
        WHERE token.token_hash = $1
          AND token.revoked_at IS NULL
          AND token.expires_at > now()
          AND (token.max_uses = 0 OR token.used_count < token.max_uses)
        RETURNING token.id, token.team_id, token.label`,
      [hashAccessToken(token)]
    );
    const row = result.rows[0];
    if (!row) return null;

    return loadTeamContext(Number(row.team_id), Number(row.id), row.label ? String(row.label) : null);
  } catch (error) {
    console.error('Проверка токена команды не удалась:', (error as Error).message);
    return null;
  }
}

/**
 * Контекст команды по запросу: сначала ссылка-токен доступа, затем сессионная
 * cookie личного кабинета.
 */
export async function authenticateTeam(req: Request): Promise<TeamContext | null> {
  const token = teamTokenFromRequest(req);
  if (token) return authenticateTeamToken(token);

  const session = verifyTeamSession(readCookie(req, TEAM_SESSION_COOKIE));
  if (!session) return null;
  return loadTeamContext(session.teamId, session.accessTokenId, null, session.epoch);
}

/** Записывает факт обращения в журнал входов (best-effort). */
export async function logAccess(
  context: TeamContext,
  req: Request,
  event = 'cabinet_access',
  metadata: Record<string, unknown> = {}
): Promise<void> {
  try {
    await query(
      `INSERT INTO access_log (subject_type, team_id, user_id, token_id, event, ip, user_agent, metadata)
       VALUES ('team', $1, NULL, $2, $3, $4, $5, $6::jsonb)`,
      [
        context.teamId,
        context.tokenId,
        event,
        String(req.ip || req.socket.remoteAddress || 'unknown').slice(0, 64),
        String(req.headers['user-agent'] || '').slice(0, 500),
        JSON.stringify(metadata),
      ]
    );
  } catch (error) {
    console.error('Не удалось записать обращение в журнал доступа:', (error as Error).message);
  }
}

/** Middleware личного кабинета: кладёт контекст команды в res.locals.team. */
export async function requireTeam(req: Request, res: Response, next: NextFunction): Promise<void> {
  const context = await authenticateTeam(req);
  if (!context) {
    res.status(401).json({ error: 'Ссылка доступа недействительна, отозвана или истекла' });
    return;
  }
  if (context.teamStatus === 'disqualified' || context.teamStatus === 'withdrawn') {
    res.status(403).json({ error: 'Доступ к личному кабинету для этой команды закрыт' });
    return;
  }
  res.locals.team = context;
  void logAccess(context, req);
  next();
}

/** Контекст команды, положенный middleware requireTeam. */
export function teamContext(res: Response): TeamContext {
  return res.locals.team as TeamContext;
}
