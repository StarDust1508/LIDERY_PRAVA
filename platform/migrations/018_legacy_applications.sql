-- 018_legacy_applications.sql
-- Архив заявок прошлых сезонов из прежней базы SQLite «Лидеры права»
-- (ТЗ 04, п. 3.7; ТЗ 10, этап 3).
--
-- Старая база остаётся рабочей и не изменяется; перенос выполняется отдельным
-- импортёром. Таблица нужна, чтобы история заявок и факты согласий не потерялись
-- при переезде. Записи доступны только для чтения и содержат персональные
-- данные, поэтому публичных маршрутов у таблицы нет.

CREATE SCHEMA IF NOT EXISTS liders;

CREATE TABLE IF NOT EXISTS liders.legacy_applications (
  id              BIGSERIAL   PRIMARY KEY,
  -- Идентификатор записи в исходной базе: защищает от повторного импорта.
  legacy_id       INTEGER     NOT NULL,
  legacy_source   TEXT        NOT NULL DEFAULT 'applications.db',
  season_year     INTEGER     NOT NULL DEFAULT 2026,
  full_name       TEXT        NOT NULL,
  email           TEXT        NOT NULL,
  phone           TEXT,
  organization    TEXT,
  status          TEXT,
  admin_notes     TEXT,
  consent_pdn     BOOLEAN     NOT NULL DEFAULT FALSE,
  consent_terms   BOOLEAN     NOT NULL DEFAULT FALSE,
  consent_marketing BOOLEAN   NOT NULL DEFAULT FALSE,
  -- Момент согласия и сетевой адрес из прежней системы (152-ФЗ).
  consent_at      TIMESTAMPTZ,
  source_ip       TEXT,
  submitted_at    TIMESTAMPTZ,
  imported_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (legacy_source, legacy_id)
);

CREATE INDEX IF NOT EXISTS legacy_applications_year_idx
  ON liders.legacy_applications (season_year DESC, submitted_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS legacy_applications_email_idx
  ON liders.legacy_applications (lower(email));
