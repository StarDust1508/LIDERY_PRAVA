import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { MAX_FILE_SIZE, MEDIA_PUBLIC_CACHE_SECONDS } from '../config.js';
import { query } from '../db.js';
import { asyncHandler } from '../lib/http.js';
import { hasValidSignature, isAllowedUploadMime, sanitizeFileName } from '../lib/media-content.js';
import { verifyMediaGrant } from '../lib/signed-links.js';
import { requireAdmin, verifyAdminToken } from '../middleware/admin-auth.js';
import { authenticateTeamToken, teamTokenFromRequest } from '../middleware/team-auth.js';

// Медиахранилище: файлы лежат в PostgreSQL (BYTEA). Публично отдаются только
// файлы с is_public = TRUE (Положение, логотипы партнёров). Материалы команд
// доступны исключительно по токену команды, админ-сессии или подписанной ссылке.

const router = Router();

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
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
      'Cache-Control': row.is_public
        ? `public, max-age=${MEDIA_PUBLIC_CACHE_SECONDS}, immutable`
        : 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(row.file_data);
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
