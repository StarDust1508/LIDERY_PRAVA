-- 007_evaluations_rankings.sql
-- Оценки членов комиссии и рейтинг этапа.
--
-- Пункт 7.7: итоговый балл — среднее арифметическое суммарных баллов членов
-- комиссии с округлением до сотых. Если расхождение сумм больше 20 баллов,
-- материалы направляются на дополнительную оценку председателю, и его балл
-- учитывается в среднем (для этого есть флаг is_chair_extra).

CREATE SCHEMA IF NOT EXISTS liders;

-- ── Оценки ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS liders.evaluations (
  id             BIGSERIAL    PRIMARY KEY,
  team_id        INTEGER      NOT NULL REFERENCES liders.teams(id) ON DELETE CASCADE,
  stage          TEXT         NOT NULL CHECK (stage IN ('selection', 'stage1', 'debate')),
  expert_id      INTEGER      REFERENCES liders.experts(id) ON DELETE SET NULL,
  jury_member_id INTEGER      REFERENCES liders.jury_members(id) ON DELETE SET NULL,
  -- Баллы по критериям: [{ "criterion_id": 1, "score": 8 }, …]
  scores         JSONB        NOT NULL DEFAULT '[]'::jsonb,
  -- Сумма баллов одного члена комиссии (считается на сервере, не клиентом).
  total_score    NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (total_score >= 0),
  comment        TEXT,
  -- Дополнительная оценка председателя комиссии (п. 7.7).
  is_chair_extra BOOLEAN      NOT NULL DEFAULT FALSE,
  -- Тайное голосование Жюри в Гранд-финале (п. 9.5.2).
  is_final_vote  BOOLEAN      NOT NULL DEFAULT FALSE,
  created_by     INTEGER      REFERENCES liders.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT evaluations_author_check
    CHECK (expert_id IS NOT NULL OR jury_member_id IS NOT NULL)
);

-- Один член комиссии выставляет команде одну оценку на этап (переоценка —
-- через обновление существующей записи).
CREATE UNIQUE INDEX IF NOT EXISTS evaluations_expert_unique_idx
  ON liders.evaluations (team_id, stage, expert_id) WHERE expert_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS evaluations_jury_unique_idx
  ON liders.evaluations (team_id, stage, jury_member_id) WHERE jury_member_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS evaluations_team_stage_idx ON liders.evaluations (team_id, stage);

-- ── Рейтинг этапа (протокол) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS liders.rankings (
  id                 BIGSERIAL    PRIMARY KEY,
  season_id          INTEGER      NOT NULL REFERENCES liders.seasons(id) ON DELETE CASCADE,
  team_id            INTEGER      NOT NULL REFERENCES liders.teams(id) ON DELETE CASCADE,
  stage              TEXT         NOT NULL CHECK (stage IN ('selection', 'stage1', 'debate')),
  place              INTEGER      NOT NULL CHECK (place > 0),
  -- Среднее арифметическое суммарных баллов, округление до сотых.
  average_score      NUMERIC(6,2) NOT NULL DEFAULT 0,
  -- Сумма баллов Жюри (для дебатов п. 9.4.2 итог — сумма, а не среднее).
  jury_total         NUMERIC(8,2),
  -- Разница между максимальной и минимальной суммой членов комиссии.
  scores_spread      NUMERIC(6,2),
  needs_chair_review BOOLEAN      NOT NULL DEFAULT FALSE,
  evaluations_count  INTEGER      NOT NULL DEFAULT 0,
  is_published       BOOLEAN      NOT NULL DEFAULT FALSE,
  published_at       TIMESTAMPTZ,
  protocol_note      TEXT,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (season_id, stage, team_id)
);

CREATE INDEX IF NOT EXISTS rankings_stage_idx ON liders.rankings (season_id, stage, place);
CREATE INDEX IF NOT EXISTS rankings_published_idx ON liders.rankings (is_published);
