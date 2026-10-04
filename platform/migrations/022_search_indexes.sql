-- 022_search_indexes.sql
-- Полнотекстовый поиск по публичному контенту (ТЗ 04, п. 4).
--
-- Индексы по to_tsvector('russian', …) нужны разделам «Мастер-классы»,
-- «Новости» и «Документы»; для архива законопроектов индекс создан миграцией
-- 019 вместе с таблицей.
--
-- Индекс по masterclasses построен по названию и описанию: ФИО ведущего
-- публикуется карточкой, а не поиском, и в выражение индекса не входит.

CREATE SCHEMA IF NOT EXISTS liders;

CREATE INDEX IF NOT EXISTS masterclasses_search_idx
  ON liders.masterclasses
  USING gin (to_tsvector('russian'::regconfig,
    COALESCE(title, '') || ' ' || COALESCE(description, '')));

CREATE INDEX IF NOT EXISTS news_search_idx
  ON liders.news
  USING gin (to_tsvector('russian'::regconfig,
    COALESCE(title, '') || ' ' || COALESCE(excerpt, '') || ' ' || COALESCE(body, '')));

CREATE INDEX IF NOT EXISTS documents_search_idx
  ON liders.documents
  USING gin (to_tsvector('russian'::regconfig, COALESCE(title, '')));
