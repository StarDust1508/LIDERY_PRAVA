import { Router } from 'express';
import { PUBLIC_BASE_URL } from '../config.js';
import { query } from '../db.js';
import { asyncHandler, parsePositiveInt, queryString } from '../lib/http.js';
import { featureEnabled } from '../lib/features.js';
import { paginationOf, setListMeta } from '../middleware/api-envelope.js';
import { applicationWindowState } from '../lib/moscow-time.js';

// Публичные справочные данные сайта. Ничего персонального здесь не отдаётся:
// только сезон, направления, партнёры, мастер-классы, новости и документы.

const router = Router();

// GET /api/season/current — активный (или последний опубликованный) сезон.
router.get(
  '/season/current',
  asyncHandler(async (_req, res) => {
    const seasonResult = await query(
      `SELECT * FROM seasons
        WHERE is_active = TRUE
        ORDER BY year DESC
        LIMIT 1`
    );
    let season = seasonResult.rows[0];
    if (!season) {
      const fallback = await query(
        `SELECT * FROM seasons WHERE status IN ('published', 'active', 'finished')
          ORDER BY year DESC LIMIT 1`
      );
      season = fallback.rows[0];
    }
    if (!season) {
      res.status(404).json({ error: 'Сезон конкурса ещё не опубликован' });
      return;
    }

    const settingsResult = await query(
      `SELECT key, value FROM site_settings
        WHERE key LIKE 'site.%' OR key LIKE 'operator.%' OR key LIKE 'features.%'
        ORDER BY key`
    );
    const settings: Record<string, unknown> = {};
    for (const row of settingsResult.rows) {
      settings[String(row.key)] = row.value?.value ?? row.value;
    }

    res.json({
      // Канонический адрес сайта: фронтенд строит по нему абсолютные ссылки.
      public_base_url: PUBLIC_BASE_URL,
      season: {
        id: season.id,
        slug: season.slug,
        title: season.title,
        year: season.year,
        status: season.status,
        is_active: season.is_active,
        application_open_at: season.application_open_at,
        application_close_at: season.application_close_at,
        tech_check_from: season.tech_check_from,
        tech_check_to: season.tech_check_to,
        stage1_from: season.stage1_from,
        stage1_to: season.stage1_to,
        final_from: season.final_from,
        final_to: season.final_to,
        // Календарный план Положения (ТЗ 02, п. 2): экспертиза, протоколы,
        // видеоролики, мастер-классы и мероприятия после финала.
        expertise_from: season.expertise_from,
        expertise_to: season.expertise_to,
        protocol_selection_at: season.protocol_selection_at,
        video_publication_from: season.video_publication_from,
        video_publication_to: season.video_publication_to,
        stage1_evaluation_from: season.stage1_evaluation_from,
        stage1_evaluation_to: season.stage1_evaluation_to,
        protocol_stage1_at: season.protocol_stage1_at,
        masterclasses_from: season.masterclasses_from,
        masterclasses_to: season.masterclasses_to,
        post_final_from: season.post_final_from,
        post_final_to: season.post_final_to,
        appeal_window_days: season.appeal_window_days,
        timezone: season.timezone,
        description: season.description,
        is_application_open: applicationWindowState(season.application_open_at, season.application_close_at) === 'open',
        application_not_started:
          applicationWindowState(season.application_open_at, season.application_close_at) === 'before',
      },
      settings,
    });
  })
);

// GET /api/directions — справочник направлений конкурса.
router.get(
  '/directions',
  asyncHandler(async (_req, res) => {
    const result = await query(
      `SELECT id, code, title, description, sort_order
         FROM directions
        WHERE is_active = TRUE
        ORDER BY sort_order, title`
    );
    res.json(result.rows);
  })
);

// GET /api/partners — партнёры и спонсоры с логотипами.
router.get(
  '/partners',
  asyncHandler(async (_req, res) => {
    const result = await query(
      `SELECT p.id, p.name, p.url, p.partner_type, p.description, p.sort_order,
              p.logo_media_id,
              CASE WHEN p.logo_media_id IS NOT NULL
                   THEN '/api/media/file/' || p.logo_media_id::text
                   ELSE NULL END AS logo_url
         FROM partners p
        WHERE p.is_active = TRUE
        ORDER BY p.sort_order, p.name`
    );
    res.json(result.rows);
  })
);

