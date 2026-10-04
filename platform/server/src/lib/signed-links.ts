import jwt from 'jsonwebtoken';
import { JWT_EXPIRES_IN, JWT_SECRET } from '../config.js';

// Краткосрочные ссылки на приватные файлы. Токен команды живёт долго и утекает
// вместе со ссылками в переписке; для выдачи конкретного файла подписываем
// отдельный короткоживущий JWT, привязанный к media_id.

export interface MediaGrantPayload {
  scope: 'media:read';
  mediaId: string;
  teamId: number | null;
}

export function signMediaGrant(mediaId: string, teamId: number | null): string {
  const payload: MediaGrantPayload = { scope: 'media:read', mediaId, teamId };
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

/** Проверяет подпись и совпадение mediaId. Возвращает claims или null. */
export function verifyMediaGrant(token: string | undefined, mediaId: string): MediaGrantPayload | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as Partial<MediaGrantPayload>;
    if (decoded.scope !== 'media:read') return null;
    if (decoded.mediaId !== mediaId) return null;
    return {
      scope: 'media:read',
      mediaId,
      teamId: typeof decoded.teamId === 'number' ? decoded.teamId : null,
    };
  } catch {
    return null;
  }
}
