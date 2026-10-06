import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { MAX_FILE_SIZE, MEDIA_GRANT_TTL_SECONDS, MEDIA_PUBLIC_CACHE_SECONDS, PUBLIC_BASE_URL } from '../config.js';
import { query } from '../db.js';
import { asyncHandler } from '../lib/http.js';
import {
  checkUploadExtension,
  hasValidSignature,
  isAllowedUploadMime,
  sanitizeFileName,
} from '../lib/media-content.js';
import { writeAudit } from '../lib/audit.js';
import { signMediaGrant, verifyMediaGrant } from '../lib/signed-links.js';
import { requireAdmin, verifyAdminToken } from '../middleware/admin-auth.js';
import { authenticateTeamToken, teamTokenFromRequest } from '../middleware/team-auth.js';
import { TEAM_SESSION_COOKIE, readCookie, verifyTeamSession } from '../lib/team-session.js';

// Медиахранилище: файлы лежат в PostgreSQL (BYTEA). Публично отдаются только
// файлы с is_public = TRUE (Положение, логотипы партнёров). Материалы команд
// доступны исключительно по токену команды, админ-сессии или подписанной ссылке.

const router = Router();

const store = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    // Сначала расширение имени, затем заявленный тип (ТЗ 11, п. 4.1, 4.5).
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
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('UNSUPPORTED_FILE_EXTENSION:')) {
      res.status(415).json({ error: message.replace('UNSUPPORTED_FILE_EXTENSION:', '').trim() });
      return;
    }
    res.status(415).json({ error: 'Недопустимый тип файла' });
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Проверяет, имеет ли команда доступ к файлу: только если файл приложен
 * к материалам её заявки.
 */
async function teamOwnsMedia(teamId: number, mediaId: string): Promise<boolean> {
  const result = await query(
    'SELECT 1 FROM application_materials WHERE team_id = $1 AND media_id = $2 LIMIT 1',
    [teamId, mediaId]
  );
  return result.rows.length > 0;
}

