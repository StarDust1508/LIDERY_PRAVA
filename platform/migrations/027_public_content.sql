-- 027_public_content.sql
-- Публичный контент: адресуемые мастер-классы и открытые сведения об экспертах.
--
-- Требования: ТЗ 08, п. 2.1 (маршрут /masterclasses/:slug), п. 2.4.5
-- (человекочитаемые slug), п. 4.4 (фильтры по сезону, спикеру и теме),
-- п. 2.1 (/about/organizers берёт данные из experts — только публичные поля).
--
-- Эксперты публикуются выборочно: `is_public` позволяет Оргкомитету скрыть
-- человека, не удаляя запись (удаление запрещено: на неё ссылаются оценки).

CREATE SCHEMA IF NOT EXISTS liders;

-- ── Мастер-классы ────────────────────────────────────────────────────────────

ALTER TABLE liders.masterclasses
  ADD COLUMN IF NOT EXISTS slug TEXT;
-- Тема нужна для фильтра «по теме» (ТЗ 08, п. 4.4); спикер и сезон уже есть.
ALTER TABLE liders.masterclasses
  ADD COLUMN IF NOT EXISTS topic TEXT;

-- Записи, заведённые до появления адресации, получают служебный адрес:
-- человекочитаемый slug формируется в админке при сохранении.
UPDATE liders.masterclasses
   SET slug = 'masterclass-' || id
 WHERE slug IS NULL OR slug = '';

CREATE UNIQUE INDEX IF NOT EXISTS masterclasses_slug_key ON liders.masterclasses (slug);

-- ── Эксперты и члены комиссий ────────────────────────────────────────────────

ALTER TABLE liders.experts
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE liders.experts
  ADD COLUMN IF NOT EXISTS photo_media_id UUID REFERENCES liders.media(id) ON DELETE SET NULL;
ALTER TABLE liders.experts
  ADD COLUMN IF NOT EXISTS about TEXT;

CREATE INDEX IF NOT EXISTS experts_public_idx ON liders.experts (is_public, stage, is_active);

-- ── Сессии личного кабинета ──────────────────────────────────────────────────

-- «Завершить все сеансы» (ТЗ 06, п. 7.4): счётчик эпохи входит в подписанную
-- cookie, поэтому его увеличение гасит все выданные сессии команды, не
-- затрагивая ссылку доступа (её Оргкомитет может выдать заново).
ALTER TABLE liders.teams
  ADD COLUMN IF NOT EXISTS session_epoch INTEGER NOT NULL DEFAULT 1;
