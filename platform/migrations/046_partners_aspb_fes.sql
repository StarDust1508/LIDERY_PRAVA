-- 046_partners_aspb_fes.sql
-- Партнёры конкурса: АСПБ и ФЭС (просьба заказчика от 23.10.2026).
--
-- Уточнено по материалам проекта: АСПБ — ООО «Агентство сопровождения процедур
-- банкротства» (aspb.pro). ФЭС — ООО «ФЭС» (Саратов, услуги в области права),
-- «ФЭС. АУ»; логотип в материалов не найден, поэтому запись без логотипа.
-- Записи идемпотентны: повторный запуск не дублирует.

INSERT INTO liders.partners (name, url, partner_type, description, sort_order, is_active)
SELECT v.name, v.url, 'partner', v.description, v.sort_order, TRUE
  FROM (
    VALUES
      ('АСПБ — Агентство сопровождения процедур банкротства', 'https://aspb.pro', 'Партнёр конкурса.', 30),
      ('ФЭС', NULL, 'Информационный партнёр конкурса.', 40)
  ) AS v(name, url, description, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM liders.partners p WHERE p.name = v.name);
