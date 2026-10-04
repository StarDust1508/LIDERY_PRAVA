import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { MAX_FILE_SIZE } from '../config.js';
import { query, withTransaction } from '../db.js';
import { asyncHandler, parsePositiveInt } from '../lib/http.js';
import {
  collectSubmissionErrors,
  parseSubmission,
  recordConsents,
  type SubmissionContext,
} from '../lib/application-submission.js';
import {
  LINK_ONLY_MATERIAL_TYPES,
  MATERIAL_TYPES,
  hasValidSignature,
  isAllowedUploadMime,
  isMaterialType,
  materialTypeTitle,
  sanitizeFileName,
} from '../lib/media-content.js';
import { isDeadlinePassed, millisecondsUntil, toDate } from '../lib/moscow-time.js';
import {
  PARTICIPANT_MAX_AGE,
  PARTICIPANT_MIN_AGE,
  ageOn,
  isEmail,
  isIsoDate,
  isParticipantCategory,
  isValidExternalUrl,
  normalizeEmail,
  optionalText,
  requiredText,
  type ParticipantCategory,
} from '../lib/validation.js';
import { clientIpOf } from '../middleware/admin-auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { logAccess, requireTeam, teamContext } from '../middleware/team-auth.js';

// Личный кабинет команды. Все маршруты защищены токеном доступа (requireTeam):
// команда видит и меняет только собственные данные и материалы.

const router = Router();
router.use(requireTeam);

const store = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (isAllowedUploadMime(file.mimetype)) cb(null, true);
    else cb(new Error('UNSUPPORTED_FILE_TYPE'));
  },
});

function uploadSingle(req: Request, res: Response, next: NextFunction): void {
  store.single('file')(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: `Файл превышает допустимый размер ${MAX_FILE_SIZE} байт` });
      return;
    }
    res.status(415).json({ error: 'Недопустимый тип файла' });
  });
}

interface ParticipantInput {
  id: number | null;
  full_name: string;
  birth_date: string;
  category: ParticipantCategory;
  organization: string | null;
  position: string | null;
  education: string | null;
  email: string;
  phone: string | null;
  role: 'captain' | 'member';
  consent_pdn: boolean;
  consent_distribution: boolean;
  consent_legal_representative: boolean;
  is_minor: boolean;
}

interface MentorInput {
  full_name: string;
  organization: string | null;
  position: string | null;
  degree: string | null;
  email: string | null;
  phone: string | null;
  consent_pdn: boolean;
}

/** Загружает команду вместе с сезоном и составом. */
async function loadTeamBundle(teamId: number) {
  const teamResult = await query(
    `SELECT t.*, s.title AS season_title, s.application_close_at, s.stage1_to,
            s.appeal_window_days, s.timezone AS season_timezone,
            d.code AS direction_code, d.title AS direction_title
       FROM teams t
       JOIN seasons s ON s.id = t.season_id
       LEFT JOIN directions d ON d.id = t.direction_id
      WHERE t.id = $1
      LIMIT 1`,
    [teamId]
  );
  const team = teamResult.rows[0];
  if (!team) return null;

  const participants = await query(
    `SELECT id, full_name, birth_date, category, organization, position, education,
            email, phone, role, consent_pdn, consent_distribution,
            consent_legal_representative, is_minor, consent_received, consent_received_at
       FROM participants
      WHERE team_id = $1
      ORDER BY role DESC, id`,
    [teamId]
  );

  const mentors = await query(
    `SELECT id, full_name, organization, position, degree, email, phone, consent_pdn, consent_received
       FROM mentors
      WHERE team_id = $1
      ORDER BY id`,
    [teamId]
  );

  return { team, participants: participants.rows, mentors: mentors.rows };
}

