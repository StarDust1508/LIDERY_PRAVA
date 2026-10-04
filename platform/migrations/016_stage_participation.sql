-- 016_stage_participation.sql
-- Участие команды в этапах и структура финального этапа (п. 9.3–9.5).
--
-- Пункт 9.3.1 в редакции 04.10.2026: команды-финалисты формируются в группы по
-- 3 команды, а при числе финалистов, не кратном трём, состав групп определяет
-- Оргкомитет. Пункт 8.6: финалистов — от 10. Поэтому минимальное число
-- финалистов хранится в сезоне, а фактическая разбивка по группам — в
-- stage_participation, вместе с голосами зала и основанием прохождения.

CREATE SCHEMA IF NOT EXISTS liders;

-- Минимальное число команд-финалистов первого этапа (п. 8.6 — «от 10»).
ALTER TABLE liders.seasons
  ADD COLUMN IF NOT EXISTS finalists_min INTEGER NOT NULL DEFAULT 10;

ALTER TABLE liders.seasons
  DROP CONSTRAINT IF EXISTS seasons_finalists_min_check;
ALTER TABLE liders.seasons
  ADD CONSTRAINT seasons_finalists_min_check
  CHECK (finalists_min >= 1);

-- ── Участие команды в этапе ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS liders.stage_participation (
  id             BIGSERIAL   PRIMARY KEY,
  season_id      INTEGER     NOT NULL REFERENCES liders.seasons(id) ON DELETE CASCADE,
  team_id        INTEGER     NOT NULL REFERENCES liders.teams(id) ON DELETE CASCADE,
  stage          TEXT        NOT NULL
                             CHECK (stage IN ('selection', 'stage1', 'final', 'grand_final')),
  -- Группа финального этапа: 3 команды, при некратном числе — по решению
  -- Оргкомитета (п. 9.3.1).
  group_code     TEXT,
  advanced       BOOLEAN,
  -- Чем определено прохождение: баллы, решение Жюри, голосование, квота.
  advance_reason TEXT,
  audience_votes INTEGER     NOT NULL DEFAULT 0 CHECK (audience_votes >= 0),
  jury_votes     INTEGER     NOT NULL DEFAULT 0 CHECK (jury_votes >= 0),
  final_place    INTEGER     CHECK (final_place IS NULL OR final_place BETWEEN 1 AND 3),
  nomination     TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (season_id, team_id, stage)
);

CREATE INDEX IF NOT EXISTS stage_participation_stage_idx
  ON liders.stage_participation (season_id, stage, advanced);
CREATE INDEX IF NOT EXISTS stage_participation_group_idx
  ON liders.stage_participation (season_id, stage, group_code);
