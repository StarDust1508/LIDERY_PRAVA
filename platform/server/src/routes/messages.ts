import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';
import { asyncHandler, parsePositiveInt, queryString } from '../lib/http.js';
import { currentAdmin } from '../middleware/admin-auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { requireTeam, teamContext } from '../middleware/team-auth.js';

// Переписка «Оргкомитет ↔ команда» (ТЗ 06, п. 2.4; ТЗ 07, п. 2.15).
//
// Одна лента на команду: Оргкомитет пишет из карточки команды в админке, команда
// отвечает из раздела «Сообщения» личного кабинета. Здесь два независимых
// роутера, потому что контуры доступа разные:
//   • adminMessagesRouter монтируется под requireAdmin (см. index.ts);
//   • cabinetMessagesRouter сам закрыт requireTeam, как и остальной кабинет.
//
// Отметки прочтения раздельные. Лента отдаёт последние 100 сообщений по
// возрастанию: переписка читается сверху вниз, а старые сообщения за пределами
// сотни не нужны ни одной из сторон.
//
// `unread_*` в ответе — сколько сообщений было непрочитано к моменту запроса
// (то есть до отметки прочтения). Так вызывающая сторона видит, что пропустила,
// даже если сам запрос уже погасил счётчик.
//
// `?peek=1` — служебный режим фонового опроса в кабинете: отдаёт ленту и
// счётчик, но НЕ отмечает сообщения прочитанными. Без него опрос раз в минуту
// гасил бы счётчик и браузерное уведомление было бы невозможно показать.

const MAX_BODY_LENGTH = 5000;

const MESSAGE_COLUMNS = `id, author_role, author_name, body, created_at,
                         read_by_team_at, read_by_admin_at`;

interface MessageRow {
  id: number;
  author_role: 'admin' | 'team' | 'system';
  author_name: string | null;
  body: string;
  created_at: string;
  read_by_team_at: string | null;
  read_by_admin_at: string | null;
}

/** Разбирает текст сообщения: 1–5000 символов после обрезки пробелов. */
function parseBody(req: Request): { body: string } | { error: string } {
  const raw = (req.body ?? {}) as { body?: unknown };
  if (typeof raw.body !== 'string') {
    return { error: 'Введите текст сообщения.' };
  }
  const body = raw.body.trim();
  if (body.length === 0) {
    return { error: 'Введите текст сообщения.' };
  }
  if (body.length > MAX_BODY_LENGTH) {
    return { error: `Сообщение длиннее ${MAX_BODY_LENGTH} символов. Сократите текст.` };
  }
  return { body };
}

function isPeek(req: Request): boolean {
  const value = queryString(req.query.peek);
  return value === '1' || value === 'true';
}

/** Последние 100 сообщений команды по возрастанию времени. */
async function loadMessages(teamId: number): Promise<MessageRow[]> {
  const result = await query(
    `SELECT ${MESSAGE_COLUMNS}
       FROM (
         SELECT ${MESSAGE_COLUMNS}
           FROM team_messages
          WHERE team_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT 100
       ) recent
      ORDER BY created_at ASC, id ASC`,
    [teamId]
  );
  return result.rows as MessageRow[];
}

async function teamExists(teamId: number): Promise<boolean> {
  const result = await query('SELECT 1 FROM teams WHERE id = $1 LIMIT 1', [teamId]);
  return result.rows.length > 0;
}

// ─── Админский контур ────────────────────────────────────────────────────────

export const adminMessagesRouter = Router();

// GET /api/admin/teams/:id/messages — лента команды для карточки в админке.
adminMessagesRouter.get(
  '/teams/:id/messages',
  asyncHandler(async (req: Request, res: Response) => {
    const teamId = parsePositiveInt(req.params.id);
    if (teamId === null) {
      res.status(400).json({ error: 'Некорректный идентификатор команды' });
      return;
    }
    if (!(await teamExists(teamId))) {
      res.status(404).json({ error: 'Команда не найдена' });
      return;
    }

    const items = await loadMessages(teamId);
    const unread = await query(
      `SELECT count(*)::int AS count
         FROM team_messages
        WHERE team_id = $1 AND author_role = 'team' AND read_by_admin_at IS NULL`,
      [teamId]
    );

    if (!isPeek(req)) {
      await query(
        `UPDATE team_messages
            SET read_by_admin_at = now()
          WHERE team_id = $1 AND author_role = 'team' AND read_by_admin_at IS NULL`,
        [teamId]
      );
    }

    res.json({ items, unread_for_admin: Number(unread.rows[0]?.count ?? 0) });
  })
);

