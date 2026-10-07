-- 035_expert_access.sql
-- Доступ эксперта к внесению оценок (ТЗ 07, п. 2.5).
--
-- Требование: «Возможность выдать доступ эксперта к внесению оценок (логин или
-- разовая ссылка) и отозвать его».
--
-- Выбрана разовая ссылка: у эксперта нет учётной записи в админке, а заводить
-- её ради одной оценки неудобно и расширяет контур доступа. Ссылка привязана к
-- конкретному эксперту и этапу, живёт ограниченное время и отзывается одним
-- действием. В базе хранится только SHA-256 токена.

CREATE TABLE IF NOT EXISTS liders.expert_access_tokens (
  id           SERIAL      PRIMARY KEY,
  expert_id    INTEGER     NOT NULL REFERENCES liders.experts(id) ON DELETE CASCADE,
  token_hash   TEXT        NOT NULL UNIQUE,
  label        TEXT,
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  used_count   INTEGER     NOT NULL DEFAULT 0,
  created_by   INTEGER     REFERENCES liders.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS expert_access_tokens_expert_idx
  ON liders.expert_access_tokens (expert_id, revoked_at, expires_at);

COMMENT ON TABLE liders.expert_access_tokens IS
  'Разовая ссылка эксперта на внесение оценок: хранится только хэш токена (ТЗ 07, п. 2.5).';

-- Журнал обращений эксперта: кто и когда вносил оценки через ссылку.
CREATE TABLE IF NOT EXISTS liders.expert_access_log (
  id         BIGSERIAL   PRIMARY KEY,
  expert_id  INTEGER     NOT NULL REFERENCES liders.experts(id) ON DELETE CASCADE,
  event      TEXT        NOT NULL,
  team_id    INTEGER     REFERENCES liders.teams(id) ON DELETE SET NULL,
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS expert_access_log_expert_idx
  ON liders.expert_access_log (expert_id, created_at DESC);
