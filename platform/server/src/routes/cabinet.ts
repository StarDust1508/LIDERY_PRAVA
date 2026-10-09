import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { MAX_FILE_SIZE } from '../config.js';
import { query, withTransaction } from '../db.js';
import { asyncHandler, parsePositiveInt, queryString } from '../lib/http.js';
import { featureEnabled } from '../lib/features.js';
import {
  MATERIAL_URL_POLICY_MESSAGE,
  isAllowedMaterialUrl,
} from '../lib/validation.js';
import {
  collectSubmissionErrors,
  parseSubmission,
  recordConsents,
  type SubmissionContext,
} from '../lib/application-submission.js';
import { buildApplicationFormDocx, loadApplicationFormData } from '../lib/application-form.js';
import { buildConsentDocx, isConsentKind } from '../lib/consent-forms.js';
import { clearTeamSessionCookie } from '../lib/team-session.js';
import { convertDocxToPdf } from '../lib/docx-to-pdf.js';
import {
  LINK_ONLY_MATERIAL_TYPES,
  MATERIAL_TYPES,
  checkUploadExtension,
  hasValidSignature,
  isAllowedUploadMime,
  isMaterialType,
  materialTypeTitle,
  sanitizeFileName,
} from '../lib/media-content.js';
import {
  addWorkingDays,
  applicationWindowState,
  formatMoscowHuman,
  isDeadlinePassed,
  millisecondsUntil,
  toDate,
} from '../lib/moscow-time.js';
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
    // Расширение проверяется до чтения тела файла (ТЗ 11, п. 4.1, 4.5): так
    // исполняемый файл отсекается раньше, чем попадёт в память.
    const extension = checkUploadExtension(file.originalname);
    if (!extension.ok) {
      cb(new Error(`UNSUPPORTED_FILE_EXTENSION: ${extension.reason}`));
      return;
    }
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
    // Причина отказа по расширению передаётся человеку дословно: «недопустимый
    // тип файла» не объясняет, что именно исправить (ТЗ 06, п. 3).
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('UNSUPPORTED_FILE_EXTENSION:')) {
      res.status(415).json({ error: message.replace('UNSUPPORTED_FILE_EXTENSION:', '').trim() });
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
  // Поля Приложения № 1 (миграция 011).
  citizenship: string | null;
  region: string | null;
  settlement: string | null;
  vk_url: string | null;
  competencies: string | null;
  personal_contribution: string | null;
  faculty: string | null;
  course: number | null;
  study_program: string | null;
}

interface MentorInput {
  full_name: string;
  organization: string | null;
  position: string | null;
  degree: string | null;
  academic_title: string | null;
  email: string | null;
  phone: string | null;
  consent_pdn: boolean;
}

