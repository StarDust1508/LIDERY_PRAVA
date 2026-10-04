-- 013_material_types_requirements.sql
-- Комплект конкурсных материалов: коды типов по ТЗ 02, п. 5 и требования к
-- составу комплекта по этапам (п. 7.2, 8.2–8.4, 9.2 Положения).
--
-- Таблица application_materials (миграция 004) знала восемь кодов. В ТЗ 02, п. 5
-- используются ещё четыре: заявка, формируемая системой (application_form),
-- согласия (consent_pdn, consent_legal_rep) и справка о статусе участника
-- (status_proof). Расширяем закрытый перечень, не удаляя прежние коды.
--
-- Требования к комплекту вынесены в БД: сроки и состав меняются решением
-- Оргкомитета, а не правкой кода (ТЗ 04, п. 3.7).

CREATE SCHEMA IF NOT EXISTS liders;

ALTER TABLE liders.application_materials
  DROP CONSTRAINT IF EXISTS application_materials_type_check;
ALTER TABLE liders.application_materials
  ADD CONSTRAINT application_materials_type_check
  CHECK (type IN (
    'application_form',
    'law_draft',
    'explanatory_note',
    'acts_list',
    'comparison_table',
    'video_link',
    'presentation',
    'status_proof',
    'consent',
    'consent_pdn',
    'consent_legal_rep',
    'other'
  ));

-- ── Требования к комплекту по этапам ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS liders.material_requirements (
  id                 SERIAL      PRIMARY KEY,
  season_id          INTEGER     NOT NULL REFERENCES liders.seasons(id) ON DELETE CASCADE,
  stage              TEXT        NOT NULL CHECK (stage IN ('selection', 'stage1', 'final')),
  type               TEXT        NOT NULL,
  title              TEXT        NOT NULL,
  is_required        BOOLEAN     NOT NULL DEFAULT TRUE,
  due_at             TIMESTAMPTZ,
  max_files          INTEGER     NOT NULL DEFAULT 1 CHECK (max_files > 0),
  -- Форматы Приложения № 6: текстовые материалы — .docx и .pdf, скан — PDF
  -- или изображение.
  allowed_extensions TEXT[]      NOT NULL DEFAULT ARRAY['docx', 'pdf']::text[],
  -- Шаблон имени файла «Команда_Документ» (Приложение № 6, п. 3).
  name_template      TEXT,
  description        TEXT,
  sort_order         INTEGER     NOT NULL DEFAULT 0,
  is_active          BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (season_id, stage, type)
);

CREATE INDEX IF NOT EXISTS material_requirements_stage_idx
  ON liders.material_requirements (season_id, stage, sort_order);

