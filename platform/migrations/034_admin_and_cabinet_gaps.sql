-- 034_admin_and_cabinet_gaps.sql
-- Остаток ТЗ 07 и ТЗ 06, найденный при сверке с попунктовым аудитом.
--
-- 1. Оценки (ТЗ 07, п. 2.7): признак конфликта интересов. Оценка члена комиссии,
--    у которого есть личная заинтересованность, сохраняется, но исключается из
--    подсчёта и не учитывается при проверке «не менее трёх оценок».
-- 2. Апелляции (ТЗ 07, п. 2.9): срок рассмотрения — пять рабочих дней. Срок
--    считается при регистрации апелляции и виден Оргкомитету как просроченный.
-- 3. Мастер-классы (ТЗ 07, п. 2.10): обложка для карточки и статус «отменён».
-- 4. Новости (ТЗ 07, п. 2.12): привязка публикации к сезону конкурса и признак
--    того, что ссылка на видео ведёт на российский видеосервис.
-- 5. Команды (ТЗ 06, п. 1.2а и 3): статус «ожидает согласие законного
--    представителя» и отметка об использованном однократном изменении состава.

-- ── 1. Оценки: конфликт интересов ───────────────────────────────────────────
ALTER TABLE liders.evaluations
    ADD COLUMN IF NOT EXISTS is_conflicted BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS conflict_reason TEXT;

COMMENT ON COLUMN liders.evaluations.is_conflicted IS
    'Оценка с конфликтом интересов: сохраняется, но исключается из подсчёта (ТЗ 07, п. 2.7).';

-- ── 2. Апелляции: срок рассмотрения ─────────────────────────────────────────
ALTER TABLE liders.appeals
    ADD COLUMN IF NOT EXISTS decision_due_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ;

COMMENT ON COLUMN liders.appeals.decision_due_at IS
    'Срок рассмотрения апелляции — пять рабочих дней с регистрации (ТЗ 07, п. 2.9).';

-- ── 3. Мастер-классы: обложка и статус «отменён» ────────────────────────────
ALTER TABLE liders.masterclasses
    ADD COLUMN IF NOT EXISTS cover_media_id UUID REFERENCES liders.media(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE liders.masterclasses
    DROP CONSTRAINT IF EXISTS masterclasses_status_check;

ALTER TABLE liders.masterclasses
    ADD CONSTRAINT masterclasses_status_check
    CHECK (status IN ('announced', 'past', 'cancelled'));

-- ── 4. Новости: сезон и признак российского видеосервиса ────────────────────
ALTER TABLE liders.news
    ADD COLUMN IF NOT EXISTS season_id INTEGER REFERENCES liders.seasons(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS news_season_idx ON liders.news (season_id, published_at DESC NULLS LAST);

-- ── 5. Команды: статус ожидания согласия и однократное изменение состава ────
ALTER TABLE liders.teams
    DROP CONSTRAINT IF EXISTS teams_status_check;

ALTER TABLE liders.teams
    ADD CONSTRAINT teams_status_check
    CHECK (status IN (
      'draft', 'submitted', 'tech_check', 'tech_rejected',
      'awaiting_legal_representative_consent',
      'allowed', 'stage1', 'finalist', 'final', 'winner',
      'disqualified', 'withdrawn'
    ));

ALTER TABLE liders.teams
    ADD COLUMN IF NOT EXISTS roster_change_used_at TIMESTAMPTZ;

COMMENT ON COLUMN liders.teams.roster_change_used_at IS
    'Момент единственного разрешённого изменения состава до публикации итогов (ТЗ 06, п. 3).';
