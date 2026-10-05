import type { NextFunction, Request, Response } from 'express';
import { describeAdminPath, writeAudit } from '../lib/audit.js';

// Автоматическая запись изменяющих админских запросов в журнал действий.
//
// Почему middleware, а не вызовы в каждом маршруте: маршрутов изменения
// шестнадцать, и любой новый легко забыть. Здесь фиксируется каждый успешный
// POST/PATCH/PUT/DELETE: кто, что, когда, с какого адреса и с каким телом
// запроса. Ответ маршрута сохраняется как состояние «после» — он содержит
// обновлённую запись.
//
// Чтение (GET) не журналируется: журнал отвечает на вопрос «кто изменил»,
// а входы фиксируются отдельно в auth_log.

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export function auditAdminMutations(req: Request, res: Response, next: NextFunction): void {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }

  const originalJson = res.json.bind(res);
  let responseBody: unknown;

  res.json = (body: unknown) => {
    responseBody = body;
    return originalJson(body);
  };

  res.on('finish', () => {
    // Записываем только состоявшиеся изменения: при 4xx/5xx данные не менялись
    // (либо изменение откатилось), и журнал не должен пухнуть от отказов.
    if (res.statusCode < 200 || res.statusCode >= 300) return;

    const { entity, entityId } = describeAdminPath(req.path);
    void writeAudit({
      action: `${req.method} /api/admin${req.path}`,
      entity,
      entityId,
      after: responseBody,
      req,
    });
  });

  next();
}
