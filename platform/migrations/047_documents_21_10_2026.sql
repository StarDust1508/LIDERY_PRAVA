-- 047_documents_21_10_2026.sql
-- Редакция Положения и Приложений от 21.10.2026.
--
-- Что меняется:
--   • приложений стало 17: добавлены протокол Оргкомитета (15), протокол
--     Конкурсной комиссии (16) и бюллетень тайного голосования (17);
--   • файлы Положения и Приложений пересобраны из новой редакции DOCX,
--     из них нарезаны 17 отдельных PDF;
--   • дата редакции документов — 21.10.2026.
--
-- Платформа сохраняет электронную подачу и электронные согласия (решение
-- заказчика от 04.10.2026): пункты новой редакции про Яндекс.Форму и бумажные
-- согласия на сайте не применяются — это отражено в разделах сайта.

UPDATE liders.documents
   SET revision_date = DATE '2026-10-21',
       version = '2026-10-21',
       updated_at = now()
 WHERE type IN ('regulation', 'appendix');

INSERT INTO liders.documents (type, title, version, external_url, revision_date, is_active, sort_order)
SELECT 'appendix', v.title, '2026-10-21', v.url, DATE '2026-10-21', TRUE, v.sort_order
  FROM (
    VALUES
      ('Приложение № 15. Протокол заседания Организационного комитета', '/docs/prilozhenie-15.pdf', 150),
      ('Приложение № 16. Протокол заседания Конкурсной комиссии', '/docs/prilozhenie-16.pdf', 160),
      ('Приложение № 17. Бюллетень для тайного голосования второго (финального) этапа', '/docs/prilozhenie-17.pdf', 170)
  ) AS v(title, url, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM liders.documents d WHERE d.external_url = v.url);
