import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { query } from '../db.js';

// ─── Доступ команды в личный кабинет ─────────────────────────────────────────
// После подачи заявки через Яндекс.Форму команда получает одноразовый/срочный
// токен доступа. В базе лежит только SHA-256 токена, поэтому утечка дампа не
// даёт входа. Токен можно отозвать, ограничить по числу использований и сроку.

export interface TeamContext {
  tokenId: number;
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

    const teamResult = await query(
      `SELECT id, name, status, season_id FROM teams WHERE id = $1 LIMIT 1`,
      [row.team_id]
    );
    const team = teamResult.rows[0];
    if (!team) return null;

    return {
      tokenId: Number(row.id),
      teamId: Number(team.id),
      teamName: String(team.name),
      teamStatus: String(team.status),
      seasonId: Number(team.season_id),
      label: row.label ? String(row.label) : null,
    };
  } catch (error) {
    console.error('Проверка токена команды не удалась:', (error as Error).message);
    return null;
  }
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
  const context = await authenticateTeamToken(teamTokenFromRequest(req));
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
