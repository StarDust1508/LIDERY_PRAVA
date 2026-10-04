import { Router } from 'express';
import { query } from '../db.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { clientIpOf } from '../middleware/admin-auth.js';
import { asyncHandler } from '../lib/http.js';
import { isEmail, normalizeEmail, optionalText, requiredText } from '../lib/validation.js';

// Публичный приём обращений с сайта: вопрос оргкомитету, связь после дедлайна
// подачи материалов, сообщение о проблеме с доступом.

const router = Router();

// POST /api/leads — 10 обращений в минуту с одного IP.
router.post(
  '/leads',
  rateLimit(10, 60_000),
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};

    const name = requiredText(body.name, 200);
    const email = isEmail(body.email) ? normalizeEmail(body.email) : null;
    const message = requiredText(body.message, 5000);
    const phone = optionalText(body.phone, 32);
    const topic = optionalText(body.topic, 200);

    if (!name || !email || !message) {
      res.status(400).json({
        error: 'Укажите имя, корректный e-mail и текст обращения',
      });
      return;
    }
    if (body.consent_pdn !== true) {
      res.status(400).json({
        error: 'Для обработки обращения необходимо согласие на обработку персональных данных',
      });
      return;
    }
    if (body.website || body.honeypot) {
      // Скрытое поле-ловушка: заполнено только автоматическими отправителями.
      res.status(202).json({ success: true });
      return;
    }

    const result = await query(
      `INSERT INTO leads (name, email, phone, topic, message, source, consent_pdn, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8)
       RETURNING id, created_at`,
      [
        name,
        email,
        phone,
        topic,
        message,
        optionalText(body.source, 64) ?? 'site',
        clientIpOf(req),
        String(req.headers['user-agent'] || '').slice(0, 500),
      ]
    );

    res.status(201).json({
      success: true,
      lead_id: result.rows[0].id,
      created_at: result.rows[0].created_at,
    });
  })
);

export default router;