/** Загружает команду вместе с сезоном, составом и сведениями о заявке. */
async function loadTeamBundle(teamId: number) {
  const teamResult = await query(
    `SELECT t.*, s.title AS season_title, s.application_close_at, s.stage1_to,
            s.appeal_window_days, s.timezone AS season_timezone,
            d.code AS direction_code, d.title AS direction_title,
            -- Номер заявки нужен команде для входа в кабинет и для обращения
            -- в Оргкомитет, поэтому отдаётся вместе с карточкой команды.
            (SELECT a.public_number FROM applications a
              WHERE a.team_id = t.id ORDER BY a.id DESC LIMIT 1) AS public_number,
            (SELECT a.submitted_at FROM applications a
              WHERE a.team_id = t.id ORDER BY a.id DESC LIMIT 1) AS submitted_at,
            (SELECT a.tech_status FROM applications a
              WHERE a.team_id = t.id ORDER BY a.id DESC LIMIT 1) AS tech_status
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
            consent_legal_representative, is_minor, consent_received, consent_received_at,
            citizenship, region, settlement, vk_url, competencies,
            personal_contribution, faculty, course, study_program
       FROM participants
      WHERE team_id = $1
      -- Капитан идёт первым (п. 4.3 Положения): сортировка по роли в
      -- обратном порядке ставила впереди участника.
      ORDER BY CASE WHEN role = 'captain' THEN 0 ELSE 1 END, id`,
    [teamId]
  );

  const mentors = await query(
    `SELECT id, full_name, organization, position, degree,
            academic_degree, academic_title, email, phone, consent_pdn, consent_received
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

  // Курс обучения: необязательное поле, но значение вне 1–6 отклоняется.
  let course: number | null = null;
  const courseRaw = item.course;
  if (courseRaw !== undefined && courseRaw !== null && String(courseRaw).trim() !== '') {
    const parsedCourse = Number.parseInt(String(courseRaw), 10);
    if (!Number.isInteger(parsedCourse) || parsedCourse < 1 || parsedCourse > 6) {
      return { error: `Некорректный курс у участника «${fullName}»: допустимо от 1 до 6` };
    }
    course = parsedCourse;
  }

  const vkUrl = optionalText(item.vk_url, 300);
  if (vkUrl !== null && !isValidExternalUrl(vkUrl)) {
    return { error: `Некорректная ссылка на страницу «ВКонтакте» у участника «${fullName}»` };
  }

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
      citizenship: optionalText(item.citizenship, 120),
      region: optionalText(item.region, 200),
      settlement: optionalText(item.settlement, 200),
      vk_url: vkUrl,
      competencies: optionalText(item.competencies, 800),
      personal_contribution: optionalText(item.personal_contribution, 1000),
      faculty: optionalText(item.faculty, 300),
      course,
      study_program: optionalText(item.study_program, 300),
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
      // degree — устаревшее поле (учёная степень); новые данные пишутся в
      // academic_degree, а degree заполняется тем же значением для совместимости.
      degree: optionalText(item.academic_degree ?? item.degree, 200),
      academic_title: optionalText(item.academic_title, 200),
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
    const results = await query(
      `SELECT stage, place, average_score, is_published, published_at, protocol_note,
              CASE WHEN protocol_media_id IS NOT NULL
                   THEN '/api/media/file/' || protocol_media_id::text
                   ELSE NULL END AS protocol_url
         FROM rankings
        WHERE team_id = $1 AND is_published = TRUE
        ORDER BY stage`,
      [context.teamId]
    );

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
      is_application_open:
        applicationWindowState(bundle.team.application_open_at, bundle.team.application_close_at) === 'open',
      application_not_started:
        applicationWindowState(bundle.team.application_open_at, bundle.team.application_close_at) === 'before',
      public_number: bundle.team.public_number ?? null,
      submitted_at: bundle.team.submitted_at ?? null,
      tech_status: bundle.team.tech_status ?? null,
      participants: bundle.participants,
      mentors: bundle.mentors,
      // Опубликованные результаты: баллы, место и протокол этапа (ТЗ 06, п. 2;
      // ТЗ 07, п. 2.8 — протокол публикуется вместе с рейтингом).
      results: results.rows,
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

    // Замена состава допускается однократно и только с сохранением не менее
    // половины участников (ТЗ 06, п. 3). Проверка идёт до записи, чтобы отказ
    // не оставлял команду в половинчатом состоянии.
    const usedAt = bundle.team.roster_change_used_at ?? null;

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

    // Клиент может не прислать идентификаторы участников (например, после
    // перезагрузки черновика). Тогда человека опознаём по почте: иначе сервер
    // вставил бы вторую строку с тем же адресом, а по старому капитану
    // сработал бы уникальный индекс «один капитан на команду» — и запрос
    // падал с 500 (найдено при сквозной проверке кабинета).
    const savedParticipants = bundle.participants as Array<{ id: number; email: string | null }>;
    for (const participant of participants) {
      if (participant.id !== null) continue;
      const email = participant.email?.trim().toLowerCase();
      if (!email) continue;
      const saved = savedParticipants.find((row) => (row.email ?? '').trim().toLowerCase() === email);
      if (saved) participant.id = Number(saved.id);
    }

    // Состав до изменения: нужен, чтобы отличить правку данных от замены людей
    // и посчитать, какая часть состава сохранена.
    const existingIds = new Set(
      (bundle.participants as Array<{ id: number }>).map((participant) => Number(participant.id))
    );
    const incomingIds = new Set(
      participants.map((participant) => participant.id).filter((id): id is number => id !== null)
    );
    const removed = [...existingIds].filter((id) => !incomingIds.has(id));
    const added = [...incomingIds].filter((id) => !existingIds.has(id));
    const kept = [...existingIds].filter((id) => incomingIds.has(id));
    // Изменением состава считается и добавление, и удаление участника: ТЗ 06,
    // п. 3 ограничивает однократностью именно «добавить/удалить участника».
    // Появление участника без id в запросе — это тоже добавление.
    const addsWithoutId = participants.filter((participant) => participant.id === null).length;
    const rosterChanged = removed.length > 0 || added.length > 0 || addsWithoutId > 0;

    // Правило однократной замены действует для уже поданной заявки: в статусе
    // «возвращена на доработку» состав можно поменять один раз, сохранив не
    // менее половины участников (ТЗ 06, п. 3). Пока команда заполняет черновик,
    // состав собирается свободно — иначе мастер подачи нельзя было бы пройти.
    const rosterRuleActive = String(bundle.team.status) === 'tech_rejected';

    if (rosterChanged && rosterRuleActive) {
      if (usedAt) {
        res.status(409).json({
          error:
            'Состав команды уже изменялся: замена участников допускается однократно до публикации итогов отборочного этапа (ТЗ 06, п. 3). Дальнейшие изменения — по решению Оргкомитета.',
          contact_endpoint: '/api/cabinet/contact',
          roster_change_used_at: usedAt,
        });
        return;
      }
      if (existingIds.size >= 2 && kept.length * 2 < existingIds.size) {
        res.status(409).json({
          error:
            'При замене участников должно сохраниться не менее половины состава (ТЗ 06, п. 3). ' +
            `Сохранено ${kept.length} из ${existingIds.size}.`,
          contact_endpoint: '/api/cabinet/contact',
        });
        return;
      }
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
                  roster_change_used_at = CASE WHEN $6 THEN COALESCE(roster_change_used_at, now())
                                               ELSE roster_change_used_at END,
                  status_changed_at = now(), updated_at = now()
            WHERE id = $5`,
          [
            name,
            directionId,
            optionalText(body.organization, 300),
            optionalText(body.city, 120),
            context.teamId,
            rosterChanged && rosterRuleActive,
          ]
        );

        // Снимаем роль капитана с текущего состава до записи: уникальный индекс
        // «один капитан на команду» проверяется на каждой строке, и вставка
        // нового капитана при живом старом давала нарушение ограничения.
        await client.query(
          `UPDATE participants SET role = 'member', updated_at = now()
            WHERE team_id = $1 AND role = 'captain'`,
          [context.teamId]
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
                    consent_received = $10,
                    citizenship = $16, region = $17, settlement = $18, vk_url = $19,
                    competencies = $20, personal_contribution = $21, faculty = $22,
                    course = $23, study_program = $24,
                    updated_at = now()
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
              participant.citizenship,
              participant.region,
              participant.settlement,
              participant.vk_url,
              participant.competencies,
              participant.personal_contribution,
              participant.faculty,
              participant.course,
              participant.study_program,
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
                consent_legal_representative, is_minor, consent_received, consent_received_at,
                citizenship, region, settlement, vk_url, competencies, personal_contribution,
                faculty, course, study_program)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $12,
                     CASE WHEN $12 THEN now() ELSE NULL END,
                     $16, $17, $18, $19, $20, $21, $22, $23, $24)
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
              participant.citizenship,
              participant.region,
              participant.settlement,
              participant.vk_url,
              participant.competencies,
              participant.personal_contribution,
              participant.faculty,
              participant.course,
              participant.study_program,
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
               (team_id, full_name, organization, position, degree, academic_degree,
                academic_title, email, phone, consent_pdn, consent_received, consent_received_at)
             VALUES ($1, $2, $3, $4, $5, $5, $9, $6, $7, $8, $8,
                     CASE WHEN $8 THEN now() ELSE NULL END)`,
            [
              context.teamId,
              mentor.full_name,
              mentor.organization,
              mentor.position,
              mentor.degree,
              mentor.email,
              mentor.phone,
              mentor.consent_pdn,
              mentor.academic_title,
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

// GET /api/cabinet/overview — сводка кабинета одним запросом (ТЗ 05, §4).
//
// Экран «Сводка» собирает те же данные из нескольких обращений; отдельный
// маршрут нужен, чтобы состояние команды можно было получить целиком — для
// мобильного клиента, уведомлений и разбора обращения Оргкомитетом.
router.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const context = teamContext(res);
    const bundle = await loadTeamBundle(context.teamId);
    if (!bundle) {
      res.status(404).json({ error: 'Команда не найдена' });
      return;
    }

    const seasonId = Number(bundle.team.season_id);
    const closeAt = bundle.team.application_close_at ?? null;
    const closePassed = isDeadlinePassed(closeAt);

    // Комплект текущего этапа: что требуется и что уже сдано (ТЗ 06, п. 2).
    const requirements = await query(
      `SELECT r.type, r.title, r.is_required, r.due_at, r.description,
              r.allowed_extensions, r.name_template,
              m.status, m.version, m.reviewer_comment, m.fix_deadline, m.created_at,
              CASE WHEN m.media_id IS NOT NULL THEN '/api/media/file/' || m.media_id::text ELSE NULL END AS file_url,
              m.external_url
         FROM material_requirements r
         LEFT JOIN LATERAL (
              SELECT am.status, am.version, am.reviewer_comment, am.fix_deadline, am.created_at,
                     am.media_id, am.external_url
                FROM application_materials am
               WHERE am.team_id = $2 AND am.type = r.type
               ORDER BY am.version DESC, am.created_at DESC
               LIMIT 1
         ) m ON TRUE
        WHERE r.season_id = $1 AND r.is_active = TRUE AND r.stage = 'selection'
        ORDER BY r.sort_order, r.id`,
      [seasonId, context.teamId]
    );

    const readiness = requirements.rows.map((row) => ({
      type: row.type,
      title: row.title,
      is_required: row.is_required,
      due_at: row.due_at,
      description: row.description,
      allowed_extensions: row.allowed_extensions,
      name_template: row.name_template,
      status: row.status ?? 'not_submitted',
      status_title: row.status ? String(row.status) : 'не сдан',
      version: row.version ?? null,
      reviewer_comment: row.reviewer_comment ?? null,
      fix_deadline: row.fix_deadline ?? null,
      file_url: row.file_url ?? null,
      external_url: row.external_url ?? null,
      submitted_at: row.created_at ?? null,
    }));

    const submitted = readiness.filter((item) => item.status !== 'not_submitted');
    const required = readiness.filter((item) => item.is_required);

    // Ближайший срок: досдача по замечанию важнее общего дедлайна приёма.
    const candidates: Array<{ title: string; at: string; kind: string }> = [];
    for (const item of readiness) {
      if (item.fix_deadline) {
        candidates.push({ title: `Досдать: ${item.title}`, at: item.fix_deadline, kind: 'fix' });
      }
      if (item.due_at) {
        candidates.push({ title: `Сдать: ${item.title}`, at: item.due_at, kind: 'material' });
      }
    }
    if (closeAt) {
      candidates.push({ title: 'Окончание приёма заявок и материалов', at: String(closeAt), kind: 'application' });
    }
    const upcoming = candidates
      .filter((item) => !isDeadlinePassed(item.at))
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    const nearest = upcoming[0] ?? null;

    res.json({
      team: {
        id: bundle.team.id,
        name: bundle.team.name,
        status: bundle.team.status,
        direction: bundle.team.direction_title ?? null,
        season: bundle.team.season_title ?? null,
        public_number: bundle.team.public_number ?? null,
        submitted_at: bundle.team.submitted_at ?? null,
        tech_status: bundle.team.tech_status ?? null,
        application_close_at: closeAt,
        deadline_passed: closePassed,
      },
      participants: bundle.participants,
      mentors: bundle.mentors,
      readiness,
      completeness: {
        required_total: required.length,
        required_done: required.filter((item) => item.status !== 'not_submitted' && item.status !== 'needs_fix').length,
        submitted_total: submitted.length,
      },
      nearest_deadline: nearest,
      fixes: readiness.filter((item) => item.status === 'needs_fix' || item.status === 'blocked'),
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
              m.reviewed_by,
              -- Кто из Оргкомитета оставил замечание: требование ТЗ 06, п. 2.
              reviewer.full_name AS reviewer_name,
              media.file_name, media.file_type, media.file_size,
              CASE WHEN m.media_id IS NOT NULL
                   THEN '/api/media/file/' || m.media_id::text
                   ELSE NULL END AS file_url
         FROM application_materials m
         LEFT JOIN media ON media.id = m.media_id
         LEFT JOIN users reviewer ON reviewer.id = m.reviewed_by
        WHERE m.team_id = $1
        ORDER BY m.type, m.version DESC, m.created_at DESC`,
      [context.teamId]
    );

    res.json(
      result.rows.map((row) => ({
        ...row,
        type_title: materialTypeTitle(row.type),
        is_deadline_passed: closePassed,
        // «Содержание заблокировано» (ТЗ 07, п. 2.3): файл остаётся в системе для
        // разбора, но команде не отдаётся — ни ссылкой, ни по прямому адресу.
        file_url: row.status === 'blocked' ? null : row.file_url,
        can_delete:
          !closePassed &&
          row.status !== 'accepted' &&
          row.status !== 'blocked' &&
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

    const body = (req.body ?? {}) as Record<string, unknown>;
    const type = body.type;
    if (!isMaterialType(type)) {
      res.status(400).json({
        error: `Некорректный тип материала. Допустимые типы: ${Object.keys(MATERIAL_TYPES).join(', ')}`,
      });
      return;
    }

    // Дедлайн проверяется на сервере по московскому времени (п. 6.2 Положения).
    // Исключение — окно досдачи: если Оргкомитет вернул материал с замечанием и
    // назначил срок, работа с этим материалом разрешена до назначенного срока
    // (ТЗ 06, п. 3: «После дедлайна — только по замечанию Оргкомитета в пределах
    // срока досдачи»). Раньше срок досдачи не учитывался и материал нельзя было
    // перезагрузить даже по прямому требованию Оргкомитета.
    const fixWindow = await query(
      `SELECT fix_deadline, status
         FROM application_materials
        WHERE application_id = $1 AND type = $2 AND status = 'needs_fix'
        ORDER BY version DESC
        LIMIT 1`,
      [application.id, type]
    );
    const fixRow = fixWindow.rows[0];
    const fixDeadline = fixRow?.fix_deadline ?? null;
    const withinFixWindow = fixRow !== undefined && !isDeadlinePassed(fixDeadline);

    if (isDeadlinePassed(bundle.team.application_close_at) && !withinFixWindow) {
      res.status(403).json({
        error: fixRow !== undefined
          ? 'Срок досдачи по замечанию Оргкомитета истёк. Запись материалов недоступна.'
          : 'Срок приёма конкурсных материалов истёк. Запись материалов недоступна.',
        contact_endpoint: '/api/cabinet/contact',
        fix_deadline: fixDeadline,
      });
      return;
    }

    const externalUrl = optionalText(body.external_url, 2000);
    if (externalUrl !== null && !isAllowedMaterialUrl(externalUrl)) {
      // Пункт 14.4 Положения: только сервисы, зарегистрированные в России.
      res.status(400).json({ error: MATERIAL_URL_POLICY_MESSAGE });
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

    // Идемпотентность (ТЗ 05, п. 1.5): повтор запроса с тем же ключом не
    // создаёт вторую версию материала — возвращаем уже сохранённую.
    const idempotencyKey = requiredText(req.header('Idempotency-Key'), 100);
    if (idempotencyKey) {
      const existing = await query(
        `SELECT id, version, created_at, status
           FROM application_materials
          WHERE idempotency_key = $1 AND team_id = $2
          LIMIT 1`,
        [idempotencyKey, context.teamId]
      );
      const row = existing.rows[0];
      if (row) {
        res.status(200).json({
          success: true,
          idempotent_replay: true,
          id: Number(row.id),
          version: Number(row.version),
          status: row.status,
          created_at: row.created_at,
        });
        return;
      }
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
           (application_id, team_id, type, media_id, external_url, version, status, uploaded_by, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, 'uploaded', 'team', $7)
         RETURNING id, created_at`,
        [application.id, context.teamId, type, mediaId, externalUrl, version, idempotencyKey]
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
      is_application_open:
        applicationWindowState(bundle.team.application_open_at, bundle.team.application_close_at) === 'open',
      application_not_started:
        applicationWindowState(bundle.team.application_open_at, bundle.team.application_close_at) === 'before',
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

    // Обращение из режима «дедлайн пропущен» помечается темой deadline_contact, а
    // в текст добавляется контекст: название команды, номер и статус заявки.
    // Оргкомитету не приходится уточнять, о какой команде речь (ТЗ 06, п. 4.4).
    const deadlineMode = body.mode === 'deadline' || body.topic === 'deadline_contact';
    const topic = deadlineMode ? 'deadline_contact' : optionalText(body.topic, 200) ?? 'Обращение команды';

    const applicationRow = await query(
      `SELECT a.public_number, a.submitted_at, t.name AS team_name, t.status AS team_status
         FROM applications a
         JOIN teams t ON t.id = a.team_id
        WHERE a.team_id = $1
        ORDER BY a.id DESC
        LIMIT 1`,
      [context.teamId]
    );
    const application = applicationRow.rows[0];
    const contextLines = [
      '',
      '---',
      `Команда: ${application?.team_name ?? context.teamName}`,
      application?.public_number ? `Номер заявки: ${application.public_number}` : null,
      application?.team_status ? `Статус заявки: ${application.team_status}` : null,
    ].filter((line): line is string => line !== null);

    const result = await query(
      `INSERT INTO leads (name, email, phone, topic, message, source, consent_pdn, team_id, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, 'cabinet', TRUE, $6, $7, $8)
       RETURNING id, created_at`,
      [
        contact?.full_name ?? context.teamName,
        email,
        optionalText(body.phone, 32),
        topic,
        `${message}\n${contextLines.join('\n')}`,
        context.teamId,
        clientIpOf(req),
        String(req.headers['user-agent'] || '').slice(0, 500),
      ]
    );

    void logAccess(context, req, 'contact_request', { lead_id: result.rows[0].id });
    res.status(201).json({ success: true, lead_id: result.rows[0].id, created_at: result.rows[0].created_at });
  })
);

// GET /api/cabinet/appeals — апелляции команды с приложенным сканом.
router.get(
  '/appeals',
  asyncHandler(async (_req, res) => {
    const context = teamContext(res);
    const result = await query(
      `SELECT a.id, a.stage, a.grounds, a.status, a.decision, a.decision_note,
              a.submitted_at, a.deadline_at, a.reviewed_at, a.scan_media_id, a.protocol_url,
              CASE WHEN a.scan_media_id IS NOT NULL
                   THEN '/api/media/file/' || a.scan_media_id::text
                   ELSE NULL END AS scan_url
         FROM appeals a
        WHERE a.team_id = $1
        ORDER BY a.submitted_at DESC`,
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
    // Включатель рассылки (features.mailing): пока транспорт не подключён,
    // согласие на информационные сообщения не записываем — иначе в системе
    // появляется согласие на рассылку, которой нет.
    if (!(await featureEnabled('mailing'))) {
      parsed.value = { ...parsed.value, marketing_consent: false };
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
    const check = await withTransaction(async (client) =>
      collectSubmissionErrors(client, submissionContext)
    );
    if (check.errors.length > 0) {
      // Если не хватает именно скана согласия законного представителя, команда
      // получает отдельный статус — Оргкомитет видит причину без переписки
      // (ТЗ 06, п. 1.2а).
      if (check.minorScanMissing) {
        await query(
          `UPDATE teams
              SET status = 'awaiting_legal_representative_consent',
                  status_changed_at = now(), updated_at = now()
            WHERE id = $1 AND status NOT IN ('disqualified', 'withdrawn')`,
          [context.teamId]
        );
      }
      res.status(422).json({
        error: 'Заявка не может быть отправлена: заполнены не все обязательные сведения.',
        details: check.errors,
        team_status: check.minorScanMissing ? 'awaiting_legal_representative_consent' : undefined,
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

// Предмет апелляции по пункту 12.2 Положения.
const APPEAL_GROUNDS = [
  'procedure_violation',
  'wrongful_rejection',
  'counting_error',
  'criteria_misapplication',
  'other',
] as const;

// POST /api/cabinet/revoke-sessions — «Завершить все сеансы» (ТЗ 06, п. 7.4).
// Увеличивает эпоху сессий команды: все выданные cookie перестают действовать,
// ссылка доступа остаётся у Оргкомитета и может быть выдана заново.
router.post(
  '/revoke-sessions',
  rateLimit(10, 60_000),
  asyncHandler(async (req, res) => {
    const context = teamContext(res);
    await query(
      `UPDATE teams SET session_epoch = session_epoch + 1, updated_at = now() WHERE id = $1`,
      [context.teamId]
    );
    clearTeamSessionCookie(res);
    void logAccess(context, req, 'team_sessions_revoked', {});
    res.json({
      success: true,
      message:
        'Все сеансы кабинета завершены. Чтобы войти снова, воспользуйтесь ссылкой доступа или запросите её у Оргкомитета.',
    });
  })
);

// POST /api/cabinet/withdraw — отказ от участия (п. 4.10 Положения).
// Одновременно отзываются действующие согласия: по пункту 14.3 отзыв согласия
// до завершения Конкурса прекращает участие, поэтому и статус, и согласия,
// и ссылки доступа меняются в одной транзакции.
router.post(
  '/withdraw',
  rateLimit(5, 60_000),
  asyncHandler(async (req, res) => {
    const context = teamContext(res);
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.confirm !== true) {
      res.status(400).json({ error: 'Подтвердите отказ от участия.' });
      return;
    }
    const reason = optionalText(body.reason, 1000);

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE teams SET status = 'withdrawn', status_changed_at = now(), updated_at = now() WHERE id = $1`,
        [context.teamId]
      );
      await client.query(
        `UPDATE applications
            SET organizer_notes = COALESCE(organizer_notes, '') || $2, updated_at = now()
          WHERE team_id = $1`,
        [context.teamId, reason ? `\nОтказ от участия: ${reason}` : '\nОтказ от участия без указания причины.']
      );
      await client.query(
        `UPDATE consents SET revoked_at = now(), updated_at = now()
          WHERE team_id = $1 AND revoked_at IS NULL`,
        [context.teamId]
      );
      await client.query(
        `UPDATE access_tokens SET revoked_at = now() WHERE team_id = $1 AND revoked_at IS NULL`,
        [context.teamId]
      );
    });

    void logAccess(context, req, 'team_withdrawn', { reason: reason ?? null });
    res.json({
      success: true,
      team_status: 'withdrawn',
      message: 'Участие отозвано. Согласия на обработку персональных данных отозваны, ссылки доступа закрыты.',
    });
  })
);

