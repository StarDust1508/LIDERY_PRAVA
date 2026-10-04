-- 021_official_contacts.sql
-- Официальные контакты и ресурсы конкурса (ТЗ 02, п. 11).
--
-- Контакты не хранятся в коде: они живут в настройках сайта и правятся из
-- админки. Здесь заполняются значения, подтверждённые представителем
-- Ассоциации. Прежняя почта support@lideryprava.ru не существует и не
-- используется — в настройках её быть не должно.
--
-- Миграция трогает только пустые значения: если Оргкомитет уже задал контакт
-- через админку, он сохраняется.

CREATE SCHEMA IF NOT EXISTS liders;

UPDATE liders.site_settings
   SET value = '{"value": "https://vk.com/lideri.prava2026"}'::jsonb,
       updated_at = now()
 WHERE key = 'site.vk_community'
   AND COALESCE(value ->> 'value', '') = '';

UPDATE liders.site_settings
   SET value = '{"value": "ssla_av@mail.ru"}'::jsonb,
       updated_at = now()
 WHERE key = 'site.contact_email'
   AND COALESCE(value ->> 'value', '') = '';

UPDATE liders.site_settings
   SET value = '{"value": "+7 (906) 074-73-13"}'::jsonb,
       updated_at = now()
 WHERE key = 'site.contact_phone'
   AND COALESCE(value ->> 'value', '') = '';

-- Руководитель Оргкомитета: контакт для режима «дедлайн пропущен» в кабинете
-- (п. 17.1 Положения; ТЗ 06, п. 6).
INSERT INTO liders.site_settings (key, value, description) VALUES
  ('site.organizer_head',
   '{"value": "Тажибов Арслан Азизович", "phone": "8 (966) 789-76-05", "vk": "https://vk.ru/id274466891"}'::jsonb,
   'Руководитель Оргкомитета конкурса (п. 17.1 Положения)')
ON CONFLICT (key) DO NOTHING;
