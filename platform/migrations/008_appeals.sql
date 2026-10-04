-- 008_appeals.sql
-- Апелляции участников (раздел 12 Положения).
--
-- Апелляция подаётся капитаном в течение 2 рабочих дней с момента опубликования
-- протокола этапа. Обжалуются итоги отборочного и первого этапов; решения
-- финального этапа пересмотру не подлежат (п. 9.6, 12.3).

CREATE SCHEMA IF NOT EXISTS liders;

CREATE TABLE IF NOT EXISTS liders.appeals (
  id           BIGSERIAL   PRIMARY KEY,
  season_id    INTEGER     NOT NULL REFERENCES liders.seasons(id) ON DELETE CASCADE,
  team_id      INTEGER     NOT NULL REFERENCES liders.teams(id) ON DELETE CASCADE,
  stage        TEXT        NOT NULL CHECK (stage IN ('selection', 'stage1')),
  -- Предмет апелляции (п. 12.2).
  grounds      TEXT        CHECK (grounds IN (
                             'procedure_violation', 'wrongful_rejection',
                             'counting_error', 'criteria_misapplication', 'other'
                           )),
  text         TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'submitted'
                           CHECK (status IN (
                             'submitted', 'in_review', 'granted',
                             'partially_granted', 'rejected', 'withdrawn'
                           )),
  decision     TEXT,
  decision_note TEXT,
  -- Протокол апелляционной комиссии (п. 12.4).
  protocol_url TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deadline_at  TIMESTAMPTZ NOT NULL,
  reviewed_at  TIMESTAMPTZ,
  reviewed_by  INTEGER     REFERENCES liders.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS appeals_team_idx ON liders.appeals (team_id, stage);
CREATE INDEX IF NOT EXISTS appeals_status_idx ON liders.appeals (status, created_at DESC);
