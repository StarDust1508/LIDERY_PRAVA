import type pg from 'pg';

// Полная проверка заявки перед отправкой (п. 7.2–7.5 Положения) и фиксация
// электронных согласий.
//
// Пункт 14.3: согласие оформляется отметкой на сайте, при этом фиксируются
// дата, время, сетевой адрес и версия текста согласия. Именно поэтому согласие
// записывается отдельной строкой в consents, а не только галочкой в участнике.

/** Категории Приложения № 12: субъект отмечает каждую строку отдельно. */
export const DISTRIBUTION_CATEGORIES = [
  'full_name',
  'organization_status',
  'region_settlement',
  'team_initiative_results',
  'image_voice',
  'social_link',
] as const;

export type DistributionCategory = (typeof DISTRIBUTION_CATEGORIES)[number];

export interface DistributionEntry {
  participant_id: number;
  categories: Record<DistributionCategory, boolean>;
  conditions: string | null;
}

export interface SubmissionInput {
  confirm_regulation: boolean;
  image_license: boolean;
  /** Необязательное согласие на рассылку (ст. 18 38-ФЗ). */
  marketing_consent: boolean;
  distribution: DistributionEntry[];
}

export interface SubmissionContext {
  teamId: number;
  seasonId: number;
  applicationId: number;
  ip: string;
  userAgent: string;
  input: SubmissionInput;
}

/** Разбирает подтверждения и матрицу Приложения № 12 из тела запроса. */
export function parseSubmission(raw: unknown): { value?: SubmissionInput; error?: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { error: 'Передайте подтверждения согласий.' };
  }
  const body = raw as Record<string, unknown>;

  if (body.confirm_regulation !== true) {
    return { error: 'Подтвердите ознакомление с Положением о Конкурсе и принятие его условий.' };
  }
  if (body.image_license !== true) {
    return {
      error:
        'Подтвердите согласие на использование изображения и предоставление права использования конкурсных материалов (Приложение № 13).',
    };
  }

  const distribution: DistributionEntry[] = [];
  const rawDistribution = Array.isArray(body.distribution) ? body.distribution : [];
  for (const item of rawDistribution) {
    if (typeof item !== 'object' || item === null) {
      return { error: 'Некорректные данные согласия на распространение персональных данных.' };
    }
    const entry = item as Record<string, unknown>;
    const participantId = Number.parseInt(String(entry.participant_id ?? ''), 10);
    if (!Number.isInteger(participantId) || participantId <= 0) {
      return { error: 'В согласии на распространение не указан участник.' };
    }

    const rawCategories = (
      typeof entry.categories === 'object' && entry.categories !== null ? entry.categories : {}
    ) as Record<string, unknown>;
    const categories = {} as Record<DistributionCategory, boolean>;
    for (const code of DISTRIBUTION_CATEGORIES) {
      categories[code] = rawCategories[code] === true;
    }

    const conditionsRaw = typeof entry.conditions === 'string' ? entry.conditions.trim() : '';
    distribution.push({
      participant_id: participantId,
      categories,
      conditions: conditionsRaw === '' ? null : conditionsRaw.slice(0, 1000),
    });
  }

  return {
    value: {
      confirm_regulation: true,
      image_license: true,
      marketing_consent: body.marketing_consent === true,
      distribution,
    },
  };
}

/**
 * Проверяет, что заявка укомплектована полностью. Возвращает список понятных
 * сообщений; пустой список означает готовность к отправке.
 */
export interface SubmissionCheck {
  errors: string[];
  /** Не хватает скана согласия законного представителя (ТЗ 06, п. 1.2а). */
  minorScanMissing: boolean;
}

