-- 011_application_form_fields.sql
-- Поля, обязательные по формам Приложений № 1 и № 9 (ТЗ 04, п. 9).
--
-- Приложение № 1 задаёт канонический состав заявки: сведения об инициативе,
-- об участниках и о наставниках. Приложение № 9 дополняет оценочный лист
-- обоснованием по каждому критерию и рекомендациями команде.
--
-- Колонки добавляются к существующим таблицам: применённые миграции 001–010
-- не редактируются (ТЗ 04, п. 5.3).

CREATE SCHEMA IF NOT EXISTS liders;

-- ── Сведения о законотворческой инициативе (Приложение № 1, часть 1) ─────────
-- Инициатива существует в рамках заявки конкретного сезона, поэтому поля
-- хранятся в applications, а не в teams.
ALTER TABLE liders.applications
  ADD COLUMN IF NOT EXISTS law_title           TEXT,
  ADD COLUMN IF NOT EXISTS act_level           TEXT,
  ADD COLUMN IF NOT EXISTS proposed_initiator  TEXT,
  ADD COLUMN IF NOT EXISTS annotation          TEXT,
  ADD COLUMN IF NOT EXISTS ai_usage            BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ai_usage_purpose    TEXT,
  ADD COLUMN IF NOT EXISTS is_solo             BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS solo_approved_at    TIMESTAMPTZ;

-- Уровень акта — закрытый перечень Приложения № 1.
ALTER TABLE liders.applications
  DROP CONSTRAINT IF EXISTS applications_act_level_check;
ALTER TABLE liders.applications
  ADD CONSTRAINT applications_act_level_check
  CHECK (act_level IS NULL OR act_level IN ('federal_constitutional', 'federal', 'regional'));

-- Аннотация инициативы — не более 1000 знаков (Приложение № 1).
ALTER TABLE liders.applications
  DROP CONSTRAINT IF EXISTS applications_annotation_length_check;
ALTER TABLE liders.applications
  ADD CONSTRAINT applications_annotation_length_check
  CHECK (annotation IS NULL OR char_length(annotation) <= 1000);

-- Единоличное участие допускается только по согласованию с Оргкомитетом
-- (п. 4.3 Положения): отметка «согласовано» обязана иметь дату согласования.
ALTER TABLE liders.applications
  DROP CONSTRAINT IF EXISTS applications_solo_check;
ALTER TABLE liders.applications
  ADD CONSTRAINT applications_solo_check
  CHECK (NOT is_solo OR solo_approved_at IS NOT NULL);

-- ── Сведения об участнике (Приложение № 1, часть 2) ──────────────────────────
ALTER TABLE liders.participants
  ADD COLUMN IF NOT EXISTS citizenship            TEXT,
  ADD COLUMN IF NOT EXISTS region                 TEXT,
  ADD COLUMN IF NOT EXISTS settlement             TEXT,
  ADD COLUMN IF NOT EXISTS vk_url                 TEXT,
  ADD COLUMN IF NOT EXISTS competencies           TEXT,
  ADD COLUMN IF NOT EXISTS personal_contribution  TEXT,
  ADD COLUMN IF NOT EXISTS faculty                TEXT,
  ADD COLUMN IF NOT EXISTS course                 INTEGER,
  ADD COLUMN IF NOT EXISTS study_program          TEXT;

-- Компетенции и опыт — не более 800 знаков (Приложение № 1).
ALTER TABLE liders.participants
  DROP CONSTRAINT IF EXISTS participants_competencies_length_check;
ALTER TABLE liders.participants
  ADD CONSTRAINT participants_competencies_length_check
  CHECK (competencies IS NULL OR char_length(competencies) <= 800);

ALTER TABLE liders.participants
  DROP CONSTRAINT IF EXISTS participants_course_range_check;
ALTER TABLE liders.participants
  ADD CONSTRAINT participants_course_range_check
  CHECK (course IS NULL OR course BETWEEN 1 AND 6);

-- ── Сведения о наставнике (Приложение № 1, часть 3) ──────────────────────────
ALTER TABLE liders.mentors
  ADD COLUMN IF NOT EXISTS academic_degree TEXT,
  ADD COLUMN IF NOT EXISTS academic_title  TEXT;

-- Ранее учёная степень хранилась в mentors.degree. Значения переносятся в
-- academic_degree; колонка degree сохраняется как устаревшая и новым кодом не
-- используется, чтобы не терять уже внесённые данные.
UPDATE liders.mentors
   SET academic_degree = degree
 WHERE academic_degree IS NULL
   AND degree IS NOT NULL;

-- ── Оценочный лист (Приложение № 9) ──────────────────────────────────────────
ALTER TABLE liders.evaluations
  ADD COLUMN IF NOT EXISTS recommendations TEXT;

-- scores хранит баллы вместе с обоснованием: [{criterion_id, score, comment}].
ALTER TABLE liders.evaluations
  DROP CONSTRAINT IF EXISTS evaluations_scores_array_check;
ALTER TABLE liders.evaluations
  ADD CONSTRAINT evaluations_scores_array_check
  CHECK (jsonb_typeof(scores) = 'array');
