import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import { IS_PRODUCTION, JWT_SECRET } from '../config.js';

// Сессия личного кабинета команды. Пароля у команды нет: ссылка-токен доступа
// или пара «номер заявки + адрес электронной почты капитана» обмениваются на
// подписанную cookie. В cookie лежит только идентификатор команды — ни ПДн,
// ни токена доступа там нет.

export const TEAM_SESSION_COOKIE = 'liders_team_session';
export const TEAM_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TEAM_SESSION_TTL = '7d';

export interface TeamSessionPayload {
  scope: 'team:session';
  teamId: number;
  /** Токен доступа, которым воспользовалась команда (если вход был по ссылке). */
  accessTokenId: number | null;
}

export function signTeamSession(teamId: number, accessTokenId: number | null): string {
  const payload: TeamSessionPayload = { scope: 'team:session', teamId, accessTokenId };
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: TEAM_SESSION_TTL as jwt.SignOptions['expiresIn'],
  });
}

export function verifyTeamSession(token: string | undefined): TeamSessionPayload | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as Partial<TeamSessionPayload>;
    if (decoded.scope !== 'team:session' || typeof decoded.teamId !== 'number') return null;
    return {
      scope: 'team:session',
      teamId: decoded.teamId,
      accessTokenId: typeof decoded.accessTokenId === 'number' ? decoded.accessTokenId : null,
    };
  } catch {
    return null;
  }
}

/** Значение cookie из заголовка запроса (без зависимости cookie-parser). */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (typeof header !== 'string' || header === '') return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      const raw = part.slice(separator + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return undefined;
}

export function setTeamSessionCookie(res: Response, token: string): void {
  res.cookie(TEAM_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'lax',
    path: '/',
    maxAge: TEAM_SESSION_TTL_MS,
  });
}

export function clearTeamSessionCookie(res: Response): void {
  res.clearCookie(TEAM_SESSION_COOKIE, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'lax',
    path: '/',
  });
}
