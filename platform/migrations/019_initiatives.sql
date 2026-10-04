-- 019_initiatives.sql
-- Архив законопроектов: инициативы, прошедшие конкурс, и их авторы
-- (ТЗ 04, п. 10; ТЗ 02, п. 14).
--
-- Публикация в архиве — решение Оргкомитета, а не следствие подачи заявки.
-- Персональные данные авторов и файлы работ отдаются публично только при
-- отдельных согласиях: authors_public соответствует Приложению № 12
-- (категории распространения), files_public — лицензии Приложения № 13.
-- При authors_public = false блок авторов не отдаётся публичным API вообще.

CREATE SCHEMA IF NOT EXISTS liders;

CREATE TABLE IF NOT EXISTS liders.initiatives (
  id              SERIAL      PRIMARY KEY,
  season_id       INTEGER     REFERENCES liders.seasons(id) ON DELETE SET NULL,
  -- Для записей прошлых лет команды в БД может не быть: team_name хранится
  -- текстом, team_id остаётся пустым.
  team_id         INTEGER     REFERENCES liders.teams(id) ON DELETE SET NULL,
  direction_id    INTEGER     REFERENCES liders.directions(id) ON DELETE SET NULL,
  slug            TEXT        NOT NULL UNIQUE,
  title           TEXT        NOT NULL,
  annotation      TEXT,
  act_level       TEXT        CHECK (act_level IS NULL OR act_level IN (
                                'federal_constitutional', 'federal', 'regional'
                              )),
  proposed_initiator TEXT,
  team_name       TEXT,
  result_place    INTEGER     CHECK (result_place IS NULL OR result_place BETWEEN 1 AND 3),
  nomination      TEXT,
  law_draft_media_id UUID     REFERENCES liders.media(id) ON DELETE SET NULL,
  explanatory_note_media_id UUID REFERENCES liders.media(id) ON DELETE SET NULL,
  video_url       TEXT,
  is_published    BOOLEAN     NOT NULL DEFAULT FALSE,
  published_at    TIMESTAMPTZ,
  authors_public  BOOLEAN     NOT NULL DEFAULT FALSE,
  files_public    BOOLEAN     NOT NULL DEFAULT FALSE,
  archive_year    INTEGER,
  sort_order      INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS initiatives_published_idx
  ON liders.initiatives (is_published, archive_year DESC NULLS LAST, published_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS initiatives_direction_idx
  ON liders.initiatives (direction_id, act_level);
CREATE INDEX IF NOT EXISTS initiatives_season_idx ON liders.initiatives (season_id);

-- Полнотекстовый поиск по названию, аннотации и команде (ТЗ 04, п. 10, п. 4).
CREATE INDEX IF NOT EXISTS initiatives_search_idx
  ON liders.initiatives
  USING gin (to_tsvector('russian'::regconfig,
    COALESCE(title, '') || ' ' || COALESCE(annotation, '') || ' ' || COALESCE(team_name, '')));

-- ── Авторы инициативы ────────────────────────────────────────────────────────
-- ФИО, организация и населённый пункт публикуются выборочно — по категориям
-- согласия Приложения № 12, поэтому у автора отдельный флаг публикации.
CREATE TABLE IF NOT EXISTS liders.initiative_authors (
  id             BIGSERIAL   PRIMARY KEY,
  initiative_id  INTEGER     NOT NULL REFERENCES liders.initiatives(id) ON DELETE CASCADE,
  full_name      TEXT        NOT NULL,
  organization   TEXT,
  region         TEXT,
  is_published   BOOLEAN     NOT NULL DEFAULT FALSE,
  sort_order     INTEGER     NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS initiative_authors_initiative_idx
  ON liders.initiative_authors (initiative_id, sort_order);