/** Разбирает и проверяет одного участника из тела запроса. */
function parseParticipant(raw: unknown, closeAt: Date | null): { value?: ParticipantInput; error?: string } {
  if (typeof raw !== 'object' || raw === null) return { error: 'Некорректные данные участника' };
  const item = raw as Record<string, unknown>;

  const fullName = requiredText(item.full_name, 200);
  if (!fullName) return { error: 'У каждого участника должно быть указано ФИО' };

  if (!isIsoDate(item.birth_date)) return { error: `Некорректная дата рождения участника «${fullName}»` };
  const category = item.category;
  if (!isParticipantCategory(category)) {
    return { error: `Некорректная категория участника «${fullName}»` };
  }

  const email = isEmail(item.email) ? normalizeEmail(item.email) : null;
  if (!email) return { error: `Некорректный e-mail участника «${fullName}»` };

  const referenceDate = closeAt ?? new Date();
  const age = ageOn(item.birth_date, referenceDate);
  if (age < PARTICIPANT_MIN_AGE || age > PARTICIPANT_MAX_AGE) {
    return {
      error: `Участник «${fullName}» не проходит по возрасту: на дату окончания приёма заявок ${age} лет (допустимо ${PARTICIPANT_MIN_AGE}–${PARTICIPANT_MAX_AGE}).`,
    };
  }

  if (item.consent_pdn !== true) {
    return { error: `Участник «${fullName}»: отсутствует согласие на обработку персональных данных` };
  }

  const isMinor = age < 18;
  const legalRepresentativeConsent = item.consent_legal_representative === true;
  if (isMinor && !legalRepresentativeConsent) {
    return {
      error: `Участник «${fullName}» младше 18 лет: требуется согласие законного представителя`,
    };
  }

  const role = item.role === 'captain' ? 'captain' : 'member';
  const id = parsePositiveInt(item.id);

  return {
    value: {
      id,
      full_name: fullName,
      birth_date: item.birth_date,
      category: category as ParticipantCategory,
      organization: optionalText(item.organization, 300),
      position: optionalText(item.position, 300),
      education: optionalText(item.education, 300),
      email,
      phone: optionalText(item.phone, 32),
      role,
      consent_pdn: true,
      consent_distribution: item.consent_distribution === true,
      consent_legal_representative: legalRepresentativeConsent,
      is_minor: isMinor,
    },
  };
}

/** Разбирает и проверяет наставника (п. 4.9). */
function parseMentor(raw: unknown): { value?: MentorInput; error?: string } {
  if (typeof raw !== 'object' || raw === null) return { error: 'Некорректные данные наставника' };
  const item = raw as Record<string, unknown>;
  const fullName = requiredText(item.full_name, 200);
  if (!fullName) return { error: 'У наставника должно быть указано ФИО' };

  const email = item.email === undefined || item.email === null || item.email === '' ? null : item.email;
  if (email !== null && !isEmail(email)) return { error: `Некорректный e-mail наставника «${fullName}»` };

  return {
    value: {
      full_name: fullName,
      organization: optionalText(item.organization, 300),
      position: optionalText(item.position, 300),
      degree: optionalText(item.degree, 200),
      email: email === null ? null : normalizeEmail(email),
      phone: optionalText(item.phone, 32),
      consent_pdn: item.consent_pdn === true,
    },
  };
}

// GET /api/cabinet/team — карточка команды с составом и наставниками.
router.get(
  '/team',
  asyncHandler(async (_req, res) => {
    const context = teamContext(res);
    const bundle = await loadTeamBundle(context.teamId);
    if (!bundle) {
      res.status(404).json({ error: 'Команда не найдена' });
      return;
    }
    res.json({
      id: bundle.team.id,
      season_id: bundle.team.season_id,
      season_title: bundle.team.season_title,
      name: bundle.team.name,
      status: bundle.team.status,
      organization: bundle.team.organization,
      city: bundle.team.city,
      captain_participant_id: bundle.team.captain_participant_id,
      direction: bundle.team.direction_id
        ? { id: bundle.team.direction_id, code: bundle.team.direction_code, title: bundle.team.direction_title }
        : null,
      application_close_at: bundle.team.application_close_at,
      is_application_open: !isDeadlinePassed(bundle.team.application_close_at),
      participants: bundle.participants,
      mentors: bundle.mentors,
    });
  })
);