export async function collectSubmissionErrors(
  client: pg.PoolClient,
  context: SubmissionContext
): Promise<SubmissionCheck> {
  const errors: string[] = [];
  // Признак «не хватает скана согласия законного представителя» — отдельный
  // статус команды, а не только текст ошибки (ТЗ 06, п. 1.2а).
  let minorScanMissing = false;

  const application = await client.query('SELECT is_solo, law_title FROM applications WHERE id = $1 LIMIT 1', [
    context.applicationId,
  ]);
  const isSolo = application.rows[0]?.is_solo === true;
  if (!application.rows[0]?.law_title) {
    errors.push('Не заполнено наименование законопроекта (Приложение № 1).');
  }

  const participants = await client.query(
    `SELECT id, full_name, role, is_minor, consent_pdn, consent_legal_representative
       FROM participants
      WHERE team_id = $1
      ORDER BY CASE WHEN role = 'captain' THEN 0 ELSE 1 END, id`,
    [context.teamId]
  );
  const rows = participants.rows;

  // Численность: 2–4 человека, единоличное участие — только по согласованию (п. 4.3).
  if (isSolo) {
    if (rows.length !== 1) {
      errors.push('При единоличном участии в заявке должен быть ровно один участник (п. 4.3 Положения).');
    }
  } else if (rows.length < 2 || rows.length > 4) {
    errors.push('В команде должно быть от 2 до 4 участников (п. 4.3 Положения).');
  }
  if (rows.filter((row) => row.role === 'captain').length !== 1) {
    errors.push('В команде должен быть ровно один капитан.');
  }

  for (const row of rows) {
    if (row.consent_pdn !== true) {
      errors.push(
        `Участник «${row.full_name}»: отсутствует согласие на обработку персональных данных (Приложения № 10–12).`
      );
    }
    if (row.is_minor === true && row.consent_legal_representative !== true) {
      errors.push(
        `Участник «${row.full_name}» младше 18 лет: требуется согласие законного представителя (Приложение № 11).`
      );
    }
  }

  // Для несовершеннолетних нужен именно скан подписанного бланка (п. 4.8, 7.2).
  // Пока скана нет, команда получает отдельный статус «ожидает согласие
  // законного представителя» (ТЗ 06, п. 1.2а): по нему Оргкомитет сразу видит,
  // чего не хватает, а команда понимает, почему заявка не ушла на проверку.
  if (rows.some((row) => row.is_minor === true)) {
    const scan = await client.query(
      `SELECT 1
         FROM application_materials
        WHERE application_id = $1 AND type = 'consent_legal_rep' AND media_id IS NOT NULL
        LIMIT 1`,
      [context.applicationId]
    );
    if (scan.rows.length === 0) {
      errors.push(
        'Для участников младше 18 лет приложите скан подписанного согласия законного представителя (Приложение № 11).'
      );
      minorScanMissing = true;
    }
  }

  const mentors = await client.query(
    `SELECT id, full_name, consent_pdn FROM mentors WHERE team_id = $1 ORDER BY id`,
    [context.teamId]
  );
  if (mentors.rows.length > 2) {
    errors.push('У команды может быть не более двух наставников (п. 4.9 Положения).');
  }
  for (const mentor of mentors.rows) {
    if (mentor.consent_pdn !== true) {
      errors.push(`Наставник «${mentor.full_name}»: отсутствует согласие на обработку персональных данных.`);
    }
  }

  // Обязательный комплект отборочного этапа берётся из material_requirements,
  // а не из кода: состав и сроки меняет Оргкомитет (ТЗ 04, п. 3.7).
  const required = await client.query(
    `SELECT type, title
       FROM material_requirements
      WHERE season_id = $1 AND stage = 'selection' AND is_active AND is_required
        AND type NOT IN ('application_form', 'consent_pdn', 'consent_legal_rep')
      ORDER BY sort_order`,
    [context.seasonId]
  );
  for (const requirement of required.rows) {
    const present = await client.query(
      `SELECT 1
         FROM application_materials
        WHERE application_id = $1 AND type = $2 AND status <> 'rejected'
          AND (media_id IS NOT NULL OR (external_url IS NOT NULL AND external_url <> ''))
        LIMIT 1`,
      [context.applicationId, requirement.type]
    );
    if (present.rows.length === 0) {
      errors.push(`Не приложен обязательный материал: ${requirement.title}.`);
    }
  }

  return { errors, minorScanMissing };
}

/** Версия действующей редакции документов — резерв, если строка ещё не заведена. */
async function currentDocumentsVersion(client: pg.PoolClient): Promise<string> {
  const setting = await client.query(
    `SELECT value ->> 'value' AS version FROM site_settings WHERE key = 'documents.current_version' LIMIT 1`
  );
  return setting.rows[0]?.version ? String(setting.rows[0].version) : '';
}

