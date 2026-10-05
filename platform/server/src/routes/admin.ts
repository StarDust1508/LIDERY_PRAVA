import { Router, type Request, type Response } from 'express';
import { query, withTransaction } from '../db.js';
import { asyncHandler, parsePositiveInt, queryString } from '../lib/http.js';
import { toCsv } from '../lib/csv.js';
import { writeAudit } from '../lib/audit.js';
import { slugify, uniqueSlug } from '../lib/slugify.js';
import { addWorkingDays } from '../lib/moscow-time.js';
import { isIsoDate, optionalText, requiredText } from '../lib/validation.js';
import { generateAccessToken, hashAccessToken } from '../middleware/team-auth.js';
import {
  adminAuditActor,
  bearerToken,
  requireAdminForWrites,
  requireAdminRole,
  verifyTokenSignature,
} from '../middleware/admin-auth.js';

// Админские маршруты. Роутер подключается под requireAdmin (см. index.ts),
// поэтому здесь нет повторных проверок сессии. Исключение — вход и выход,
// они живут в отдельном роутере routes/auth-admin.ts.
//
// Разграничение ролей (ТЗ 07, п. 1.3): оператор ведёт заявки, материалы,
// обращения, мастер-классы, новости и документы. Настройки, справочники,
// эксперты, публикация протоколов и выгрузка персональных данных — только
// администратор. Проверка стоит на маршруте, а не в интерфейсе.

const router = Router();

// ─── Общие помощники ─────────────────────────────────────────────────────────

/** Идентификатор администратора из токена; NULL для входа по env-паролю. */
function adminUserId(req: Request): number | null {
  const principal = verifyTokenSignature(bearerToken(req))?.principal;
  return principal && principal.kind === 'user' ? principal.userId : null;
}

/** Обрабатывает типовые ошибки ограничений БД. true — ответ уже отправлен. */
function handleDbError(res: Response, error: unknown): boolean {
  const code = (error as { code?: string }).code;
  if (code === '23505') {
    res.status(409).json({ error: 'Такая запись уже существует (нарушено уникальное ограничение)' });
    return true;
  }
  if (code === '23503') {
    res.status(409).json({ error: 'Ссылка на несуществующую запись' });
    return true;
  }
  if (code === '23514') {
    res.status(400).json({ error: 'Значение не проходит проверку ограничений' });
    return true;
  }
  return false;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ─── Универсальный CRUD для справочников и контента ──────────────────────────
// Имена таблиц и колонок берутся только из статических конфигураций ниже,
// поэтому динамический SQL не может быть подставлен извне.

type FieldType = 'text' | 'int' | 'numeric' | 'bool' | 'json' | 'date' | 'timestamptz';

interface CrudField {
  name: string;
  type: FieldType;
  maxLength?: number;
}

interface CrudConfig {
  table: string;
  fields: CrudField[];
  /**
   * Поле-источник человекочитаемого адреса. Если в таблице есть `slug` и он не
   * заполнен, адрес формируется из этого поля (ТЗ 08, п. 2.4.5).
   */
  slugFrom?: string;
  orderBy: string;
  searchFields?: string[];
  filters?: string[];
  /**
   * Доменные проверки перед записью. Возвращает текст ошибки для клиента
   * или null, если запись допустима. На обновлении получает объединённое
   * состояние (текущая строка + изменения), поэтому проверяет итог, а не патч.
   */
  validate?: (values: Record<string, unknown>, mode: 'create' | 'update') => string | null;
}

function coerceField(field: CrudField, raw: unknown): { ok: boolean; value: unknown } {
  if (raw === null) return { ok: true, value: null };
  switch (field.type) {
    case 'bool':
      return { ok: typeof raw === 'boolean', value: typeof raw === 'boolean' ? raw : null };
    case 'int': {
      const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
      return Number.isInteger(parsed) ? { ok: true, value: parsed } : { ok: false, value: null };
    }
    case 'numeric': {
      const parsed = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false, value: null };
    }
    case 'json':
      return { ok: typeof raw === 'object', value: JSON.stringify(raw) };
    case 'date':
      return isIsoDate(raw) ? { ok: true, value: raw } : { ok: false, value: null };
    case 'timestamptz': {
      const date = new Date(String(raw));
      return Number.isNaN(date.getTime()) ? { ok: false, value: null } : { ok: true, value: date.toISOString() };
    }
    default:
      return { ok: true, value: optionalText(raw, field.maxLength ?? 4000) };
  }
}

function buildCrud(config: CrudConfig): Router {
  const crud = Router();
  const { table } = config;

  crud.get(
    '/',
    asyncHandler(async (req, res) => {
      const params: unknown[] = [];
      const where: string[] = [];

      for (const filter of config.filters ?? []) {
        const value = queryString(req.query[filter]);
        if (value !== undefined && value !== '') {
          params.push(value);
          where.push(`${filter} = $${params.length}`);
        }
      }

      const search = queryString(req.query.q);
      if (search && config.searchFields && config.searchFields.length > 0) {
        params.push(`%${search}%`);
        const placeholder = `$${params.length}`;
        where.push(`(${config.searchFields.map((field) => `${field} ILIKE ${placeholder}`).join(' OR ')})`);
      }

      const limit = Math.min(1000, parsePositiveInt(queryString(req.query.limit)) ?? 200);
      const result = await query(
        `SELECT * FROM ${table}
         ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY ${config.orderBy}
         LIMIT ${limit}`,
        params
      );
      res.json(result.rows);
    })
  );

  crud.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = parsePositiveInt(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'Некорректный идентификатор записи' });
        return;
      }
      const result = await query(`SELECT * FROM ${table} WHERE id = $1 LIMIT 1`, [id]);
      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Запись не найдена' });
        return;
      }
      res.json(result.rows[0]);
    })
  );

  crud.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const columns: string[] = [];
      const values: unknown[] = [];
      const record: Record<string, unknown> = {};

      for (const field of config.fields) {
        if (!Object.prototype.hasOwnProperty.call(body, field.name)) continue;
        const coerced = coerceField(field, body[field.name]);
        if (!coerced.ok) {
          res.status(400).json({ error: `Некорректное значение поля «${field.name}»` });
          return;
        }
        columns.push(field.name);
        values.push(coerced.value);
        record[field.name] = coerced.value;
      }

      if (columns.length === 0) {
        res.status(400).json({ error: 'Не передано ни одного поля для создания записи' });
        return;
      }

      // Адрес формируется из названия, если его не задали вручную: пустой slug
      // ломает и ссылки, и карту сайта.
      if (config.slugFrom && config.fields.some((field) => field.name === 'slug')) {
        const provided = String(record.slug ?? '').trim();
        const source = String(record[config.slugFrom] ?? '').trim();
        if (provided === '' && source !== '') {
          const base = slugify(source);
          record.slug = await uniqueSlug(base, async (candidate) => {
            const taken = await query(`SELECT 1 FROM ${table} WHERE slug = $1 LIMIT 1`, [candidate]);
            return taken.rows.length > 0;
          });
          const slugIndex = columns.indexOf('slug');
          if (slugIndex === -1) {
            columns.push('slug');
            values.push(record.slug);
          } else {
            values[slugIndex] = record.slug;
          }
        }
      }

      const validationError = config.validate?.(record, 'create');
      if (validationError) {
        res.status(400).json({ error: validationError });
        return;
      }

      const placeholders = columns.map((_column, index) => `$${index + 1}`);
      try {
        const result = await query(
          `INSERT INTO ${table} (${columns.join(', ')})
           VALUES (${placeholders.join(', ')})
           RETURNING *`,
          values
        );
        res.status(201).json(result.rows[0]);
      } catch (error) {
        if (!handleDbError(res, error)) throw error;
      }
    })
  );

  crud.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = parsePositiveInt(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'Некорректный идентификатор записи' });
        return;
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const assignments: string[] = [];
      const values: unknown[] = [];
      const patch: Record<string, unknown> = {};

      for (const field of config.fields) {
        if (!Object.prototype.hasOwnProperty.call(body, field.name)) continue;
        const coerced = coerceField(field, body[field.name]);
        if (!coerced.ok) {
          res.status(400).json({ error: `Некорректное значение поля «${field.name}»` });
          return;
        }
        values.push(coerced.value);
        assignments.push(`${field.name} = $${values.length}`);
        patch[field.name] = coerced.value;
      }

      if (assignments.length === 0) {
        res.status(400).json({ error: 'Не передано ни одного поля для изменения' });
        return;
      }

      if (config.slugFrom && config.fields.some((field) => field.name === 'slug')) {
        const provided = String(patch.slug ?? '').trim();
        const source = String(patch[config.slugFrom] ?? '').trim();
        if (provided === '' && source !== '') {
          const base = slugify(source);
          const generated = await uniqueSlug(base, async (candidate) => {
            const taken = await query(`SELECT 1 FROM ${table} WHERE slug = $1 AND id <> $2 LIMIT 1`, [
              candidate,
              id,
            ]);
            return taken.rows.length > 0;
          });
          patch.slug = generated;
          const slugIndex = assignments.findIndex((item) => item.startsWith('slug = '));
          if (slugIndex === -1) {
            values.push(generated);
            assignments.push(`slug = $${values.length}`);
          } else {
            const placeholder = Number(assignments[slugIndex].split('$')[1]);
            values[placeholder - 1] = generated;
          }
        }
      }

      if (config.validate) {
        const existing = await query(`SELECT * FROM ${table} WHERE id = $1 LIMIT 1`, [id]);
        if (existing.rows.length === 0) {
          res.status(404).json({ error: 'Запись не найдена' });
          return;
        }
        const validationError = config.validate({ ...existing.rows[0], ...patch }, 'update');
        if (validationError) {
          res.status(400).json({ error: validationError });
          return;
        }
      }

      values.push(id);
      try {
        const result = await query(
          `UPDATE ${table}
              SET ${assignments.join(', ')}, updated_at = now()
            WHERE id = $${values.length}
            RETURNING *`,
          values
        );
        if (result.rows.length === 0) {
          res.status(404).json({ error: 'Запись не найдена' });
          return;
        }
        res.json(result.rows[0]);
      } catch (error) {
        if (!handleDbError(res, error)) throw error;
      }
    })
  );

  crud.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = parsePositiveInt(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'Некорректный идентификатор записи' });
        return;
      }
      try {
        const result = await query(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [id]);
        if (result.rows.length === 0) {
          res.status(404).json({ error: 'Запись не найдена' });
          return;
        }
        res.json({ success: true });
      } catch (error) {
        if (!handleDbError(res, error)) throw error;
      }
    })
  );

  return crud;
}

// ─── Заявки ──────────────────────────────────────────────────────────────────

interface ApplicationFilter {
  where: string;
  params: unknown[];
}

function buildApplicationFilter(req: Request): ApplicationFilter {
  const params: unknown[] = [];
  const where: string[] = [];

  const seasonId = parsePositiveInt(queryString(req.query.season_id));
  if (seasonId !== null) {
    params.push(seasonId);
    where.push(`a.season_id = $${params.length}`);
  }
  const status = queryString(req.query.tech_status) ?? queryString(req.query.status);
  if (status) {
    params.push(status);
    where.push(`a.tech_status = $${params.length}`);
  }
  const source = queryString(req.query.source);
  if (source) {
    params.push(source);
    where.push(`a.source = $${params.length}`);
  }
  const directionId = parsePositiveInt(queryString(req.query.direction_id));
  if (directionId !== null) {
    params.push(directionId);
    where.push(`t.direction_id = $${params.length}`);
  }
  const search = queryString(req.query.q);
  if (search) {
    params.push(`%${search}%`);
    const placeholder = `$${params.length}`;
    where.push(`(t.name ILIKE ${placeholder} OR t.organization ILIKE ${placeholder})`);
  }

  return { where: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '', params };
}

