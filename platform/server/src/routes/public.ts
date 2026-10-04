import { Router } from 'express';
import { PUBLIC_BASE_URL } from '../config.js';
import { query } from '../db.js';
import { asyncHandler, parsePositiveInt } from '../lib/http.js';
import { isDeadlinePassed } from '../lib/moscow-time.js';

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
      `SELECT key, value FROM site_settings WHERE key LIKE 'site.%' ORDER BY key`
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
        appeal_window_days: season.appeal_window_days,
        timezone: season.timezone,
        description: season.description,
        is_application_open: !isDeadlinePassed(season.application_close_at),
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
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const params: unknown[] = [];
    let where = '';
    if (status === 'announced' || status === 'past') {
      params.push(status);
      where = 'WHERE m.status = $1';
    }
    const result = await query(
      `SELECT m.id, m.season_id, m.title, m.speaker, m.speaker_info, m.description,
              m.status, m.starts_at, m.place, m.recording_url, m.media_id, m.sort_order
         FROM masterclasses m
         ${where}
        ORDER BY m.starts_at DESC NULLS LAST, m.sort_order`,
      params
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
    let where = 'WHERE n.is_published = TRUE';
    if (type === 'news' || type === 'video') {
      params.push(type);
      where += ` AND n.type = $${params.length}`;
    }
    const result = await query(
      `SELECT n.id, n.slug, n.title, n.type, n.excerpt, n.video_url,
              n.published_at, n.cover_media_id,
              CASE WHEN n.cover_media_id IS NOT NULL
                   THEN '/api/media/file/' || n.cover_media_id::text
                   ELSE NULL END AS cover_url
         FROM news n
         ${where}
        ORDER BY n.published_at DESC NULLS LAST, n.id DESC
        LIMIT 100`,
      params
    );
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

export default router;
