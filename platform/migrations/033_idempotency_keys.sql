-- 033_idempotency_keys.sql
-- Идемпотентность изменяющих запросов (ТЗ 05, п. 1.5).
--
-- Требование: POST /api/applications, POST /api/leads и POST /api/cabinet/materials
-- принимают заголовок Idempotency-Key, и повтор с тем же ключом не создаёт
-- вторую запись. У заявок ключ хранился с миграции 023; у обращений и
-- материалов его не было — двойное нажатие кнопки или повтор запроса при
-- обрыве связи создавали дубликат.
--
-- Ключ уникален в пределах таблицы: повтор возвращает уже созданную запись.

ALTER TABLE liders.application_materials
    ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS application_materials_idempotency_key_idx
    ON liders.application_materials (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

ALTER TABLE liders.leads
    ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS leads_idempotency_key_idx
    ON liders.leads (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN liders.application_materials.idempotency_key IS
    'Ключ идемпотентности загрузки материала: повтор с тем же ключом возвращает существующую запись (ТЗ 05, п. 1.5).';
COMMENT ON COLUMN liders.leads.idempotency_key IS
    'Ключ идемпотентности обращения: повтор с тем же ключом не создаёт второе обращение (ТЗ 05, п. 1.5).';