const APPLICATION_SELECT = `
  SELECT a.id, a.season_id, a.team_id, a.source, a.external_form_id, a.external_response_id,
         a.submitted_at, a.tech_status, a.tech_checked_at, a.tech_rejection_reason,
         a.organizer_notes, a.ip, a.user_agent, a.created_at, a.updated_at,
         -- Сведения об инициативе по Приложению № 1: нужны в карточке заявки.
         a.public_number, a.law_title, a.act_level, a.proposed_initiator, a.annotation,
         a.ai_usage, a.ai_usage_purpose, a.is_solo, a.solo_approved_at, a.content_locked,
         t.name AS team_name, t.status AS team_status, t.organization, t.city,
         t.captain_participant_id,
         d.id AS direction_id, d.title AS direction_title,
         s.title AS season_title,
         (SELECT count(*) FROM participants p WHERE p.team_id = t.id) AS participants_count,
         (SELECT count(*) FROM mentors m WHERE m.team_id = t.id) AS mentors_count,
         (SELECT count(*) FROM application_materials am WHERE am.application_id = a.id) AS materials_count
    FROM applications a
    JOIN teams t ON t.id = a.team_id
    JOIN seasons s ON s.id = a.season_id
    LEFT JOIN directions d ON d.id = t.direction_id
`;

