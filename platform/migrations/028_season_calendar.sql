-- 028_season_calendar.sql
-- Полный календарный план сезона (ТЗ 02, п. 2; ТЗ 08, п. 2.1 — страница «Календарь»).
--
-- В таблице сезона были только сроки приёма, технической проверки, первого
-- этапа и финала. Календарный план Положения содержит ещё экспертизу,
-- публикацию протоколов, видеоролики, мастер-классы и мероприятия после
-- финала — без этих полей страница «Календарь» показывает неполный план, а
-- сроки приходится писать текстом.
--
-- Даты не хранятся в коде: значения ниже — перенос календарного плана
-- Положения в базу, дальше Оргкомитет меняет их в админке.

CREATE SCHEMA IF NOT EXISTS liders;

ALTER TABLE liders.seasons
  ADD COLUMN IF NOT EXISTS expertise_from TIMESTAMPTZ;
ALTER TABLE liders.seasons
  ADD COLUMN IF NOT EXISTS expertise_to TIMESTAMPTZ;
ALTER TABLE liders.seasons
  ADD COLUMN IF NOT EXISTS protocol_selection_at TIMESTAMPTZ;
ALTER TABLE liders.seasons
  ADD COLUMN IF NOT EXISTS video_publication_from TIMESTAMPTZ;
ALTER TABLE liders.seasons
  ADD COLUMN IF NOT EXISTS video_publication_to TIMESTAMPTZ;
ALTER TABLE liders.seasons
  ADD COLUMN IF NOT EXISTS stage1_evaluation_from TIMESTAMPTZ;
ALTER TABLE liders.seasons
  ADD COLUMN IF NOT EXISTS stage1_evaluation_to TIMESTAMPTZ;
ALTER TABLE liders.seasons
  ADD COLUMN IF NOT EXISTS protocol_stage1_at TIMESTAMPTZ;
ALTER TABLE liders.seasons
  ADD COLUMN IF NOT EXISTS masterclasses_from TIMESTAMPTZ;
ALTER TABLE liders.seasons
  ADD COLUMN IF NOT EXISTS masterclasses_to TIMESTAMPTZ;
ALTER TABLE liders.seasons
  ADD COLUMN IF NOT EXISTS post_final_from TIMESTAMPTZ;
ALTER TABLE liders.seasons
  ADD COLUMN IF NOT EXISTS post_final_to TIMESTAMPTZ;

COMMENT ON COLUMN liders.seasons.expertise_from IS 'Экспертиза и оценка инициатив онлайн-комиссией (п. 6.3 Положения)';
COMMENT ON COLUMN liders.seasons.protocol_selection_at IS 'Срок публикации протокола итогов отборочного этапа';
COMMENT ON COLUMN liders.seasons.protocol_stage1_at IS 'Срок публикации протокола итогов первого этапа';
COMMENT ON COLUMN liders.seasons.post_final_from IS 'Мероприятия после финала: дискуссия с депутатами, стажировки';

-- Перенос календарного плана сезона 2026/2027 (МСК = UTC+3).
UPDATE liders.seasons
   SET expertise_from = COALESCE(expertise_from, TIMESTAMPTZ '2026-12-20 00:00:00+03'),
       expertise_to = COALESCE(expertise_to, TIMESTAMPTZ '2027-01-13 23:59:59+03'),
       protocol_selection_at = COALESCE(protocol_selection_at, TIMESTAMPTZ '2027-01-15 23:59:59+03'),
       video_publication_from = COALESCE(video_publication_from, TIMESTAMPTZ '2027-01-15 00:00:00+03'),
       video_publication_to = COALESCE(video_publication_to, TIMESTAMPTZ '2027-02-15 23:59:59+03'),
       stage1_evaluation_from = COALESCE(stage1_evaluation_from, TIMESTAMPTZ '2027-02-16 00:00:00+03'),
       stage1_evaluation_to = COALESCE(stage1_evaluation_to, TIMESTAMPTZ '2027-02-28 23:59:59+03'),
       protocol_stage1_at = COALESCE(protocol_stage1_at, TIMESTAMPTZ '2027-03-05 23:59:59+03'),
       masterclasses_from = COALESCE(masterclasses_from, TIMESTAMPTZ '2027-03-01 00:00:00+03'),
       masterclasses_to = COALESCE(masterclasses_to, TIMESTAMPTZ '2027-03-31 23:59:59+03'),
       post_final_from = COALESCE(post_final_from, TIMESTAMPTZ '2027-05-01 00:00:00+03'),
       post_final_to = COALESCE(post_final_to, TIMESTAMPTZ '2027-06-30 23:59:59+03'),
       updated_at = now()
 WHERE slug = '2027';

-- ── Органы конкурса в справочнике экспертов ──────────────────────────────────
-- ТЗ 08, п. 2.1 требует на странице «Оргкомитет и эксперты» не только
-- Конкурсную комиссию и Жюри, но и Оргкомитет, экспертов, Апелляционную
-- комиссию и Счётную группу (ТЗ 02, п. 10). Раньше перечень этапов в
-- `experts.stage` их не допускал, поэтому состав этих органов нельзя было
-- опубликовать иначе как текстом.

ALTER TABLE liders.experts
  DROP CONSTRAINT IF EXISTS experts_stage_check;
ALTER TABLE liders.experts
  ADD CONSTRAINT experts_stage_check
  CHECK (stage IN (
    'organizing_committee', 'selection', 'stage1', 'debate',
    'expert', 'appeal_commission', 'counting_group'
  ));

-- Публикация состава Жюри: те же публичные поля, что и у экспертов.
ALTER TABLE liders.jury_members
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE liders.jury_members
  ADD COLUMN IF NOT EXISTS photo_media_id UUID REFERENCES liders.media(id) ON DELETE SET NULL;
ALTER TABLE liders.jury_members
  ADD COLUMN IF NOT EXISTS about TEXT;