// GET /api/masterclasses — мастер-классы для команд-финалистов.
router.get(
  '/masterclasses',
  // Включатель раздела (ТЗ 07, п. 2.16): выключенный раздел отдаёт пустой
  // список, а не ошибку — страница показывает пояснение.
  asyncHandler(async (req, res, next) => {
    if (await featureEnabled('masterclasses')) {
      next();
      return;
    }
    res.json([]);
  }),
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const params: unknown[] = [];
    // Снятые с публикации и отменённые занятия на сайте не показываются
    // (ТЗ 07, п. 2.10): статус «отменён» остаётся виден только Оргкомитету.
    let where = 'WHERE m.is_published = TRUE AND m.status <> \'cancelled\'';
    if (status === 'announced' || status === 'past') {
      params.push(status);
      where += ` AND m.status = $${params.length}`;
    }
    // Прошедший мастер-класс без записи на сайте не показывается (ТЗ 05, §3).
    // Правило проверялось только при сохранении в админке: если запись удалили
    // из хранилища отдельно, страница оставалась без видео. Здесь оно
    // действует и на выдаче.
    if (status === 'past') {
      where += ' AND (m.recording_url IS NOT NULL OR m.media_id IS NOT NULL)';
    }
    const result = await query(
      `SELECT m.id, m.slug, m.topic, m.season_id, m.title, m.speaker, m.speaker_info, m.description,
              m.status, m.starts_at, m.place, m.recording_url, m.media_id, m.materials, m.sort_order,
              CASE WHEN m.media_id IS NOT NULL
                   THEN '/api/media/file/' || m.media_id::text
                   ELSE NULL END AS recording_file_url,
              s.slug AS season_slug, s.title AS season_title
         FROM masterclasses m
         LEFT JOIN seasons s ON s.id = m.season_id
         ${where}
        ORDER BY m.starts_at DESC NULLS LAST, m.sort_order`,
      params
    );
    res.json(result.rows);
  })
);

// GET /api/masterclasses/:slug — мастер-класс по человекочитаемому адресу
// (ТЗ 08, п. 2.1). Служебный адрес вида `masterclass-12` тоже принимается: он
// остаётся у записей, заведённых до появления адресации.
router.get(
  '/masterclasses/:slug',
  asyncHandler(async (req, res) => {
    const slug = String(req.params.slug).slice(0, 200);
    const result = await query(
      `SELECT m.id, m.slug, m.season_id, m.title, m.topic, m.speaker, m.speaker_info,
              m.description, m.status, m.starts_at, m.place, m.recording_url, m.media_id, m.materials,
              CASE WHEN m.media_id IS NOT NULL
                   THEN '/api/media/file/' || m.media_id::text
                   ELSE NULL END AS recording_file_url,
              s.slug AS season_slug, s.title AS season_title
         FROM masterclasses m
         LEFT JOIN seasons s ON s.id = m.season_id
        WHERE m.slug = $1 OR m.slug = 'masterclass-' || $2
        LIMIT 1`,
      [slug, /^\d+$/.test(slug) ? slug : '0']
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Мастер-класс не найден' });
      return;
    }
    res.json(result.rows[0]);
  })
);

// GET /api/jury — Жюри финального этапа из отдельного справочника. Состав Жюри
// ведётся в таблице jury_members, поэтому страница «Оргкомитет и эксперты»
// получает его отдельно от экспертов.
router.get(
  '/jury',
  asyncHandler(async (_req, res) => {
    const result = await query(
      `SELECT j.id, j.full_name, j.organization, j.position, j.role, j.stage, j.about,
              CASE WHEN j.photo_media_id IS NOT NULL
                   THEN '/api/media/file/' || j.photo_media_id::text
                   ELSE NULL END AS photo_url
         FROM jury_members j
        WHERE j.is_active AND j.is_public
        ORDER BY j.role DESC, j.full_name`
    );
    res.json(result.rows);
  })
);

