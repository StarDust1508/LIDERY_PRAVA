-- 017_winners_pages.sql
-- Победители по годам и номинациям и редактируемые страницы сайта
-- (ТЗ 04, п. 3.7; ТЗ 08, п. 5).
--
-- Победители ведутся отдельной таблицей, а не выводятся автоматически из
-- рейтинга: номинации раздела 11 Положения включают зрительские и особые
-- («Приз зрительских симпатий», «Лучший оратор», специальные номинации
-- Оргкомитета), которых нет в rankings. Записи прошлых лет вносятся вручную и
-- не требуют команды в БД, поэтому связь с teams необязательна.
--
-- pages закрывают требование править тексты («О конкурсе», «История конкурса»,
-- FAQ) из админки, а не правкой вёрстки.

CREATE SCHEMA IF NOT EXISTS liders;

-- ── Победители и призёры ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS liders.winners (
  id             SERIAL      PRIMARY KEY,
  season_id      INTEGER     REFERENCES liders.seasons(id) ON DELETE SET NULL,
  season_year    INTEGER     NOT NULL,
  nomination     TEXT        NOT NULL,
  place          INTEGER     CHECK (place IS NULL OR place BETWEEN 1 AND 3),
  team_id        INTEGER     REFERENCES liders.teams(id) ON DELETE SET NULL,
  team_name      TEXT,
  -- Состав публикуется текстом: ФИО — только при согласии по Приложению № 12.
  participants_text TEXT,
  mentors_text   TEXT,
  initiative_title TEXT,
  photo_media_id UUID        REFERENCES liders.media(id) ON DELETE SET NULL,
  video_url      TEXT,
  announcement   TEXT,
  is_published   BOOLEAN     NOT NULL DEFAULT FALSE,
  sort_order     INTEGER     NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (season_year, nomination, team_name)
);

CREATE INDEX IF NOT EXISTS winners_year_idx
  ON liders.winners (season_year DESC, nomination, place NULLS LAST, sort_order);
CREATE INDEX IF NOT EXISTS winners_published_idx
  ON liders.winners (is_published, season_year DESC);

-- ── Редактируемые страницы ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS liders.pages (
  id              SERIAL      PRIMARY KEY,
  slug            TEXT        NOT NULL UNIQUE,
  title           TEXT        NOT NULL,
  type            TEXT        NOT NULL DEFAULT 'page'
                              CHECK (type IN ('page', 'history', 'faq')),
  excerpt         TEXT,
  body            TEXT,
  seo_title       TEXT,
  seo_description TEXT,
  og_media_id     UUID        REFERENCES liders.media(id) ON DELETE SET NULL,
  is_published    BOOLEAN     NOT NULL DEFAULT FALSE,
  sort_order      INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pages_published_idx ON liders.pages (is_published, sort_order);
