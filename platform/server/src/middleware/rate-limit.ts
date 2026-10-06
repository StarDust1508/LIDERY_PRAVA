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
 * @param max       максимум запросов в окне
 * @param windowMs  длительность окна в миллисекундах
 * @param onLimited вызывается при отклонении запроса (429). Нужен входу
 *                  администратора: попытки, отсечённые burst-лимитом, должны
 *                  попадать в журнал и приближать «долгую» блокировку по IP,
 *                  иначе второй уровень защиты остаётся незадействованным.
 */
export function rateLimit(
  max = 10,
  windowMs = 60_000,
  onLimited?: (req: Request, retryAfterSeconds: number) => void
) {
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
      try {
        onLimited?.(req, retryAfter);
      } catch (error) {
        // Сбой обработчика не должен менять ответ клиенту.
        console.error('Обработчик ограничения частоты завершился ошибкой:', (error as Error).message);
      }
      res.status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' });
      return;
    }

    bucket.count += 1;
    next();
  };
}

/**
 * Ограничение по произвольному ключу — например, по команде.
 *
 * ТЗ 11, п. 5.4 задаёт лимит «получить ссылку заново» — 3 раза в час на команду.
 * По адресу такой лимит не работает: обращение может прийти от Оргкомитета с
 * разных адресов, а команда остаётся той же. Корзины общие с rateLimit, но ключ
 * считается отдельной функцией.
 */
export function scopedRateLimit(
  max: number,
  windowMs: number,
  keyOf: (req: Request) => string | null,
  onLimited?: (req: Request, retryAfterSeconds: number) => void
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const scope = keyOf(req);
    if (scope === null) {
      // Ключ не определён (нет команды в запросе) — маршрут сам ответит ошибкой.
      next();
      return;
    }
    const key = `scope:${scope}`;
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
      try {
        onLimited?.(req, retryAfter);
      } catch (error) {
        console.error('Обработчик ограничения частоты завершился ошибкой:', (error as Error).message);
      }
      res.status(429).json({
        error: `Ссылку доступа можно запрашивать не чаще ${max} раз в час на команду.`,
      });
      return;
    }

    bucket.count += 1;
    next();
  };
}