/** Есть ли опубликованный документ указанного типа. */
async function hasPublishedDocument(client: pg.PoolClient, type: string): Promise<boolean> {
  const result = await client.query('SELECT 1 FROM documents WHERE type = $1 AND is_active LIMIT 1', [type]);
  return result.rows.length > 0;
}

/**
 * Находит опубликованный документ: Положение, оферту или приложение по номеру.
 * Ищутся только действующие редакции: согласие фиксируется с той версией,
 * которая опубликована на момент акцепта.
 */
async function resolveDocument(
  client: pg.PoolClient,
  documentType: 'regulation' | 'offer' | 'appendix' | 'mailing_consent',
  appendixNumber: string | null
): Promise<{ id: number | null; version: string }> {
  const result =
    documentType === 'appendix'
      ? await client.query(
          `SELECT id, version FROM documents
            WHERE type = 'appendix' AND is_active
              AND title LIKE 'Приложение № ' || $1 || '.%'
            ORDER BY id
            LIMIT 1`,
          [appendixNumber]
        )
      : await client.query(
          `SELECT id, version FROM documents
            WHERE type = $1 AND is_active
            ORDER BY revision_date DESC, id DESC
            LIMIT 1`,
          [documentType]
        );

  const row = result.rows[0];
  return {
    id: row ? Number(row.id) : null,
    version: row ? String(row.version) : await currentDocumentsVersion(client),
  };
}

interface ConsentParams {
  subjectType: 'participant' | 'legal_representative' | 'mentor' | 'team';
  participantId: number | null;
  mentorId: number | null;
  documentCode: string;
  /** Тип документа в таблице documents: Положение, оферта, приложение или рассылка. */
  documentType: 'regulation' | 'offer' | 'appendix' | 'mailing_consent';
  appendixNumber: string | null;
  scanMediaId?: string | null;
}

/** Записывает согласие: обновляет действующее либо заводит новое. */
async function upsertConsent(
  client: pg.PoolClient,
  context: SubmissionContext,
  params: ConsentParams
): Promise<void> {
  const document = await resolveDocument(client, params.documentType, params.appendixNumber);

  const existing = await client.query(
    `SELECT id FROM consents
      WHERE season_id = $1 AND document_code = $2 AND subject_type = $3
        AND COALESCE(participant_id, 0) = COALESCE($4, 0)
        AND COALESCE(mentor_id, 0) = COALESCE($5, 0)
        AND COALESCE(team_id, 0) = COALESCE($6, 0)
        AND revoked_at IS NULL
      LIMIT 1`,
    [
      context.seasonId,
      params.documentCode,
      params.subjectType,
      params.participantId,
      params.mentorId,
      context.teamId,
    ]
  );

  if (existing.rows[0]) {
    await client.query(
      `UPDATE consents
          SET document_id = $1, document_version = $2, accepted = TRUE, accepted_at = now(),
              ip = $3, user_agent = $4, scan_media_id = $5, updated_at = now()
        WHERE id = $6`,
      [
        document.id,
        document.version,
        context.ip,
        context.userAgent,
        params.scanMediaId ?? null,
        Number(existing.rows[0].id),
      ]
    );
    return;
  }

  await client.query(
    `INSERT INTO consents
       (season_id, team_id, subject_type, participant_id, mentor_id, document_id,
        document_code, document_version, accepted, accepted_at, ip, user_agent, scan_media_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, now(), $9, $10, $11)`,
    [
      context.seasonId,
      context.teamId,
      params.subjectType,
      params.participantId,
      params.mentorId,
      document.id,
      params.documentCode,
      document.version,
      context.ip,
      context.userAgent,
      params.scanMediaId ?? null,
    ]
  );
}

/**
 * Фиксирует согласия, отмеченные командой при отправке заявки:
 * Положение (для команды), Приложения № 10 или № 11 (для участников и
 * наставников), № 12 (матрица распространения), № 13 (изображение и лицензия).
 */
