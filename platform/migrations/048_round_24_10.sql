-- 048_round_24_10.sql
-- Правки заказчика от 24.10.2026: сроки первого этапа, состав команды
-- «КиберЪОко», партнёры и описания.

-- 1. Первый этап: 1–31 марта 2027 — чтобы в кабинете этап был «предстоит».
UPDATE liders.seasons
   SET stage1_from = TIMESTAMPTZ '2027-03-01 00:00:00+03',
       stage1_to   = TIMESTAMPTZ '2027-03-31 23:59:00+03',
       updated_at  = now()
 WHERE is_active;

-- 2. «КиберЪОко»: полный состав команды-победителя 2026 года.
UPDATE liders.winners
   SET participants_text = 'Кривошеев Владислав Иванович, Тополенко Елизавета Константиновна, Кострова Ксения Ивановна',
       updated_at = now()
 WHERE season_year = 2026 AND team_name = 'КиберЪОко';

-- 3. ФЭС — партнёр конкурса (не информационный).
UPDATE liders.partners
   SET description = 'Партнёр конкурса.', updated_at = now()
 WHERE name = 'ФЭС';

-- 4. «Технологии Права» — партнёр конкурса.
INSERT INTO liders.partners (name, url, partner_type, description, sort_order, is_active)
SELECT 'Технологии Права', 'https://tech-pravo.ru', 'partner', 'Партнёр конкурса.', 50, TRUE
 WHERE NOT EXISTS (SELECT 1 FROM liders.partners p WHERE p.name = 'Технологии Права');
