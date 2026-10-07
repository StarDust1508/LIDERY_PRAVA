import type { NextFunction, Request, Response } from 'express';
import { parsePositiveInt, queryString } from '../lib/http.js';

// Формат ответов API (ТЗ 05, п. 1.1, 1.2, 1.4).
//
// Требование ТЗ:
//   • успешный ответ — объект с полем `data`;
//   • список — `{ data: [...], meta: { total, page, perPage } }`;
//   • ошибка — `{ error: { code, message, details } }`, без стека и деталей БД.
//
// Реализация — на уровне `res.json`, а не в каждом обработчике: маршрутов около
// сотни, и правка «руками» неизбежно оставила бы часть ответов в старом формате.
// Обработчики по-прежнему отдают свой объект, обёртка добавляет структуру.
//
// Метаданные списка обработчик кладёт в `res.locals.meta` (см. setListMeta) —
// тогда ответ получает `meta` с общим числом записей, страницей и размером
// страницы.

/** Коды ошибок по HTTP-статусу: клиенту нужен код, а не только текст. */
const ERROR_CODES: Record<number, string> = {
  // 400 — запрос не разобран (некорректный JSON); 422 — данные не прошли
  // проверку. Код ошибки в теле различает эти случаи для клиента (ТЗ 05, п. 1.2).
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  422: 'validation_error',
  429: 'rate_limited',
  500: 'internal_error',
  502: 'bad_gateway',
  503: 'service_unavailable',
};

export function errorCodeFor(status: number): string {
  return ERROR_CODES[status] ?? (status >= 500 ? 'server_error' : 'request_error');
}

interface ErrorBody {
  error?: unknown;
  details?: unknown;
  requestId?: unknown;
  [key: string]: unknown;
}

/** Приводит тело ошибки к виду `{ error: { code, message, details } }`. */
function shapeError(status: number, payload: unknown, requestId?: string): Record<string, unknown> {
  const body = (typeof payload === 'object' && payload !== null ? payload : {}) as ErrorBody;
  const raw = body.error;
  const message =
    typeof raw === 'string'
      ? raw
      : typeof raw === 'object' && raw !== null && typeof (raw as { message?: unknown }).message === 'string'
        ? String((raw as { message: string }).message)
        : 'Запрос не выполнен.';

  const details = Array.isArray(body.details)
    ? body.details.map(String)
    : Array.isArray((raw as { details?: unknown })?.details)
      ? ((raw as { details: unknown[] }).details).map(String)
      : [];

  // Остальные поля ответа сохраняются на верхнем уровне: интерфейсу нужны,
  // например, `application_close_at` при отказе по сроку или `max_fix_deadline`.
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === 'error' || key === 'details' || key === 'requestId') continue;
    extra[key] = value;
  }

  return {
    error: {
      code: errorCodeFor(status),
      message,
      ...(details.length > 0 ? { details } : {}),
    },
    ...extra,
    requestId: requestId ?? (typeof body.requestId === 'string' ? body.requestId : undefined),
  };
}

/** Уже обёрнутый ответ не оборачивается повторно. */
function isEnvelope(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return false;
  const keys = Object.keys(payload as Record<string, unknown>);
  return keys.length > 0 && keys.every((key) => key === 'data' || key === 'meta');
}

/**
 * Код ответа для ошибок проверки данных.
 *
 * ТЗ 05, п. 1.2 различает два случая:
 *   • 400 — запрос не удалось разобрать (некорректный JSON, битая кодировка);
 *   • 422 — запрос разобран, но данные не прошли проверку (не указано поле,
 *     недопустимое значение, нарушено правило Положения).
 *
 * Маршруты исторически отвечали 400 во всех случаях проверки. Вместо правки
 * полутора сотен мест код приводится здесь: синтаксическая ошибка помечает ответ
 * флагом `syntaxError`, всё остальное с кодом 400 — это проверка данных.
 */
function statusForResponse(res: Response): number {
  if (res.statusCode === 400 && res.locals.syntaxError !== true) return 422;
  return res.statusCode;
}

/**
 * Метаданные списка: обработчик вызывает перед отправкой, если отдаёт страницу.
 * `total` — общее число записей без учёта страницы.
 */
export function setListMeta(
  res: Response,
  meta: { total: number; page: number; perPage: number }
): void {
  res.locals.meta = meta;
}

export function apiEnvelope(req: Request, res: Response, next: NextFunction): void {
  const json = res.json.bind(res);

  res.json = (payload: unknown): Response => {
    // Файлы, CSV и карты сайта уходят через res.send и сюда не попадают.
    if (res.locals.rawResponse === true) return json(payload);

    const requestId = (req as Request & { requestId?: string }).requestId;
    const status = statusForResponse(res);

    if (status >= 400) {
      // Статус мог быть уточнён (400 → 422): выставляем его до отправки.
      if (status !== res.statusCode) res.status(status);
      return json(shapeError(status, payload, requestId));
    }

    if (isEnvelope(payload)) return json(payload);

    const meta = res.locals.meta as { total: number; page: number; perPage: number } | undefined;
    return json(meta ? { data: payload, meta } : { data: payload });
  };

  next();
}

/**
 * Пагинация списка (ТЗ 05, п. 1.4): `?page=&perPage=`, по умолчанию 50 записей,
 * максимум 200. Прежние `limit`/`offset` продолжают работать: на них написаны
 * уже выпущенные клиенты, и ломать их ради нового вида параметров нельзя.
 */
export function paginationOf(
  req: Request,
  defaultPerPage = 50
): { page: number; perPage: number; limit: number; offset: number } {
  const rawLimit = parsePositiveInt(queryString(req.query.limit));
  const rawOffset = parsePositiveInt(queryString(req.query.offset));
  const rawPage = parsePositiveInt(queryString(req.query.page));
  const rawPerPage = parsePositiveInt(queryString(req.query.perPage));

  const perPage = Math.min(200, Math.max(1, rawPerPage ?? rawLimit ?? defaultPerPage));
  const page = rawPage ?? (rawOffset !== null ? Math.floor(rawOffset / perPage) + 1 : 1);
  const offset = rawPage !== null || rawOffset === null ? (page - 1) * perPage : rawOffset;

  return { page, perPage, limit: perPage, offset: Math.max(0, offset) };
}
