import { Router, type Response } from 'express';
import { query, withTransaction } from '../db.js';
import { asyncHandler, parsePositiveInt, queryString } from '../lib/http.js';
import { writeAudit } from '../lib/audit.js';
import { optionalText, requiredText } from '../lib/validation.js';
import { addWorkingDays } from '../lib/moscow-time.js';
import { currentAdmin, requireAdminRole } from '../middleware/admin-auth.js';

// Права субъекта персональных данных (ТЗ 11, п. 6).
//
// Закон даёт человеку право получить свои данные, исправить их, потребовать
// удаления и отозвать согласие. Инструменты живут в админке, потому что
// выполняет их ответственный за обработку персональных данных, а не сам субъект:
// подтверждать личность по открытому сайту нельзя.
//
// Что здесь есть:
//   • поиск субъекта по адресу электронной почты, фамилии или телефону — по
//     участникам, наставникам, обращениям и архиву заявок 2026;
//   • выгрузка всех сведений о субъекте (доступ и исправление);
//   • обезличивание по требованию об удалении: персональные данные заменяются
//     безвозвратно, согласия отзываются, запись о команде и результатах
//     сохраняется — иначе рассыпалась бы история конкурса;
//   • каждая операция пишется в журнал действий с автором и причиной.
//
// Физического удаления строк нет: на участника ссылаются согласия, материалы и
// оценки. Обезличивание — это и есть удаление персональных данных в смысле
// 152-ФЗ: сведения перестают относиться к конкретному человеку.

const router = Router();

// Раздел меняет персональные данные, поэтому доступен только роли «администратор».
router.use(requireAdminRole('admin'));

/** Пометка, которая остаётся вместо удалённых данных. */
const ERASED_NAME = 'Обезличено по требованию субъекта';
const ERASED_EMAIL = 'erased@invalid.local';

interface SubjectHit {
  kind: 'participant' | 'mentor' | 'lead' | 'legacy';
  id: number;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  /** Где субъект участвует: команда, заявка или источник обращения. */
  context: string | null;
  created_at: string | null;
  /** true — данные уже обезличены. */
  erased: boolean;
}

/** Идентификатор администратора текущего запроса (для подписи в обращениях). */
function adminUserId(res: Response): number | null {
  return currentAdmin(res)?.userId ?? null;
}

function isErased(row: { full_name?: string | null; email?: string | null }): boolean {
  return row.full_name === ERASED_NAME;
}

