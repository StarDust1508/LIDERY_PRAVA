-- 043_document_links.sql
-- Персональные PDF приложений и актуальные редакции документов.
--
-- Зачем: на странице «Документы» у каждого приложения своя строка, но все
-- четырнадцать ссылок открывали один общий файл — человек искал своё
-- приложение вручную. Приложения разрезаны на отдельные PDF
-- (platform/scripts/split-appendices.py), здесь обновляются ссылки.
--
-- Положение и Приложения пересобраны из документов, присланных заказчиком
-- 18 октября 2026 года, поэтому дата редакции уточняется до 2026-10-18.
--
-- Идемпотентно: повторный прогон ничего не меняет.

UPDATE liders.documents
   SET external_url = '/docs/prilozhenie-' || lpad((regexp_match(title, 'Приложение № (\d+)'))[1], 2, '0') || '.pdf',
       updated_at = now()
 WHERE type = 'appendix'
   AND title ~ 'Приложение № \d+'
   AND external_url IS DISTINCT FROM '/docs/prilozhenie-' || lpad((regexp_match(title, 'Приложение № (\d+)'))[1], 2, '0') || '.pdf';

UPDATE liders.documents
   SET revision_date = DATE '2026-10-18',
       updated_at = now()
 WHERE type IN ('regulation', 'appendix')
   AND revision_date <> DATE '2026-10-18';

-- Контроль: 14 приложений с персональными ссылками и Положение с общим PDF.
DO $$
DECLARE
  appendices int;
  regulation int;
BEGIN
  SELECT count(*) INTO appendices
    FROM liders.documents
   WHERE type = 'appendix' AND external_url LIKE '/docs/prilozhenie-%.pdf';
  SELECT count(*) INTO regulation
    FROM liders.documents
   WHERE type = 'regulation' AND external_url = '/docs/polozhenie-lidery-prava-2027.pdf';

  IF appendices <> 14 THEN
    RAISE EXCEPTION 'после миграции 043 персональных ссылок у приложений: % (ожидалось 14)', appendices;
  END IF;
  IF regulation <> 1 THEN
    RAISE EXCEPTION 'после миграции 043 ссылка на Положение не найдена';
  END IF;
END $$;
