import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { asyncHandler, parsePositiveInt } from '../lib/http.js';
import { formatMoscowHuman, isDeadlinePassed, toDate } from '../lib/moscow-time.js';
import {
  ageOn,
  isActLevel,
  isEmail,
  isIsoDate,
  isParticipantCategory,
  normalizeEmail,
  optionalText,
  requiredText,
  type ActLevel,
  type ParticipantCategory,
} from '../lib/validation.js';
import { clientIpOf } from '../middleware/admin-auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { generateAccessToken, hashAccessToken } from '../middleware/team-auth.js';

// Приём заявок с сайта. `/apply` — единственный канал подачи (п. 17.3
// Положения; решение Р1 и Р3), внешние формы не используются.
//
// Мастер подачи работает в несколько шагов: этот маршрут создаёт черновик
// (команда, инициатива, капитан) и выдаёт ссылку доступа в кабинет, а шаги
// «Участники», «Наставники», «Материалы» и «Согласия» команда проходит уже в
// личном кабинете. Проверка комплекта целиком выполняется при отправке заявки.

const router = Router();

// Ссылка доступа живёт до конца конкурса и с запасом на апелляции.
const ACCESS_TOKEN_TTL_DAYS = 240;

interface SeasonRow {
  id: number;
  year: number;
  title: string;
  application_open_at: string | Date | null;
  application_close_at: string | Date | null;
}

interface InitiativeInput {
  law_title: string;
  act_level: ActLevel;
  proposed_initiator: string | null;
  annotation: string;
  ai_usage: boolean;
  ai_usage_purpose: string | null;
  is_solo: boolean;
  solo_approved_at: Date | null;
}

interface CaptainInput {
  full_name: string;
  birth_date: string;
  category: ParticipantCategory;
  email: string;
  phone: string | null;
  /** Признак несовершеннолетия на дату окончания приёма заявок (п. 4.8). */
  is_minor: boolean;
}

async function loadActiveSeason(): Promise<SeasonRow | null> {
  const result = await query(
    `SELECT id, year, title, application_open_at, application_close_at
       FROM seasons
      WHERE is_active
      ORDER BY id DESC
      LIMIT 1`
  );
  return (result.rows[0] as SeasonRow | undefined) ?? null;
}

/** Сведения о инициативе по Приложению № 1. */
function parseInitiative(raw: unknown): { value?: InitiativeInput; error?: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { error: 'Заполните сведения о законотворческой инициативе.' };
  }
  const item = raw as Record<string, unknown>;

  const lawTitle = requiredText(item.law_title, 300);
  if (!lawTitle) return { error: 'Укажите наименование законопроекта.' };

  if (!isActLevel(item.act_level)) {
    return {
      error:
        'Укажите уровень акта: федеральный конституционный закон, федеральный закон или закон субъекта Российской Федерации.',
    };
  }

  const annotation = requiredText(item.annotation, 1000);
  if (!annotation) {
    return { error: 'Добавьте краткую аннотацию инициативы: не более 1000 знаков.' };
  }

  const aiUsage = item.ai_usage === true;
  const aiUsagePurpose = optionalText(item.ai_usage_purpose, 500);
  if (aiUsage && !aiUsagePurpose) {
    return { error: 'Укажите цели использования систем искусственного интеллекта.' };
  }

  const isSolo = item.is_solo === true;
  let soloApprovedAt: Date | null = null;
  if (isSolo) {
    // Пункт 4.3: единоличное участие — только по согласованию с Оргкомитетом.
    if (!isIsoDate(item.solo_approved_at)) {
      return {
        error:
          'Единоличное участие допускается по согласованию с Оргкомитетом: укажите дату согласования (п. 4.3 Положения).',
      };
    }
    soloApprovedAt = new Date(`${item.solo_approved_at}T00:00:00+03:00`);
  }

  return {
    value: {
      law_title: lawTitle,
      act_level: item.act_level as ActLevel,
      proposed_initiator: optionalText(item.proposed_initiator, 300),
      annotation,
      ai_usage: aiUsage,
      ai_usage_purpose: aiUsagePurpose,
      is_solo: isSolo,
      solo_approved_at: soloApprovedAt,
    },
  };
}

/**
 * Капитан команды. Его данные собираются на первом шаге мастера: без адреса
 * электронной почты капитана команда не сможет войти в личный кабинет по
 * номеру заявки.
 */
function parseCaptain(raw: unknown, closeAt: Date | null): { value?: CaptainInput; error?: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { error: 'Заполните сведения о капитане команды.' };
  }
  const item = raw as Record<string, unknown>;

  const fullName = requiredText(item.full_name, 200);
  if (!fullName) return { error: 'Укажите фамилию, имя и отчество капитана команды.' };

  if (!isIsoDate(item.birth_date)) return { error: 'Укажите дату рождения капитана команды.' };
  if (!isParticipantCategory(item.category)) {
    return { error: 'Укажите категорию участника по пункту 4.1 Положения.' };
  }
  if (!isEmail(item.email)) return { error: 'Укажите корректный адрес электронной почты капитана.' };

  const referenceDate = closeAt ?? new Date();
  const age = ageOn(item.birth_date, referenceDate);
  if (age < 16 || age > 35) {
    return {
      error: `Капитан команды не проходит по возрасту: на дату окончания приёма заявок ${age} лет (допустимо 16–35, п. 4.1 Положения).`,
    };
  }

  return {
    value: {
      full_name: fullName,
      birth_date: item.birth_date,
      category: item.category,
      email: normalizeEmail(String(item.email)),
      phone: optionalText(item.phone, 32),
      is_minor: age < 18,
    },
  };
}

