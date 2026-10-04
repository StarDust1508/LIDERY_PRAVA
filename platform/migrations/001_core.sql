-- 001_core.sql
-- Ядро платформы конкурса «Лидеры права»: служебные пользователи, медиахранилище
-- (BYTEA), журнал аутентификации, CMS-настройки и обращения с сайта.
--
-- Все объекты создаются явно в единственной схеме проекта — liders.
-- Второй схемы в базе нет: search_path выставляется в server/src/db.ts.

CREATE SCHEMA IF NOT EXISTS liders;

-- ── Служебные пользователи (администраторы и операторы оргкомитета) ──────────
-- Публичной регистрации нет: участники работают по токену доступа команды,
-- а записи в этой таблице заводит администратор.
CREATE TABLE IF NOT EXISTS liders.users (
  id            SERIAL PRIMARY KEY,
  email         TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  role          TEXT        NOT NULL DEFAULT 'operator'
                            CHECK (role IN ('admin', 'operator')),
  full_name     TEXT,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  -- Смена пароля увеличивает версию и мгновенно гасит выданные сессии.
  auth_version  INTEGER     NOT NULL DEFAULT 1,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Медиахранилище: файлы лежат в БД (BYTEA) ─────────────────────────────────
-- Из таблицы читаются две проекции: метаданные (списки) и file_data (отдача).
CREATE TABLE IF NOT EXISTS liders.media (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name   TEXT        NOT NULL,
  file_url    TEXT        NOT NULL DEFAULT '',
  file_type   TEXT        NOT NULL,
  file_size   BIGINT      NOT NULL CHECK (file_size >= 0),
  file_data   BYTEA       NOT NULL,
  -- Публичные файлы (Положение, логотипы партнёров) отдаются без авторизации.
  is_public   BOOLEAN     NOT NULL DEFAULT FALSE,
  category    TEXT        NOT NULL DEFAULT 'document',
  sha256      TEXT,
  uploaded_by INTEGER     REFERENCES liders.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS media_created_at_idx ON liders.media (created_at DESC);
CREATE INDEX IF NOT EXISTS media_visibility_idx ON liders.media (is_public, category);

-- ── Отзыв админ-сессий ───────────────────────────────────────────────────────
-- Хранится только SHA-256 токена: logout реально отзывает сессию и после
-- перезапуска процесса, не сохраняя bearer-токен.
CREATE TABLE IF NOT EXISTS liders.admin_session_revocations (
  token_hash TEXT        PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_session_revocations_expires_idx
  ON liders.admin_session_revocations (expires_at);

-- ── Журнал аутентификации ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS liders.auth_log (
  id         BIGSERIAL   PRIMARY KEY,
  event      TEXT        NOT NULL,
  email      TEXT,
  user_id    INTEGER     REFERENCES liders.users(id) ON DELETE SET NULL,
  ip         TEXT,
  user_agent TEXT,
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_log_created_at_idx ON liders.auth_log (created_at DESC);
CREATE INDEX IF NOT EXISTS auth_log_event_idx ON liders.auth_log (event, created_at DESC);

-- ── Настройки сайта: ключ → JSONB + история ревизий ──────────────────────────
CREATE TABLE IF NOT EXISTS liders.site_settings (
  key         TEXT        PRIMARY KEY,
  value       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  description TEXT,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS liders.site_settings_revisions (
  id         BIGSERIAL   PRIMARY KEY,
  key        TEXT        NOT NULL,
  value      JSONB       NOT NULL,
  actor      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS site_settings_revisions_key_idx
  ON liders.site_settings_revisions (key, created_at DESC);

-- ── Обращения на сайте (связь с организаторами) ──────────────────────────────
CREATE TABLE IF NOT EXISTS liders.leads (
  id            BIGSERIAL   PRIMARY KEY,
  name          TEXT        NOT NULL,
  email         TEXT        NOT NULL,
  phone         TEXT,
  topic         TEXT,
  message       TEXT        NOT NULL,
  source        TEXT        NOT NULL DEFAULT 'site',
  status        TEXT        NOT NULL DEFAULT 'new'
                            CHECK (status IN ('new', 'in_progress', 'answered', 'closed', 'spam')),
  consent_pdn   BOOLEAN     NOT NULL DEFAULT FALSE,
  team_id       INTEGER,
  ip            TEXT,
  user_agent    TEXT,
  admin_comment TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leads_status_idx ON liders.leads (status, created_at DESC);
CREATE INDEX IF NOT EXISTS leads_created_at_idx ON liders.leads (created_at DESC);
