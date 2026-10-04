-- 002_seasons_directions.sql
-- Конкурсный сезон и справочник направлений конкурса (Приложение № 2).

CREATE SCHEMA IF NOT EXISTS liders;

-- ── Сезон конкурса ───────────────────────────────────────────────────────────
-- Календарный план из раздела 6.3 Положения хранится в виде моментов времени
-- (TIMESTAMPTZ). Моменты задаются по московскому времени (UTC+3); сравнение с
-- текущим временем не зависит от часового пояса сервера.
CREATE TABLE IF NOT EXISTS liders.seasons (
  id                  SERIAL      PRIMARY KEY,
  slug                TEXT        NOT NULL UNIQUE,
  title               TEXT        NOT NULL,
  year                INTEGER     NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'draft'
                                  CHECK (status IN ('draft', 'published', 'active', 'finished')),
  is_active           BOOLEAN     NOT NULL DEFAULT FALSE,
  application_open_at TIMESTAMPTZ,
  application_close_at TIMESTAMPTZ,
  tech_check_from     TIMESTAMPTZ,
  tech_check_to       TIMESTAMPTZ,
  stage1_from         TIMESTAMPTZ,
  stage1_to           TIMESTAMPTZ,
  final_from          TIMESTAMPTZ,
  final_to            TIMESTAMPTZ,
  -- Срок подачи апелляции в рабочих днях (п. 12.1 — 2 рабочих дня).
  appeal_window_days  INTEGER     NOT NULL DEFAULT 2 CHECK (appeal_window_days > 0),
  -- Таймзона конкурса зафиксирована Положением (п. 6.2).
  timezone            TEXT        NOT NULL DEFAULT 'Europe/Moscow',
  description         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Активным может быть только один сезон.
CREATE UNIQUE INDEX IF NOT EXISTS seasons_single_active_idx
  ON liders.seasons ((is_active)) WHERE is_active;

-- ── Направления конкурса (Приложение № 2) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS liders.directions (
  id          SERIAL      PRIMARY KEY,
  code        TEXT        NOT NULL UNIQUE,
  title       TEXT        NOT NULL,
  description TEXT,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS directions_active_idx ON liders.directions (is_active, sort_order);
