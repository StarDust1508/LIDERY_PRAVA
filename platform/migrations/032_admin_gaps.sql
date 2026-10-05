-- 032_admin_gaps.sql
-- Пробелы разделов админки, найденные при сверке с ТЗ 07.
--
-- 1. Апелляции (п. 2.9): в карточке должны быть и приложенный командой скан, и
--    протокол рассмотрения. Протокол уже хранится (`protocol_url`), скана не
--    было: команда не могла приложить подтверждающий документ.
-- 2. Материалы (п. 2.3): нужен статус «содержание заблокировано» — он
--    применяется, когда материал нельзя показывать (нарушение прав, запрещённое
--    содержание). Такой материал остаётся в системе, но файл команде не отдаётся.
-- 3. Мастер-классы (п. 2.10, ТЗ 08 п. 4.3): в карточке прошедшего мастер-класса
--    публикуются материалы занятия — их негде было хранить.

CREATE SCHEMA IF NOT EXISTS liders;

-- ── 1. Апелляции: скан команды ───────────────────────────────────────────────
ALTER TABLE liders.appeals
  ADD COLUMN IF NOT EXISTS scan_media_id UUID REFERENCES liders.media(id) ON DELETE SET NULL;

COMMENT ON COLUMN liders.appeals.scan_media_id IS
  'Скан или документ, приложенный командой к апелляции (п. 2.9 ТЗ 07).';

-- ── 2. Материалы: статус «содержание заблокировано» ──────────────────────────
ALTER TABLE liders.application_materials
  DROP CONSTRAINT IF EXISTS application_materials_status_check;
ALTER TABLE liders.application_materials
  ADD CONSTRAINT application_materials_status_check
  CHECK (status IN ('uploaded', 'accepted', 'needs_fix', 'rejected', 'blocked'));

-- ── 3. Мастер-классы: материалы занятия ─────────────────────────────────────
ALTER TABLE liders.masterclasses
  ADD COLUMN IF NOT EXISTS materials JSONB;

COMMENT ON COLUMN liders.masterclasses.materials IS
  'Материалы мастер-класса: массив объектов { title, url } (ТЗ 08, п. 4.3).';