// GET /api/admin/applications — список с фильтрами.
router.get(
  '/applications',
  asyncHandler(async (req, res) => {
    const filter = buildApplicationFilter(req);
    const limit = Math.min(1000, parsePositiveInt(queryString(req.query.limit)) ?? 200);
    const offset = Math.max(0, parsePositiveInt(queryString(req.query.offset)) ?? 0);
    const result = await query(
      `${APPLICATION_SELECT} ${filter.where} ORDER BY a.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      filter.params
    );
    res.json(result.rows);
  })
);

// GET /api/admin/applications/export — выгрузка CSV (экспорт для оргкомитета).
router.get(
  '/applications/export',
  requireAdminRole('admin'),
  asyncHandler(async (req, res) => {
    const filter = buildApplicationFilter(req);
    const result = await query(
      `${APPLICATION_SELECT} ${filter.where} ORDER BY a.created_at DESC LIMIT 5000`,
      filter.params
    );
    const csv = toCsv(
      [
        'ID заявки',
        'Сезон',
        'Команда',
        'Направление',
        'Организация',
        'Город',
        'Источник',
        'Статус заявки',
        'Статус команды',
        'Участников',
        'Наставников',
        'Материалов',
        'Дата подачи',
      ],
      result.rows.map((row) => [
        row.id,
        row.season_title,
        row.team_name,
        row.direction_title,
        row.organization,
        row.city,
        row.source,
        row.tech_status,
        row.team_status,
        row.participants_count,
        row.mentors_count,
        row.materials_count,
        row.submitted_at,
      ])
    );
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="applications.csv"',
    });
    res.send(csv);
  })
);

// GET /api/admin/applications/:id — заявка целиком.
router.get(
  '/applications/:id',
  asyncHandler(async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Некорректный идентификатор заявки' });
      return;
    }
    const applicationResult = await query(`${APPLICATION_SELECT} WHERE a.id = $1 LIMIT 1`, [id]);
    if (applicationResult.rows.length === 0) {
      res.status(404).json({ error: 'Заявка не найдена' });
      return;
    }
    const application = applicationResult.rows[0];

    const participants = await query('SELECT * FROM participants WHERE team_id = $1 ORDER BY role DESC, id', [
      application.team_id,
    ]);
    const mentors = await query('SELECT * FROM mentors WHERE team_id = $1 ORDER BY id', [application.team_id]);
    const materials = await query(
      `SELECT m.*, media.file_name, media.file_type, media.file_size
         FROM application_materials m
         LEFT JOIN media ON media.id = m.media_id
        WHERE m.application_id = $1
        ORDER BY m.type, m.version DESC`,
      [id]
    );

    res.json({ application, participants: participants.rows, mentors: mentors.rows, materials: materials.rows });
  })
);

// GET /api/admin/applications/:id/consents — согласия заявки и матрица
// распространения. Электронное согласие подтверждается версией текста, датой,
// временем и сетевым адресом (п. 14.3 Положения), поэтому Оргкомитет должен
// видеть эти сведения, а не только галочку.
router.get(
  '/applications/:id/consents',
  asyncHandler(async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Некорректный идентификатор заявки' });
      return;
    }
    const application = await query('SELECT id, team_id FROM applications WHERE id = $1 LIMIT 1', [id]);
    const row = application.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Заявка не найдена' });
      return;
    }

    const consents = await query(
      `SELECT c.id, c.subject_type, c.document_code, c.document_version, c.accepted,
              c.accepted_at, c.ip, c.revoked_at, c.scan_media_id,
              p.full_name AS participant_name, m.full_name AS mentor_name,
              d.title AS document_title
         FROM consents c
         LEFT JOIN participants p ON p.id = c.participant_id
         LEFT JOIN mentors m ON m.id = c.mentor_id
         LEFT JOIN documents d ON d.id = c.document_id
        WHERE c.team_id = $1
        ORDER BY c.id`,
      [row.team_id]
    );

    const distribution = await query(
      `SELECT dc.participant_id, p.full_name AS participant_name, dc.category_code,
              dc.allowed, dc.conditions, dc.signed_at
         FROM participant_distribution_consents dc
         JOIN participants p ON p.id = dc.participant_id
        WHERE p.team_id = $1
        ORDER BY p.id, dc.category_code`,
      [row.team_id]
    );

    res.json({ consents: consents.rows, distribution: distribution.rows });
  })
);

const TECH_STATUSES = ['pending', 'in_review', 'fix_required', 'accepted', 'rejected'] as const;

// PATCH /api/admin/applications/:id — статус технической проверки и заметки.
router.patch(
  '/applications/:id',
  asyncHandler(async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Некорректный идентификатор заявки' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;

    const assignments: string[] = [];
    const values: unknown[] = [];

    if (body.tech_status !== undefined) {
      const status = String(body.tech_status);
      if (!TECH_STATUSES.includes(status as (typeof TECH_STATUSES)[number])) {
        res.status(400).json({ error: `Недопустимый статус технической проверки: ${status}` });
        return;
      }
      values.push(status);
      assignments.push(`tech_status = $${values.length}`);
      assignments.push('tech_checked_at = now()');
      values.push(adminUserId(req));
      assignments.push(`tech_checked_by = $${values.length}`);
    }
    if (body.tech_rejection_reason !== undefined) {
      values.push(optionalText(body.tech_rejection_reason, 2000));
      assignments.push(`tech_rejection_reason = $${values.length}`);
    }
    if (body.organizer_notes !== undefined) {
      values.push(optionalText(body.organizer_notes, 5000));
      assignments.push(`organizer_notes = $${values.length}`);
    }

    if (assignments.length === 0) {
      res.status(400).json({ error: 'Не передано ни одного поля для изменения' });
      return;
    }

    values.push(id);
    const result = await query(
      `UPDATE applications
          SET ${assignments.join(', ')}, updated_at = now()
        WHERE id = $${values.length}
        RETURNING id, tech_status, tech_checked_at, tech_rejection_reason, organizer_notes`,
      values
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Заявка не найдена' });
      return;
    }

    // Статус заявки синхронизируется с жизненным циклом команды.
    if (body.tech_status === 'accepted') {
      await query(
        `UPDATE teams SET status = 'allowed', status_changed_at = now(), updated_at = now()
          WHERE id = (SELECT team_id FROM applications WHERE id = $1)
            AND status IN ('submitted', 'tech_check')`,
        [id]
      );
    }
    if (body.tech_status === 'rejected') {
      await query(
        `UPDATE teams SET status = 'tech_rejected', status_changed_at = now(), updated_at = now()
          WHERE id = (SELECT team_id FROM applications WHERE id = $1)`,
        [id]
      );
    }

    res.json(result.rows[0]);
  })
);

// POST /api/admin/applications/bulk — массовая техническая проверка (ТЗ 07, п. 3.3).
// Одно действие — один запрос, но с предпросмотром: при `dry_run` возвращается
// список того, что именно изменится, и только затем Оргкомитет подтверждает.
router.post(
  '/applications/bulk',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawIds = Array.isArray(body.ids) ? body.ids : [];
    const ids: number[] = [];
    for (const value of rawIds) {
      const id = parsePositiveInt(value);
      if (id === null) {
        res.status(400).json({ error: 'Некорректный список заявок' });
        return;
      }
      ids.push(id);
    }
    if (ids.length === 0) {
      res.status(400).json({ error: 'Отметьте хотя бы одну заявку' });
      return;
    }
    if (ids.length > 200) {
      res.status(400).json({ error: 'За одно действие можно обработать не более 200 заявок' });
      return;
    }

    const patch = (body.patch ?? {}) as Record<string, unknown>;
    const status = patch.tech_status === undefined ? null : String(patch.tech_status);
    if (status !== null && !(TECH_STATUSES as readonly string[]).includes(status)) {
      res.status(400).json({ error: `Недопустимый статус технической проверки: ${status}` });
      return;
    }
    const rejectionReason = optionalText(patch.tech_rejection_reason, 2000);
    if (status === 'rejected' && !rejectionReason) {
      res.status(400).json({ error: 'При отклонении укажите причину: команда увидит её в личном кабинете.' });
      return;
    }
    const notes = optionalText(patch.organizer_notes, 4000);
    if (status === null && notes === null) {
      res.status(400).json({ error: 'Не передано ни одного изменения' });
      return;
    }

    const before = await query(
      `SELECT a.id, a.public_number, a.tech_status, t.name AS team_name
         FROM applications a
         LEFT JOIN teams t ON t.id = a.team_id
        WHERE a.id = ANY($1::int[])
        ORDER BY a.id`,
      [ids]
    );
    if (before.rows.length !== ids.length) {
      const found = new Set(before.rows.map((row) => Number(row.id)));
      const missing = ids.filter((id) => !found.has(id));
      res.status(404).json({ error: `Заявки не найдены: ${missing.join(', ')}` });
      return;
    }

    const preview = before.rows.map((row) => ({
      id: Number(row.id),
      public_number: row.public_number,
      team_name: row.team_name,
      tech_status_before: row.tech_status,
      tech_status_after: status ?? row.tech_status,
    }));

    if (body.dry_run === true) {
      res.json({ dry_run: true, affected: preview.length, preview });
      return;
    }

    await withTransaction(async (client) => {
      for (const row of before.rows) {
        const id = Number(row.id);
        if (status !== null) {
          await client.query(
            `UPDATE applications
                SET tech_status = $1,
                    tech_rejection_reason = CASE WHEN $1 = 'rejected' THEN $2 ELSE NULL END,
                    tech_checked_at = now(),
                    tech_checked_by = $3,
                    updated_at = now()
              WHERE id = $4`,
            [status, rejectionReason, adminUserId(req), id]
          );
          if (status === 'accepted') {
            await client.query(
              `UPDATE teams SET status = 'allowed', status_changed_at = now(), updated_at = now()
                WHERE id = (SELECT team_id FROM applications WHERE id = $1)
                  AND status IN ('submitted', 'tech_check')`,
              [id]
            );
          }
          if (status === 'rejected') {
            await client.query(
              `UPDATE teams SET status = 'tech_rejected', status_changed_at = now(), updated_at = now()
                WHERE id = (SELECT team_id FROM applications WHERE id = $1)`,
              [id]
            );
          }
        }
        if (notes !== null) {
          await client.query(
            `UPDATE applications
                SET organizer_notes = COALESCE(organizer_notes, '') || $1, updated_at = now()
              WHERE id = $2`,
            [notes, id]
          );
        }
      }
    });

    await writeAudit({
      action: 'applications_bulk_review',
      entity: 'applications',
      entityId: ids.join(','),
      before: before.rows,
      after: { tech_status: status, organizer_notes: notes },
      req,
    });

    res.json({ dry_run: false, affected: preview.length, preview });
  })
);

// ─── Материалы заявок ────────────────────────────────────────────────────────

// GET /api/admin/materials — материалы с фильтрами.
router.get(
  '/materials',
  asyncHandler(async (req, res) => {
    const params: unknown[] = [];
    const where: string[] = [];
    const status = queryString(req.query.status);
    if (status) {
      params.push(status);
      where.push(`m.status = $${params.length}`);
    }
    const teamId = parsePositiveInt(queryString(req.query.team_id));
    if (teamId !== null) {
      params.push(teamId);
      where.push(`m.team_id = $${params.length}`);
    }
    const type = queryString(req.query.type);
    if (type) {
      params.push(type);
      where.push(`m.type = $${params.length}`);
    }
    // Очередь проверки материалов (ТЗ 07, п. 2.3): отдельный фильтр по сроку
    // досдачи — «истекает в ближайшие два рабочих дня» и «срок истёк».
    const deadline = queryString(req.query.deadline);
    if (deadline === 'overdue') {
      where.push("m.fix_deadline IS NOT NULL AND m.fix_deadline < now() AND m.status = 'needs_fix'");
    } else if (deadline === 'soon') {
      where.push(
        "m.fix_deadline IS NOT NULL AND m.status = 'needs_fix' AND m.fix_deadline >= now() " +
          "AND m.fix_deadline <= now() + interval '2 days'"
      );
    } else if (deadline === 'queue') {
      where.push("m.status IN ('uploaded', 'needs_fix')");
    }
    const applicationId = parsePositiveInt(queryString(req.query.application_id));
    if (applicationId !== null) {
      params.push(applicationId);
      where.push(`m.application_id = $${params.length}`);
    }
    const result = await query(
      `SELECT m.*, t.name AS team_name, a.public_number, media.file_name, media.file_type, media.file_size,
              CASE WHEN m.media_id IS NOT NULL
                   THEN '/api/media/file/' || m.media_id::text
                   ELSE NULL END AS file_url,
              (m.fix_deadline IS NOT NULL AND m.fix_deadline < now() AND m.status = 'needs_fix') AS fix_overdue
         FROM application_materials m
         JOIN teams t ON t.id = m.team_id
         LEFT JOIN applications a ON a.id = m.application_id
         LEFT JOIN media ON media.id = m.media_id
         ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY m.application_id, m.type, m.created_at DESC
        LIMIT 500`,
      params
    );
    res.json(result.rows);
  })
);

const MATERIAL_STATUSES = ['uploaded', 'accepted', 'needs_fix', 'rejected', 'blocked'] as const;

// POST /api/admin/materials/:id/review — результат проверки материала.
router.post(
  '/materials/:id/review',
  asyncHandler(async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Некорректный идентификатор материала' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const status = String(body.status ?? '');
    if (!MATERIAL_STATUSES.includes(status as (typeof MATERIAL_STATUSES)[number])) {
      res.status(400).json({ error: `Недопустимый статус материала: ${status}` });
      return;
    }

    // Блокировка содержания (ТЗ 07, п. 2.3): применяется, когда материал нельзя
    // показывать — нарушение прав или запрещённое содержание. Причина
    // обязательна: команда должна понимать, что произошло.
    if (status === 'blocked' && !optionalText(body.comment, 3000)) {
      res.status(400).json({
        error: 'Для блокировки содержания укажите причину: команда увидит пояснение в личном кабинете.',
      });
      return;
    }

    // При возврате на доработку действует срок не более 2 рабочих дней (п. 7.5).
    let fixDeadline: string | null = null;
    if (status === 'needs_fix') {
      if (body.fix_deadline !== undefined && body.fix_deadline !== null) {
        const parsed = new Date(String(body.fix_deadline));
        if (Number.isNaN(parsed.getTime())) {
          res.status(400).json({ error: 'Некорректный срок досдачи материала' });
          return;
        }
        fixDeadline = parsed.toISOString();
      } else {
        fixDeadline = addWorkingDays(new Date(), 2).toISOString();
      }
    }

    const result = await query(
      `UPDATE application_materials
          SET status = $1, reviewer_comment = $2, fix_deadline = $3,
              reviewed_by = $4, reviewed_at = now(), updated_at = now()
        WHERE id = $5
        RETURNING id, status, reviewer_comment, fix_deadline, reviewed_at`,
      [status, optionalText(body.comment, 3000), fixDeadline, adminUserId(req), id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Материал не найден' });
      return;
    }
    res.json(result.rows[0]);
  })
);

// POST /api/admin/materials/bulk — массовая проверка материалов (ТЗ 07, п. 3.3).
router.post(
  '/materials/bulk',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawIds = Array.isArray(body.ids) ? body.ids : [];
    const ids: number[] = [];
    for (const value of rawIds) {
      const id = parsePositiveInt(value);
      if (id === null) {
        res.status(400).json({ error: 'Некорректный список материалов' });
        return;
      }
      ids.push(id);
    }
    if (ids.length === 0) {
      res.status(400).json({ error: 'Отметьте хотя бы один материал' });
      return;
    }
    if (ids.length > 200) {
      res.status(400).json({ error: 'За одно действие можно обработать не более 200 материалов' });
      return;
    }

    const action = String(body.action ?? '');
    if (action !== 'accept' && action !== 'request_fix' && action !== 'block') {
      res.status(400).json({
        error: 'Действие указывается явно: «принять», «вернуть на доработку» или «заблокировать содержание».',
      });
      return;
    }
    const status = action === 'accept' ? 'accepted' : action === 'block' ? 'blocked' : 'needs_fix';
    const comment = optionalText(body.comment, 3000);
    if ((action === 'request_fix' || action === 'block') && !comment) {
      res.status(400).json({
        error:
          action === 'block'
            ? 'Для блокировки содержания укажите причину: команда увидит пояснение.'
            : 'При возврате на доработку укажите, что исправить: команда увидит замечание.',
      });
      return;
    }

    const before = await query(
      `SELECT m.id, m.type, m.status, t.name AS team_name
         FROM application_materials m
         JOIN teams t ON t.id = m.team_id
        WHERE m.id = ANY($1::int[])
        ORDER BY m.id`,
      [ids]
    );
    if (before.rows.length !== ids.length) {
      const found = new Set(before.rows.map((row) => Number(row.id)));
      const missing = ids.filter((id) => !found.has(id));
      res.status(404).json({ error: `Материалы не найдены: ${missing.join(', ')}` });
      return;
    }

    const preview = before.rows.map((row) => ({
      id: Number(row.id),
      type: row.type,
      team_name: row.team_name,
      status_before: row.status,
      status_after: status,
    }));

    if (body.dry_run === true) {
      res.json({ dry_run: true, affected: preview.length, preview });
      return;
    }

    const fixDeadline = action === 'request_fix' ? addWorkingDays(new Date(), 2).toISOString() : null;
    await query(
      `UPDATE application_materials
          SET status = $1, reviewer_comment = $2, fix_deadline = $3,
              reviewed_by = $4, reviewed_at = now(), updated_at = now()
        WHERE id = ANY($5::int[])`,
      [status, comment, fixDeadline, adminUserId(req), ids]
    );

    await writeAudit({
      action: 'materials_bulk_review',
      entity: 'materials',
      entityId: ids.join(','),
      before: before.rows,
      after: { status, comment },
      req,
    });

    res.json({ dry_run: false, affected: preview.length, preview });
  })
);

// ─── Команды ─────────────────────────────────────────────────────────────────

const TEAM_STATUSES = [
  'draft',
  'submitted',
  'tech_check',
  'tech_rejected',
  'allowed',
  'stage1',
  'finalist',
  'final',
  'winner',
  'disqualified',
  'withdrawn',
] as const;

// GET /api/admin/teams — список команд с составом и статусами.
router.get(
  '/teams',
  asyncHandler(async (req, res) => {
    const params: unknown[] = [];
    const where: string[] = [];

    const seasonId = parsePositiveInt(queryString(req.query.season_id));
    if (seasonId !== null) {
      params.push(seasonId);
      where.push(`t.season_id = $${params.length}`);
    }
    const status = queryString(req.query.status);
    if (status) {
      params.push(status);
      where.push(`t.status = $${params.length}`);
    }
    const directionId = parsePositiveInt(queryString(req.query.direction_id));
    if (directionId !== null) {
      params.push(directionId);
      where.push(`t.direction_id = $${params.length}`);
    }
    const search = queryString(req.query.q);
    if (search) {
      params.push(`%${search}%`);
      where.push(`(t.name ILIKE $${params.length} OR t.organization ILIKE $${params.length})`);
    }

    const result = await query(
      `SELECT t.id, t.season_id, t.name, t.status, t.organization, t.city,
              t.direction_id, t.captain_participant_id, t.status_changed_at, t.created_at,
              d.title AS direction_title,
              s.title AS season_title,
              (SELECT count(*) FROM participants p WHERE p.team_id = t.id) AS participants_count,
              (SELECT count(*) FROM mentors m WHERE m.team_id = t.id) AS mentors_count,
              (SELECT count(*) FROM application_materials am WHERE am.team_id = t.id) AS materials_count,
              (SELECT p.full_name FROM participants p
                WHERE p.team_id = t.id AND p.role = 'captain' LIMIT 1) AS captain_name,
              (SELECT p.email FROM participants p
                WHERE p.team_id = t.id AND p.role = 'captain' LIMIT 1) AS captain_email
         FROM teams t
         JOIN seasons s ON s.id = t.season_id
         LEFT JOIN directions d ON d.id = t.direction_id
         ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY t.created_at DESC
        LIMIT 500`,
      params
    );
    res.json(result.rows);
  })
);

// GET /api/admin/teams/:id — команда с составом, заявкой и материалами.
router.get(
  '/teams/:id',
  asyncHandler(async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Некорректный идентификатор команды' });
      return;
    }
    const teamResult = await query(
      `SELECT t.*, s.title AS season_title, s.application_close_at, d.title AS direction_title
         FROM teams t
         JOIN seasons s ON s.id = t.season_id
         LEFT JOIN directions d ON d.id = t.direction_id
        WHERE t.id = $1 LIMIT 1`,
      [id]
    );
    if (teamResult.rows.length === 0) {
      res.status(404).json({ error: 'Команда не найдена' });
      return;
    }
    const participants = await query('SELECT * FROM participants WHERE team_id = $1 ORDER BY role DESC, id', [id]);
    const mentors = await query('SELECT * FROM mentors WHERE team_id = $1 ORDER BY id', [id]);
    const application = await query('SELECT * FROM applications WHERE team_id = $1 ORDER BY id DESC LIMIT 1', [id]);
    const materials = await query(
      `SELECT m.*, media.file_name, media.file_type, media.file_size
         FROM application_materials m
         LEFT JOIN media ON media.id = m.media_id
        WHERE m.team_id = $1
        ORDER BY m.type, m.version DESC`,
      [id]
    );
    const tokens = await query(
      `SELECT id, label, issued_to_email, max_uses, used_count, single_use,
              expires_at, revoked_at, last_used_at, created_at
         FROM access_tokens WHERE team_id = $1 ORDER BY created_at DESC`,
      [id]
    );

    // История статусов берётся из журнала действий: каждое решение Оргкомитета
    // уже записано с автором и временем, дублировать её отдельной таблицей не нужно.
    const history = await query(
      `SELECT created_at, actor_label, action, before, after
         FROM audit_log
        WHERE entity = 'teams' AND entity_id = $1
        ORDER BY created_at DESC
        LIMIT 50`,
      [String(id)]
    );
    const participation = await query(
      `SELECT stage, group_code, advanced, advance_reason, audience_votes, jury_votes,
              final_place, nomination, notes, created_at
         FROM stage_participation WHERE team_id = $1 ORDER BY stage, id`,
      [id]
    );
    const rankings = await query(
      `SELECT stage, place, average_score, is_published, published_at, needs_chair_review
         FROM rankings WHERE team_id = $1 ORDER BY stage`,
      [id]
    );

    res.json({
      team: teamResult.rows[0],
      participants: participants.rows,
      mentors: mentors.rows,
      application: application.rows[0] ?? null,
      materials: materials.rows,
      access_tokens: tokens.rows,
      status_history: history.rows,
      stage_participation: participation.rows,
      rankings: rankings.rows,
    });
  })
);

// PATCH /api/admin/teams/:id — решение оргкомитета по команде.
router.patch(
  '/teams/:id',
  asyncHandler(async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Некорректный идентификатор команды' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const assignments: string[] = [];
    const values: unknown[] = [];

    if (body.status !== undefined) {
      const status = String(body.status);
      if (!TEAM_STATUSES.includes(status as (typeof TEAM_STATUSES)[number])) {
        res.status(400).json({ error: `Недопустимый статус команды: ${status}` });
        return;
      }
      // Дисквалификация — решение с последствиями: без причины его не принимают
      // (ТЗ 07, п. 2.4), а причина попадает в журнал действий.
      if (status === 'disqualified' && !optionalText(body.disqualification_reason, 2000)) {
        res.status(400).json({
          error: 'Для дисквалификации укажите причину: команда увидит её, а решение попадёт в журнал.',
        });
        return;
      }
      values.push(status);
      assignments.push(`status = $${values.length}`);
      assignments.push('status_changed_at = now()');
    }
    if (body.disqualification_reason !== undefined) {
      values.push(optionalText(body.disqualification_reason, 2000));
      assignments.push(`disqualification_reason = $${values.length}`);
    } else if (body.status !== undefined && String(body.status) !== 'disqualified') {
      // Возврат в работу снимает прежнюю причину: иначе в карточке останется
      // причина дисквалификации у действующей команды.
      assignments.push('disqualification_reason = NULL');
    }
    if (body.direction_id !== undefined) {
      values.push(parsePositiveInt(body.direction_id));
      assignments.push(`direction_id = $${values.length}`);
    }
    if (body.organization !== undefined) {
      values.push(optionalText(body.organization, 300));
      assignments.push(`organization = $${values.length}`);
    }
    if (body.city !== undefined) {
      values.push(optionalText(body.city, 120));
      assignments.push(`city = $${values.length}`);
    }

    if (assignments.length === 0) {
      res.status(400).json({ error: 'Не передано ни одного поля для изменения' });
      return;
    }

    values.push(id);
    const result = await query(
      `UPDATE teams SET ${assignments.join(', ')}, updated_at = now()
        WHERE id = $${values.length}
        RETURNING id, name, status, direction_id, organization, city, disqualification_reason`,
      values
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Команда не найдена' });
      return;
    }
    res.json(result.rows[0]);
  })
);

// ─── Токены доступа команды ──────────────────────────────────────────────────

// POST /api/admin/teams/:id/tokens — выпуск токена доступа в личный кабинет.
router.post(
  '/teams/:id/tokens',
  asyncHandler(async (req, res) => {
    const teamId = parsePositiveInt(req.params.id);
    if (teamId === null) {
      res.status(400).json({ error: 'Некорректный идентификатор команды' });
      return;
    }
    const team = await query('SELECT id FROM teams WHERE id = $1 LIMIT 1', [teamId]);
    if (team.rows.length === 0) {
      res.status(404).json({ error: 'Команда не найдена' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const days = Math.min(365, Math.max(1, parsePositiveInt(body.expires_in_days) ?? 90));
    const maxUses = Math.max(0, parsePositiveInt(body.max_uses) ?? 0);
    const singleUse = body.single_use === true;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const token = generateAccessToken();
    const result = await query(
      `INSERT INTO access_tokens
         (team_id, token_hash, label, issued_to_email, max_uses, single_use, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, label, expires_at, max_uses, single_use, created_at`,
      [
        teamId,
        hashAccessToken(token),
        optionalText(body.label, 200),
        optionalText(body.issued_to_email, 250),
        singleUse ? Math.min(1, maxUses === 0 ? 1 : maxUses) : maxUses,
        singleUse,
        expiresAt.toISOString(),
        adminUserId(req),
      ]
    );

    // Токен показывается один раз: в базе хранится только его SHA-256.
    res.status(201).json({ ...result.rows[0], token });
  })
);

// GET /api/admin/teams/:id/tokens — список выпущенных токенов.
router.get(
  '/teams/:id/tokens',
  asyncHandler(async (req, res) => {
    const teamId = parsePositiveInt(req.params.id);
    if (teamId === null) {
      res.status(400).json({ error: 'Некорректный идентификатор команды' });
      return;
    }
    const result = await query(
      `SELECT id, label, issued_to_email, max_uses, used_count, single_use,
              expires_at, revoked_at, last_used_at, created_at
         FROM access_tokens WHERE team_id = $1 ORDER BY created_at DESC`,
      [teamId]
    );
    res.json(result.rows);
  })
);

// POST /api/admin/tokens/:id/revoke — отзыв токена.
router.post(
  '/tokens/:id/revoke',
  asyncHandler(async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Некорректный идентификатор токена' });
      return;
    }
    const result = await query(
      'UPDATE access_tokens SET revoked_at = now() WHERE id = $1 RETURNING id, revoked_at',
      [id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Токен не найден' });
      return;
    }
    res.json(result.rows[0]);
  })
);

// ─── Участники ───────────────────────────────────────────────────────────────

// GET /api/admin/participants — список участников с согласиями.
router.get(
  '/participants',
  asyncHandler(async (req, res) => {
    const params: unknown[] = [];
    const where: string[] = [];

    const teamId = parsePositiveInt(queryString(req.query.team_id));
    if (teamId !== null) {
      params.push(teamId);
      where.push(`p.team_id = $${params.length}`);
    }
    const seasonId = parsePositiveInt(queryString(req.query.season_id));
    if (seasonId !== null) {
      params.push(seasonId);
      where.push(`p.season_id = $${params.length}`);
    }
    const search = queryString(req.query.q);
    if (search) {
      params.push(`%${search}%`);
      where.push(`(p.full_name ILIKE $${params.length} OR p.email ILIKE $${params.length})`);
    }
    const consent = queryString(req.query.consent_received);
    if (consent === 'true' || consent === 'false') {
      params.push(consent === 'true');
      where.push(`p.consent_received = $${params.length}`);
    }

    const result = await query(
      `SELECT p.*, t.name AS team_name, t.status AS team_status
         FROM participants p
         JOIN teams t ON t.id = p.team_id
         ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY p.created_at DESC
        LIMIT 1000`,
      params
    );
    res.json(result.rows);
  })
);

// PATCH /api/admin/participants/:id — правка данных участника и согласий.
router.patch(
  '/participants/:id',
  asyncHandler(async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Некорректный идентификатор участника' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const assignments: string[] = [];
    const values: unknown[] = [];

    const textFields: Array<[string, number]> = [
      ['full_name', 200],
      ['organization', 300],
      ['position', 300],
      ['education', 300],
      ['email', 250],
      ['phone', 32],
    ];
    for (const [field, maxLength] of textFields) {
      if (body[field] === undefined) continue;
      values.push(optionalText(body[field], maxLength));
      assignments.push(`${field} = $${values.length}`);
    }

    if (body.role !== undefined) {
      const role = String(body.role);
      if (role !== 'captain' && role !== 'member') {
        res.status(400).json({ error: 'Роль участника: captain или member' });
        return;
      }
      values.push(role);
      assignments.push(`role = $${values.length}`);
    }
    if (body.category !== undefined) {
      values.push(String(body.category));
      assignments.push(`category = $${values.length}`);
    }
    if (body.birth_date !== undefined) {
      if (!isIsoDate(body.birth_date)) {
        res.status(400).json({ error: 'Некорректная дата рождения' });
        return;
      }
      values.push(body.birth_date);
      assignments.push(`birth_date = $${values.length}`);
    }
    for (const booleanField of [
      'consent_pdn',
      'consent_distribution',
      'consent_legal_representative',
      'is_minor',
      'consent_received',
    ]) {
      if (body[booleanField] === undefined) continue;
      if (typeof body[booleanField] !== 'boolean') {
        res.status(400).json({ error: `Поле ${booleanField} должно быть логическим` });
        return;
      }
      values.push(body[booleanField]);
      assignments.push(`${booleanField} = $${values.length}`);
    }

    if (assignments.length === 0) {
      res.status(400).json({ error: 'Не передано ни одного поля для изменения' });
      return;
    }

    values.push(id);
    try {
      const result = await query(
        `UPDATE participants SET ${assignments.join(', ')}, updated_at = now()
          WHERE id = $${values.length}
          RETURNING *`,
        values
      );
      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Участник не найден' });
        return;
      }
      res.json(result.rows[0]);
    } catch (error) {
      if (!handleDbError(res, error)) throw error;
    }
  })
);

// ─── Оценки ──────────────────────────────────────────────────────────────────

const STAGES = ['selection', 'stage1', 'debate'] as const;

// GET /api/admin/evaluations — оценки с фильтрами.
router.get(
  '/evaluations',
  asyncHandler(async (req, res) => {
    const params: unknown[] = [];
    const where: string[] = [];
    const teamId = parsePositiveInt(queryString(req.query.team_id));
    if (teamId !== null) {
      params.push(teamId);
      where.push(`e.team_id = $${params.length}`);
    }
    const stage = queryString(req.query.stage);
    if (stage) {
      params.push(stage);
      where.push(`e.stage = $${params.length}`);
    }
    const result = await query(
      `SELECT e.*, t.name AS team_name,
              ex.full_name AS expert_name, jm.full_name AS jury_name
         FROM evaluations e
         JOIN teams t ON t.id = e.team_id
         LEFT JOIN experts ex ON ex.id = e.expert_id
         LEFT JOIN jury_members jm ON jm.id = e.jury_member_id
         ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY e.created_at DESC
        LIMIT 1000`,
      params
    );
    res.json(result.rows);
  })
);

// POST /api/admin/evaluations — выставление или обновление оценки.
router.post(
  '/evaluations',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const teamId = parsePositiveInt(body.team_id);
    const stage = String(body.stage ?? '');
    if (teamId === null) {
      res.status(400).json({ error: 'Укажите команду' });
      return;
    }
    if (!STAGES.includes(stage as (typeof STAGES)[number])) {
      res.status(400).json({ error: `Недопустимый этап: ${stage}` });
      return;
    }

    const expertId = parsePositiveInt(body.expert_id);
    const juryMemberId = parsePositiveInt(body.jury_member_id);
    if ((expertId === null) === (juryMemberId === null)) {
      res.status(400).json({ error: 'Укажите ровно одного автора оценки: эксперта или члена Жюри' });
      return;
    }

    const rawScores = Array.isArray(body.scores) ? body.scores : [];
    if (rawScores.length === 0) {
      res.status(400).json({ error: 'Передайте баллы по критериям' });
      return;
    }

    const criteriaResult = await query('SELECT id, max_score FROM criteria WHERE stage = $1 AND is_active = TRUE', [
      stage,
    ]);
    const maxById = new Map<number, number>();
    for (const row of criteriaResult.rows) maxById.set(Number(row.id), Number(row.max_score));
    if (maxById.size === 0) {
      res.status(409).json({ error: `Для этапа ${stage} не заданы критерии оценки` });
      return;
    }

    const scores: Array<{ criterion_id: number; score: number; comment: string | null }> = [];
    let total = 0;
    for (const raw of rawScores) {
      const item = raw as Record<string, unknown>;
      const criterionId = parsePositiveInt(item?.criterion_id);
      if (criterionId === null || !maxById.has(criterionId)) {
        res.status(400).json({ error: 'Критерий не относится к выбранному этапу' });
        return;
      }
      const score = Number(item?.score);
      const maxScore = maxById.get(criterionId) as number;
      if (!Number.isFinite(score) || score < 0 || score > maxScore) {
        res.status(400).json({ error: `Балл по критерию должен быть от 0 до ${maxScore}` });
        return;
      }
      total += score;
      // Приложение № 9: у каждого критерия — балл и обоснование.
      scores.push({
        criterion_id: criterionId,
        score: round2(score),
        comment: optionalText(item?.comment, 1000),
      });
    }

    const totalScore = round2(total);
    const comment = optionalText(body.comment, 3000);
    // Приложение № 9: рекомендации команде по итогам оценки.
    const recommendations = optionalText(body.recommendations, 3000);
    const isChairExtra = body.is_chair_extra === true;
    const isFinalVote = body.is_final_vote === true;

    const existing = await query(
      expertId !== null
        ? 'SELECT id FROM evaluations WHERE team_id = $1 AND stage = $2 AND expert_id = $3 LIMIT 1'
        : 'SELECT id FROM evaluations WHERE team_id = $1 AND stage = $2 AND jury_member_id = $3 LIMIT 1',
      [teamId, stage, expertId ?? juryMemberId]
    );

    if (existing.rows.length > 0) {
      const updated = await query(
        `UPDATE evaluations
            SET scores = $1::jsonb, total_score = $2, comment = $3,
                is_chair_extra = $4, is_final_vote = $5, recommendations = $6,
                updated_at = now()
          WHERE id = $7
          RETURNING *`,
        [JSON.stringify(scores), totalScore, comment, isChairExtra, isFinalVote, recommendations, existing.rows[0].id]
      );
      res.json(updated.rows[0]);
      return;
    }

    const inserted = await query(
      `INSERT INTO evaluations
         (team_id, stage, expert_id, jury_member_id, scores, total_score, comment,
          recommendations, is_chair_extra, is_final_vote, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        teamId,
        stage,
        expertId,
        juryMemberId,
        JSON.stringify(scores),
        totalScore,
        comment,
        recommendations,
        isChairExtra,
        isFinalVote,
        adminUserId(req),
      ]
    );
    res.status(201).json(inserted.rows[0]);
  })
);

// DELETE /api/admin/evaluations/:id
router.delete(
  '/evaluations/:id',
  asyncHandler(async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Некорректный идентификатор оценки' });
      return;
    }
    const result = await query('DELETE FROM evaluations WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Оценка не найдена' });
      return;
    }
    res.json({ success: true });
  })
);

