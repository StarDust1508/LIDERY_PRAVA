-- 025_legal_documents.sql
-- Юридические документы сайта конкурса (ТЗ 09, п. 4).
--
-- Документы написаны заново по Положению и Приложениям № 10–13 и по данным
-- Ассоциации. Копировать тексты с сайта Ассоциации запрещено: там чужой сайт в
-- тексте, нет дат редакции, оферта написана про мобильное приложение.
--
-- Записи создаются НЕОПУБЛИКОВАННЫМИ (is_active = FALSE): в админке их видно,
-- на сайте они не выводятся до утверждения Правлением Ассоциации. Публичный API
-- отдаёт только документы с is_active = TRUE.
--
-- Тексты лежат в docs/legal/*.md, PDF для публикации — в platform/public/docs/legal/.

CREATE SCHEMA IF NOT EXISTS liders;

-- Перечень типов документов дополняется юридическими документами сайта.
ALTER TABLE liders.documents
  DROP CONSTRAINT IF EXISTS documents_type_check;
ALTER TABLE liders.documents
  ADD CONSTRAINT documents_type_check
  CHECK (type IN (
    'regulation', 'appendix',
    'offer', 'privacy_policy', 'terms', 'cookies_policy',
    'jury_regulations', 'mailing_consent',
    'consent_pdn', 'consent_distribution', 'consent_legal_representative',
    'license_terms', 'appeal_form', 'other'
  ));

INSERT INTO liders.documents (
  type, title, version, revision_date, external_url, requires_acceptance, is_active, sort_order
) VALUES
  ('offer',
   'Оферта сайта конкурса «Лидеры права – 2027»',
   '2026-10-04', DATE '2026-10-04', '/docs/legal/oferta.pdf', TRUE, FALSE, 20),
  ('privacy_policy',
   'Политика в отношении обработки персональных данных',
   '2026-10-04', DATE '2026-10-04', '/docs/legal/privacy-policy.pdf', TRUE, FALSE, 21),
  ('terms',
   'Пользовательское соглашение сайта конкурса «Лидеры права – 2027»',
   '2026-10-04', DATE '2026-10-04', '/docs/legal/user-agreement.pdf', TRUE, FALSE, 22),
  ('cookies_policy',
   'Политика использования cookie-файлов',
   '2026-10-04', DATE '2026-10-04', '/docs/legal/cookies-policy.pdf', TRUE, FALSE, 23),
  ('jury_regulations',
   'Регламент Жюри и урегулирования конфликта интересов',
   '2026-10-04', DATE '2026-10-04', '/docs/legal/jury-regulations.pdf', FALSE, FALSE, 24),
  ('mailing_consent',
   'Согласие на получение информационных и новостных сообщений',
   '2026-10-04', DATE '2026-10-04', '/docs/legal/mailing-consent.pdf', FALSE, FALSE, 25)
ON CONFLICT DO NOTHING;
