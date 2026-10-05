import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { API_HOST, API_PORT, CORS_ORIGINS, DATABASE_SCHEMA, IS_PRODUCTION, NODE_ENV } from './config.js';
import pool, { testConnection } from './db.js';
import { requireAdmin } from './middleware/admin-auth.js';
import { auditAdminMutations } from './middleware/admin-audit.js';
import { securityHeaders } from './middleware/security-headers.js';
import adminRouter from './routes/admin.js';
import applicationsRouter from './routes/applications.js';
import authAdminRouter from './routes/auth-admin.js';
import cabinetAccessRouter from './routes/cabinet-access.js';
import cabinetRouter from './routes/cabinet.js';
import leadsRouter from './routes/leads.js';
import mediaRouter from './routes/media.js';
import publicRouter from './routes/public.js';

// Единственная точка входа API. Фоновых заданий здесь нет: всё, что должно
// происходить по расписанию, запускается отдельными процессами (cron/systemd),
// чтобы рестарт API не зависел от состояния задач.

const app = express();

app.disable('x-powered-by');
// За nginx: req.ip должен содержать реальный адрес клиента (важно для
// rate-limit и журналов входов).
app.set('trust proxy', 1);

app.use(securityHeaders);
app.use(
  cors({
    origin: CORS_ORIGINS,
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));

// Админка и личный кабинет не кэшируются и не индексируются.
app.use(['/api/admin', '/api/cabinet'], (_req: Request, res: Response, next: NextFunction) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});

// GET /api/health — проверка живости и доступности БД.
app.get('/api/health', async (_req: Request, res: Response) => {
  const databaseUp = await testConnection();
  res.status(databaseUp ? 200 : 503).json({
    status: databaseUp ? 'ok' : 'degraded',
    database: databaseUp ? 'up' : 'down',
    schema: DATABASE_SCHEMA,
    environment: NODE_ENV,
    time: new Date().toISOString(),
  });
});

// Публичные данные, обращения, файлы, приём заявок и личный кабинет.
app.use('/api', publicRouter);
app.use('/api', leadsRouter);
app.use('/api', mediaRouter);
// Приём заявок с формы сайта (/apply) — единственный канал подачи.
app.use('/api', applicationsRouter);
// Вход в кабинет монтируется ДО cabinetRouter: сам кабинет целиком закрыт
// requireTeam, а экран входа должен работать без сессии.
app.use('/api/cabinet', cabinetAccessRouter);
app.use('/api/cabinet', cabinetRouter);

// Вход/выход администратора — без requireAdmin; остальные админские маршруты
// закрыты middleware целиком. Изменяющие запросы автоматически попадают в
// журнал действий (ТЗ 03, п. 5.6; ТЗ 07, п. 2.16–2.17).
app.use('/api/admin', authAdminRouter);
app.use('/api/admin', requireAdmin, auditAdminMutations, adminRouter);

// Неизвестный маршрут.
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Маршрут не найден' });
});

// Единый обработчик ошибок: клиенту уходит понятное сообщение, в лог — детали.
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = (error as { status?: number; statusCode?: number }).status
    ?? (error as { statusCode?: number }).statusCode
    ?? 500;

  // Некорректный JSON от express.json().
  if (error instanceof SyntaxError && status === 400) {
    res.status(400).json({ error: 'Некорректный JSON в теле запроса' });
    return;
  }

  if (status >= 500) {
    console.error('Необработанная ошибка API:', error);
    if (IS_PRODUCTION) {
      res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    } else {
      res.status(500).json({ error: 'Внутренняя ошибка сервера', details: (error as Error).message });
    }
    return;
  }

  res.status(status).json({ error: (error as Error).message || 'Ошибка запроса' });
});

const server = app.listen(API_PORT, API_HOST, () => {
  console.log(`API «Лидеры права» слушает http://${API_HOST}:${API_PORT} (${NODE_ENV})`);
});

// Аккуратное завершение: перестаём принимать соединения и закрываем пул БД.
async function shutdown(signal: string): Promise<void> {
  console.log(`Получен ${signal}, останавливаем сервер…`);
  server.close(async () => {
    await pool.end().catch(() => undefined);
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

export default app;