export async function recordConsents(client: pg.PoolClient, context: SubmissionContext): Promise<void> {
  // Согласие команды с Положением о Конкурсе (п. 7.3).
  await upsertConsent(client, context, {
    subjectType: 'team',
    participantId: null,
    mentorId: null,
    documentCode: 'regulation',
    documentType: 'regulation',
    appendixNumber: null,
  });

  // Подача заявки означает согласие и с офертой (п. 7.3 Положения; ТЗ 09, п. 5.7).
  // Отметка фиксируется, только когда оферта опубликована: публичная оферта
  // предполагает опубликованный текст. Пока документ не утверждён Ассоциацией
  // и не активирован, согласие с ним не запрашивается и не записывается.
  if (await hasPublishedDocument(client, 'offer')) {
    await upsertConsent(client, context, {
      subjectType: 'team',
      participantId: null,
      mentorId: null,
      documentCode: 'offer',
      documentType: 'offer',
      appendixNumber: null,
    });
  }

  // Согласие на информационные сообщения — отдельное и необязательное
  // (ст. 18 Федерального закона № 38-ФЗ «О рекламе»). Запрашивается и
  // записывается только когда текст согласия опубликован: согласие с
  // неопубликованным текстом юридически бессмысленно. Отказ не влияет на
  // участие в конкурсе.
  if (context.input.marketing_consent && (await hasPublishedDocument(client, 'mailing_consent'))) {
    const captain = await client.query(
      `SELECT id FROM participants WHERE team_id = $1 AND role = 'captain' ORDER BY id LIMIT 1`,
      [context.teamId]
    );
    const captainId = captain.rows[0]?.id ? Number(captain.rows[0].id) : null;
    if (captainId !== null) {
      await upsertConsent(client, context, {
        subjectType: 'participant',
        participantId: captainId,
        mentorId: null,
        documentCode: 'mailing_consent',
        documentType: 'mailing_consent',
        appendixNumber: null,
      });
    }
  }

  const participants = await client.query(
    `SELECT id, full_name, is_minor, consent_legal_representative FROM participants
      WHERE team_id = $1 ORDER BY id`,
    [context.teamId]
  );

  // Скан согласия законного представителя — один на команду: приложение № 11
  // загружается материалом типа consent_legal_rep.
  const scanResult = await client.query(
    `SELECT media_id FROM application_materials
      WHERE application_id = $1 AND type = 'consent_legal_rep' AND media_id IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`,
    [context.applicationId]
  );
  const scanMediaId = scanResult.rows[0]?.media_id ? String(scanResult.rows[0].media_id) : null;

  for (const participant of participants.rows) {
    const isMinor = participant.is_minor === true;
    await upsertConsent(client, context, {
      subjectType: isMinor ? 'legal_representative' : 'participant',
      participantId: Number(participant.id),
      mentorId: null,
      documentCode: isMinor ? 'appendix_11' : 'appendix_10',
      documentType: 'appendix',
      appendixNumber: isMinor ? '11' : '10',
      scanMediaId: isMinor ? scanMediaId : null,
    });

    // Приложение № 13: изображение и лицензия на конкурсные материалы.
    await upsertConsent(client, context, {
      subjectType: 'participant',
      participantId: Number(participant.id),
      mentorId: null,
      documentCode: 'appendix_13',
      documentType: 'appendix',
      appendixNumber: '13',
    });
  }

  const mentors = await client.query(`SELECT id FROM mentors WHERE team_id = $1 ORDER BY id`, [context.teamId]);
  for (const mentor of mentors.rows) {
    await upsertConsent(client, context, {
      subjectType: 'mentor',
      participantId: null,
      mentorId: Number(mentor.id),
      documentCode: 'appendix_10',
      documentType: 'appendix',
      appendixNumber: '10',
    });
  }

  // Приложение № 12: согласие на распространение оформляется отдельно от
  // согласия на обработку и по каждой категории отдельно (п. 14.3).
  for (const entry of context.input.distribution) {
    const belongs = participants.rows.some((row) => Number(row.id) === entry.participant_id);
    if (!belongs) continue;

    await upsertConsent(client, context, {
      subjectType: 'participant',
      participantId: entry.participant_id,
      mentorId: null,
      documentCode: 'appendix_12',
      documentType: 'appendix',
      appendixNumber: '12',
    });

    for (const code of DISTRIBUTION_CATEGORIES) {
      await client.query(
        `INSERT INTO participant_distribution_consents
           (participant_id, category_code, allowed, conditions, signed_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (participant_id, category_code)
         DO UPDATE SET allowed = EXCLUDED.allowed,
                       conditions = EXCLUDED.conditions,
                       signed_at = now(),
                       updated_at = now()`,
        [entry.participant_id, code, entry.categories[code], entry.conditions]
      );
    }
  }
}
