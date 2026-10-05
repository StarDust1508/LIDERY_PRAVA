-- 029_pdn_subject_rights.sql
-- Права субъекта персональных данных: учёт обращений и отзыв распространения.
--
-- Требования: ТЗ 11, п. 6 (доступ, исправление, удаление и отзыв согласия —
-- через ответственного за обработку ПДн с инструментами в админке), п. 5
-- (ретенция: 3 года с завершения сезона, затем удаление или обезличивание,
-- ежегодная проверка и журналирование).
--
-- Зачем отдельная таблица обращений: у обращения субъекта есть срок ответа, и
-- Оргкомитет должен видеть, какие обращения в работе и какие просрочены. Без
-- учёта обращение живёт в почте, а срок никто не контролирует.

CREATE SCHEMA IF NOT EXISTS liders;

-- Отзыв согласия на распространение по категориям: строки не удаляются, иначе
-- исчезнет доказательство, что согласие было дано и затем отозвано.
ALTER TABLE liders.participant_distribution_consents
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS liders.pdn_requests (
  id            SERIAL      PRIMARY KEY,
  -- Что просит субъект: доступ, исправление, удаление или отзыв согласия.
  kind          TEXT        NOT NULL
                            CHECK (kind IN ('access', 'correction', 'erasure', 'withdrawal', 'other')),
  subject_name  TEXT        NOT NULL,
  subject_email TEXT        NOT NULL,
  -- Канал обращения: почта, форма на сайте, письменное заявление.
  channel       TEXT        NOT NULL DEFAULT 'email',
  message       TEXT,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Срок ответа: 10 рабочих дней (ст. 20 152-ФЗ) — считается при регистрации.
  due_at        TIMESTAMPTZ,
  status        TEXT        NOT NULL DEFAULT 'new'
                            CHECK (status IN ('new', 'in_progress', 'done', 'refused')),
  resolution    TEXT,
  -- Кто из Оргкомитета ведёт обращение и когда закрыл.
  handled_by    INTEGER     REFERENCES liders.users(id) ON DELETE SET NULL,
  handled_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pdn_requests_status_idx ON liders.pdn_requests (status, due_at);
CREATE INDEX IF NOT EXISTS pdn_requests_email_idx ON liders.pdn_requests (lower(subject_email));

-- Ретенция: какие сезоны уже обезличены и когда. Отдельная таблица нужна, чтобы
-- ежегодная проверка была доказуемой, а повторный прогон ничего не ломал.
CREATE TABLE IF NOT EXISTS liders.pdn_retention_runs (
  id             SERIAL      PRIMARY KEY,
  season_id      INTEGER     REFERENCES liders.seasons(id) ON DELETE SET NULL,
  season_slug    TEXT,
  cutoff_at      TIMESTAMPTZ NOT NULL,
  anonymized     INTEGER     NOT NULL DEFAULT 0,
  report         JSONB,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ,
  actor          TEXT
);
