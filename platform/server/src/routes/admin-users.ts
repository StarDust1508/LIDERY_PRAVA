import bcrypt from 'bcryptjs';
import { Router, type Response } from 'express';
import { ADMIN_IDLE_MINUTES } from '../config.js';
import { query } from '../db.js';
import { writeAudit } from '../lib/audit.js';
import { asyncHandler, parsePositiveInt, queryString } from '../lib/http.js';
import { optionalText, requiredText } from '../lib/validation.js';
import {
  type AdminIdentity,
  countActiveAdminSessions,
  currentAdmin,
  revokeAllAdminSessions,
} from '../middleware/admin-auth.js';

// Пользователи админ-панели (ТЗ 07, п. 1.3 и 2.17).
//
// Раздел доступен только роли `admin`: роутер подключается в index.ts под
// requireAdmin + requireAdminRole('admin'). Оператор сюда не попадает вообще.
//
// Правила, которые проверяет сервер, а не интерфейс:
//   • пароль хранится только в виде bcrypt-хэша, cost 12 (ТЗ 11, п. 45);
//   • нельзя заблокировать или понизить себя — иначе администратор останется
//     без доступа и вернуть его сможет только доступ к серверу;
//   • в системе всегда остаётся хотя бы один действующий администратор;
//   • смена пароля и «завершить все сеансы» поднимают auth_version и гасят
//     уже выданные токены (ТЗ 07, п. 1.2).

const router = Router();

/** Стоимость bcrypt: ТЗ 11, п. 45 требует не ниже 12. */
/** Стоимость bcrypt: та же, что при создании учётных записей. */
export const BCRYPT_COST = 12;
const MIN_PASSWORD_LENGTH = 12;
const ROLES = ['admin', 'operator'] as const;
type UserRole = (typeof ROLES)[number];

interface UserRow {
  id: number;
  email: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  blocked_at: string | null;
  blocked_reason: string | null;
  auth_version: number;
}

/** Публичное представление учётной записи: хэш пароля наружу не уходит. */
function publicUser(row: UserRow, sessions: number) {
  return {
    id: Number(row.id),
    email: row.email,
    full_name: row.full_name,
    role: row.role,
    is_active: row.is_active,
    must_change_password: row.must_change_password === true,
    last_login_at: row.last_login_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    blocked_at: row.blocked_at,
    blocked_reason: row.blocked_reason,
    active_sessions: sessions,
  };
}

