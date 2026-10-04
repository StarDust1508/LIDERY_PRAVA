-- 012_consents.sql
-- Согласия (Приложения № 10–13) и матрица распространения персональных данных
-- (Приложение № 12).
--
-- Пункты 7.2 и 14.3 Положения: согласие на обработку персональных данных и
-- согласие на распространение оформляются отдельно друг от друга; допускается
-- электронная форма — отметка на сайте, при этом фиксируются дата, время,
-- сетевой адрес и версия текста согласия.
--
-- Для участников младше 18 лет согласие законного представителя
-- (Приложение № 11) дополнительно представляется сканом подписанного бланка,
-- поэтому у согласия есть ссылка на файл в медиахранилище.

CREATE SCHEMA IF NOT EXISTS liders;

-- ── Согласия субъектов ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS liders.consents (
  id               BIGSERIAL   PRIMARY KEY,
  season_id        INTEGER     NOT NULL REFERENCES liders.seasons(id) ON DELETE CASCADE,
  team_id          INTEGER     REFERENCES liders.teams(id) ON DELETE CASCADE,
  -- Кто даёт согласие: участник, его законный представитель, наставник
  -- или команда целиком (согласие с Положением).
  subject_type     TEXT        NOT NULL
                               CHECK (subject_type IN (
                                 'participant', 'legal_representative', 'mentor', 'team'
                               )),
  participant_id   INTEGER     REFERENCES liders.participants(id) ON DELETE CASCADE,
  mentor_id        INTEGER     REFERENCES liders.mentors(id) ON DELETE CASCADE,
  -- Версия текста согласия связывается с опубликованным документом.
  document_id      INTEGER     REFERENCES liders.documents(id) ON DELETE SET NULL,
  document_code    TEXT        NOT NULL,
  document_version TEXT        NOT NULL,
  accepted         BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Момент проставления отметки — доказательство согласия (п. 14.3).
  accepted_at      TIMESTAMPTZ,
  ip               TEXT,
  user_agent       TEXT,
  -- Скан подписанного бланка: обязателен для Приложения № 11 (п. 4.8, 7.2).
  scan_media_id    UUID        REFERENCES liders.media(id) ON DELETE SET NULL,
  revoked_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT consents_subject_check CHECK (
    (subject_type IN ('participant', 'legal_representative')
       AND participant_id IS NOT NULL AND mentor_id IS NULL)
    OR (subject_type = 'mentor' AND mentor_id IS NOT NULL AND participant_id IS NULL)
    OR (subject_type = 'team' AND participant_id IS NULL AND mentor_id IS NULL)
  ),
  -- Отметка без момента проставления и без версии текста недействительна.
  CONSTRAINT consents_accepted_check CHECK (
    NOT accepted OR (accepted_at IS NOT NULL AND document_version <> '')
  )
);

CREATE INDEX IF NOT EXISTS consents_team_idx ON liders.consents (team_id, document_code);
CREATE INDEX IF NOT EXISTS consents_participant_idx ON liders.consents (participant_id);
CREATE INDEX IF NOT EXISTS consents_mentor_idx ON liders.consents (mentor_id);
CREATE INDEX IF NOT EXISTS consents_document_idx ON liders.consents (document_id);

-- У субъекта не может быть двух действующих согласий одного вида в сезоне;
-- после отзыва (revoked_at) запись выходит из индекса и согласие можно дать
-- заново — история при этом сохраняется.
CREATE UNIQUE INDEX IF NOT EXISTS consents_active_subject_idx
  ON liders.consents (
    season_id, document_code, subject_type,
    COALESCE(participant_id, 0), COALESCE(mentor_id, 0), COALESCE(team_id, 0)
  )
  WHERE revoked_at IS NULL;

-- ── Матрица распространения персональных данных (Приложение № 12) ────────────
-- Шесть категорий из пункта 2 бланка: субъект отмечает «разрешаю» или
-- «не разрешаю» по каждой строке отдельно, а не одним общим согласием.
CREATE TABLE IF NOT EXISTS liders.participant_distribution_consents (
  id             BIGSERIAL   PRIMARY KEY,
  participant_id INTEGER     NOT NULL REFERENCES liders.participants(id) ON DELETE CASCADE,
  category_code  TEXT        NOT NULL
                             CHECK (category_code IN (
                               'full_name', 'organization_status', 'region_settlement',
                               'team_initiative_results', 'image_voice', 'social_link'
                             )),
  allowed        BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Условия и запреты субъекта (пункт 3 бланка).
  conditions     TEXT,
  signed_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (participant_id, category_code)
);

CREATE INDEX IF NOT EXISTS participant_distribution_consents_public_idx
  ON liders.participant_distribution_consents (category_code, allowed);
