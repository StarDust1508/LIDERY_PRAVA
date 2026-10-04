-- 004_applications_materials.sql
-- Заявка на участие и конкурсные материалы.
--
-- Заявки приходят двумя путями: из электронной формы (Яндекс.Форма) и с сайта.
-- Каждый материал либо хранится в медиахранилище (FK на media), либо задаётся
-- ссылкой (видеоролик первого этапа публикуется во «ВКонтакте», п. 8.3).

CREATE SCHEMA IF NOT EXISTS liders;

-- ── Заявка ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS liders.applications (
  id                 SERIAL      PRIMARY KEY,
  season_id          INTEGER     NOT NULL REFERENCES liders.seasons(id) ON DELETE CASCADE,
  team_id            INTEGER     NOT NULL REFERENCES liders.teams(id) ON DELETE CASCADE,
  source             TEXT        NOT NULL CHECK (source IN ('yandex_form', 'site')),
  external_form_id   TEXT,
  external_response_id TEXT,
  submitted_at       TIMESTAMPTZ,
  -- Техническая проверка (п. 7.4–7.5 Положения).
  tech_status        TEXT        NOT NULL DEFAULT 'pending'
                                 CHECK (tech_status IN (
                                   'pending', 'in_review', 'fix_required', 'accepted', 'rejected'
                                 )),
  tech_checked_at    TIMESTAMPTZ,
  tech_checked_by    INTEGER     REFERENCES liders.users(id) ON DELETE SET NULL,
  tech_rejection_reason TEXT,
  -- Служебные заметки оргкомитета: участникам не показываются.
  organizer_notes    TEXT,
  ip                 TEXT,
  user_agent         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Пункт 4.4: одна заявка на команду в рамках сезона.
  UNIQUE (season_id, team_id)
);

CREATE INDEX IF NOT EXISTS applications_status_idx ON liders.applications (season_id, tech_status);
CREATE INDEX IF NOT EXISTS applications_submitted_idx ON liders.applications (submitted_at DESC);

-- Повторный импорт одной и той же формы не должен создавать дубль заявки.
CREATE UNIQUE INDEX IF NOT EXISTS applications_external_response_idx
  ON liders.applications (external_response_id) WHERE external_response_id IS NOT NULL;

-- ── Конкурсные материалы ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS liders.application_materials (
  id               BIGSERIAL   PRIMARY KEY,
  application_id   INTEGER     NOT NULL REFERENCES liders.applications(id) ON DELETE CASCADE,
  team_id          INTEGER     NOT NULL REFERENCES liders.teams(id) ON DELETE CASCADE,
  type             TEXT        NOT NULL
                               CHECK (type IN (
                                 'law_draft', 'explanatory_note', 'acts_list', 'comparison_table',
                                 'video_link', 'presentation', 'consent', 'other'
                               )),
  -- Файл материала. При удалении файла материал сохраняется со ссылкой.
  media_id         UUID        REFERENCES liders.media(id) ON DELETE SET NULL,
  external_url     TEXT,
  version          INTEGER     NOT NULL DEFAULT 1 CHECK (version > 0),
  status           TEXT        NOT NULL DEFAULT 'uploaded'
                               CHECK (status IN ('uploaded', 'accepted', 'needs_fix', 'rejected')),
  reviewer_comment TEXT,
  reviewed_by      INTEGER     REFERENCES liders.users(id) ON DELETE SET NULL,
  reviewed_at      TIMESTAMPTZ,
  -- Дедлайн на устранение недостатков (п. 7.5 — не более 2 рабочих дней).
  fix_deadline     TIMESTAMPTZ,
  uploaded_by      TEXT        NOT NULL DEFAULT 'team' CHECK (uploaded_by IN ('team', 'admin')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Материал существует, только если у него есть файл или ссылка.
  CONSTRAINT application_materials_source_check
    CHECK (media_id IS NOT NULL OR (external_url IS NOT NULL AND external_url <> ''))
);

CREATE INDEX IF NOT EXISTS application_materials_application_idx
  ON liders.application_materials (application_id, type);
CREATE INDEX IF NOT EXISTS application_materials_team_idx
  ON liders.application_materials (team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS application_materials_status_idx
  ON liders.application_materials (status);