// ─── Рейтинг и протоколы этапов ──────────────────────────────────────────────

// GET /api/admin/rankings — рейтинг этапа.
router.get(
  '/rankings',
  asyncHandler(async (req, res) => {
    const params: unknown[] = [];
    const where: string[] = [];
    const seasonId = parsePositiveInt(queryString(req.query.season_id));
    if (seasonId !== null) {
      params.push(seasonId);
      where.push(`r.season_id = $${params.length}`);
    }
    const stage = queryString(req.query.stage);
    if (stage) {
      params.push(stage);
      where.push(`r.stage = $${params.length}`);
    }
    const result = await query(
      `SELECT r.*, t.name AS team_name, t.status AS team_status
         FROM rankings r
         JOIN teams t ON t.id = r.team_id
         ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY r.stage, r.place`,
      params
    );
    res.json(result.rows);
  })
);

// POST /api/admin/rankings/recalculate — пересчёт рейтинга по п. 7.7.
router.post(
  '/rankings/recalculate',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const seasonId = parsePositiveInt(body.season_id);
    const stage = String(body.stage ?? '');
    if (seasonId === null) {
      res.status(400).json({ error: 'Укажите сезон' });
      return;
    }
    if (!STAGES.includes(stage as (typeof STAGES)[number])) {
      res.status(400).json({ error: `Недопустимый этап: ${stage}` });
      return;
    }

    const teamsResult = await query(
      `SELECT id, name FROM teams
        WHERE season_id = $1 AND status NOT IN ('disqualified', 'withdrawn')
        ORDER BY name`,
      [seasonId]
    );
    const teams = teamsResult.rows;
    if (teams.length === 0) {
      res.json({ stage, teams: [], message: 'В сезоне нет команд для расчёта' });
      return;
    }
    const teamIds = teams.map((team) => Number(team.id));

    const evaluationsResult = await query(
      `SELECT team_id, total_score, is_chair_extra
         FROM evaluations
        WHERE stage = $1 AND team_id = ANY($2::int[])`,
      [stage, teamIds]
    );

    const byTeam = new Map<number, { regular: number[]; chair: number[] }>();
    for (const id of teamIds) byTeam.set(id, { regular: [], chair: [] });
    for (const row of evaluationsResult.rows) {
      const bucket = byTeam.get(Number(row.team_id));
      if (!bucket) continue;
      const score = Number(row.total_score);
      if (row.is_chair_extra) bucket.chair.push(score);
      else bucket.regular.push(score);
    }

    const computed = teams.map((team) => {
      const id = Number(team.id);
      const bucket = byTeam.get(id) ?? { regular: [], chair: [] };
      const spread =
        bucket.regular.length > 1 ? round2(Math.max(...bucket.regular) - Math.min(...bucket.regular)) : 0;
      // Пункт 7.7: расхождение более 20 баллов — материалы направляются на
      // дополнительную оценку председателя, и его балл учитывается в среднем.
      // Флаг needs_chair_review означает «оценка председателя ещё нужна»:
      // как только она внесена, требование выполнено и флаг снимается
      // (ТЗ 04, п. 3.4.3; приёмочный сценарий С4.4).
      const hasChairExtra = bucket.chair.length > 0;
      const needsChairReview = spread > 20 && !hasChairExtra;
      const scores = spread > 20 && hasChairExtra ? [...bucket.regular, ...bucket.chair] : bucket.regular;
      const average =
        scores.length > 0 ? round2(scores.reduce((sum, value) => sum + value, 0) / scores.length) : 0;
      const juryTotal = round2(scores.reduce((sum, value) => sum + value, 0));
      return {
        team_id: id,
        team_name: String(team.name),
        average_score: average,
        jury_total: juryTotal,
        scores_spread: spread,
        needs_chair_review: needsChairReview,
        evaluations_count: scores.length,
      };
    });

    computed.sort((a, b) => {
      if (b.average_score !== a.average_score) return b.average_score - a.average_score;
      if (b.jury_total !== a.jury_total) return b.jury_total - a.jury_total;
      return a.team_name.localeCompare(b.team_name, 'ru');
    });

    await withTransaction(async (client) => {
      for (let index = 0; index < computed.length; index += 1) {
        const row = computed[index];
        await client.query(
          `INSERT INTO rankings
             (season_id, team_id, stage, place, average_score, jury_total, scores_spread,
              needs_chair_review, evaluations_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (season_id, stage, team_id) DO UPDATE
             SET place = EXCLUDED.place,
                 average_score = EXCLUDED.average_score,
                 jury_total = EXCLUDED.jury_total,
                 scores_spread = EXCLUDED.scores_spread,
                 needs_chair_review = EXCLUDED.needs_chair_review,
                 evaluations_count = EXCLUDED.evaluations_count,
                 updated_at = now()`,
          [
            seasonId,
            row.team_id,
            stage,
            index + 1,
            row.average_score,
            row.jury_total,
            row.scores_spread,
            row.needs_chair_review,
            row.evaluations_count,
          ]
        );
      }
      await client.query(
        `DELETE FROM rankings
          WHERE season_id = $1 AND stage = $2 AND NOT (team_id = ANY($3::int[]))`,
        [seasonId, stage, teamIds]
      );
    });

    res.json({
      stage,
      teams: computed.map((row, index) => ({ ...row, place: index + 1 })),
    });
  })
);

