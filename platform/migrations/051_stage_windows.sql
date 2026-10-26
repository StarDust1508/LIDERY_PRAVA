-- 051_stage_windows.sql
-- Окна этапов приведены к новым срокам: приём заявок до 31.12.2026,
-- первый этап 01.02.2027–01.03.2027. Экспертиза идёт в январе, видеопрезентации
-- и онлайн-предзащита — в феврале, оценка — во второй половине февраля.
UPDATE liders.seasons
   SET expertise_from          = TIMESTAMPTZ '2027-01-01 00:00:00+03',
       expertise_to            = TIMESTAMPTZ '2027-01-31 23:59:00+03',
       video_publication_from  = TIMESTAMPTZ '2027-02-01 00:00:00+03',
       video_publication_to    = TIMESTAMPTZ '2027-02-15 23:59:00+03',
       stage1_evaluation_from  = TIMESTAMPTZ '2027-02-16 00:00:00+03',
       stage1_evaluation_to    = TIMESTAMPTZ '2027-02-28 23:59:00+03',
       post_final_from         = TIMESTAMPTZ '2027-05-01 00:00:00+03',
       post_final_to           = TIMESTAMPTZ '2027-06-30 23:59:00+03',
       updated_at              = now()
 WHERE is_active;