// PATCH /api/cabinet/team — изменение состава до окончания приёма заявок.
router.patch(
  '/team',
  asyncHandler(async (req, res) => {
    const context = teamContext(res);
    const bundle = await loadTeamBundle(context.teamId);
    if (!bundle) {
      res.status(404).json({ error: 'Команда не найдена' });
      return;
    }

    if (isDeadlinePassed(bundle.team.application_close_at)) {
      res.status(403).json({
        error: 'Срок приёма заявок истёк: изменение состава команды недоступно.',
        contact_endpoint: '/api/cabinet/contact',
      });
      return;
    }
    if (!['draft', 'tech_rejected'].includes(String(bundle.team.status))) {
      res.status(409).json({
        error: `Состав нельзя изменить в статусе «${bundle.team.status}». Обратитесь в оргкомитет.`,
        contact_endpoint: '/api/cabinet/contact',
      });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;

    // Состав команды: от 1 (единоличное участие по согласованию, п. 4.3)
    // до 4 человек, и ровно один капитан.
    const rawParticipants = Array.isArray(body.participants) ? body.participants : null;
    if (rawParticipants === null) {
      res.status(400).json({ error: 'Передайте список участников в поле participants' });
      return;
    }
    if (rawParticipants.length < 1 || rawParticipants.length > 4) {
      res.status(400).json({ error: 'В команде должно быть от 1 до 4 участников (п. 4.3 Положения)' });
      return;
    }

    const participants: ParticipantInput[] = [];
    for (const raw of rawParticipants) {
      const parsed = parseParticipant(raw, toDate(bundle.team.application_close_at));
      if (parsed.error || !parsed.value) {
        res.status(400).json({ error: parsed.error ?? 'Некорректные данные участника' });
        return;
      }
      participants.push(parsed.value);
    }
    if (participants.filter((p) => p.role === 'captain').length !== 1) {
      res.status(400).json({ error: 'В команде должен быть ровно один капитан' });
      return;
    }

    // Наставники: не более двух (п. 4.9).
    const rawMentors = Array.isArray(body.mentors) ? body.mentors : [];
    if (rawMentors.length > 2) {
      res.status(400).json({ error: 'У команды может быть не более двух наставников (п. 4.9 Положения)' });
      return;
    }
    const mentors: MentorInput[] = [];
    for (const raw of rawMentors) {
      const parsed = parseMentor(raw);
      if (parsed.error || !parsed.value) {
        res.status(400).json({ error: parsed.error ?? 'Некорректные данные наставника' });
        return;
      }
      mentors.push(parsed.value);
    }

    const name = requiredText(body.name, 200) ?? String(bundle.team.name);
    const directionId = body.direction_id === null || body.direction_id === undefined
      ? (bundle.team.direction_id as number | null)
      : parsePositiveInt(body.direction_id);
    if (directionId === null && body.direction_id !== null && body.direction_id !== undefined) {
      res.status(400).json({ error: 'Некорректное направление конкурса' });
      return;
    }

    try {
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE teams
              SET name = $1, direction_id = $2, organization = $3, city = $4,
                  status_changed_at = now(), updated_at = now()
            WHERE id = $5`,
          [name, directionId, optionalText(body.organization, 300), optionalText(body.city, 120), context.teamId]
        );

        const keptIds: number[] = [];
        let captainId: number | null = null;

        for (const participant of participants) {
          const updated = await client.query(
            `UPDATE participants
                SET full_name = $1, birth_date = $2, category = $3, organization = $4,
                    position = $5, education = $6, email = $7, phone = $8, role = $9,
                    consent_pdn = $10, consent_distribution = $11,
                    consent_legal_representative = $12, is_minor = $13,
                    consent_received = $10, updated_at = now()
              WHERE id = $14 AND team_id = $15
              RETURNING id`,
            [
              participant.full_name,
              participant.birth_date,
              participant.category,
              participant.organization,
              participant.position,
              participant.education,
              participant.email,
              participant.phone,
              participant.role,
              participant.consent_pdn,
              participant.consent_distribution,
              participant.consent_legal_representative,
              participant.is_minor,
              participant.id,
              context.teamId,
            ]
          );

          if (updated.rows.length > 0) {
            const id = Number(updated.rows[0].id);
            keptIds.push(id);
            if (participant.role === 'captain') captainId = id;
            continue;
          }

          const inserted = await client.query(
            `INSERT INTO participants
               (season_id, team_id, full_name, birth_date, category, organization, position,
                education, email, phone, role, consent_pdn, consent_distribution,
                consent_legal_representative, is_minor, consent_received, consent_received_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $12,
                     CASE WHEN $12 THEN now() ELSE NULL END)
             RETURNING id`,
            [
              bundle.team.season_id,
              context.teamId,
              participant.full_name,
              participant.birth_date,
              participant.category,
              participant.organization,
              participant.position,
              participant.education,
              participant.email,
              participant.phone,
              participant.role,
              participant.consent_pdn,
              participant.consent_distribution,
              participant.consent_legal_representative,
              participant.is_minor,
            ]
          );
          const id = Number(inserted.rows[0].id);
          keptIds.push(id);
          if (participant.role === 'captain') captainId = id;
        }

        if (keptIds.length > 0) {
          await client.query('DELETE FROM participants WHERE team_id = $1 AND NOT (id = ANY($2::int[]))', [
            context.teamId,
            keptIds,
          ]);
        } else {
          await client.query('DELETE FROM participants WHERE team_id = $1', [context.teamId]);
        }

        await client.query('UPDATE teams SET captain_participant_id = $1, updated_at = now() WHERE id = $2', [
          captainId,
          context.teamId,
        ]);

        await client.query('DELETE FROM mentors WHERE team_id = $1', [context.teamId]);
        for (const mentor of mentors) {
          await client.query(
            `INSERT INTO mentors
               (team_id, full_name, organization, position, degree, email, phone, consent_pdn,
                consent_received, consent_received_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, CASE WHEN $8 THEN now() ELSE NULL END)`,
            [
              context.teamId,
              mentor.full_name,
              mentor.organization,
              mentor.position,
              mentor.degree,
              mentor.email,
              mentor.phone,
              mentor.consent_pdn,
            ]
          );
        }
      });
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('participants_season_email_idx')) {
        res.status(409).json({
          error:
            'Участник с таким адресом электронной почты уже есть в этой заявке или заявлен в другой команде сезона (п. 4.4 Положения). Передайте идентификатор существующего участника, чтобы изменить его данные.',
        });
        return;
      }
      if (message.includes('teams_season_id_name_key')) {
        res.status(409).json({ error: 'Команда с таким названием уже зарегистрирована в этом сезоне' });
        return;
      }
      throw error;
    }

    const updated = await loadTeamBundle(context.teamId);
    res.json({
      success: true,
      team: updated
        ? {
            id: updated.team.id,
            name: updated.team.name,
            status: updated.team.status,
            direction_id: updated.team.direction_id,
            participants: updated.participants,
            mentors: updated.mentors,
          }
        : null,
    });
  })
);

// GET /api/cabinet/materials — материалы заявки команды.
router.get(
  '/materials',
  asyncHandler(async (_req, res) => {
    const context = teamContext(res);
    const bundle = await loadTeamBundle(context.teamId);
    const closePassed = isDeadlinePassed(bundle?.team.application_close_at ?? null);

    const result = await query(
      `SELECT m.id, m.application_id, m.type, m.media_id, m.external_url, m.version, m.status,
              m.reviewer_comment, m.reviewed_at, m.fix_deadline, m.created_at, m.updated_at,
              media.file_name, media.file_type, media.file_size,
              CASE WHEN m.media_id IS NOT NULL
                   THEN '/api/media/file/' || m.media_id::text
                   ELSE NULL END AS file_url
         FROM application_materials m
         LEFT JOIN media ON media.id = m.media_id
        WHERE m.team_id = $1
        ORDER BY m.type, m.version DESC, m.created_at DESC`,
      [context.teamId]
    );

    res.json(
      result.rows.map((row) => ({
        ...row,
        type_title: materialTypeTitle(row.type),
        is_deadline_passed: closePassed,
        can_delete:
          !closePassed &&
          row.status !== 'accepted' &&
          (row.fix_deadline === null || !isDeadlinePassed(row.fix_deadline)),
      }))
    );
  })
);

// POST /api/cabinet/materials — загрузка файла или прикрепление ссылки.
router.post(
  '/materials',
  rateLimit(30, 60_000),
  uploadSingle,
  asyncHandler(async (req, res) => {
    const context = teamContext(res);
    const bundle = await loadTeamBundle(context.teamId);
    if (!bundle) {
      res.status(404).json({ error: 'Команда не найдена' });
      return;
    }

    const applicationResult = await query(
      'SELECT id FROM applications WHERE team_id = $1 ORDER BY id DESC LIMIT 1',
      [context.teamId]
    );
    const application = applicationResult.rows[0];
    if (!application) {
      res.status(409).json({ error: 'Заявка ещё не подана: материалы можно добавить после подачи заявки' });
      return;
    }

    // Дедлайн проверяется на сервере по московскому времени (п. 6.2 Положения).
    if (isDeadlinePassed(bundle.team.application_close_at)) {
      res.status(403).json({
        error: 'Срок приёма конкурсных материалов истёк. Запись материалов недоступна.',
        contact_endpoint: '/api/cabinet/contact',
      });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const type = body.type;
    if (!isMaterialType(type)) {
      res.status(400).json({
        error: `Некорректный тип материала. Допустимые типы: ${Object.keys(MATERIAL_TYPES).join(', ')}`,
      });
      return;
    }

    const externalUrl = optionalText(body.external_url, 2000);
    if (externalUrl !== null && !isValidExternalUrl(externalUrl)) {
      res.status(400).json({ error: 'Ссылка должна быть корректным адресом http(s)' });
      return;
    }

    const file = req.file;
    if (LINK_ONLY_MATERIAL_TYPES.includes(type) && file) {
      res.status(400).json({ error: 'Для этого типа материала загружается ссылка, а не файл' });
      return;
    }
    if (LINK_ONLY_MATERIAL_TYPES.includes(type) && !externalUrl) {
      res.status(400).json({ error: 'Для видеоролика укажите ссылку на публикацию во «ВКонтакте»' });
      return;
    }
    if (!LINK_ONLY_MATERIAL_TYPES.includes(type) && !file && !externalUrl) {
      res.status(400).json({ error: 'Приложите файл или укажите ссылку на материал' });
      return;
    }
    if (file && !hasValidSignature(file)) {
      res.status(415).json({ error: 'Содержимое файла не соответствует заявленному типу' });
      return;
    }

    const materialId = await withTransaction(async (client) => {
      let mediaId: string | null = null;
      if (file) {
        const inserted = await client.query(
          `INSERT INTO media (file_name, file_url, file_type, file_size, file_data, is_public, category)
           VALUES ($1, '', $2, $3, $4, FALSE, 'material')
           RETURNING id`,
          [sanitizeFileName(file.originalname), file.mimetype, file.size, file.buffer]
        );
        mediaId = String(inserted.rows[0].id);
        await client.query('UPDATE media SET file_url = $1 WHERE id = $2', [
          `/api/media/file/${mediaId}`,
          mediaId,
        ]);
      }

      const versionResult = await client.query(
        'SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM application_materials WHERE application_id = $1 AND type = $2',
        [application.id, type]
      );
      const version = Number(versionResult.rows[0].next_version);

      const material = await client.query(
        `INSERT INTO application_materials
           (application_id, team_id, type, media_id, external_url, version, status, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'uploaded', 'team')
         RETURNING id, created_at`,
        [application.id, context.teamId, type, mediaId, externalUrl, version]
      );
      return { id: Number(material.rows[0].id), created_at: material.rows[0].created_at, version };
    });

    void logAccess(context, req, 'material_uploaded', { material_id: materialId.id, type });

    res.status(201).json({
      success: true,
      id: materialId.id,
      version: materialId.version,
      created_at: materialId.created_at,
      type,
      type_title: MATERIAL_TYPES[type],
    });
  })
);

// DELETE /api/cabinet/materials/:id — удаление материала до дедлайна.
router.delete(
  '/materials/:id',
  asyncHandler(async (req, res) => {
    const context = teamContext(res);
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Некорректный идентификатор материала' });
      return;
    }

    const materialResult = await query(
      `SELECT m.id, m.media_id, m.status, m.fix_deadline, s.application_close_at
         FROM application_materials m
         JOIN teams t ON t.id = m.team_id
         JOIN seasons s ON s.id = t.season_id
        WHERE m.id = $1 AND m.team_id = $2
        LIMIT 1`,
      [id, context.teamId]
    );
    const material = materialResult.rows[0];
    if (!material) {
      res.status(404).json({ error: 'Материал не найден' });
      return;
    }
    if (material.status === 'accepted') {
      res.status(409).json({ error: 'Принятый материал удалить нельзя. Обратитесь в оргкомитет.' });
      return;
    }

    // На этапе устранения недостатков действует отдельный срок (п. 7.5).
    const deadline =
      material.status === 'needs_fix' && material.fix_deadline
        ? material.fix_deadline
        : material.application_close_at;
    if (isDeadlinePassed(deadline)) {
      res.status(403).json({
        error: 'Срок работы с материалами истёк. Удаление недоступно.',
        contact_endpoint: '/api/cabinet/contact',
      });
      return;
    }

    await withTransaction(async (client) => {
      await client.query('DELETE FROM application_materials WHERE id = $1 AND team_id = $2', [
        id,
        context.teamId,
      ]);
      if (material.media_id) {
        const stillUsed = await client.query('SELECT 1 FROM application_materials WHERE media_id = $1 LIMIT 1', [
          material.media_id,
        ]);
        if (stillUsed.rows.length === 0) {
          await client.query('DELETE FROM media WHERE id = $1 AND is_public = FALSE', [material.media_id]);
        }
      }
    });

    void logAccess(context, req, 'material_deleted', { material_id: id });
    res.json({ success: true });
  })
);

// GET /api/cabinet/deadlines — сроки этапов и сроки досдачи материалов.
router.get(
  '/deadlines',
  asyncHandler(async (_req, res) => {
    const context = teamContext(res);
    const bundle = await loadTeamBundle(context.teamId);
    if (!bundle) {
      res.status(404).json({ error: 'Команда не найдена' });
      return;
    }
    const fixes = await query(
      `SELECT id, type, status, fix_deadline
         FROM application_materials
        WHERE team_id = $1 AND fix_deadline IS NOT NULL AND status = 'needs_fix'
        ORDER BY fix_deadline`,
      [context.teamId]
    );

    res.json({
      timezone: bundle.team.season_timezone,
      application_close_at: bundle.team.application_close_at,
      stage1_to: bundle.team.stage1_to,
      appeal_window_days: bundle.team.appeal_window_days,
      is_application_open: !isDeadlinePassed(bundle.team.application_close_at),
      milliseconds_left: millisecondsUntil(bundle.team.application_close_at),
      fix_deadlines: fixes.rows.map((row) => ({
        material_id: row.id,
        type: row.type,
        type_title: materialTypeTitle(row.type),
        fix_deadline: row.fix_deadline,
        is_open: !isDeadlinePassed(row.fix_deadline),
      })),
    });
  })
);

// POST /api/cabinet/contact — связь с оргкомитетом, в том числе после дедлайна.
// Обращение разрешено в любой момент: это единственный доступный канал, когда
// запись материалов уже закрыта.
router.post(
  '/contact',
  rateLimit(5, 60_000),
  asyncHandler(async (req, res) => {
    const context = teamContext(res);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const message = requiredText(body.message, 5000);
    if (!message) {
      res.status(400).json({ error: 'Укажите текст обращения' });
      return;
    }

    const captain = await query(
      `SELECT full_name, email FROM participants
        WHERE team_id = $1
        ORDER BY CASE WHEN role = 'captain' THEN 0 ELSE 1 END, id
        LIMIT 1`,
      [context.teamId]
    );
    const contact = captain.rows[0];
    const fallbackEmail = isEmail(body.email) ? normalizeEmail(String(body.email)) : null;
    const email = contact?.email ?? fallbackEmail;
    if (!email) {
      res.status(400).json({ error: 'Укажите e-mail для ответа оргкомитета' });
      return;
    }

    const result = await query(
      `INSERT INTO leads (name, email, phone, topic, message, source, consent_pdn, team_id, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, 'cabinet', TRUE, $6, $7, $8)
       RETURNING id, created_at`,
      [
        contact?.full_name ?? context.teamName,
        email,
        optionalText(body.phone, 32),
        optionalText(body.topic, 200) ?? 'Обращение команды',
        message,
        context.teamId,
        clientIpOf(req),
        String(req.headers['user-agent'] || '').slice(0, 500),
      ]
    );

    void logAccess(context, req, 'contact_request', { lead_id: result.rows[0].id });
    res.status(201).json({ success: true, lead_id: result.rows[0].id, created_at: result.rows[0].created_at });
  })
);

// GET /api/cabinet/appeals — апелляции команды (подача — через оргкомитет).
router.get(
  '/appeals',
  asyncHandler(async (_req, res) => {
    const context = teamContext(res);
    const result = await query(
      `SELECT id, stage, grounds, status, decision, decision_note, submitted_at, deadline_at, reviewed_at
         FROM appeals
        WHERE team_id = $1
        ORDER BY submitted_at DESC`,
      [context.teamId]
    );
    res.json(result.rows);
  })
);

// POST /api/cabinet/submit — отправка заявки: последний шаг мастера.
// До этого шага заявка остаётся черновиком и в техническую проверку не попадает.
router.post(
  '/submit',
  rateLimit(5, 60_000),
  asyncHandler(async (req, res) => {
    const context = teamContext(res);
    const bundle = await loadTeamBundle(context.teamId);
    if (!bundle) {
      res.status(404).json({ error: 'Команда не найдена' });
      return;
    }

    const applicationResult = await query(
      `SELECT id, submitted_at, public_number
         FROM applications
        WHERE team_id = $1
        ORDER BY id DESC
        LIMIT 1`,
      [context.teamId]
    );
    const application = applicationResult.rows[0];
    if (!application) {
      res.status(409).json({ error: 'Заявка не найдена: начните подачу на странице /apply.' });
      return;
    }
    if (application.submitted_at !== null) {
      res.status(409).json({ error: 'Заявка уже отправлена. Изменения возможны до окончания приёма заявок.' });
      return;
    }
    if (isDeadlinePassed(bundle.team.application_close_at)) {
      res.status(403).json({
        error: 'Срок приёма заявок истёк: отправка недоступна. Свяжитесь с Оргкомитетом.',
        contact_endpoint: '/api/cabinet/contact',
      });
      return;
    }

    const parsed = parseSubmission(req.body ?? {});
    if (parsed.error || !parsed.value) {
      res.status(400).json({ error: parsed.error ?? 'Некорректные подтверждения согласий.' });
      return;
    }

    const submissionContext: SubmissionContext = {
      teamId: context.teamId,
      seasonId: context.seasonId,
      applicationId: Number(application.id),
      ip: clientIpOf(req),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
      input: parsed.value,
    };

    // Сначала собираем все замечания и показываем их списком: команда должна
    // видеть сразу весь объём недоделанного, а не по одной ошибке за раз.
    const errors = await withTransaction(async (client) =>
      collectSubmissionErrors(client, submissionContext)
    );
    if (errors.length > 0) {
      res.status(422).json({
        error: 'Заявка не может быть отправлена: заполнены не все обязательные сведения.',
        details: errors,
      });
      return;
    }

    const submittedAt = new Date();
    await withTransaction(async (client) => {
      await recordConsents(client, submissionContext);
      await client.query(
        `UPDATE applications
            SET submitted_at = $1, submitted_ip = $2, tech_status = 'pending',
                content_locked = TRUE, draft_updated_at = now(), updated_at = now()
          WHERE id = $3`,
        [submittedAt, submissionContext.ip, submissionContext.applicationId]
      );
      await client.query(
        `UPDATE teams
            SET status = 'submitted', status_changed_at = now(), updated_at = now()
          WHERE id = $1`,
        [context.teamId]
      );
    });

    void logAccess(context, req, 'application_submitted', {
      application_id: Number(application.id),
      public_number: application.public_number,
    });

    res.json({
      success: true,
      public_number: application.public_number,
      submitted_at: submittedAt.toISOString(),
      team_status: 'submitted',
      tech_status: 'pending',
      message: 'Заявка отправлена и поступила на техническую проверку.',
    });
  })
);

export default router;