/** Проверка требований к паролю; используется и при смене своего пароля. */
export function validatePassword(password: string, email: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов.`;
  }
  if (password.toLowerCase() === email.toLowerCase()) {
    return 'Пароль не должен совпадать с адресом электронной почты.';
  }
  if (!/[A-Za-zА-Яа-я]/.test(password) || !/[0-9]/.test(password)) {
    return 'Пароль должен содержать хотя бы одну букву и одну цифру.';
  }
  return null;
}

/** Сколько сейчас действующих администраторов, кроме указанной записи. */
async function otherActiveAdminsCount(excludeId: number): Promise<number> {
  const result = await query(
    `SELECT count(*)::int AS total FROM users
      WHERE role = 'admin' AND is_active AND id <> $1`,
    [excludeId]
  );
  return Number(result.rows[0]?.total ?? 0);
}

/** Отказ, если действие оставит систему без администратора или без вас. */
async function guardSelfAndLastAdmin(
  res: Response,
  actor: AdminIdentity | undefined,
  targetId: number,
  action: 'block' | 'demote'
): Promise<boolean> {
  if (actor && actor.userId !== null && actor.userId === targetId) {
    res.status(409).json({
      error:
        action === 'block'
          ? 'Нельзя заблокировать собственную учётную запись: вы потеряете доступ к админ-панели.'
          : 'Нельзя понизить собственную роль: вернуть права сможет только другой администратор.',
    });
    return false;
  }
  if ((await otherActiveAdminsCount(targetId)) === 0) {
    res.status(409).json({
      error: 'В системе должен остаться хотя бы один действующий администратор.',
    });
    return false;
  }
  return true;
}

// GET /api/admin/users — список учётных записей с числом активных сеансов.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const search = queryString(req.query.q);
    const role = queryString(req.query.role);
    const params: unknown[] = [];
    const where: string[] = ['TRUE'];
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      where.push(`(lower(email) LIKE $${params.length} OR lower(COALESCE(full_name, '')) LIKE $${params.length})`);
    }
    if (role && (ROLES as readonly string[]).includes(role)) {
      params.push(role);
      where.push(`role = $${params.length}`);
    }
    const result = await query(
      `SELECT id, email, full_name, role, is_active, must_change_password, last_login_at,
              created_at, updated_at, blocked_at, blocked_reason, auth_version
         FROM users WHERE ${where.join(' AND ')}
        ORDER BY is_active DESC, role, email`,
      params
    );
    const rows = result.rows as UserRow[];
    const sessions = await query(
      `SELECT user_id, count(*)::int AS total FROM admin_session_activity
        WHERE expires_at > now() AND last_seen_at > now() - ($1 || ' minutes')::interval
        GROUP BY user_id`,
      [String(ADMIN_IDLE_MINUTES)]
    );
    const byUser = new Map<number, number>(
      sessions.rows.map((row) => [Number(row.user_id), Number(row.total)])
    );
    res.json(rows.map((row) => publicUser(row, byUser.get(Number(row.id)) ?? 0)));
  })
);

// POST /api/admin/users — создание учётной записи администратора или оператора.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const actor = currentAdmin(res);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = requiredText(body.email, 200)?.toLowerCase() ?? null;
    const fullName = optionalText(body.full_name, 200) ?? null;
    const role = typeof body.role === 'string' && (ROLES as readonly string[]).includes(body.role)
      ? (body.role as UserRole)
      : null;
    const password = typeof body.password === 'string' ? body.password : '';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Укажите корректный адрес электронной почты.' });
      return;
    }
    if (!role) {
      res.status(400).json({ error: 'Роль указывается явно: «администратор» или «оператор».' });
      return;
    }
    const passwordError = validatePassword(password, email);
    if (passwordError) {
      res.status(400).json({ error: passwordError });
      return;
    }

    const hash = await bcrypt.hash(password, BCRYPT_COST);
    try {
      const created = await query(
        `INSERT INTO users (email, password_hash, role, full_name, is_active, created_by,
                            password_changed_at, must_change_password)
         VALUES ($1, $2, $3, $4, TRUE, $5, now(), TRUE)
         RETURNING id, email, full_name, role, is_active, must_change_password, last_login_at,
                   created_at, updated_at, blocked_at, blocked_reason, auth_version`,
        [email, hash, role, fullName, actor?.userId ?? null]
      );
      const row = created.rows[0] as UserRow;
      await writeAudit({
        action: 'user_create',
        entity: 'users',
        entityId: row.id,
        after: { email: row.email, role: row.role, full_name: row.full_name },
        actorType: actor?.role === 'operator' ? 'operator' : 'admin',
        req,
      });
      res.status(201).json(publicUser(row, 0));
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        res.status(409).json({ error: 'Учётная запись с таким адресом уже существует.' });
        return;
      }
      throw error;
    }
  })
);

// PATCH /api/admin/users/:id — роль, блокировка и ФИО.
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const actor = currentAdmin(res);
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Некорректный идентификатор пользователя' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const before = await query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
    const current = before.rows[0] as UserRow | undefined;
    if (!current) {
      res.status(404).json({ error: 'Учётная запись не найдена' });
      return;
    }

    const updates: string[] = [];
    const params: unknown[] = [];

    if (body.role !== undefined) {
      const role = typeof body.role === 'string' && (ROLES as readonly string[]).includes(body.role)
        ? (body.role as UserRole)
        : null;
      if (!role) {
        res.status(400).json({ error: 'Роль указывается явно: «администратор» или «оператор».' });
        return;
      }
      if (role === 'operator' && current.role === 'admin') {
        if (!(await guardSelfAndLastAdmin(res, actor, id, 'demote'))) return;
      }
      params.push(role);
      updates.push(`role = $${params.length}`);
    }

    if (body.is_active !== undefined) {
      if (typeof body.is_active !== 'boolean') {
        res.status(400).json({ error: 'Поле «активна» принимает значение true или false.' });
        return;
      }
      if (body.is_active === false) {
        if (!(await guardSelfAndLastAdmin(res, actor, id, 'block'))) return;
        params.push(optionalText(body.blocked_reason, 500) ?? null);
        updates.push(`blocked_reason = $${params.length}`);
        updates.push('blocked_at = now()');
      } else {
        updates.push('blocked_at = NULL');
        updates.push('blocked_reason = NULL');
      }
      params.push(body.is_active);
      updates.push(`is_active = $${params.length}`);
      if (body.is_active === false) {
        // Блокировка гасит выданные сеансы, а не только запрещает новые.
        updates.push('auth_version = auth_version + 1');
      }
    }

    if (body.full_name !== undefined) {
      params.push(optionalText(body.full_name, 200) ?? null);
      updates.push(`full_name = $${params.length}`);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'Не передано ни одного изменения.' });
      return;
    }

    params.push(id);
    const updated = await query(
      `UPDATE users SET ${updates.join(', ')}, updated_at = now() WHERE id = $${params.length}
       RETURNING id, email, full_name, role, is_active, must_change_password, last_login_at,
                 created_at, updated_at, blocked_at, blocked_reason, auth_version`,
      params
    );
    const row = updated.rows[0] as UserRow;
    await writeAudit({
      action: body.is_active === false ? 'user_block' : body.is_active === true ? 'user_unblock' : 'user_update',
      entity: 'users',
      entityId: id,
      before: { role: current.role, is_active: current.is_active, full_name: current.full_name },
      after: { role: row.role, is_active: row.is_active, full_name: row.full_name },
      actorType: actor?.role === 'operator' ? 'operator' : 'admin',
      req,
    });
    res.json(publicUser(row, await countActiveAdminSessions(id)));
  })
);

// POST /api/admin/users/:id/password — сброс пароля администратором.
// Новый пароль помечается временным: система попросит его заменить.
router.post(
  '/:id/password',
  asyncHandler(async (req, res) => {
    const actor = currentAdmin(res);
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Некорректный идентификатор пользователя' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const existing = await query('SELECT id, email FROM users WHERE id = $1 LIMIT 1', [id]);
    const user = existing.rows[0];
    if (!user) {
      res.status(404).json({ error: 'Учётная запись не найдена' });
      return;
    }
    const password = typeof body.password === 'string' ? body.password : '';
    const passwordError = validatePassword(password, String(user.email));
    if (passwordError) {
      res.status(400).json({ error: passwordError });
      return;
    }

    const hash = await bcrypt.hash(password, BCRYPT_COST);
    await query(
      `UPDATE users SET password_hash = $1, password_changed_at = now(),
                        must_change_password = TRUE, auth_version = auth_version + 1,
                        updated_at = now()
        WHERE id = $2`,
      [hash, id]
    );
    await query('DELETE FROM admin_session_activity WHERE user_id = $1', [id]);
    await writeAudit({
      action: 'user_password_reset',
      entity: 'users',
      entityId: id,
      after: { email: String(user.email), sessions_revoked: true },
      actorType: actor?.role === 'operator' ? 'operator' : 'admin',
      req,
    });
    res.json({ success: true, sessions_revoked: true, must_change_password: true });
  })
);

// POST /api/admin/users/:id/revoke-sessions — «завершить все сеансы» учётной записи.
router.post(
  '/:id/revoke-sessions',
  asyncHandler(async (req, res) => {
    const actor = currentAdmin(res);
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Некорректный идентификатор пользователя' });
      return;
    }
    const updated = await revokeAllAdminSessions(id);
    if (updated === 0) {
      res.status(404).json({ error: 'Учётная запись не найдена' });
      return;
    }
    await writeAudit({
      action: 'user_sessions_revoked',
      entity: 'users',
      entityId: id,
      after: { sessions_revoked: true, by_self: actor?.userId === id },
      actorType: actor?.role === 'operator' ? 'operator' : 'admin',
      req,
    });
    res.json({ success: true, sessions_revoked: true, self: actor?.userId === id });
  })
);

export default router;
