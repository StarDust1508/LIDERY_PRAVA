import type { Request } from 'express';
import { query } from '../db.js';
import {
  adminAuditActor,
  adminRoleOfRequest,
  adminStablePrincipal,
  adminUserIdOf,
  clientIpOf,
} from '../middleware/admin-auth.js';

// Журнал действий администраторов и операторов (таблица audit_log).
//
// Требования: ТЗ 03, п. 5.6 («каждое изменение данных — с автором и временем»),
// ТЗ 07, п. 2.16–2.17 (журнал и массовые операции), пункт 1.4 приёмки.
// Запись ведётся best-effort: сбой журнала не должен ломать саму операцию,
// иначе администратор не сможет, например, принять заявку из-за проблемы с
// журналом.

export type AuditActorType = 'admin' | 'operator' | 'system';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | number | null;
  /** Состояние до и после изменения: то, что нужно, чтобы объяснить решение. */
  before?: unknown;
  after?: unknown;
  actorType?: AuditActorType;
  req?: Request;
}

/** Убирает из тела запроса то, что не должно попадать в журнал. */
function sanitize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sanitize);
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/password|secret|token/i.test(key)) {
      result[key] = '***';
      continue;
    }
    result[key] = sanitize(item);
  }
  return result;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    const req = entry.req;
    await query(
      `INSERT INTO audit_log
         (actor_type, user_id, actor_label, action, entity, entity_id, before, after, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)`,
      [
        // Роль берётся из сессии: журнал должен различать действия оператора и
        // администратора (ТЗ 07, п. 1.3), иначе разбор инцидента бессмыслен.
        entry.actorType ?? (req ? adminRoleOfRequest(req) : 'system'),
        req ? adminUserIdOf(req) : null,
        req ? (adminStablePrincipal(req) ?? adminAuditActor(req)) : 'system',
        entry.action,
        entry.entity,
        entry.entityId === null || entry.entityId === undefined ? null : String(entry.entityId),
        entry.before === undefined ? null : JSON.stringify(sanitize(entry.before)),
        entry.after === undefined ? null : JSON.stringify(sanitize(entry.after)),
        req ? clientIpOf(req) : null,
        req ? String(req.headers['user-agent'] || '').slice(0, 500) : null,
      ]
    );
  } catch (error) {
    console.error('Не удалось записать действие в журнал:', (error as Error).message);
  }
}

/** Разбирает путь админского маршрута на сущность и идентификатор. */
export function describeAdminPath(path: string): { entity: string; entityId: string | null } {
  const parts = path.split('/').filter((part) => part !== '');
  const [entity = 'unknown', maybeId] = parts;
  const entityId = maybeId && /^\d+$/.test(maybeId) ? maybeId : null;
  return { entity, entityId };
}
