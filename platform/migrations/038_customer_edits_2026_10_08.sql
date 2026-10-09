-- Правки заказчика от 8 октября 2026 года (сообщение с 25 замечаниями).
--
-- 1. Единая почта Оргкомитета — lidery.prava@mail.ru (п. 16 замечаний).
-- 2. Справка об обучении (или копия документа об образовании) больше не
--    требуется: материал исключён из комплекта (п. 13). Тип сохраняется в
--    закрытом перечне, чтобы уже загруженные файлы читались.

UPDATE liders.site_settings
   SET value = '{"value": "lidery.prava@mail.ru"}'::jsonb,
       updated_at = now()
 WHERE key = 'site.contact_email';

UPDATE liders.material_requirements
   SET is_active = FALSE,
       is_required = FALSE
 WHERE type = 'status_proof';
