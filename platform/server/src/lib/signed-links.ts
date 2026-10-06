import jwt from 'jsonwebtoken';
import { JWT_SECRET, MEDIA_GRANT_TTL_SECONDS } from '../config.js';

// Краткосрочные ссылки на приватные файлы. Токен команды живёт долго и утекает
// вместе со ссылками в переписке; для выдачи конкретного файла подписываем
// отдельный короткоживущий JWT, привязанный к media_id.

export interface MediaGrantPayload {
  scope: 'media:read';
  mediaId: string;
  teamId: number | null;
}

/**
 * Подписывает краткосрочную ссылку на файл.
 *
 * Срок жизни — минуты, а не дни: ссылка уходит в переписку и почту, и её утечка
 * не должна открывать материал навсегда. Раньше здесь использовался срок
 * JWT-сессии команды (7 дней), что противоречило смыслу механизма.
 */
export function signMediaGrant(
  mediaId: string,
  teamId: number | null,
  ttlSeconds: number = MEDIA_GRANT_TTL_SECONDS
): { token: string; expiresAt: string; expiresIn: number } {
  const payload: MediaGrantPayload = { scope: 'media:read', mediaId, teamId };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: ttlSeconds });
  return {
    token,
    expiresIn: ttlSeconds,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  };
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
