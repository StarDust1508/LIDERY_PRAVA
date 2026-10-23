-- 045_winners_history.sql
-- Победители прошлых сезонов: 2018, 2021, 2023, 2026.
--
-- До этой миграции таблица winners была пуста, и страница «Победители» ничего
-- не показывала. Данные собраны по официальным публикациям вузов и СМИ
-- (ssla-av.ru, ИА «Регион 64», dvfu.ru, crb.rgup.ru, agprf.org); за 2019, 2020,
-- 2022, 2024 и 2025 публичных данных нет — их должен добавить Оргкомитет.
-- Записи идемпотентны: повторный запуск ничего не дублирует.

INSERT INTO liders.winners
  (season_id, season_year, nomination, place, team_name, participants_text,
   mentors_text, initiative_title, announcement, is_published, sort_order)
SELECT s.id, v.season_year, v.nomination, v.place, v.team_name, v.participants_text,
       v.mentors_text, v.initiative_title, v.announcement, TRUE, v.sort_order
  FROM (
    VALUES
      (2018, 'Победитель конкурса', 1, 'Ораторы',
       'Команда Саратовской государственной юридической академии.',
       NULL, NULL,
       'Финал прошёл 5 февраля 2018 года в Саратовской областной универсальной научной библиотеке.',
       10),
      (2021, 'Победитель конкурса', 1, 'СССР',
       'Команда Волгоградского государственного университета.',
       NULL, NULL,
       'Финал прошёл 16 апреля 2021 года в СГЮА; в конкурсе участвовали 19 команд.',
       20),
      (2023, 'Победитель конкурса', 1, 'Юридическая школа ДВФУ',
       'Абоян Агавни, Гордеев Кирилл, Парин Дмитрий.',
       'Тренер — Шишкина О. Е.',
       NULL,
       'Финал 2023 года: 98 заявок, 20 команд из 16 регионов. Второе место — «ЛИКБЕЗ» (Крымский филиал РГУП).',
       30),
      (2026, 'Комфортная среда для жизни', 1, 'КиберЪОко',
       'Команда Дальневосточного юридического института (филиала) Университета прокуратуры Российской Федерации; участник — Кострова Ксения.',
       'Куратор — Сыромля Л. Б.',
       'Проект «ОкоЪ против наркограффити»',
       'Абсолютный победитель девятого сезона; финал 22 апреля 2026 года в рамках V Саратовского юридического форума.',
       40)
  ) AS v(season_year, nomination, place, team_name, participants_text, mentors_text,
         initiative_title, announcement, sort_order)
  JOIN liders.seasons s ON s.is_active
 WHERE NOT EXISTS (
   SELECT 1 FROM liders.winners w
    WHERE w.season_year = v.season_year AND w.team_name = v.team_name
 );

CREATE INDEX IF NOT EXISTS winners_year_idx ON liders.winners (season_year, sort_order);
