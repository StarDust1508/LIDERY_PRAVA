-- 009_content.sql
-- Публичный контент сайта: мастер-классы, партнёры, новости и видеосюжеты,
-- юридические документы.

CREATE SCHEMA IF NOT EXISTS liders;

-- ── Мастер-классы для команд-финалистов (п. 8.7) ─────────────────────────────
CREATE TABLE IF NOT EXISTS liders.masterclasses (
  id           SERIAL      PRIMARY KEY,
  season_id    INTEGER     REFERENCES liders.seasons(id) ON DELETE SET NULL,
  title        TEXT        NOT NULL,
  speaker      TEXT        NOT NULL,
  speaker_info TEXT,
  description  TEXT,
  status       TEXT        NOT NULL DEFAULT 'announced' CHECK (status IN ('announced', 'past')),
  starts_at    TIMESTAMPTZ,
  place        TEXT,
  recording_url TEXT,
  media_id     UUID        REFERENCES liders.media(id) ON DELETE SET NULL,
  sort_order   INTEGER     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS masterclasses_order_idx
  ON liders.masterclasses (status, starts_at DESC NULLS LAST, sort_order);

-- ── Партнёры и спонсоры (раздел 2 Положения) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS liders.partners (
  id            SERIAL      PRIMARY KEY,
  name          TEXT        NOT NULL,
  url           TEXT,
  logo_media_id UUID        REFERENCES liders.media(id) ON DELETE SET NULL,
  partner_type  TEXT        NOT NULL DEFAULT 'partner'
                            CHECK (partner_type IN ('general', 'partner', 'sponsor', 'info', 'expert')),
  description   TEXT,
  sort_order    INTEGER     NOT NULL DEFAULT 0,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS partners_active_idx ON liders.partners (is_active, sort_order);

-- ── Новости и видеосюжеты ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS liders.news (
  id             SERIAL      PRIMARY KEY,
  slug           TEXT        NOT NULL UNIQUE,
  title          TEXT        NOT NULL,
  type           TEXT        NOT NULL DEFAULT 'news' CHECK (type IN ('news', 'video')),
  cover_media_id UUID        REFERENCES liders.media(id) ON DELETE SET NULL,
  video_url      TEXT,
  excerpt        TEXT,
  body           TEXT,
  published_at   TIMESTAMPTZ,
  is_published   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS news_published_idx
  ON liders.news (is_published, published_at DESC NULLS LAST);

-- ── Юридические документы и Положение ────────────────────────────────────────
-- requires_acceptance = TRUE для документов, отметка о согласии с которыми
-- обязательна при подаче заявки (Положение, согласия на обработку ПДн).
CREATE TABLE IF NOT EXISTS liders.documents (
  id                  SERIAL      PRIMARY KEY,
  type                TEXT        NOT NULL DEFAULT 'regulation'
                                  CHECK (type IN (
                                    'regulation', 'privacy_policy', 'consent_pdn',
                                    'consent_distribution', 'consent_legal_representative',
                                    'license_terms', 'appeal_form', 'other'
                                  )),
  title               TEXT        NOT NULL,
  version             TEXT        NOT NULL,
  revision_date       DATE        NOT NULL,
  media_id            UUID        REFERENCES liders.media(id) ON DELETE SET NULL,
  external_url        TEXT,
  requires_acceptance BOOLEAN     NOT NULL DEFAULT FALSE,
  is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order          INTEGER     NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (type, version)
);

CREATE INDEX IF NOT EXISTS documents_active_idx ON liders.documents (is_active, sort_order);