// POST /api/admin/teams/:id/messages — сообщение команде от Оргкомитета.
adminMessagesRouter.post(
  '/teams/:id/messages',
  rateLimit(60, 60_000),
  asyncHandler(async (req: Request, res: Response) => {
    const teamId = parsePositiveInt(req.params.id);
    if (teamId === null) {
      res.status(400).json({ error: 'Некорректный идентификатор команды' });
      return;
    }
    const parsed = parseBody(req);
    if ('error' in parsed) {
      res.status(422).json({ error: parsed.error });
      return;
    }
    if (!(await teamExists(teamId))) {
      res.status(404).json({ error: 'Команда не найдена' });
      return;
    }

    // Автор сообщения — тот, кто вошёл в панель: почта учётной записи, а для
    // входа по паролю из окружения подписи «Оргкомитет» достаточно.
    const admin = currentAdmin(res);
    const authorName = admin?.email ?? admin?.fullName ?? 'Оргкомитет';

    const result = await query(
      `INSERT INTO team_messages (team_id, application_id, author_role, author_name, body)
       VALUES (
         $1,
         (SELECT id FROM applications WHERE team_id = $1 ORDER BY id DESC LIMIT 1),
         'admin',
         $2,
         $3
       )
       RETURNING ${MESSAGE_COLUMNS}`,
      [teamId, authorName, parsed.body]
    );

    res.status(201).json(result.rows[0]);
  })
);

// ─── Контур команды ─────────────────────────────────────────────────────────

export const cabinetMessagesRouter = Router();
cabinetMessagesRouter.use(requireTeam);

// GET /api/cabinet/messages — лента команды и счётчик непрочитанного.
cabinetMessagesRouter.get(
  '/messages',
  asyncHandler(async (_req: Request, res: Response) => {
    const context = teamContext(res);
    const items = await loadMessages(context.teamId);
    const unread = await query(
      `SELECT count(*)::int AS count
         FROM team_messages
        WHERE team_id = $1 AND author_role = 'admin' AND read_by_team_at IS NULL`,
      [context.teamId]
    );

    if (!isPeek(_req)) {
      await query(
        `UPDATE team_messages
            SET read_by_team_at = now()
          WHERE team_id = $1 AND author_role = 'admin' AND read_by_team_at IS NULL`,
        [context.teamId]
      );
    }

    res.json({ items, unread_for_team: Number(unread.rows[0]?.count ?? 0) });
  })
);

// POST /api/cabinet/messages — ответ команды Оргкомитету.
cabinetMessagesRouter.post(
  '/messages',
  rateLimit(30, 60_000),
  asyncHandler(async (req: Request, res: Response) => {
    const context = teamContext(res);
    const parsed = parseBody(req);
    if ('error' in parsed) {
      res.status(422).json({ error: parsed.error });
      return;
    }

    // Подпись команды — номер заявки, если заявка уже есть, иначе название
    // команды: Оргкомитет должен понимать, от кого пришло сообщение, не открывая
    // соседнюю карточку.
    const application = await query(
      `SELECT id, public_number FROM applications WHERE team_id = $1 ORDER BY id DESC LIMIT 1`,
      [context.teamId]
    );
    const applicationRow = application.rows[0] as { id: number; public_number: string | null } | undefined;
    const authorName = applicationRow?.public_number ?? context.teamName;

    const result = await query(
      `INSERT INTO team_messages (team_id, application_id, author_role, author_name, body)
       VALUES ($1, $2, 'team', $3, $4)
       RETURNING ${MESSAGE_COLUMNS}`,
      [context.teamId, applicationRow?.id ?? null, authorName, parsed.body]
    );

    res.status(201).json(result.rows[0]);
  })
);