// GET /api/experts — члены Конкурсной комиссии, Жюри и эксперты (ТЗ 08, п. 2.1).
// Отдаются только публичные поля: без почты, телефона и заметок Оргкомитета.
router.get(
  '/experts',
  asyncHandler(async (_req, res) => {
    const result = await query(
      `SELECT e.id, e.full_name, e.organization, e.position, e.degree, e.role, e.stage,
              e.about,
              CASE WHEN e.photo_media_id IS NOT NULL
                   THEN '/api/media/file/' || e.photo_media_id::text
                   ELSE NULL END AS photo_url
         FROM experts e
        WHERE e.is_active AND e.is_public
        ORDER BY e.stage, e.role DESC, e.full_name`
    );
    res.json(result.rows);
  })
);

// GET /api/news — новости и видеосюжеты.
router.get(
  '/news',
  asyncHandler(async (req, res) => {
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    const params: unknown[] = [];
    // Материалы, снятые с публикации, на сайте не показываются; сезон
    // фильтруется по параметру (ТЗ 07, п. 2.12).
    let where = 'WHERE n.is_published = TRUE';
    const seasonId = parsePositiveInt(queryString(req.query.season_id));
    if (seasonId !== null) {
      params.push(seasonId);
      where += ` AND (n.season_id = $${params.length} OR n.season_id IS NULL)`;
    }
    if (type === 'news' || type === 'video') {
      params.push(type);
      where += ` AND n.type = $${params.length}`;
    }
    // Постраничность списка новостей (ТЗ 05, п. 1.4): 50 записей по умолчанию,
    // максимум 200, вместе с общим числом публикаций.
    const page = paginationOf(req);
    const result = await query(
      `SELECT n.id, n.slug, n.title, n.type, n.excerpt, n.video_url,
              n.published_at, n.cover_media_id,
              CASE WHEN n.cover_media_id IS NOT NULL
                   THEN '/api/media/file/' || n.cover_media_id::text
                   ELSE NULL END AS cover_url
         FROM news n
         ${where}
        ORDER BY n.published_at DESC NULLS LAST, n.id DESC
        LIMIT ${page.limit} OFFSET ${page.offset}`,
      params
    );
    const counted = await query(`SELECT count(*)::int AS total FROM news n ${where}`, params);
    setListMeta(res, { total: Number(counted.rows[0]?.total ?? 0), page: page.page, perPage: page.perPage });
    res.json(result.rows);
  })
);

// GET /api/news/:slug — отдельная публикация.
router.get(
  '/news/:slug',
  asyncHandler(async (req, res) => {
    const result = await query(
      `SELECT n.id, n.slug, n.title, n.type, n.excerpt, n.body, n.video_url,
              n.published_at, n.cover_media_id,
              CASE WHEN n.cover_media_id IS NOT NULL
                   THEN '/api/media/file/' || n.cover_media_id::text
                   ELSE NULL END AS cover_url
         FROM news n
        WHERE n.slug = $1 AND n.is_published = TRUE
        LIMIT 1`,
      [req.params.slug]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Публикация не найдена' });
      return;
    }
    res.json(result.rows[0]);
  })
);

// GET /api/documents — юридические документы и Положение.
router.get(
  '/documents',
  asyncHandler(async (req, res) => {
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    const params: unknown[] = [];
    let where = 'WHERE d.is_active = TRUE';
    if (type) {
      params.push(type);
      where += ` AND d.type = $${params.length}`;
    }
    const result = await query(
      `SELECT d.id, d.type, d.title, d.version, d.revision_date,
              d.requires_acceptance, d.external_url, d.media_id, d.sort_order,
              CASE WHEN d.media_id IS NOT NULL
                   THEN '/api/media/file/' || d.media_id::text
                   ELSE NULL END AS file_url
         FROM documents d
         ${where}
        ORDER BY d.sort_order, d.type, d.revision_date DESC`,
      params
    );
    res.json(result.rows);
  })
);

// GET /api/documents/:id — карточка одного документа.
router.get(
  '/documents/:id',
  asyncHandler(async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Некорректный идентификатор документа' });
      return;
    }
    const result = await query(
      `SELECT d.id, d.type, d.title, d.version, d.revision_date,
              d.requires_acceptance, d.external_url, d.media_id,
              CASE WHEN d.media_id IS NOT NULL
                   THEN '/api/media/file/' || d.media_id::text
                   ELSE NULL END AS file_url
         FROM documents d
        WHERE d.id = $1 AND d.is_active = TRUE
        LIMIT 1`,
      [id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Документ не найден' });
      return;
    }
    res.json(result.rows[0]);
  })
);