// POST /api/applications — создание заявки (черновика) с формы сайта.
router.post(
  '/applications',
  rateLimit(10, 60_000),
  asyncHandler(async (req, res) => {
    const season = await loadActiveSeason();
    if (!season) {
      res.status(409).json({ error: 'Активный сезон конкурса не найден. Обратитесь в Оргкомитет.' });
      return;
    }

    const now = new Date();
    const openAt = toDate(season.application_open_at);
    const closeAt = toDate(season.application_close_at);
    if (openAt && now.getTime() < openAt.getTime()) {
      res.status(409).json({
        error: `Приём заявок откроется ${formatMoscowHuman(openAt)}.`,
        application_open_at: openAt.toISOString(),
      });
      return;
    }
    if (isDeadlinePassed(closeAt)) {
      res.status(409).json({
        error: `Срок приёма заявок истёк ${formatMoscowHuman(closeAt)}.`,
        application_close_at: closeAt ? closeAt.toISOString() : null,
      });
      return;
    }

    // Идемпотентность: повторная отправка с тем же ключом не создаёт вторую
    // заявку. Ключ приходит из заголовка Idempotency-Key.
    const idempotencyKey = requiredText(req.header('Idempotency-Key'), 100);
    if (idempotencyKey) {
      const existing = await query(
        `SELECT a.id, a.public_number, a.submitted_at, t.name AS team_name, t.status AS team_status
           FROM applications a
           JOIN teams t ON t.id = a.team_id
          WHERE a.idempotency_key = $1
          LIMIT 1`,
        [idempotencyKey]
      );
      const row = existing.rows[0];
      if (row) {
        res.status(200).json({
          idempotent_replay: true,
          application_id: Number(row.id),
          public_number: row.public_number,
          team_name: row.team_name,
          team_status: row.team_status,
          cabinet_url: '/cabinet/access',
          note:
            'Заявка с этим ключом уже создана. Ссылка доступа повторно не выдаётся: войдите в личный кабинет по номеру заявки и адресу электронной почты капитана.',
        });
        return;
      }
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const team = (typeof body.team === 'object' && body.team !== null ? body.team : {}) as Record<string, unknown>;

    const teamName = requiredText(team.name, 200);
    if (!teamName) {
      res.status(400).json({ error: 'Укажите наименование команды.' });
      return;
    }

    const directionId = parsePositiveInt(team.direction_id);
    if (directionId === null) {
      res.status(400).json({ error: 'Выберите направление конкурса (Приложение № 2).' });
      return;
    }
    const direction = await query('SELECT id FROM directions WHERE id = $1 AND is_active LIMIT 1', [directionId]);
    if (!direction.rows[0]) {
      res.status(400).json({ error: 'Направление конкурса не найдено или неактивно.' });
      return;
    }

    const initiative = parseInitiative(body.initiative);
    if (initiative.error || !initiative.value) {
      res.status(400).json({ error: initiative.error ?? 'Некорректные сведения об инициативе.' });
      return;
    }

    const captain = parseCaptain(body.captain, closeAt);
    if (captain.error || !captain.value) {
      res.status(400).json({ error: captain.error ?? 'Некорректные сведения о капитане команды.' });
      return;
    }

    // Проверенные значения фиксируются в локальных константах: внутри
    // транзакции сужение типов по полям объекта не сохраняется.
    const initiativeInput = initiative.value;
    const captainInput = captain.value;

    const ip = clientIpOf(req);
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 500);
    const accessToken = generateAccessToken();
    const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    let created: { applicationId: number; teamId: number; publicNumber: string };
    try {
      created = await withTransaction(async (client) => {
        const teamRow = await client.query(
          `INSERT INTO teams (season_id, direction_id, name, organization, city, status, status_changed_at)
           VALUES ($1, $2, $3, $4, $5, 'draft', now())
           RETURNING id`,
          [
            season.id,
            directionId,
            teamName,
            optionalText(team.organization, 300),
            optionalText(team.city, 120),
          ]
        );
        const teamId = Number(teamRow.rows[0].id);

        const captainRow = await client.query(
          `INSERT INTO participants
             (season_id, team_id, full_name, birth_date, category, email, phone, role,
              consent_pdn, consent_received, is_minor)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'captain', FALSE, FALSE, $8)
           RETURNING id`,
          [
            season.id,
            teamId,
            captainInput.full_name,
            captainInput.birth_date,
            captainInput.category,
            captainInput.email,
            captainInput.phone,
            captainInput.is_minor,
          ]
        );
        const captainId = Number(captainRow.rows[0].id);

        await client.query('UPDATE teams SET captain_participant_id = $1, updated_at = now() WHERE id = $2', [
          captainId,
          teamId,
        ]);

        const applicationRow = await client.query(
          `INSERT INTO applications
             (season_id, team_id, source, law_title, act_level, proposed_initiator, annotation,
              ai_usage, ai_usage_purpose, is_solo, solo_approved_at,
              idempotency_key, draft_updated_at, ip, user_agent)
           VALUES ($1, $2, 'site', $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), $12, $13)
           RETURNING id`,
          [
            season.id,
            teamId,
            initiativeInput.law_title,
            initiativeInput.act_level,
            initiativeInput.proposed_initiator,
            initiativeInput.annotation,
            initiativeInput.ai_usage,
            initiativeInput.ai_usage_purpose,
            initiativeInput.is_solo,
            initiativeInput.solo_approved_at,
            idempotencyKey,
            ip,
            userAgent,
          ]
        );
        const applicationId = Number(applicationRow.rows[0].id);
        const publicNumber = `LP-${season.year}-${String(applicationId).padStart(6, '0')}`;
        await client.query('UPDATE applications SET public_number = $1, updated_at = now() WHERE id = $2', [
          publicNumber,
          applicationId,
        ]);

        await client.query(
          `INSERT INTO access_tokens (team_id, token_hash, label, issued_to_email, max_uses, single_use, expires_at)
           VALUES ($1, $2, 'Ссылка доступа по заявке', $3, 0, FALSE, $4)`,
          [teamId, hashAccessToken(accessToken), captainInput.email, accessExpiresAt]
        );

        return { applicationId, teamId, publicNumber };
      });
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('teams_season_id_name_key')) {
        res.status(409).json({
          error: 'Команда с таким названием уже зарегистрирована в этом сезоне. Выберите другое название.',
        });
        return;
      }
      if (message.includes('participants_season_email_idx')) {
        res.status(409).json({
          error: 'Капитан команды уже заявлен в другой команде этого сезона (п. 4.4 Положения).',
        });
        return;
      }
      throw error;
    }

    res.status(201).json({
      success: true,
      application_id: created.applicationId,
      public_number: created.publicNumber,
      team_id: created.teamId,
      team_name: teamName,
      cabinet_url: '/cabinet/access',
      // Ссылка доступа показывается один раз: в базе хранится только её хэш.
      access_token: accessToken,
      access_expires_at: accessExpiresAt.toISOString(),
      application_close_at: closeAt ? closeAt.toISOString() : null,
      next_step: 'Участники',
    });
  })
);

