import type { NextFunction, Request, Response } from 'express';
import { CORS_ORIGINS, PUBLIC_BASE_URL } from '../config.js';

// Защита изменяющих запросов из браузера (ТЗ 11, п. 5.3).
//
// Разделение по способу аутентификации:
//   • запрос с заголовком Authorization (админка, внешние интеграции) CSRF не
//     подвержен: браузер не подставляет этот заголовок сам, его ставит наш код;
//   • запрос с cookie сессии кабинета (SameSite=Lax, HttpOnly) может быть
//     инициирован чужой страницей — для него проверяем источник.
//
// Проверяется источник запроса: Origin, при его отсутствии Referer, а также
// Sec-Fetch-Site (его ставят браузеры). Значения вне белого списка отклоняются.
//
// Отсутствие заголовков не блокируется: не-браузерный клиент (curl в приёмке,
// systemd-таймер) не является «сбитым с толку заместителем» и не может
// воспользоваться чужой сессией — cookie ему никто не выдавал.
// Основную защиту даёт SameSite=Lax: браузер просто не отправляет cookie сессии
// при межсайтовом POST. Проверка источника — второй рубеж.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Источники, которым разрешено обращаться к API из браузера. */
export const ALLOWED_ORIGINS: readonly string[] = Array.from(
  new Set(
    [...CORS_ORIGINS, PUBLIC_BASE_URL, 'https://www.lideryprava.ru'].map((value) =>
      value.trim().replace(/\/+$/, '')
    )
  )
).filter((value) => value.length > 0);

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  // Запрос с Bearer-токеном: признак CSRF неприменим.
  const authorization = req.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    next();
    return;
  }

  // Браузер сам сообщает, что запрос межсайтовый.
  const fetchSite = req.headers['sec-fetch-site'];
  if (typeof fetchSite === 'string' && fetchSite.toLowerCase() === 'cross-site') {
    res.status(403).json({
      error: 'Запрос отклонён: межсайтовые изменяющие запросы к API запрещены.',
      requestId: (req as Request & { requestId?: string }).requestId,
    });
    return;
  }

  const source = originOf(req.headers.origin) ?? originOf(req.headers.referer);
  if (source !== null && !ALLOWED_ORIGINS.includes(source)) {
    res.status(403).json({
      error: 'Запрос отклонён: источник не входит в список разрешённых.',
      requestId: (req as Request & { requestId?: string }).requestId,
    });
    return;
  }

  next();
}