// GET /api/criteria — критерии оценки по этапам (раздел 10 Положения).
// Публичные данные: участник должен видеть, по чему его оценивают.
router.get(
  '/criteria',
  asyncHandler(async (req, res) => {
    const stage = queryString(req.query.stage);
    const params: unknown[] = [];
    const where: string[] = ['is_active'];
    if (stage) {
      params.push(stage);
      where.push(`stage = $${params.length}`);
    }
    const result = await query(
      `SELECT id, stage, code, title, description, max_score, sort_order
         FROM criteria
        WHERE ${where.join(' AND ')}
        ORDER BY stage, sort_order`,
      params
    );
    res.json(result.rows);
  })
);

// ─── Архив законопроектов (ТЗ 02, п. 14; ТЗ 04, п. 10) ───────────────────────
// Публикуются только инициативы с is_published = TRUE — решение Оргкомитета, а
// не следствие подачи заявки. Авторы и файлы отдаются лишь при соответствующих
// согласиях: authors_public (Приложение № 12) и files_public (Приложение № 13).
// Без согласия карточка публикуется обезличенно — «команда» без персональных
// данных. Это проверка на сервере, а не в интерфейсе.

const INITIATIVE_SELECT = `
  SELECT i.id, i.slug, i.title, i.annotation, i.act_level, i.proposed_initiator, i.direction_id,
         i.team_name, i.result_place, i.nomination, i.archive_year,
         i.video_url, i.published_at, i.authors_public, i.files_public,
         d.code AS direction_code, d.title AS direction_title,
         CASE WHEN i.files_public
                   AND (i.law_draft_media_id IS NOT NULL OR i.explanatory_note_media_id IS NOT NULL)
              THEN TRUE ELSE FALSE END AS has_files
    FROM initiatives i
    LEFT JOIN directions d ON d.id = i.direction_id
`;

// GET /api/initiatives — список архива с фильтрами и полнотекстовым поиском.
router.get(
  '/initiatives',
  // Включатель архива (ТЗ 07, п. 2.16).
  asyncHandler(async (req, res, next) => {
    if (await featureEnabled('public_archive')) {
      next();
      return;
    }
    res.json([]);
  }),
  asyncHandler(async (req, res) => {
    const params: unknown[] = [];
    const where: string[] = ['i.is_published'];

    const year = parsePositiveInt(queryString(req.query.year));
    if (year !== null) {
      params.push(year);
      where.push(`i.archive_year = $${params.length}`);
    }
    const directionId = parsePositiveInt(queryString(req.query.direction_id));
    if (directionId !== null) {
      params.push(directionId);
      where.push(`i.direction_id = $${params.length}`);
    }
    const actLevel = queryString(req.query.act_level);
    if (actLevel) {
      params.push(actLevel);
      where.push(`i.act_level = $${params.length}`);
    }
    if (queryString(req.query.has_files) === 'true') {
      where.push(`i.files_public AND (i.law_draft_media_id IS NOT NULL OR i.explanatory_note_media_id IS NOT NULL)`);
    }
    const search = queryString(req.query.q);
    if (search) {
      params.push(search);
      where.push(
        `to_tsvector('russian'::regconfig,
            COALESCE(i.title, '') || ' ' || COALESCE(i.annotation, '') || ' ' || COALESCE(i.team_name, ''))
         @@ plainto_tsquery('russian'::regconfig, $${params.length})`
      );
    }

    // Постраничность архива (ТЗ 05, п. 1.4): сохраняем и прежний `limit`.
    const page = paginationOf(req);
    const result = await query(
      `${INITIATIVE_SELECT} WHERE ${where.join(' AND ')}
        ORDER BY i.archive_year DESC NULLS LAST, i.result_place NULLS LAST, i.sort_order, i.published_at DESC NULLS LAST
        LIMIT ${page.limit} OFFSET ${page.offset}`,
      params
    );
    const counted = await query(
      `SELECT count(*)::int AS total FROM initiatives i WHERE ${where.join(' AND ')}`,
      params
    );
    setListMeta(res, { total: Number(counted.rows[0]?.total ?? 0), page: page.page, perPage: page.perPage });

    res.json(
      result.rows.map((row) => ({
        ...row,
        // Флаги согласий наружу не отдаём: клиенту важно, есть ли данные, а не
        // внутренняя механика их сокрытия.
        authors_public: undefined,
        files_public: undefined,
      }))
    );
  })
);