// POST /api/cabinet/appeals — подача апелляции по форме Приложения № 14.
// Срок считается от фактического времени опубликования протокола этапа (п. 12.1).
router.post(
  '/appeals',
  rateLimit(5, 60_000),
  // Файл необязателен: апелляцию можно подать текстом, а подтверждающий
  // документ приложить, если он есть (ТЗ 07, п. 2.9 — в карточке виден скан).
  uploadSingle,
  asyncHandler(async (req, res) => {
    const context = teamContext(res);
    // Включатель апелляций (ТЗ 07, п. 2.16).
    if (!(await featureEnabled('appeals'))) {
      res.status(403).json({ error: 'Приём апелляций приостановлен Оргкомитетом.' });
      return;
    }
    const bundle = await loadTeamBundle(context.teamId);
    if (!bundle) {
      res.status(404).json({ error: 'Команда не найдена' });
      return;
    }
    if (bundle.team.status === 'disqualified' || bundle.team.status === 'withdrawn') {
      res.status(403).json({ error: 'Апелляция недоступна: участие команды прекращено.' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const stage = String(body.stage ?? '');
    if (stage !== 'selection' && stage !== 'stage1') {
      res.status(400).json({
        error: 'Апелляция подаётся по итогам отборочного или первого этапа; решения финального этапа не обжалуются (п. 12.3 Положения).',
      });
      return;
    }
    const grounds = String(body.grounds ?? '');
    if (!(APPEAL_GROUNDS as readonly string[]).includes(grounds)) {
      res.status(400).json({ error: 'Укажите предмет апелляции по пункту 12.2 Положения.' });
      return;
    }
    const text = requiredText(body.text, 10_000);
    if (!text) {
      res.status(400).json({ error: 'Изложите мотивированное обоснование со ссылками на Положение.' });
      return;
    }

    const protocol = await query(
      `SELECT published_at
         FROM rankings
        WHERE season_id = $1 AND stage = $2 AND is_published
        ORDER BY published_at DESC
        LIMIT 1`,
      [context.seasonId, stage]
    );
    const publishedAt = protocol.rows[0]?.published_at;
    if (!publishedAt) {
      res.status(409).json({ error: 'Протокол этапа ещё не опубликован: срок подачи апелляции не начался.' });
      return;
    }

    const windowDays = Number(bundle.team.appeal_window_days) || 2;
    const deadlineAt = addWorkingDays(new Date(publishedAt), windowDays);
    if (Date.now() > deadlineAt.getTime()) {
      res.status(403).json({ error: `Срок подачи апелляции истёк ${formatMoscowHuman(deadlineAt)}.` });
      return;
    }

    // Приложенный файл сохраняется в общем хранилище: скан остаётся доступен
    // команде и Оргкомитету, а не только в письме.
    const file = (req as Request & { file?: { originalname: string; mimetype: string; size: number; buffer: Buffer } })
      .file;
    let scanMediaId: string | null = null;
    if (file) {
      const media = await query(
        `INSERT INTO media (file_name, file_url, file_type, file_size, file_data, is_public, category)
         VALUES ($1, '', $2, $3, $4, FALSE, 'appeal_scan')
         RETURNING id`,
        [sanitizeFileName(file.originalname), file.mimetype, file.size, file.buffer]
      );
      scanMediaId = String(media.rows[0].id);
      await query('UPDATE media SET file_url = $1 WHERE id = $2', [`/api/media/file/${scanMediaId}`, scanMediaId]);
    }

    // Срок рассмотрения из Положения исключён: дата не рассчитывается и не
    // хранится (поле остаётся в схеме для прежних записей).
    const inserted = await query(
      `INSERT INTO appeals
         (season_id, team_id, stage, grounds, text, status, submitted_at, deadline_at,
          registered_at, decision_due_at, scan_media_id)
       VALUES ($1, $2, $3, $4, $5, 'submitted', now(), $6, now(), $7, $8)
       RETURNING id, submitted_at, deadline_at, registered_at, decision_due_at, scan_media_id`,
      [context.seasonId, context.teamId, stage, grounds, text, deadlineAt, null, scanMediaId]
    );

    void logAccess(context, req, 'appeal_submitted', { appeal_id: inserted.rows[0].id, stage });
    res.status(201).json({
      success: true,
      id: Number(inserted.rows[0].id),
      stage,
      submitted_at: inserted.rows[0].submitted_at,
      deadline_at: inserted.rows[0].deadline_at,
      decision_due_at: inserted.rows[0].decision_due_at,
      scan_media_id: inserted.rows[0].scan_media_id ?? null,
    });
  })
);

// POST /api/cabinet/final-confirmation — подтверждение участия в финале (п. 9.2):
// состав выступающих и готовность презентации.
router.post(
  '/final-confirmation',
  rateLimit(5, 60_000),
  asyncHandler(async (req, res) => {
    const context = teamContext(res);
    const bundle = await loadTeamBundle(context.teamId);
    if (!bundle) {
      res.status(404).json({ error: 'Команда не найдена' });
      return;
    }
    if (bundle.team.status !== 'finalist' && bundle.team.status !== 'final') {
      res.status(409).json({ error: 'Подтверждение участия доступно командам-финалистам.' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawSpeakers = Array.isArray(body.speakers) ? body.speakers : [];
    const speakerIds: number[] = [];
    for (const value of rawSpeakers) {
      const id = parsePositiveInt(value);
      if (id === null) {
        res.status(400).json({ error: 'Некорректный состав выступающих.' });
        return;
      }
      speakerIds.push(id);
    }
    if (speakerIds.length === 0) {
      res.status(400).json({ error: 'Укажите состав выступающих на финале.' });
      return;
    }

    const participants = await query('SELECT id, full_name FROM participants WHERE team_id = $1', [
      context.teamId,
    ]);
    const speakers = participants.rows.filter((row) => speakerIds.includes(Number(row.id)));
    if (speakers.length !== speakerIds.length) {
      res.status(403).json({ error: 'В составе выступающих указан участник другой команды.' });
      return;
    }

    const note = optionalText(body.note, 2000);
    const speakerNames = speakers.map((row) => String(row.full_name));
    const notes = [note, `Выступающие: ${speakerNames.join(', ')}`].filter(Boolean).join('\n');

    await query(
      `INSERT INTO stage_participation (season_id, team_id, stage, advanced, advance_reason, notes)
       VALUES ($1, $2, 'final', TRUE, 'подтверждение команды', $3)
       ON CONFLICT (season_id, team_id, stage)
       DO UPDATE SET advanced = TRUE, notes = EXCLUDED.notes, updated_at = now()`,
      [context.seasonId, context.teamId, notes]
    );

    void logAccess(context, req, 'final_confirmed', { speakers: speakerNames.length });
    res.json({ success: true, speakers: speakerNames, message: 'Участие в финале подтверждено.' });
  })
);

// GET /api/cabinet/application-form.docx — заполненный бланк заявки.
// Приложение № 1 в редакции 04.10.2026: заявка формируется системой и доступна
// участнику для скачивания в личном кабинете; загружать её не требуется.
router.get(
  '/application-form.docx',
  asyncHandler(async (req, res) => {
    const context = teamContext(res);
    const data = await loadApplicationFormData(context.teamId);
    if (!data) {
      res.status(404).json({ error: 'Заявка не найдена' });
      return;
    }

    const buffer = buildApplicationFormDocx(data);
    void logAccess(context, req, 'application_form_downloaded', { format: 'docx' });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader('Content-Disposition', `attachment; filename="zayavka-${data.application.public_number ?? 'lidery-prava'}.docx"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  })
);

// GET /api/cabinet/consent-form.docx?kind=… — бланк согласия для архива команды
// (ТЗ 06, п. 1.3). Доступен после отправки заявки: до этого согласия ещё не
// даны, и бланк не имеет смысла.
router.get(
  '/consent-form.docx',
  asyncHandler(async (req, res) => {
    const context = teamContext(res);
    const kind = queryString(req.query.kind);
    if (!isConsentKind(kind)) {
      res.status(400).json({
        error: 'Укажите вид согласия: pdn (№ 10), distribution (№ 12), legal_representative (№ 11), media (№ 13).',
      });
      return;
    }

    const data = await loadApplicationFormData(context.teamId);
    if (!data) {
      res.status(404).json({ error: 'Заявка не найдена' });
      return;
    }
    if (!data.application.submitted_at) {
      res.status(409).json({
        error: 'Бланки согласий формируются после отправки заявки: до этого согласия не зафиксированы.',
      });
      return;
    }

    const participantId = parsePositiveInt(queryString(req.query.participant_id));
    const participant =
      (participantId !== null
        ? data.participants.find((row) => Number(row.id) === participantId)
        : undefined) ?? data.participants[0];
    if (!participant) {
      res.status(404).json({ error: 'Участник не найден' });
      return;
    }

    const version = await query(
      `SELECT d.version, d.revision_date
         FROM documents d
        WHERE d.is_active = TRUE AND d.type IN ('appendix', 'consent_distribution', 'consent_legal_representative', 'license_terms')
        ORDER BY d.revision_date DESC
        LIMIT 1`
    );

    const buffer = buildConsentDocx(kind, {
      teamName: String(data.team.name ?? ''),
      directionTitle: (data.team.direction_title as string | null) ?? null,
      publicNumber: (data.application.public_number as string | null) ?? null,
      version: String(version.rows[0]?.version ?? '2026-10-04'),
      revisionDate: (version.rows[0]?.revision_date as string | null) ?? null,
      participant: {
        full_name: String(participant.full_name ?? ''),
        birth_date: (participant.birth_date as string | null) ?? null,
        email: (participant.email as string | null) ?? null,
        phone: (participant.phone as string | null) ?? null,
        organization: (participant.organization as string | null) ?? null,
        region: (participant.region as string | null) ?? null,
        settlement: (participant.settlement as string | null) ?? null,
        citizenship: (participant.citizenship as string | null) ?? null,
        is_minor: participant.is_minor === true,
      },
    });

    void logAccess(context, req, 'consent_form_downloaded', { kind, participant_id: participant.id });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader('Content-Disposition', `attachment; filename="soglasie-${kind}-${participant.id}.docx"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  })
);

// GET /api/cabinet/application-form.pdf — тот же бланк в PDF.
// Требуется LibreOffice на сервере; если его нет, честно сообщаем об этом.
router.get(
  '/application-form.pdf',
  rateLimit(10, 60_000),
  asyncHandler(async (req, res) => {
    const context = teamContext(res);
    const data = await loadApplicationFormData(context.teamId);
    if (!data) {
      res.status(404).json({ error: 'Заявка не найдена' });
      return;
    }

    const pdf = await convertDocxToPdf(buildApplicationFormDocx(data));
    if (!pdf) {
      res.status(503).json({
        error: 'Формирование PDF на этом сервере недоступно. Скачайте бланк в формате DOCX.',
      });
      return;
    }

    void logAccess(context, req, 'application_form_downloaded', { format: 'pdf' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="zayavka-${data.application.public_number ?? 'lidery-prava'}.pdf"`);
    res.setHeader('Content-Length', String(pdf.length));
    res.send(pdf);
  })
);

export default router;