// GET /api/admin/subjects?query=… — поиск субъекта персональных данных.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const raw = queryString(req.query.query);
    if (!raw || raw.trim().length < 3) {
      res.status(400).json({
        error: 'Укажите не менее трёх символов: адрес электронной почты, фамилию или телефон субъекта.',
      });
      return;
    }
    const pattern = `%${raw.trim().toLowerCase()}%`;

    const participants = await query(
      `SELECT p.id, p.full_name, p.email, p.phone, p.created_at, t.name AS team_name, s.slug AS season_slug
         FROM participants p
         LEFT JOIN teams t ON t.id = p.team_id
         LEFT JOIN seasons s ON s.id = p.season_id
        WHERE lower(p.full_name) LIKE $1 OR lower(COALESCE(p.email, '')) LIKE $1
              OR COALESCE(p.phone, '') LIKE $1
        ORDER BY p.id DESC
        LIMIT 50`,
      [pattern]
    );
    const mentors = await query(
      `SELECT m.id, m.full_name, m.email, m.phone, m.created_at, t.name AS team_name
         FROM mentors m
         LEFT JOIN teams t ON t.id = m.team_id
        WHERE lower(m.full_name) LIKE $1 OR lower(COALESCE(m.email, '')) LIKE $1
              OR COALESCE(m.phone, '') LIKE $1
        ORDER BY m.id DESC
        LIMIT 50`,
      [pattern]
    );
    const leads = await query(
      `SELECT id, name AS full_name, email, phone, created_at, source
         FROM leads
        WHERE lower(name) LIKE $1 OR lower(email) LIKE $1 OR COALESCE(phone, '') LIKE $1
        ORDER BY id DESC
        LIMIT 50`,
      [pattern]
    );
    const legacy = await query(
      `SELECT id, full_name, email, phone, submitted_at AS created_at, legacy_source
         FROM legacy_applications
        WHERE lower(full_name) LIKE $1 OR lower(email) LIKE $1 OR COALESCE(phone, '') LIKE $1
        ORDER BY id DESC
        LIMIT 50`,
      [pattern]
    );

    const hits: SubjectHit[] = [
      ...participants.rows.map((row) => ({
        kind: 'participant' as const,
        id: Number(row.id),
        full_name: row.full_name,
        email: row.email,
        phone: row.phone,
        context: [row.team_name, row.season_slug].filter(Boolean).join(' · ') || null,
        created_at: row.created_at,
        erased: isErased(row),
      })),
      ...mentors.rows.map((row) => ({
        kind: 'mentor' as const,
        id: Number(row.id),
        full_name: row.full_name,
        email: row.email,
        phone: row.phone,
        context: row.team_name ? `наставник команды ${row.team_name}` : null,
        created_at: row.created_at,
        erased: isErased(row),
      })),
      ...leads.rows.map((row) => ({
        kind: 'lead' as const,
        id: Number(row.id),
        full_name: row.full_name,
        email: row.email,
        phone: row.phone,
        context: row.source ? `обращение (${row.source})` : 'обращение',
        created_at: row.created_at,
        erased: isErased(row),
      })),
      ...legacy.rows.map((row) => ({
        kind: 'legacy' as const,
        id: Number(row.id),
        full_name: row.full_name,
        email: row.email,
        phone: row.phone,
        context: `архив заявок 2026 (${row.legacy_source ?? 'applications.db'})`,
        created_at: row.created_at,
        erased: isErased(row),
      })),
    ];

    res.json({ query: raw.trim(), total: hits.length, subjects: hits });
  })
);

// GET /api/admin/subjects/:kind/:id — все сведения о субъекте (право на доступ).
router.get(
  '/:kind/:id',
  asyncHandler(async (req, res) => {
    const kind = String(req.params.kind);
    const id = parsePositiveInt(req.params.id);
    if (id === null || !['participant', 'mentor', 'lead', 'legacy'].includes(kind)) {
      res.status(400).json({ error: 'Некорректный субъект: укажите вид записи и идентификатор.' });
      return;
    }

    if (kind === 'participant') {
      const person = await query(
        `SELECT p.*, t.name AS team_name, t.status AS team_status, s.slug AS season_slug, s.title AS season_title
           FROM participants p
           LEFT JOIN teams t ON t.id = p.team_id
           LEFT JOIN seasons s ON s.id = p.season_id
          WHERE p.id = $1 LIMIT 1`,
        [id]
      );
      if (person.rows.length === 0) {
        res.status(404).json({ error: 'Участник не найден' });
        return;
      }
      const consents = await query(
        `SELECT document_code, document_version, accepted, accepted_at, ip, revoked_at, scan_media_id
           FROM consents WHERE participant_id = $1 ORDER BY id`,
        [id]
      );
      const distribution = await query(
        `SELECT category_code, allowed, conditions, signed_at, revoked_at
           FROM participant_distribution_consents WHERE participant_id = $1 ORDER BY category_code`,
        [id]
      );
      const materials = await query(
        `SELECT m.type, m.status, m.created_at, media.file_name
           FROM application_materials m
           LEFT JOIN media ON media.id = m.media_id
          WHERE m.team_id = (SELECT team_id FROM participants WHERE id = $1)
          ORDER BY m.id`,
        [id]
      );
      res.json({
        kind,
        person: person.rows[0],
        consents: consents.rows,
        distribution: distribution.rows,
        materials: materials.rows,
      });
      return;
    }

    if (kind === 'mentor') {
      const person = await query(
        `SELECT m.*, t.name AS team_name FROM mentors m LEFT JOIN teams t ON t.id = m.team_id WHERE m.id = $1 LIMIT 1`,
        [id]
      );
      if (person.rows.length === 0) {
        res.status(404).json({ error: 'Наставник не найден' });
        return;
      }
      const consents = await query(
        `SELECT document_code, document_version, accepted, accepted_at, ip, revoked_at
           FROM consents WHERE mentor_id = $1 ORDER BY id`,
        [id]
      );
      res.json({ kind, person: person.rows[0], consents: consents.rows });
      return;
    }

    if (kind === 'lead') {
      const row = await query('SELECT * FROM leads WHERE id = $1 LIMIT 1', [id]);
      if (row.rows.length === 0) {
        res.status(404).json({ error: 'Обращение не найдено' });
        return;
      }
      res.json({ kind, person: row.rows[0], consents: [] });
      return;
    }

    const row = await query('SELECT * FROM legacy_applications WHERE id = $1 LIMIT 1', [id]);
    if (row.rows.length === 0) {
      res.status(404).json({ error: 'Запись архива не найдена' });
      return;
    }
    res.json({ kind, person: row.rows[0], consents: [] });
  })
);