// GET /api/initiatives/:slug — карточка инициативы.
router.get(
  '/initiatives/:slug',
  asyncHandler(async (req, res) => {
    const slug = String(req.params.slug).slice(0, 200);
    const result = await query(`${INITIATIVE_SELECT} WHERE i.is_published AND i.slug = $1 LIMIT 1`, [slug]);
    const initiative = result.rows[0];
    if (!initiative) {
      res.status(404).json({ error: 'Инициатива не найдена' });
      return;
    }

    // Авторы — только при согласии на распространение (Приложение № 12).
    let authors: Array<Record<string, unknown>> = [];
    if (initiative.authors_public === true) {
      const authorsResult = await query(
        `SELECT full_name, organization, region
           FROM initiative_authors
          WHERE initiative_id = $1 AND is_published
          ORDER BY sort_order, id`,
        [initiative.id]
      );
      authors = authorsResult.rows;
    }

    // Файлы — только при лицензии (Приложение № 13).
    const files: Array<{ kind: string; title: string; url: string }> = [];
    if (initiative.files_public === true) {
      if (initiative.law_draft_media_id) {
        files.push({
          kind: 'law_draft',
          title: 'Текст законопроекта',
          url: `/api/media/file/${initiative.law_draft_media_id}`,
        });
      }
      if (initiative.explanatory_note_media_id) {
        files.push({
          kind: 'explanatory_note',
          title: 'Пояснительная записка',
          url: `/api/media/file/${initiative.explanatory_note_media_id}`,
        });
      }
    }

    const related = await query(
      `SELECT slug, title, archive_year
         FROM initiatives
        WHERE is_published AND id <> $1
          AND direction_id IS NOT DISTINCT FROM $2
        ORDER BY archive_year DESC NULLS LAST, result_place NULLS LAST
        LIMIT 3`,
      [initiative.id, initiative.direction_id ?? null]
    );

    res.json({
      ...initiative,
      authors,
      files,
      related: related.rows,
      authors_public: undefined,
      files_public: undefined,
    });
  })
);

// ─── Победители (ТЗ 08, п. 5) ────────────────────────────────────────────────
// Публикуются только записи с is_published; фото и видео — при согласиях,
// поэтому отдаются ссылками на уже опубликованные файлы (media.is_public).

router.get(
  '/winners',
  asyncHandler(async (req, res) => {
    const params: unknown[] = [];
    const where: string[] = ['w.is_published'];
    const year = parsePositiveInt(queryString(req.query.year));
    if (year !== null) {
      params.push(year);
      where.push(`w.season_year = $${params.length}`);
    }

    const result = await query(
      `SELECT w.id, w.season_year, w.nomination, w.place, w.team_name,
              w.participants_text, w.mentors_text, w.initiative_title,
              w.video_url, w.announcement, w.sort_order,
              CASE WHEN w.photo_media_id IS NOT NULL
                   THEN '/api/media/file/' || w.photo_media_id::text ELSE NULL END AS photo_url
         FROM winners w
        WHERE ${where.join(' AND ')}
        ORDER BY w.season_year DESC, w.nomination, w.place NULLS LAST, w.sort_order`,
      params
    );
    res.json(result.rows);
  })
);

// ─── Редактируемые страницы (ТЗ 08, п. 5) ───────────────────────────────────

router.get(
  '/pages/:slug',
  asyncHandler(async (req, res) => {
    const slug = String(req.params.slug).slice(0, 200);
    const result = await query(
      `SELECT slug, title, type, excerpt, body, seo_title, seo_description
         FROM pages
        WHERE slug = $1 AND is_published
        LIMIT 1`,
      [slug]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Страница не найдена' });
      return;
    }
    res.json(result.rows[0]);
  })
);

export default router;
