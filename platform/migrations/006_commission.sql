-- 006_commission.sql
-- Конкурсная комиссия, Жюри и критерии оценки (раздел 10 Положения).

CREATE SCHEMA IF NOT EXISTS liders;

-- ── Эксперты ─────────────────────────────────────────────────────────────────
-- Эксперт привлекается Оргкомитетом для экспертного сопровождения этапа
-- (п. 1.11, 5.2.2). Наставник командой не является и в этой таблице не лежит.
CREATE TABLE IF NOT EXISTS liders.experts (
  id           SERIAL      PRIMARY KEY,
  full_name    TEXT        NOT NULL,
  organization TEXT,
  position     TEXT,
  degree       TEXT,
  role         TEXT        NOT NULL DEFAULT 'member'
                           CHECK (role IN ('chair', 'member')),
  stage        TEXT        NOT NULL DEFAULT 'selection'
                           CHECK (stage IN ('selection', 'stage1', 'debate')),
  email        TEXT,
  phone        TEXT,
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS experts_stage_idx ON liders.experts (stage, is_active);

-- ── Члены Жюри финального этапа ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS liders.jury_members (
  id           SERIAL      PRIMARY KEY,
  full_name    TEXT        NOT NULL,
  organization TEXT,
  position     TEXT,
  role         TEXT        NOT NULL DEFAULT 'member' CHECK (role IN ('chair', 'member')),
  stage        TEXT        NOT NULL DEFAULT 'debate'
                           CHECK (stage IN ('selection', 'stage1', 'debate')),
  email        TEXT,
  phone        TEXT,
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jury_members_stage_idx ON liders.jury_members (stage, is_active);

-- ── Критерии оценки ──────────────────────────────────────────────────────────
-- stage: selection — отборочный этап (п. 10.2), stage1 — первый этап (п. 10.3),
-- debate — дебаты финального этапа (п. 10.4).
CREATE TABLE IF NOT EXISTS liders.criteria (
  id          SERIAL       PRIMARY KEY,
  stage       TEXT         NOT NULL CHECK (stage IN ('selection', 'stage1', 'debate')),
  code        TEXT         NOT NULL,
  title       TEXT         NOT NULL,
  description TEXT,
  max_score   NUMERIC(5,2) NOT NULL CHECK (max_score > 0),
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (stage, code)
);

CREATE INDEX IF NOT EXISTS criteria_stage_idx ON liders.criteria (stage, sort_order);
