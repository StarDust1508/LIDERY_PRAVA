-- 003_teams_participants_mentors.sql
-- Команда, её участники и наставники.
--
-- Нормативные основания: п. 4.1 (категории и возраст), п. 4.3 (2–4 человека),
-- п. 4.4 (один участник — одна команда), п. 4.8 (согласие законного
-- представителя), п. 4.9 (не более двух наставников).

CREATE SCHEMA IF NOT EXISTS liders;

-- ── Команда ──────────────────────────────────────────────────────────────────
-- Статус — единая шкала жизненного цикла от черновика до победителя.
CREATE TABLE IF NOT EXISTS liders.teams (
  id                    SERIAL      PRIMARY KEY,
  season_id             INTEGER     NOT NULL REFERENCES liders.seasons(id) ON DELETE RESTRICT,
  direction_id          INTEGER     REFERENCES liders.directions(id) ON DELETE SET NULL,
  name                  TEXT        NOT NULL,
  organization          TEXT,
  city                  TEXT,
  -- Капитан появится после создания участников: FK добавляется ниже.
  captain_participant_id INTEGER,
  status                TEXT        NOT NULL DEFAULT 'draft'
                                    CHECK (status IN (
                                      'draft', 'submitted', 'tech_check', 'tech_rejected',
                                      'allowed', 'stage1', 'finalist', 'final', 'winner',
                                      'disqualified', 'withdrawn'
                                    )),
  status_changed_at     TIMESTAMPTZ,
  disqualification_reason TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (season_id, name)
);

CREATE INDEX IF NOT EXISTS teams_season_status_idx ON liders.teams (season_id, status);
CREATE INDEX IF NOT EXISTS teams_direction_idx ON liders.teams (direction_id);

-- ── Участники ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS liders.participants (
  id                SERIAL      PRIMARY KEY,
  season_id         INTEGER     NOT NULL REFERENCES liders.seasons(id) ON DELETE CASCADE,
  team_id           INTEGER     NOT NULL REFERENCES liders.teams(id) ON DELETE CASCADE,
  full_name         TEXT        NOT NULL,
  birth_date        DATE        NOT NULL,
  -- Категории из п. 4.1 Положения.
  category          TEXT        NOT NULL
                                CHECK (category IN (
                                  'student', 'magistrant', 'aspirant',
                                  'young_specialist', 'mo_leader'
                                )),
  organization      TEXT,
  position          TEXT,
  education         TEXT,
  email             TEXT        NOT NULL,
  phone             TEXT,
  role              TEXT        NOT NULL DEFAULT 'member' CHECK (role IN ('captain', 'member')),
  -- Согласия (п. 7.2, 14.3): обработка ПДн, распространение ПДн,
  -- для несовершеннолетних — согласие законного представителя.
  consent_pdn                   BOOLEAN     NOT NULL DEFAULT FALSE,
  consent_distribution          BOOLEAN     NOT NULL DEFAULT FALSE,
  consent_legal_representative  BOOLEAN     NOT NULL DEFAULT FALSE,
  is_minor                      BOOLEAN     NOT NULL DEFAULT FALSE,
  consent_received              BOOLEAN     NOT NULL DEFAULT FALSE,
  consent_received_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Пункт 4.4: участник входит только в одну команду в рамках сезона.
CREATE UNIQUE INDEX IF NOT EXISTS participants_season_email_idx
  ON liders.participants (season_id, lower(email));

-- В команде ровно один капитан.
CREATE UNIQUE INDEX IF NOT EXISTS participants_one_captain_idx
  ON liders.participants (team_id) WHERE role = 'captain';

CREATE INDEX IF NOT EXISTS participants_team_idx ON liders.participants (team_id);

-- Капитан команды — участник этой же команды (совпадение team_id проверяет API).
ALTER TABLE liders.teams
  DROP CONSTRAINT IF EXISTS teams_captain_participant_fk;
ALTER TABLE liders.teams
  ADD CONSTRAINT teams_captain_participant_fk
  FOREIGN KEY (captain_participant_id) REFERENCES liders.participants(id) ON DELETE SET NULL;

-- ── Наставники ───────────────────────────────────────────────────────────────
-- Пункт 4.9: не более двух наставников на команду — ограничение проверяется
-- на уровне API, потому что это правило предметной области, а не целостности.
CREATE TABLE IF NOT EXISTS liders.mentors (
  id               SERIAL      PRIMARY KEY,
  team_id          INTEGER     NOT NULL REFERENCES liders.teams(id) ON DELETE CASCADE,
  full_name        TEXT        NOT NULL,
  organization     TEXT,
  position         TEXT,
  degree           TEXT,
  email            TEXT,
  phone            TEXT,
  consent_pdn      BOOLEAN     NOT NULL DEFAULT FALSE,
  consent_received BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mentors_team_idx ON liders.mentors (team_id);
