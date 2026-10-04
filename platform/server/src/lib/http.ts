import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Оборачивает асинхронный обработчик, чтобы отклонённый промис попал в
 * error-handler Express, а не завис как необработанный reject.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

/** Разбирает положительный целочисленный параметр пути или запроса. */
export function parsePositiveInt(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const parsed = Number.parseInt(String(raw), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Приводит значение query-параметра к строке (первое значение, если массив). */
export function queryString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}