// GET /api/applications/status/:key — проверка статуса по номеру заявки.
// Персональные данные не отдаются: только номер, команда, статусы и счётчики.
router.get(
  '/applications/status/:key',
  rateLimit(30, 60_000),
  asyncHandler(async (req, res) => {
    const key = String(req.params.key ?? '').trim().slice(0, 32);
    if (key === '') {
      res.status(400).json({ error: 'Укажите номер заявки.' });
      return;
    }

    const result = await query(
      `SELECT a.public_number, a.submitted_at, a.tech_status, a.created_at,
              t.name AS team_name, t.status AS team_status,
              (SELECT count(*) FROM participants p WHERE p.team_id = t.id) AS participants_count,
              (SELECT count(*) FROM mentors m WHERE m.team_id = t.id) AS mentors_count
         FROM applications a
         JOIN teams t ON t.id = a.team_id
        WHERE upper(a.public_number) = upper($1)
        LIMIT 1`,
      [key]
    );
    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Заявка с таким номером не найдена.' });
      return;
    }

    const season = await loadActiveSeason();
    res.json({
      public_number: row.public_number,
      team_name: row.team_name,
      team_status: row.team_status,
      tech_status: row.tech_status,
      submitted: row.submitted_at !== null,
      submitted_at: row.submitted_at,
      created_at: row.created_at,
      participants_count: Number(row.participants_count),
      mentors_count: Number(row.mentors_count),
      application_close_at: season?.application_close_at ?? null,
    });
  })
);

// GET /api/applications/requirements — состав комплекта конкурсных материалов.
// Состав и сроки ведёт Оргкомитет в таблице material_requirements, поэтому
// интерфейс получает их запросом, а не хранит собственный перечень
// (ТЗ 04, п. 3.7).
router.get(
  '/applications/requirements',
  rateLimit(60, 60_000),
  asyncHandler(async (req, res) => {
    const season = await loadActiveSeason();
    if (!season) {
      res.status(404).json({ error: 'Активный сезон конкурса не найден.' });
      return;
    }

    const stage = String(req.query.stage ?? 'selection');
    if (!['selection', 'stage1', 'final'].includes(stage)) {
      res.status(400).json({ error: 'Некорректный этап конкурса.' });
      return;
    }

    const result = await query(
      `SELECT type, title, is_required, due_at, max_files, allowed_extensions,
              name_template, description, sort_order
         FROM material_requirements
        WHERE season_id = $1 AND stage = $2 AND is_active
        ORDER BY sort_order`,
      [season.id, stage]
    );

    res.json({ stage, application_close_at: season.application_close_at, requirements: result.rows });
  })
);

export default router;