// POST /api/admin/rankings/publish — публикация протокола этапа.
router.post(
  '/rankings/publish',
  requireAdminRole('admin'),
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const seasonId = parsePositiveInt(body.season_id);
    const stage = String(body.stage ?? '');
    const publish = body.is_published !== false;
    if (seasonId === null || !STAGES.includes(stage as (typeof STAGES)[number])) {
      res.status(400).json({ error: 'Укажите сезон и этап' });
      return;
    }

    // Пункт 7.7 и ТЗ 04 (п. 3.4.3): итог не публикуется, пока по команде
    // требуется дополнительная оценка председателя.
    if (publish) {
      const pending = await query(
        `SELECT t.name
           FROM rankings r
           JOIN teams t ON t.id = r.team_id
          WHERE r.season_id = $1 AND r.stage = $2 AND r.needs_chair_review
          ORDER BY t.name`,
        [seasonId, stage]
      );
      if (pending.rows.length > 0) {
        res.status(409).json({
          error:
            'Протокол нельзя опубликовать: по части команд требуется дополнительная оценка председателя (п. 7.7 Положения). ' +
            `Команды: ${pending.rows.map((row) => String(row.name)).join(', ')}.`,
        });
        return;
      }
    }

    const result = await query(
      `UPDATE rankings
          SET is_published = $1,
              published_at = CASE WHEN $1 THEN now() ELSE NULL END,
              updated_at = now()
        WHERE season_id = $2 AND stage = $3
        RETURNING id`,
      [publish, seasonId, stage]
    );
    res.json({ success: true, updated: result.rows.length, is_published: publish });
  })
);