// GET /api/media/file/:id — отдача файла.
router.get(
  '/media/file/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) {
      res.status(404).json({ error: 'Файл не найден' });
      return;
    }

    const result = await query(
      'SELECT id, file_name, file_type, file_data, is_public FROM media WHERE id = $1',
      [id]
    );
    const row = result.rows[0];
    if (!row || !row.file_data) {
      res.status(404).json({ error: 'Файл не найден' });
      return;
    }

    let granted = Boolean(row.is_public);

    if (!granted) {
      // 1. Админ-сессия (любая из ролей: обе работают с материалами заявок).
      if (await verifyAdminToken(req)) {
        granted = true;
      }
      // 2. Токен команды, которой принадлежит материал.
      if (!granted) {
        const team = await authenticateTeamToken(teamTokenFromRequest(req));
        if (team && (await teamOwnsMedia(team.teamId, id))) {
          granted = true;
        }
      }
      // 2а. Сессия кабинета (cookie). Без этой проверки участник, вошедший по
      // ссылке доступа, не мог скачать собственный материал: файл отдавался
      // только по заголовку с токеном, которого у браузера нет (ТЗ 06, п. 7.5).
      if (!granted) {
        const session = verifyTeamSession(readCookie(req, TEAM_SESSION_COOKIE));
        if (session && (await teamOwnsMedia(session.teamId, id))) {
          granted = true;
        }
      }
      // 3. Краткосрочная подписанная ссылка на конкретный файл.
      if (!granted) {
        const grantToken = typeof req.query.grant === 'string' ? req.query.grant : undefined;
        granted = verifyMediaGrant(grantToken, id) !== null;
      }
    }

    if (!granted) {
      // Для приватных файлов отвечаем 404: так нельзя перебором выяснить,
      // существует ли материал другой команды.
      res.status(404).json({ error: 'Файл не найден или недоступен' });
      return;
    }

    res.set({
      'Content-Type': row.file_type || 'application/octet-stream',
      // Приватные материалы отдаются вложением: браузер не открывает их
      // содержимым страницы (ТЗ 11, п. 4.6). Публичные документы сайта —
      // inline, чтобы PDF Положения открывался для чтения прямо в браузере.
      'Content-Disposition': `${row.is_public ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
      'Cache-Control': row.is_public
        ? `public, max-age=${MEDIA_PUBLIC_CACHE_SECONDS}, immutable`
        : 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(row.file_data);
  })
);

/**
 * POST /api/admin/media/:id/link — краткосрочная ссылка на приватный файл.
 *
 * Нужна, чтобы передать скан согласия, апелляции или материал коллеге из
 * Оргкомитета, не выдавая ему админ-сессию: ссылка живёт минуты и привязана к
 * конкретному файлу (ТЗ 11, п. 24). Вот почему модуль подписанных ссылок вообще
 * существует — раньше выдавать такие ссылки было нечем.
 */
router.post(
  '/admin/media/:id/link',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) {
      res.status(404).json({ error: 'Файл не найден' });
      return;
    }

    const found = await query('SELECT id, file_name, is_public FROM media WHERE id = $1', [id]);
    const row = found.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Файл не найден' });
      return;
    }

    // Срок ограничен сверху сутками: ссылка на приватный материал не должна
    // становиться постоянным адресом.
    const requested = Number(req.body?.ttl_seconds);
    const ttl = Number.isFinite(requested) && requested > 0
      ? Math.min(Math.max(Math.trunc(requested), 60), 86_400)
      : MEDIA_GRANT_TTL_SECONDS;

    const grant = signMediaGrant(id, null, ttl);
    const path = `/api/media/file/${id}?grant=${encodeURIComponent(grant.token)}`;
    const url = `${PUBLIC_BASE_URL}${path}`;

    await writeAudit({
      action: 'media_grant_link',
      entity: 'media',
      entityId: id,
      after: { expires_at: grant.expiresAt, expires_in: grant.expiresIn, file_name: row.file_name },
      req,
    });

    res.status(201).json({
      url,
      // Относительный путь нужен тому же интерфейсу и тестам: абсолютный адрес
      // собирается из PUBLIC_BASE_URL и в локальной среде ведёт на боевой домен.
      path,
      token: grant.token,
      expires_at: grant.expiresAt,
      expires_in: grant.expiresIn,
      file_name: row.file_name,
    });
  })
);

// GET /api/admin/media — метаданные файлов (без бинарных данных).
router.get(
  '/admin/media',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const params: unknown[] = [];
    let where = '';
    if (typeof req.query.category === 'string' && req.query.category !== '') {
      params.push(req.query.category);
      where = `WHERE category = $${params.length}`;
    }
    const result = await query(
      `SELECT id, file_name, file_url, file_type, file_size, is_public, category, sha256, created_at
         FROM media
         ${where}
        ORDER BY created_at DESC
        LIMIT 500`,
      params
    );
    res.json(result.rows);
  })
);

// POST /api/admin/media — загрузка файла администратором.
router.post(
  '/admin/media',
  requireAdmin,
  uploadSingle,
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Файл не передан' });
      return;
    }
    if (!hasValidSignature(file)) {
      res.status(415).json({ error: 'Содержимое файла не соответствует заявленному типу' });
      return;
    }

    const isPublic = req.body?.is_public === true || req.body?.is_public === 'true' || req.body?.is_public === '1';
    const category = typeof req.body?.category === 'string' && req.body.category !== ''
      ? req.body.category.slice(0, 64)
      : 'document';

    const result = await query(
      `INSERT INTO media (file_name, file_url, file_type, file_size, file_data, is_public, category)
       VALUES ($1, '', $2, $3, $4, $5, $6)
       RETURNING id`,
      [sanitizeFileName(file.originalname), file.mimetype, file.size, file.buffer, isPublic, category]
    );

    const id = String(result.rows[0].id);
    const fileUrl = `/api/media/file/${id}`;
    await query('UPDATE media SET file_url = $1 WHERE id = $2', [fileUrl, id]);

    res.status(201).json({
      id,
      file_name: file.originalname,
      file_url: fileUrl,
      file_type: file.mimetype,
      file_size: file.size,
      is_public: isPublic,
      category,
    });
  })
);

// DELETE /api/admin/media/:id — удаление файла.
router.delete(
  '/admin/media/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) {
      res.status(404).json({ error: 'Файл не найден' });
      return;
    }
    const blocked = await query('SELECT 1 FROM application_materials WHERE media_id = $1 LIMIT 1', [id]);
    if (blocked.rows.length > 0) {
      res.status(409).json({
        error: 'Файл приложен к материалам заявки. Сначала удалите или замените материал.',
      });
      return;
    }
    const result = await query('DELETE FROM media WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Файл не найден' });
      return;
    }
    res.json({ success: true });
  })
);

export default router;