// POST /api/admin/subjects/:kind/:id/erase — удаление персональных данных.
// Требуется причина и подтверждение: операция необратима.
router.post(
  '/:kind/:id/erase',
  asyncHandler(async (req, res) => {
    const kind = String(req.params.kind);
    const id = parsePositiveInt(req.params.id);
    if (id === null || !['participant', 'mentor', 'lead', 'legacy'].includes(kind)) {
      res.status(400).json({ error: 'Некорректный субъект: укажите вид записи и идентификатор.' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.confirm !== true) {
      res.status(400).json({ error: 'Подтвердите удаление: операция необратима.' });
      return;
    }
    const reason = optionalText(body.reason, 1000);
    if (!reason) {
      res.status(400).json({ error: 'Укажите основание: обращение субъекта, решение Оргкомитета или срок хранения.' });
      return;
    }

    const actor = currentAdmin(res);
    const note = `Обезличено ${new Date().toISOString().slice(0, 10)}: ${reason}`;

    const result = await withTransaction(async (client) => {
      if (kind === 'participant') {
        const before = await client.query(
          `SELECT id, full_name, email, phone, region, settlement, vk_url, organization, position,
                  education, competencies, personal_contribution, faculty, study_program, birth_date
             FROM participants WHERE id = $1 LIMIT 1`,
          [id]
        );
        if (before.rows.length === 0) return null;
        await client.query(
          `UPDATE participants
              SET full_name = $2, email = $3, phone = NULL, region = NULL, settlement = NULL,
                  vk_url = NULL, organization = NULL, position = NULL, education = NULL,
                  competencies = NULL, personal_contribution = NULL, faculty = NULL,
                  study_program = NULL, birth_date = NULL, citizenship = NULL, is_minor = FALSE,
                  consent_pdn = FALSE, consent_distribution = FALSE,
                  consent_legal_representative = FALSE, consent_received = FALSE,
                  consent_received_at = NULL, updated_at = now()
            WHERE id = $1`,
          [id, ERASED_NAME, ERASED_EMAIL]
        );
        await client.query(
          `UPDATE consents SET revoked_at = now(), updated_at = now()
            WHERE participant_id = $1 AND revoked_at IS NULL`,
          [id]
        );
        await client.query(
          `UPDATE participant_distribution_consents SET revoked_at = now(), updated_at = now()
            WHERE participant_id = $1 AND revoked_at IS NULL`,
          [id]
        );
        return { table: 'participants', before: before.rows[0] };
      }

      if (kind === 'mentor') {
        const before = await client.query('SELECT * FROM mentors WHERE id = $1 LIMIT 1', [id]);
        if (before.rows.length === 0) return null;
        await client.query(
          `UPDATE mentors
              SET full_name = $2, email = NULL, phone = NULL, organization = NULL, position = NULL,
                  degree = NULL, academic_degree = NULL, academic_title = NULL,
                  consent_pdn = FALSE, consent_received = FALSE, consent_received_at = NULL,
                  updated_at = now()
            WHERE id = $1`,
          [id, ERASED_NAME]
        );
        await client.query(
          `UPDATE consents SET revoked_at = now(), updated_at = now()
            WHERE mentor_id = $1 AND revoked_at IS NULL`,
          [id]
        );
        return { table: 'mentors', before: before.rows[0] };
      }

      if (kind === 'lead') {
        const before = await client.query('SELECT * FROM leads WHERE id = $1 LIMIT 1', [id]);
        if (before.rows.length === 0) return null;
        await client.query(
          `UPDATE leads
              SET name = $2, email = $3, phone = NULL, message = $4,
                  admin_comment = COALESCE(admin_comment, '') || $5, updated_at = now()
            WHERE id = $1`,
          [id, ERASED_NAME, ERASED_EMAIL, note, `\n${note}`]
        );
        return { table: 'leads', before: before.rows[0] };
      }

      const before = await client.query('SELECT * FROM legacy_applications WHERE id = $1 LIMIT 1', [id]);
      if (before.rows.length === 0) return null;
      await client.query(
        `UPDATE legacy_applications
            SET full_name = $2, email = $3, phone = NULL, organization = NULL,
                admin_notes = COALESCE(admin_notes, '') || $4,
                consent_pdn = FALSE, consent_terms = FALSE, consent_marketing = FALSE,
                consent_at = NULL, source_ip = NULL
          WHERE id = $1`,
        [id, ERASED_NAME, ERASED_EMAIL, `\n${note}`]
      );
      return { table: 'legacy_applications', before: before.rows[0] };
    });

    if (!result) {
      res.status(404).json({ error: 'Субъект не найден' });
      return;
    }

    await writeAudit({
      action: 'pdn_erase',
      entity: result.table,
      entityId: id,
      before: { было: 'персональные данные присутствовали' },
      after: { стало: ERASED_NAME, основание: reason, автор: actor?.email ?? 'env:owner' },
      req,
    });

    res.json({
      success: true,
      table: result.table,
      message:
        'Персональные данные обезличены, согласия отозваны. Запись о команде и результатах сохранена: ' +
        'иначе рассыпалась бы история конкурса. Операция зафиксирована в журнале действий.',
    });
  })
);

// ─── Обращения субъектов: учёт и сроки ответа ────────────────────────────────

const REQUEST_KINDS = ['access', 'correction', 'erasure', 'withdrawal', 'other'] as const;
const REQUEST_STATUSES = ['new', 'in_progress', 'done', 'refused'] as const;

/** Срок ответа субъекту: 10 рабочих дней (ст. 20 152-ФЗ). */
function requestDueAt(from: Date): string {
  return addWorkingDays(from, 10).toISOString();
}

// GET /api/admin/pdn-requests — обращения субъектов с контролем срока.
router.get(
  '/requests',
  asyncHandler(async (req, res) => {
    const status = queryString(req.query.status);
    const params: unknown[] = [];
    let where = '';
    if (status === 'overdue') {
      // Нарушение срока ответа — отдельный фильтр: по ст. 20 152-ФЗ срок
      // считается в 10 рабочих дней от получения обращения.
      where = "WHERE r.due_at IS NOT NULL AND r.due_at < now() AND r.status IN ('new', 'in_progress')";
    } else if (status && (REQUEST_STATUSES as readonly string[]).includes(status)) {
      params.push(status);
      where = 'WHERE r.status = $1';
    }
    const result = await query(
      `SELECT r.*, u.email AS handled_by_email, u.full_name AS handled_by_name,
              (r.due_at IS NOT NULL AND r.due_at < now() AND r.status IN ('new', 'in_progress')) AS overdue
         FROM pdn_requests r
         LEFT JOIN users u ON u.id = r.handled_by
         ${where}
        ORDER BY (r.status IN ('new', 'in_progress')) DESC, r.due_at NULLS LAST, r.id DESC
        LIMIT 200`,
      params
    );
    res.json(result.rows);
  })
);

// POST /api/admin/pdn-requests — регистрация обращения субъекта.
router.post(
  '/requests',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const kind = String(body.kind ?? '');
    if (!(REQUEST_KINDS as readonly string[]).includes(kind)) {
      res.status(400).json({ error: 'Укажите вид обращения: доступ, исправление, удаление, отзыв согласия.' });
      return;
    }
    const subjectName = requiredText(body.subject_name, 300);
    const subjectEmail = requiredText(body.subject_email, 250)?.toLowerCase() ?? null;
    if (!subjectName || !subjectEmail || !subjectEmail.includes('@')) {
      res.status(400).json({ error: 'Укажите имя и корректный адрес электронной почты субъекта.' });
      return;
    }
    const receivedAt = body.received_at ? new Date(String(body.received_at)) : new Date();
    if (Number.isNaN(receivedAt.getTime())) {
      res.status(400).json({ error: 'Некорректная дата получения обращения.' });
      return;
    }

    const created = await query(
      `INSERT INTO pdn_requests (kind, subject_name, subject_email, channel, message, received_at, due_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        kind,
        subjectName,
        subjectEmail,
        optionalText(body.channel, 64) ?? 'email',
        optionalText(body.message, 5000),
        receivedAt.toISOString(),
        requestDueAt(receivedAt),
      ]
    );
    await writeAudit({
      action: 'pdn_request_register',
      entity: 'pdn_requests',
      entityId: created.rows[0].id,
      after: { kind, subject_email: subjectEmail, due_at: created.rows[0].due_at },
      req,
    });
    res.status(201).json(created.rows[0]);
  })
);

// PATCH /api/admin/pdn-requests/:id — ведение обращения и результат.
router.patch(
  '/requests/:id',
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
      if (!(REQUEST_STATUSES as readonly string[]).includes(status)) {
        res.status(400).json({ error: `Недопустимое состояние обращения: ${status}` });
        return;
      }
      values.push(status);
      assignments.push(`status = $${values.length}`);
      if (status === 'done' || status === 'refused') {
        values.push(adminUserId(res));
        assignments.push(`handled_by = $${values.length}`);
        assignments.push('handled_at = now()');
      }
    }
    if (body.resolution !== undefined) {
      values.push(optionalText(body.resolution, 5000));
      assignments.push(`resolution = $${values.length}`);
    }
    if (assignments.length === 0) {
      res.status(400).json({ error: 'Не передано ни одного изменения' });
      return;
    }

    values.push(id);
    const updated = await query(
      `UPDATE pdn_requests SET ${assignments.join(', ')}, updated_at = now()
        WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (updated.rows.length === 0) {
      res.status(404).json({ error: 'Обращение не найдено' });
      return;
    }
    await writeAudit({
      action: 'pdn_request_update',
      entity: 'pdn_requests',
      entityId: id,
      after: { status: updated.rows[0].status, resolution: updated.rows[0].resolution },
      req,
    });
    res.json(updated.rows[0]);
  })
);

// GET /api/admin/subjects/:kind/:id/export — выгрузка сведений о субъекте.
// Формат CSV открывается в Excel и удобен для ответа субъекту.
router.get(
  '/:kind/:id/export',
  asyncHandler(async (req, res) => {
    const kind = String(req.params.kind);
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Некорректный идентификатор субъекта' });
      return;
    }
    const table =
      kind === 'participant'
        ? 'participants'
        : kind === 'mentor'
          ? 'mentors'
          : kind === 'lead'
            ? 'leads'
            : kind === 'legacy'
              ? 'legacy_applications'
              : null;
    if (!table) {
      res.status(400).json({ error: 'Неизвестный вид записи' });
      return;
    }

    const row = await query(`SELECT * FROM ${table} WHERE id = $1 LIMIT 1`, [id]);
    if (row.rows.length === 0) {
      res.status(404).json({ error: 'Субъект не найден' });
      return;
    }
    const consents =
      kind === 'participant' || kind === 'mentor'
        ? await query(
            `SELECT document_code, document_version, accepted, accepted_at, ip, revoked_at
               FROM consents WHERE ${kind === 'participant' ? 'participant_id' : 'mentor_id'} = $1 ORDER BY id`,
            [id]
          )
        : { rows: [] as Array<Record<string, unknown>> };

    await writeAudit({
      action: 'pdn_export',
      entity: table,
      entityId: id,
      after: { выгрузка: 'сведения о субъекте', автор: currentAdmin(res)?.email ?? 'env:owner' },
      req,
    });

    res.json({
      kind,
      exported_at: new Date().toISOString(),
      person: row.rows[0],
      consents: consents.rows,
      note: 'Выгрузка сделана по праву субъекта на доступ к своим данным (ТЗ 11, п. 6). Факт выгрузки записан в журнал.',
    });
  })
);

export default router;
