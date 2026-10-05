-- 026_admin_roles_and_sessions.sql
-- Роли админ-панели, управление пользователями и учёт активности сессий.
--
-- Требования: ТЗ 07, п. 1.2 (сессия 12 часов, выход при бездействии 60 минут),
-- п. 1.3 (роли `admin` и `operator`), п. 2.17 (`/admin/users` — создание, смена
-- роли, блокировка, сброс пароля), ТЗ 11, п. 45 (bcrypt, cost ≥ 12).
--
-- Таблица `users` уже содержала роли (`001_core.sql`), но код пускал в админку
-- только роль `admin`: роль `operator` была объявлена и не работала. Здесь
-- добавляется всё, чего не хватало для управления учётными записями, и таблица
-- активности сессий.
--
-- Зачем отдельная таблица активности, если токен подписан и stateless:
-- бездействие нельзя проверить по подписи — в токене нет отметки последнего
-- обращения. Токен по-прежнему не хранится (в таблице только SHA-256), поэтому
-- утечка базы не даёт возможности войти.

CREATE SCHEMA IF NOT EXISTS liders;

-- ── Учётные записи администраторов и операторов ──────────────────────────────

-- Кто завёл запись: нужно, чтобы разобрать инцидент доступа, когда автор
-- действия уже уволен и запись заблокирована.
ALTER TABLE liders.users
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES liders.users(id) ON DELETE SET NULL;
ALTER TABLE liders.users
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
-- Блокировка не удаляет запись: заявки и журнал ссылаются на автора действий.
ALTER TABLE liders.users
  ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;
ALTER TABLE liders.users
  ADD COLUMN IF NOT EXISTS blocked_reason TEXT;
-- Пароль, выданный администратором, помечается временным: при первом входе
-- система просит заменить его (ТЗ 11, п. 45 — общие пароли запрещены).
ALTER TABLE liders.users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS users_role_active_idx ON liders.users (role, is_active);

-- ── Активность админ-сессий (ТЗ 07, п. 1.2) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS liders.admin_session_activity (
  -- SHA-256 токена: сам токен не сохраняется.
  token_hash   TEXT        PRIMARY KEY,
  -- NULL для сессии владельца по паролю из окружения.
  user_id      INTEGER     REFERENCES liders.users(id) ON DELETE CASCADE,
  principal    TEXT        NOT NULL,
  role         TEXT        NOT NULL CHECK (role IN ('admin', 'operator')),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Совпадает с exp токена: строки не живут дольше самой сессии.
  expires_at   TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS admin_session_activity_seen_idx
  ON liders.admin_session_activity (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS admin_session_activity_user_idx
  ON liders.admin_session_activity (user_id);
CREATE INDEX IF NOT EXISTS admin_session_activity_expires_idx
  ON liders.admin_session_activity (expires_at);
