import type { NextFunction, Request, Response } from 'express';

// In-memory rate-limit по IP: защита публичных форм от спама и перебора.
// Достаточно для одного инстанса приложения; при горизонтальном
// масштабировании счётчики нужно перенести в Redis.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Периодическая очистка истёкших корзин, чтобы карта не росла бесконечно.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key);
  }
}, 60_000).unref?.();

function clientIp(req: Request): string {
  // req.ip учитывает trust proxy (см. index.ts) и корректно достаёт клиентский
  // IP из X-Forwarded-For за доверенным прокси.
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Ограничение частоты запросов.
 * @param max      максимум запросов в окне
 * @param windowMs длительность окна в миллисекундах
 */
export function rateLimit(max = 10, windowMs = 60_000) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // После сопоставления маршрута req.route.path содержит стабильный шаблон,
    // а не подставленный клиентом идентификатор: иначе перебор путей создавал бы
    // новую корзину на каждый запрос.
    const routePath = typeof req.route?.path === 'string' ? req.route.path : req.path;
    const key = `${clientIp(req)}:${req.method}:${req.baseUrl}${routePath}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || now > bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (bucket.count >= max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      res.status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' });
      return;
    }

    bucket.count += 1;
    next();
  };
}
