-- 036_rankings_protocol.sql
-- PDF протокола этапа (ТЗ 07, п. 2.8, п. 3: «Кнопка „Опубликовать“ — загружается
-- PDF протокола»).
--
-- Протокол — документ, который Оргкомитет публикует вместе с рейтингом: баллы
-- видны в личном кабинете, а сам протокол участник скачивает. Раньше хранить
-- файл было негде, и публикация ограничивалась отметкой в базе.

ALTER TABLE liders.rankings
    ADD COLUMN IF NOT EXISTS protocol_media_id UUID REFERENCES liders.media(id) ON DELETE SET NULL;

COMMENT ON COLUMN liders.rankings.protocol_media_id IS
    'PDF протокола этапа, загруженный Оргкомитетом при публикации (ТЗ 07, п. 2.8).';