// PATCH /api/admin/rankings/:id — отметка публикации и примечание к протоколу.
router.patch(
  '/rankings/:id',
  asyncHandler(async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Некорректный идентификатор строки рейтинга' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const assignments: string[] = [];
    const values: unknown[] = [];

    if (body.is_published !== undefined) {
      if (typeof body.is_published !== 'boolean') {
        res.status(400).json({ error: 'Поле is_published должно быть логическим' });
        return;
      }
      values.push(body.is_published);
      assignments.push(`is_published = $${values.length}`);
      assignments.push(`published_at = CASE WHEN $${values.length} THEN now() ELSE NULL END`);
    }
    if (body.protocol_note !== undefined) {
      values.push(optionalText(body.protocol_note, 3000));
      assignments.push(`protocol_note = $${values.length}`);
    }
    if (assignments.length === 0) {
      res.status(400).json({ error: 'Не передано ни одного поля для изменения' });
      return;
    }

    values.push(id);
    const result = await query(
      `UPDATE rankings SET ${assignments.join(', ')}, updated_at = now()
        WHERE id = $${values.length}
        RETURNING *`,
      values
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Строка рейтинга не найдена' });
      return;
    }
    res.json(result.rows[0]);
  })
);

// ─── Апелляции ───────────────────────────────────────────────────────────────

const APPEAL_STATUSES = [
  'submitted',
  'in_review',
  'granted',
  'partially_granted',
  'rejected',
  'withdrawn',
] as const;

// GET /api/admin/appeals — список апелляций.
router.get(
  '/appeals',
  asyncHandler(async (req, res) => {
    const params: unknown[] = [];
    const where: string[] = [];
    const status = queryString(req.query.status);
    if (status) {
      params.push(status);
      where.push(`ap.status = $${params.length}`);
    }
    const stage = queryString(req.query.stage);
    if (stage) {
      params.push(stage);
      where.push(`ap.stage = $${params.length}`);
    }
    const seasonId = parsePositiveInt(queryString(req.query.season_id));
    if (seasonId !== null) {
      params.push(seasonId);
      where.push(`ap.season_id = $${params.length}`);
    }
    const result = await query(
      `SELECT ap.*, t.name AS team_name, s.title AS season_title,
              (ap.deadline_at < now() AND ap.status = 'submitted') AS overdue,
              CASE WHEN ap.scan_media_id IS NOT NULL
                   THEN '/api/media/file/' || ap.scan_media_id::text
                   ELSE NULL END AS scan_url
         FROM appeals ap
         JOIN teams t ON t.id = ap.team_id
         JOIN seasons s ON s.id = ap.season_id
         ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY ap.submitted_at DESC
        LIMIT 500`,
      params
    );
    res.json(result.rows);
  })
);

// POST /api/admin/appeals — регистрация апелляции, поступившей в оргкомитет.
router.post(
  '/appeals',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const teamId = parsePositiveInt(body.team_id);
    const stage = String(body.stage ?? '');
    const text = requiredText(body.text, 10000);

    if (teamId === null || !text) {
      res.status(400).json({ error: 'Укажите команду и текст апелляции' });
      return;
    }
    if (stage !== 'selection' && stage !== 'stage1') {
      res.status(400).json({ error: 'Апелляция подаётся только по итогам отборочного или первого этапа' });
      return;
    }

    const team = await query(
      `SELECT t.id, t.season_id, s.appeal_window_days
         FROM teams t JOIN seasons s ON s.id = t.season_id
        WHERE t.id = $1 LIMIT 1`,
      [teamId]
    );
    if (team.rows.length === 0) {
      res.status(404).json({ error: 'Команда не найдена' });
      return;
    }

    let deadlineAt: string;
    if (body.deadline_at !== undefined && body.deadline_at !== null) {
      const parsed = new Date(String(body.deadline_at));
      if (Number.isNaN(parsed.getTime())) {
        res.status(400).json({ error: 'Некорректный срок подачи апелляции' });
        return;
      }
      deadlineAt = parsed.toISOString();
    } else {
      // Пункт 12.1: 2 рабочих дня с момента опубликования протокола.
      const days = Number(team.rows[0].appeal_window_days || 2);
      deadlineAt = addWorkingDays(new Date(), days).toISOString();
    }

    const result = await query(
      `INSERT INTO appeals (season_id, team_id, stage, grounds, text, deadline_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [team.rows[0].season_id, teamId, stage, optionalText(body.grounds, 64), text, deadlineAt]
    );
    res.status(201).json(result.rows[0]);
  })
);

// PATCH /api/admin/appeals/:id — решение апелляционной комиссии.
router.patch(
  '/appeals/:id',
  asyncHandler(async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Некорректный идентификатор апелляции' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const assignments: string[] = [];
    const values: unknown[] = [];

    if (body.status !== undefined) {
      const status = String(body.status);
      if (!APPEAL_STATUSES.includes(status as (typeof APPEAL_STATUSES)[number])) {
        res.status(400).json({ error: `Недопустимый статус апелляции: ${status}` });
        return;
      }
      values.push(status);
      assignments.push(`status = $${values.length}`);
      if (['granted', 'partially_granted', 'rejected', 'withdrawn'].includes(status)) {
        assignments.push('reviewed_at = now()');
        values.push(adminUserId(req));
        assignments.push(`reviewed_by = $${values.length}`);
      }
    }
    if (body.decision !== undefined) {
      values.push(optionalText(body.decision, 3000));
      assignments.push(`decision = $${values.length}`);
    }
    if (body.decision_note !== undefined) {
      values.push(optionalText(body.decision_note, 5000));
      assignments.push(`decision_note = $${values.length}`);
    }
    if (body.protocol_url !== undefined) {
      values.push(optionalText(body.protocol_url, 2000));
      assignments.push(`protocol_url = $${values.length}`);
    }

    if (assignments.length === 0) {
      res.status(400).json({ error: 'Не передано ни одного поля для изменения' });
      return;
    }

    values.push(id);
    const result = await query(
      `UPDATE appeals SET ${assignments.join(', ')}, updated_at = now()
        WHERE id = $${values.length}
        RETURNING *`,
      values
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Апелляция не найдена' });
      return;
    }
    res.json(result.rows[0]);
  })
);

// ─── Обращения с сайта ───────────────────────────────────────────────────────

const LEAD_STATUSES = ['new', 'in_progress', 'answered', 'closed', 'spam'] as const;

// GET /api/admin/leads — обращения.
router.get(
  '/leads',
  asyncHandler(async (req, res) => {
    const params: unknown[] = [];
    const where: string[] = [];
    const status = queryString(req.query.status);
    if (status) {
      params.push(status);
      where.push(`l.status = $${params.length}`);
    }
    const search = queryString(req.query.q);
    if (search) {
      params.push(`%${search}%`);
      where.push(`(l.name ILIKE $${params.length} OR l.email ILIKE $${params.length})`);
    }
    const result = await query(
      `SELECT l.*, t.name AS team_name
         FROM leads l
         LEFT JOIN teams t ON t.id = l.team_id
         ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY l.created_at DESC
        LIMIT 1000`,
      params
    );
    res.json(result.rows);
  })
);

// PATCH /api/admin/leads/:id — статус обработки обращения.
router.patch(
  '/leads/:id',
  asyncHandler(async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Некорректный идентификатор обращения' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const assignments: string[] = [];
    const values: unknown[] = [];

    if (body.status !== undefined) {
      const status = String(body.status);
      if (!LEAD_STATUSES.includes(status as (typeof LEAD_STATUSES)[number])) {
        res.status(400).json({ error: `Недопустимый статус обращения: ${status}` });
        return;
      }
      values.push(status);
      assignments.push(`status = $${values.length}`);
    }
    if (body.admin_comment !== undefined) {
      values.push(optionalText(body.admin_comment, 3000));
      assignments.push(`admin_comment = $${values.length}`);
    }
    if (assignments.length === 0) {
      res.status(400).json({ error: 'Не передано ни одного поля для изменения' });
      return;
    }

    values.push(id);
    const result = await query(
      `UPDATE leads SET ${assignments.join(', ')}, updated_at = now()
        WHERE id = $${values.length}
        RETURNING *`,
      values
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Обращение не найдено' });
      return;
    }
    res.json(result.rows[0]);
  })
);

// ─── Настройки сайта ─────────────────────────────────────────────────────────

// GET /api/admin/settings — все настройки.
router.get(
  '/settings',
  requireAdminRole('admin'),
  asyncHandler(async (_req, res) => {
    const result = await query('SELECT key, value, description, updated_by, updated_at FROM site_settings ORDER BY key');
    res.json(result.rows);
  })
);

// PUT /api/admin/settings/:key — запись настройки с сохранением ревизии.
router.put(
  '/settings/:key',
  requireAdminRole('admin'),
  asyncHandler(async (req, res) => {
    const key = String(req.params.key).slice(0, 200);
    if (!/^[a-zA-Z0-9._-]+$/.test(key)) {
      res.status(400).json({ error: 'Ключ настройки может содержать только буквы, цифры, точку, дефис и подчёркивание' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.value === undefined) {
      res.status(400).json({ error: 'Передайте значение настройки в поле value' });
      return;
    }
    const actor = adminAuditActor(req);

    const saved = await withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO site_settings (key, value, description, updated_by, updated_at)
         VALUES ($1, $2::jsonb, $3, $4, now())
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value,
               description = COALESCE(EXCLUDED.description, site_settings.description),
               updated_by = EXCLUDED.updated_by,
               updated_at = now()
         RETURNING key, value, description, updated_by, updated_at`,
        [key, JSON.stringify(body.value), optionalText(body.description, 500), actor]
      );
      await client.query(
        'INSERT INTO site_settings_revisions (key, value, actor) VALUES ($1, $2::jsonb, $3)',
        [key, JSON.stringify(body.value), actor]
      );
      return result.rows[0];
    });

    res.json(saved);
  })
);

// GET /api/admin/settings/:key/revisions — история изменений настройки.
router.get(
  '/settings/:key/revisions',
  requireAdminRole('admin'),
  asyncHandler(async (req, res) => {
    const key = String(req.params.key).slice(0, 200);
    const result = await query(
      `SELECT id, key, value, actor, created_at
         FROM site_settings_revisions
        WHERE key = $1
        ORDER BY created_at DESC
        LIMIT 100`,
      [key]
    );
    res.json(result.rows);
  })
);

// DELETE /api/admin/settings/:key
router.delete(
  '/settings/:key',
  requireAdminRole('admin'),
  asyncHandler(async (req, res) => {
    const key = String(req.params.key).slice(0, 200);
    const result = await query('DELETE FROM site_settings WHERE key = $1 RETURNING key', [key]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Настройка не найдена' });
      return;
    }
    res.json({ success: true });
  })
);

// ─── Сводка для панели ───────────────────────────────────────────────────────

