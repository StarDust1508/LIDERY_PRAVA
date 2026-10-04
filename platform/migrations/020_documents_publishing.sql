-- 020_documents_publishing.sql
-- Публикация Положения и Приложений № 1–14 редакции 04.10.2026 и адрес
-- официальной формы подачи заявки (ТЗ 04, п. 9; ТЗ 09).
--
-- Что меняется в таблице documents (миграция 009):
--   1) закрытый перечень type дополняется значением appendix — строками
--      Приложений № 1–14;
--   2) ограничение UNIQUE (type, version) не позволяло хранить 14 приложений
--      одной редакции: заменяется на UNIQUE (type, version, title).
--
-- PDF лежат в platform/public/docs и отдаются сайтом как /docs/<файл>.
-- Подписанный экземпляр появится позже отдельным файлом; строки таблицы
-- хранят версию и дату редакции, с которой соглашается участник (п. 14.3).

CREATE SCHEMA IF NOT EXISTS liders;

ALTER TABLE liders.documents
  DROP CONSTRAINT IF EXISTS documents_type_check;
ALTER TABLE liders.documents
  ADD CONSTRAINT documents_type_check
  CHECK (type IN (
    'regulation', 'appendix', 'privacy_policy', 'consent_pdn',
    'consent_distribution', 'consent_legal_representative',
    'license_terms', 'appeal_form', 'other'
  ));

ALTER TABLE liders.documents
  DROP CONSTRAINT IF EXISTS documents_type_version_key;
ALTER TABLE liders.documents
  DROP CONSTRAINT IF EXISTS documents_type_version_title_key;
ALTER TABLE liders.documents
  ADD CONSTRAINT documents_type_version_title_key UNIQUE (type, version, title);

-- ── Положение о конкурсе ─────────────────────────────────────────────────────
INSERT INTO liders.documents (
  type, title, version, revision_date, external_url, requires_acceptance, sort_order
) VALUES (
  'regulation',
  'Положение о Десятом ежегодном федеральном научно-образовательном конкурсе «Лидеры права – 2027»',
  '2026-10-04',
  DATE '2026-10-04',
  '/docs/polozhenie-lidery-prava-2027.pdf',
  TRUE,
  0
)
ON CONFLICT DO NOTHING;

-- ── Приложения № 1–14 ────────────────────────────────────────────────────────
-- Единый PDF содержит все приложения; requires_acceptance = TRUE у форм
-- согласий (№ 10–13), с которыми участник соглашается при подаче заявки.
INSERT INTO liders.documents (
  type, title, version, revision_date, external_url, requires_acceptance, sort_order
)
SELECT 'appendix', v.title, '2026-10-04', DATE '2026-10-04',
       '/docs/prilozheniya-lidery-prava-2027.pdf', v.requires_acceptance, v.sort_order
  FROM (VALUES
    ('Приложение № 1. Форма заявки на участие в конкурсе', FALSE, 1),
    ('Приложение № 2. Направления для подготовки законотворческих инициатив', FALSE, 2),
    ('Приложение № 3. Требования к тексту проекта законотворческой инициативы (законопроекта)', FALSE, 3),
    ('Приложение № 4. Требования к пояснительной записке к законопроекту', FALSE, 4),
    ('Приложение № 5. Требования к перечню актов и сравнительной таблице', FALSE, 5),
    ('Приложение № 6. Требования к оформлению конкурсных материалов', FALSE, 6),
    ('Приложение № 7. Требования к видеоролику и презентационным материалам', FALSE, 7),
    ('Приложение № 8. Регламент дебатов финального этапа', FALSE, 8),
    ('Приложение № 9. Форма оценочного листа', FALSE, 9),
    ('Приложение № 10. Согласие на обработку персональных данных (участник, наставник, достигший 18 лет)', TRUE, 10),
    ('Приложение № 11. Согласие законного представителя на участие несовершеннолетнего в конкурсе и обработку его персональных данных', TRUE, 11),
    ('Приложение № 12. Согласие на обработку персональных данных, разрешённых субъектом персональных данных для распространения', TRUE, 12),
    ('Приложение № 13. Согласие на использование изображения и предоставление права использования конкурсных материалов', TRUE, 13),
    ('Приложение № 14. Форма апелляционного заявления', FALSE, 14)
  ) AS v(title, requires_acceptance, sort_order)
ON CONFLICT DO NOTHING;

-- ── Настройки: версия документов и официальный канал подачи ─────────────────
-- Заполняются только пустые значения: если Оргкомитет уже правил настройку
-- через админку, миграция её не перезаписывает.
INSERT INTO liders.site_settings (key, value, description) VALUES
  ('documents.current_version',
   '{"value": "2026-10-04"}'::jsonb,
   'Действующая редакция Положения и Приложений, с которой соглашается участник')
ON CONFLICT (key) DO NOTHING;

UPDATE liders.site_settings
   SET value = '{"value": "/apply"}'::jsonb,
       updated_at = now()
 WHERE key = 'site.application_form_url'
   AND COALESCE(value ->> 'value', '') = '';