-- ── Отборочный этап: комплект по п. 7.2 ──────────────────────────────────────
-- Срок — дата закрытия приёма заявок сезона (11.12.2026, 23:59:59 МСК).
INSERT INTO liders.material_requirements (
  season_id, stage, type, title, is_required, due_at, max_files,
  allowed_extensions, name_template, description, sort_order
)
SELECT s.id, 'selection', v.type, v.title, v.is_required, s.application_close_at, v.max_files,
       v.allowed_extensions, v.name_template, v.description, v.sort_order
  FROM liders.seasons s
  CROSS JOIN (VALUES
    ('application_form', 'Заявка на участие (Приложение № 1)', FALSE, 1, ARRAY['docx', 'pdf']::text[], 'Команда_Заявка',
     'Формируется системой в электронном виде и доступна в личном кабинете; представление отдельного файла не требуется (Приложение № 1, ред. 04.10.2026).', 1),
    ('law_draft', 'Текст проекта законотворческой инициативы', TRUE, 1, ARRAY['docx', 'pdf']::text[], 'Команда_Законопроект',
     'Оформляется по Приложениям № 3 и 6; оригинальность текста не менее 70 процентов (п. 7.4).', 2),
    ('explanatory_note', 'Пояснительная записка к законопроекту', TRUE, 1, ARRAY['docx', 'pdf']::text[], 'Команда_Пояснительная_записка',
     'Оформляется по Приложениям № 4 и 6, с экономическим обоснованием.', 3),
    ('acts_list', 'Перечень актов, подлежащих изменению', FALSE, 1, ARRAY['docx', 'pdf']::text[], 'Команда_Перечень_актов',
     'Приложение № 5; представляется вместе с законопроектом.', 4),
    ('comparison_table', 'Сравнительная таблица', FALSE, 1, ARRAY['docx', 'pdf']::text[], 'Команда_Сравнительная_таблица',
     'Приложение № 5; представляется вместе с законопроектом.', 5),
    ('consent_pdn', 'Согласие на обработку персональных данных (Приложения № 10–12)', FALSE, 1, ARRAY['pdf']::text[], 'Команда_Согласие',
     'Оформляется электронной отметкой в мастере подачи; загрузка файла не требуется (п. 14.3).', 6),
    ('consent_legal_rep', 'Согласие законного представителя (Приложение № 11)', FALSE, 1, ARRAY['pdf', 'jpg', 'jpeg', 'png']::text[], 'Команда_Согласие_законного_представителя',
     'Обязательно для участников младше 18 лет: электронная отметка и скан подписанного бланка (п. 4.8, 7.2).', 7)
  ) AS v(type, title, is_required, max_files, allowed_extensions, name_template, description, sort_order)
 WHERE s.slug = '2027'
ON CONFLICT (season_id, stage, type) DO NOTHING;

-- ── Первый этап: видеоролик (п. 8.2–8.4) ─────────────────────────────────────
-- Срок — 15.02.2027, 23:59:59 МСК.
INSERT INTO liders.material_requirements (
  season_id, stage, type, title, is_required, due_at, max_files,
  allowed_extensions, name_template, description, sort_order
)
SELECT s.id, 'stage1', 'video_link', 'Ссылка на видеоролик во «ВКонтакте»', TRUE,
       '2027-02-15T23:59:59+03:00'::timestamptz, 1, ARRAY[]::text[], NULL,
       'Публикация на стене личной страницы или сообщества команды с хэштегом #Лидеры_права_2027, названием команды и законопроекта; для номинации «Приз зрительских симпатий» — дополнительно #ВПраве (п. 8.3).', 1
  FROM liders.seasons s
 WHERE s.slug = '2027'
ON CONFLICT (season_id, stage, type) DO NOTHING;

-- ── Финальный этап: презентация и подтверждение статуса (п. 9.2) ─────────────
-- Срок — не позднее чем за 7 календарных дней до начала финала.
INSERT INTO liders.material_requirements (
  season_id, stage, type, title, is_required, due_at, max_files,
  allowed_extensions, name_template, description, sort_order
)
SELECT s.id, 'final', v.type, v.title, v.is_required,
       s.final_from - INTERVAL '7 days', v.max_files,
       v.allowed_extensions, v.name_template, v.description, v.sort_order
  FROM liders.seasons s
  CROSS JOIN (VALUES
    ('presentation', 'Презентационные материалы', TRUE, 1, ARRAY['pdf', 'pptx']::text[], 'Команда_Презентация',
     'Представляются не позднее чем за 7 календарных дней до даты финала (п. 9.2).', 1),
    ('status_proof', 'Справка об обучении или копия документа об образовании', TRUE, 1, ARRAY['pdf', 'jpg', 'jpeg', 'png']::text[], 'Команда_Справка_об_обучении',
     'Подтверждение статуса участника: справка об обучении (не ранее 01.09.2026) либо копия документа об образовании.', 2)
  ) AS v(type, title, is_required, max_files, allowed_extensions, name_template, description, sort_order)
 WHERE s.slug = '2027'
ON CONFLICT (season_id, stage, type) DO NOTHING;