// GET /api/admin/stats — краткая сводка по конкурсу.
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const seasonId = parsePositiveInt(queryString(req.query.season_id));
    const teamParams = seasonId !== null ? [seasonId] : [];
    const teamWhere = seasonId !== null ? 'WHERE season_id = $1' : '';

    const teamsByStatus = await query(
      `SELECT status, count(*)::int AS count FROM teams ${teamWhere} GROUP BY status ORDER BY status`,
      teamParams
    );
    const applications = await query(
      `SELECT tech_status, count(*)::int AS count FROM applications
        ${seasonId !== null ? 'WHERE season_id = $1' : ''}
        GROUP BY tech_status ORDER BY tech_status`,
      teamParams
    );
    const leads = await query(
      `SELECT status, count(*)::int AS count FROM leads GROUP BY status ORDER BY status`
    );
    const materials = await query(
      `SELECT status, count(*)::int AS count FROM application_materials GROUP BY status ORDER BY status`
    );
    const rankings = await query(
      `SELECT stage, count(*)::int AS count,
              count(*) FILTER (WHERE needs_chair_review)::int AS needs_chair_review
         FROM rankings
        ${seasonId !== null ? 'WHERE season_id = $1' : ''}
        GROUP BY stage ORDER BY stage`,
      teamParams
    );

    // Счётчики внимания ведут в отфильтрованные списки (ТЗ 07, п. 1.7):
    // сколько заявок не обработано, материалов с замечаниями, апелляций в сроке
    // и обращений без ответа.
    const attention = await query(
      `SELECT
         (SELECT count(*)::int FROM applications WHERE tech_status IN ('pending', 'in_review')) AS applications_pending,
         (SELECT count(*)::int FROM application_materials WHERE status = 'needs_fix') AS materials_needs_fix,
         (SELECT count(*)::int FROM appeals
           WHERE decision IS NULL
             AND (deadline_at IS NULL OR deadline_at > now())) AS appeals_open,
         (SELECT count(*)::int FROM leads WHERE status = 'new') AS leads_new`
    );

    res.json({
      teams_by_status: teamsByStatus.rows,
      applications_by_status: applications.rows,
      leads_by_status: leads.rows,
      materials_by_status: materials.rows,
      rankings_by_stage: rankings.rows,
      attention: attention.rows[0] ?? {
        applications_pending: 0,
        materials_needs_fix: 0,
        appeals_open: 0,
        leads_new: 0,
      },
    });
  })
);

// GET /api/admin/legacy-applications — архив заявок сезона 2026 (ТЗ 10, п. 3.1).
// Таблица заведена миграцией 018; записи переносятся импортёром
// (ops/import-legacy.sh) и не участвуют в работе конкурса: только чтение и
// выгрузка.
router.get(
  '/legacy-applications',
  asyncHandler(async (req, res) => {
    const params: unknown[] = [];
    const where: string[] = [];
    const search = queryString(req.query.q);
    if (search) {
      params.push(`%${search}%`);
      where.push(
        `(full_name ILIKE $${params.length} OR COALESCE(email, '') ILIKE $${params.length}
          OR COALESCE(organization, '') ILIKE $${params.length})`
      );
    }
    const status = queryString(req.query.status);
    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    const result = await query(
      `SELECT * FROM legacy_applications
        ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY submitted_at DESC NULLS LAST, legacy_id DESC
        LIMIT 1000`,
      params
    );
    res.json(result.rows);
  })
);

// ─── Справочники и контент (универсальный CRUD) ──────────────────────────────

router.use(
  '/seasons',
  requireAdminForWrites,
  buildCrud({
    table: 'seasons',
    fields: [
      { name: 'slug', type: 'text', maxLength: 80 },
      { name: 'title', type: 'text', maxLength: 300 },
      { name: 'year', type: 'int' },
      { name: 'status', type: 'text', maxLength: 32 },
      { name: 'is_active', type: 'bool' },
      { name: 'application_open_at', type: 'timestamptz' },
      { name: 'application_close_at', type: 'timestamptz' },
      { name: 'tech_check_from', type: 'timestamptz' },
      { name: 'tech_check_to', type: 'timestamptz' },
      { name: 'stage1_from', type: 'timestamptz' },
      { name: 'stage1_to', type: 'timestamptz' },
      { name: 'final_from', type: 'timestamptz' },
      { name: 'final_to', type: 'timestamptz' },
      { name: 'expertise_from', type: 'timestamptz' },
      { name: 'expertise_to', type: 'timestamptz' },
      { name: 'protocol_selection_at', type: 'timestamptz' },
      { name: 'video_publication_from', type: 'timestamptz' },
      { name: 'video_publication_to', type: 'timestamptz' },
      { name: 'stage1_evaluation_from', type: 'timestamptz' },
      { name: 'stage1_evaluation_to', type: 'timestamptz' },
      { name: 'protocol_stage1_at', type: 'timestamptz' },
      { name: 'masterclasses_from', type: 'timestamptz' },
      { name: 'masterclasses_to', type: 'timestamptz' },
      { name: 'post_final_from', type: 'timestamptz' },
      { name: 'post_final_to', type: 'timestamptz' },
      { name: 'appeal_window_days', type: 'int' },
      { name: 'timezone', type: 'text', maxLength: 64 },
      { name: 'description', type: 'text', maxLength: 5000 },
    ],
    orderBy: 'year DESC, id DESC',
    filters: ['status'],
    searchFields: ['title', 'slug'],
  })
);

router.use(
  '/directions',
  requireAdminForWrites,
  buildCrud({
    table: 'directions',
    fields: [
      { name: 'code', type: 'text', maxLength: 80 },
      { name: 'title', type: 'text', maxLength: 500 },
      { name: 'description', type: 'text', maxLength: 5000 },
      { name: 'sort_order', type: 'int' },
      { name: 'is_active', type: 'bool' },
    ],
    orderBy: 'sort_order, title',
    filters: ['is_active'],
    searchFields: ['title', 'code'],
  })
);

router.use(
  '/experts',
  requireAdminForWrites,
  buildCrud({
    table: 'experts',
    fields: [
      { name: 'full_name', type: 'text', maxLength: 200 },
      { name: 'organization', type: 'text', maxLength: 300 },
      { name: 'position', type: 'text', maxLength: 300 },
      { name: 'degree', type: 'text', maxLength: 200 },
      { name: 'role', type: 'text', maxLength: 32 },
      { name: 'stage', type: 'text', maxLength: 32 },
      { name: 'email', type: 'text', maxLength: 250 },
      { name: 'phone', type: 'text', maxLength: 32 },
      { name: 'is_active', type: 'bool' },
      { name: 'notes', type: 'text', maxLength: 3000 },
      // Публикация на сайте (ТЗ 08, п. 2.1): Оргкомитет решает, показывать ли
      // человека в разделе «Оргкомитет и эксперты», и задаёт фото и описание.
      { name: 'is_public', type: 'bool' },
      { name: 'photo_media_id', type: 'text', maxLength: 64 },
      { name: 'about', type: 'text', maxLength: 4000 },
    ],
    orderBy: 'stage, role DESC, full_name',
    filters: ['stage', 'role', 'is_active', 'is_public'],
    searchFields: ['full_name', 'organization'],
  })
);

router.use(
  '/jury-members',
  requireAdminForWrites,
  buildCrud({
    table: 'jury_members',
    fields: [
      { name: 'full_name', type: 'text', maxLength: 200 },
      { name: 'organization', type: 'text', maxLength: 300 },
      { name: 'position', type: 'text', maxLength: 300 },
      { name: 'role', type: 'text', maxLength: 32 },
      { name: 'stage', type: 'text', maxLength: 32 },
      { name: 'email', type: 'text', maxLength: 250 },
      { name: 'phone', type: 'text', maxLength: 32 },
      { name: 'is_active', type: 'bool' },
      { name: 'notes', type: 'text', maxLength: 3000 },
      { name: 'is_public', type: 'bool' },
      { name: 'photo_media_id', type: 'text', maxLength: 64 },
      { name: 'about', type: 'text', maxLength: 4000 },
    ],
    orderBy: 'role DESC, full_name',
    filters: ['stage', 'role'],
    searchFields: ['full_name', 'organization'],
  })
);

router.use(
  '/criteria',
  requireAdminForWrites,
  buildCrud({
    table: 'criteria',
    fields: [
      { name: 'stage', type: 'text', maxLength: 32 },
      { name: 'code', type: 'text', maxLength: 64 },
      { name: 'title', type: 'text', maxLength: 1000 },
      { name: 'description', type: 'text', maxLength: 5000 },
      { name: 'max_score', type: 'numeric' },
      { name: 'sort_order', type: 'int' },
      { name: 'is_active', type: 'bool' },
    ],
    orderBy: 'stage, sort_order',
    filters: ['stage'],
    searchFields: ['title', 'code'],
  })
);

router.use(
  '/masterclasses',
  buildCrud({
    table: 'masterclasses',
    slugFrom: 'title',
    fields: [
      { name: 'slug', type: 'text', maxLength: 200 },
      { name: 'topic', type: 'text', maxLength: 200 },
      { name: 'season_id', type: 'int' },
      { name: 'title', type: 'text', maxLength: 300 },
      { name: 'speaker', type: 'text', maxLength: 300 },
      { name: 'speaker_info', type: 'text', maxLength: 2000 },
      { name: 'description', type: 'text', maxLength: 10000 },
      { name: 'status', type: 'text', maxLength: 32 },
      { name: 'starts_at', type: 'timestamptz' },
      { name: 'place', type: 'text', maxLength: 300 },
      { name: 'recording_url', type: 'text', maxLength: 2000 },
      { name: 'media_id', type: 'text', maxLength: 64 },
      // Материалы занятия: массив { title, url } (ТЗ 08, п. 4.3).
      { name: 'materials', type: 'json' },
      { name: 'sort_order', type: 'int' },
    ],
    orderBy: 'starts_at DESC NULLS LAST, sort_order',
    filters: ['status'],
    searchFields: ['title', 'speaker'],
    // Требование Оргкомитета: записи прошедших мастер-классов должны быть
    // доступны для просмотра на сайте, поэтому «прошедший» без записи не
    // сохраняется — ни при создании, ни при переводе из анонса.
    validate: (values) => {
      const hasRecording = Boolean(values.recording_url) || Boolean(values.media_id);
      if (values.status === 'past' && !hasRecording) {
        return 'Прошедший мастер-класс нельзя сохранить без записи: укажите ссылку на запись или загрузите видеофайл';
      }
      return null;
    },
  })
);

router.use(
  '/partners',
  requireAdminForWrites,
  buildCrud({
    table: 'partners',
    fields: [
      { name: 'name', type: 'text', maxLength: 300 },
      { name: 'url', type: 'text', maxLength: 2000 },
      { name: 'logo_media_id', type: 'text', maxLength: 64 },
      { name: 'partner_type', type: 'text', maxLength: 32 },
      { name: 'description', type: 'text', maxLength: 5000 },
      { name: 'sort_order', type: 'int' },
      { name: 'is_active', type: 'bool' },
    ],
    orderBy: 'sort_order, name',
    filters: ['partner_type'],
    searchFields: ['name'],
  })
);

