import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

// Идентификатор запроса (ТЗ 11, п. 5.9; ТЗ 05, п. 6.1).
//
// Назначение: участник или администратор сообщает короткий номер из сообщения об
// ошибке, и по нему в журналах nginx и API находится вся история запроса. Без
// него разбор обращения «у меня не отправилась заявка» упирается в поиск по
// времени.
//
// Идентификатор приходит из заголовка X-Request-Id, если его поставил прокси,
// иначе создаётся здесь. В ответ он попадает всегда — и при успехе, и при ошибке.

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Идентификатор текущего запроса: заголовок (если безопасный) или новый UUID. */
export function requestIdOf(req: Request): string {
  // Идентификатор, уже назначенный этому запросу, возвращается как есть: иначе
  // второй вызов дал бы другой UUID и разошёлся бы с заголовком ответа —
  // участник сообщил бы номер, которого нет в журнале.
  const assigned = (req as Request & { requestId?: string }).requestId;
  if (typeof assigned === 'string' && assigned.length > 0) return assigned;

  const incoming = req.headers[REQUEST_ID_HEADER.toLowerCase()];
  const value = Array.isArray(incoming) ? incoming[0] : incoming;
  if (value) {
    // Чужой заголовок не должен ломать журнал: оставляем только безопасные
    // символы и ограничиваем длину.
    const cleaned = String(value).replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64);
    if (cleaned.length >= 8) return cleaned;
  }
  return randomUUID();
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const id = requestIdOf(req);
  (req as Request & { requestId?: string }).requestId = id;
  res.set(REQUEST_ID_HEADER, id);
  next();
}
