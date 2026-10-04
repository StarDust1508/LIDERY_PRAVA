-- 014_notifications_outbox.sql
-- Очередь исходящих писем (ТЗ 04, п. 3.7).
--
-- Решение Р7: отправка писем в текущем объёме не реализуется, и ни один сценарий
-- не должен зависеть от почты. Таблица создаётся заранее, чтобы включение
-- рассылки позже не потребовало изменения схемы: письмо сначала попадает в
-- очередь с шаблоном, телом и статусом, а транспорт читает её отдельным
-- процессом (фоновых заданий в app.listen нет — ТЗ 09, п. 5).

CREATE SCHEMA IF NOT EXISTS liders;

CREATE TABLE IF NOT EXISTS liders.notifications_outbox (
  id              BIGSERIAL   PRIMARY KEY,
  season_id       INTEGER     REFERENCES liders.seasons(id) ON DELETE SET NULL,
  team_id         INTEGER     REFERENCES liders.teams(id) ON DELETE SET NULL,
  recipient_email TEXT,
  recipient_name  TEXT,
  -- Код шаблона письма: application_received, fix_required, protocol_published…
  template_code   TEXT        NOT NULL,
  subject         TEXT        NOT NULL,
  body            TEXT        NOT NULL,
  -- Данные для повторной сборки письма (номера, ссылки), без дублирования ПДн.
  payload         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT        NOT NULL DEFAULT 'queued'
                              CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  attempts        INTEGER     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error      TEXT,
  scheduled_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_outbox_status_idx
  ON liders.notifications_outbox (status, created_at);
CREATE INDEX IF NOT EXISTS notifications_outbox_team_idx
  ON liders.notifications_outbox (team_id, created_at DESC);