router.use(
  '/news',
  buildCrud({
    table: 'news',
    slugFrom: 'title',
    fields: [
      { name: 'slug', type: 'text', maxLength: 200 },
      { name: 'title', type: 'text', maxLength: 300 },
      { name: 'type', type: 'text', maxLength: 32 },
      { name: 'cover_media_id', type: 'text', maxLength: 64 },
      { name: 'video_url', type: 'text', maxLength: 2000 },
      { name: 'excerpt', type: 'text', maxLength: 2000 },
      { name: 'body', type: 'text', maxLength: 100000 },
      { name: 'published_at', type: 'timestamptz' },
      { name: 'is_published', type: 'bool' },
    ],
    orderBy: 'published_at DESC NULLS LAST, id DESC',
    filters: ['type'],
    searchFields: ['title', 'slug'],
  })
);

router.use(
  '/documents',
  buildCrud({
    table: 'documents',
    fields: [
      { name: 'type', type: 'text', maxLength: 64 },
      { name: 'title', type: 'text', maxLength: 300 },
      { name: 'version', type: 'text', maxLength: 64 },
      { name: 'revision_date', type: 'date' },
      { name: 'media_id', type: 'text', maxLength: 64 },
      { name: 'external_url', type: 'text', maxLength: 2000 },
      { name: 'requires_acceptance', type: 'bool' },
      { name: 'is_active', type: 'bool' },
      { name: 'sort_order', type: 'int' },
    ],
    orderBy: 'sort_order, type, revision_date DESC',
    filters: ['type'],
    searchFields: ['title'],
  })
);

// ─── Победители, страницы и архив законопроектов (ТЗ 07) ─────────────────────

router.use(
  '/winners',
  buildCrud({
    table: 'winners',
    fields: [
      { name: 'season_id', type: 'int' },
      { name: 'season_year', type: 'int' },
      { name: 'nomination', type: 'text', maxLength: 200 },
      { name: 'place', type: 'int' },
      { name: 'team_id', type: 'int' },
      { name: 'team_name', type: 'text', maxLength: 200 },
      { name: 'participants_text', type: 'text', maxLength: 2000 },
      { name: 'mentors_text', type: 'text', maxLength: 2000 },
      { name: 'initiative_title', type: 'text', maxLength: 300 },
      { name: 'photo_media_id', type: 'text', maxLength: 64 },
      { name: 'video_url', type: 'text', maxLength: 2000 },
      { name: 'announcement', type: 'text', maxLength: 4000 },
      { name: 'is_published', type: 'bool' },
      { name: 'sort_order', type: 'int' },
    ],
    orderBy: 'season_year DESC, nomination, place NULLS LAST, sort_order',
    filters: ['nomination'],
    searchFields: ['team_name', 'nomination', 'initiative_title'],
  })
);

router.use(
  '/pages',
  buildCrud({
    table: 'pages',
    slugFrom: 'title',
    fields: [
      { name: 'slug', type: 'text', maxLength: 200 },
      { name: 'title', type: 'text', maxLength: 300 },
      { name: 'type', type: 'text', maxLength: 32 },
      { name: 'excerpt', type: 'text', maxLength: 1000 },
      { name: 'body', type: 'text', maxLength: 100000 },
      { name: 'seo_title', type: 'text', maxLength: 200 },
      { name: 'seo_description', type: 'text', maxLength: 400 },
      { name: 'og_media_id', type: 'text', maxLength: 64 },
      { name: 'is_published', type: 'bool' },
      { name: 'sort_order', type: 'int' },
    ],
    orderBy: 'sort_order, title',
    filters: ['type'],
    searchFields: ['title', 'slug'],
  })
);

router.use(
  '/initiatives',
  buildCrud({
    table: 'initiatives',
    slugFrom: 'title',
    fields: [
      { name: 'season_id', type: 'int' },
      { name: 'team_id', type: 'int' },
      { name: 'direction_id', type: 'int' },
      { name: 'slug', type: 'text', maxLength: 200 },
      { name: 'title', type: 'text', maxLength: 300 },
      { name: 'annotation', type: 'text', maxLength: 1000 },
      { name: 'act_level', type: 'text', maxLength: 32 },
      { name: 'proposed_initiator', type: 'text', maxLength: 300 },
      { name: 'team_name', type: 'text', maxLength: 200 },
      { name: 'result_place', type: 'int' },
      { name: 'nomination', type: 'text', maxLength: 200 },
      { name: 'law_draft_media_id', type: 'text', maxLength: 64 },
      { name: 'explanatory_note_media_id', type: 'text', maxLength: 64 },
      { name: 'video_url', type: 'text', maxLength: 2000 },
      { name: 'is_published', type: 'bool' },
      { name: 'authors_public', type: 'bool' },
      { name: 'files_public', type: 'bool' },
      { name: 'archive_year', type: 'int' },
      { name: 'sort_order', type: 'int' },
      // published_at выставляется автоматически при публикации, вручную не
      // редактируется: от него считается порядок и ссылки в sitemap.
    ],
    orderBy: 'archive_year DESC NULLS LAST, sort_order, title',
    filters: ['slug', 'act_level'],
    searchFields: ['title', 'team_name', 'annotation'],
  })
);

/**
 * Авторы инициативы. Публикуются выборочно: `is_published` у автора
 * соответствует согласию по категориям Приложения № 12, поэтому Оргкомитет
 * отмечает каждого автора отдельно, а не всех сразу.
 */
const initiativeAuthorsRouter = Router();

initiativeAuthorsRouter.get(
  '/:id/authors',
  asyncHandler(async (req, res) => {
    const initiativeId = parsePositiveInt(req.params.id);
    if (initiativeId === null) {
      res.status(400).json({ error: 'Некорректный идентификатор инициативы' });
      return;
    }
    const result = await query(
      `SELECT id, full_name, organization, region, is_published, sort_order
         FROM initiative_authors WHERE initiative_id = $1 ORDER BY sort_order, id`,
      [initiativeId]
    );
    res.json(result.rows);
  })
);

initiativeAuthorsRouter.post(
  '/:id/authors',
  asyncHandler(async (req, res) => {
    const initiativeId = parsePositiveInt(req.params.id);
    if (initiativeId === null) {
      res.status(400).json({ error: 'Некорректный идентификатор инициативы' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fullName = optionalText(body.full_name, 200);
    if (!fullName) {
      res.status(400).json({ error: 'Укажите фамилию, имя и отчество автора' });
      return;
    }
    const inserted = await query(
      `INSERT INTO initiative_authors (initiative_id, full_name, organization, region, is_published, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, full_name, organization, region, is_published, sort_order`,
      [
        initiativeId,
        fullName,
        optionalText(body.organization, 300),
        optionalText(body.region, 200),
        body.is_published === true,
        Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
      ]
    );
    res.status(201).json(inserted.rows[0]);
  })
);

initiativeAuthorsRouter.patch(
  '/:initiativeId/authors/:authorId',
  asyncHandler(async (req, res) => {
    const initiativeId = parsePositiveInt(req.params.initiativeId);
    const authorId = parsePositiveInt(req.params.authorId);
    if (initiativeId === null || authorId === null) {
      res.status(400).json({ error: 'Некорректный идентификатор' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const assignments: string[] = [];
    const values: unknown[] = [];

    for (const [field, maxLength] of [
      ['full_name', 200],
      ['organization', 300],
      ['region', 200],
    ] as const) {
      if (body[field] === undefined) continue;
      values.push(optionalText(body[field], maxLength));
      assignments.push(`${field} = $${values.length}`);
    }
    if (body.is_published !== undefined) {
      values.push(body.is_published === true);
      assignments.push(`is_published = $${values.length}`);
    }
    if (body.sort_order !== undefined) {
      values.push(Number(body.sort_order) || 0);
      assignments.push(`sort_order = $${values.length}`);
    }
    if (assignments.length === 0) {
      res.status(400).json({ error: 'Не передано ни одного поля для изменения' });
      return;
    }

    values.push(initiativeId, authorId);
    const result = await query(
      `UPDATE initiative_authors SET ${assignments.join(', ')}
        WHERE initiative_id = $${values.length - 1} AND id = $${values.length}
        RETURNING id, full_name, organization, region, is_published, sort_order`,
      values
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Автор не найден' });
      return;
    }
    res.json(result.rows[0]);
  })
);

initiativeAuthorsRouter.delete(
  '/:initiativeId/authors/:authorId',
  asyncHandler(async (req, res) => {
    const initiativeId = parsePositiveInt(req.params.initiativeId);
    const authorId = parsePositiveInt(req.params.authorId);
    if (initiativeId === null || authorId === null) {
      res.status(400).json({ error: 'Некорректный идентификатор' });
      return;
    }
    const result = await query(
      'DELETE FROM initiative_authors WHERE initiative_id = $1 AND id = $2 RETURNING id',
      [initiativeId, authorId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Автор не найден' });
      return;
    }
    res.json({ success: true });
  })
);

router.use('/initiatives', initiativeAuthorsRouter);

// POST /api/admin/initiatives/:id/publish — публикация в архив.
// Публикация — только решение Оргкомитета, а не следствие подачи заявки.
// Команды, отстранённые или отозвавшие участие, в архив не попадают
// (ТЗ 02, п. 14, правило 4).
router.post(
  '/initiatives/:id/publish',
  requireAdminRole('admin'),
  asyncHandler(async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Некорректный идентификатор инициативы' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const publish = body.is_published !== false;

    const initiative = await query(
      `SELECT i.id, i.is_published, t.status AS team_status, t.name AS team_name
         FROM initiatives i
         LEFT JOIN teams t ON t.id = i.team_id
        WHERE i.id = $1
        LIMIT 1`,
      [id]
    );
    const row = initiative.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Инициатива не найдена' });
      return;
    }

    if (publish && (row.team_status === 'disqualified' || row.team_status === 'withdrawn')) {
      res.status(409).json({
        error:
          'Публикация невозможна: команда дисквалифицирована или отозвала участие, такие работы в архив не попадают (п. 7.4, раздел 13 Положения).',
      });
      return;
    }

    const result = await query(
      `UPDATE initiatives
          SET is_published = $1,
              published_at = CASE WHEN $1 THEN now() ELSE NULL END,
              updated_at = now()
        WHERE id = $2
        RETURNING id, is_published, published_at`,
      [publish, id]
    );
    res.json(result.rows[0]);
  })
);

// GET /api/admin/audit — журнал действий: кто, что и когда изменил.
// Записи создаёт middleware auditAdminMutations для каждого успешного
// изменяющего запроса; здесь — только чтение с фильтрами.
router.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const params: unknown[] = [];
    const where: string[] = [];

    const entity = queryString(req.query.entity);
    if (entity) {
      params.push(entity);
      where.push(`a.entity = $${params.length}`);
    }
    const action = queryString(req.query.action);
    if (action) {
      params.push(`%${action}%`);
      where.push(`a.action ILIKE $${params.length}`);
    }
    const search = queryString(req.query.q);
    if (search) {
      params.push(`%${search}%`);
      where.push(`(a.actor_label ILIKE $${params.length} OR a.entity_id ILIKE $${params.length})`);
    }
    const limit = Math.min(500, parsePositiveInt(queryString(req.query.limit)) ?? 200);

    const result = await query(
      `SELECT a.id, a.actor_type, a.user_id, a.actor_label, a.action, a.entity, a.entity_id,
              a.before, a.after, a.ip, a.created_at,
              u.full_name AS user_name
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.user_id
         ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ${limit}`,
      params
    );

    res.json(result.rows);
  })
);

export default router;
