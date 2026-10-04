-- 005_access_tokens_log.sql
-- Доступ команды в личный кабинет и журнал входов.
--
-- Токен выдаётся после подачи заявки через Яндекс.Форму. В базе хранится только
-- SHA-256 токена; сам токен показывается команде один раз.

CREATE SCHEMA IF NOT EXISTS liders;

-- ── Токены доступа команды ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS liders.access_tokens (
  id            BIGSERIAL   PRIMARY KEY,
  team_id       INTEGER     NOT NULL REFERENCES liders.teams(id) ON DELETE CASCADE,
  token_hash    TEXT        NOT NULL UNIQUE,
  label         TEXT,
  issued_to_email TEXT,
  -- max_uses = 0 — без ограничения по числу входов (в пределах срока).
  max_uses      INTEGER     NOT NULL DEFAULT 0 CHECK (max_uses >= 0),
  used_count    INTEGER     NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  single_use    BOOLEAN     NOT NULL DEFAULT FALSE,
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ,
  created_by    INTEGER     REFERENCES liders.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS access_tokens_team_idx ON liders.access_tokens (team_id);
CREATE INDEX IF NOT EXISTS access_tokens_active_idx
  ON liders.access_tokens (expires_at) WHERE revoked_at IS NULL;

-- ── Журнал входов в личный кабинет и админку ─────────────────────────────────
CREATE TABLE IF NOT EXISTS liders.access_log (
  id           BIGSERIAL   PRIMARY KEY,
  subject_type TEXT        NOT NULL CHECK (subject_type IN ('team', 'admin')),
  team_id      INTEGER     REFERENCES liders.teams(id) ON DELETE SET NULL,
  user_id      INTEGER     REFERENCES liders.users(id) ON DELETE SET NULL,
  token_id     BIGINT      REFERENCES liders.access_tokens(id) ON DELETE SET NULL,
  event        TEXT        NOT NULL,
  ip           TEXT,
  user_agent   TEXT,
  metadata     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS access_log_team_idx ON liders.access_log (team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS access_log_created_idx ON liders.access_log (created_at DESC);

-- Обращения с сайта могут быть привязаны к команде (связь после дедлайна,
-- когда запись материалов уже запрещена). Таблица команд создаётся позже
-- таблицы обращений, поэтому внешний ключ добавляется здесь.
ALTER TABLE liders.leads
  DROP CONSTRAINT IF EXISTS leads_team_fk;
ALTER TABLE liders.leads
  ADD CONSTRAINT leads_team_fk
  FOREIGN KEY (team_id) REFERENCES liders.teams(id) ON DELETE SET NULL;
