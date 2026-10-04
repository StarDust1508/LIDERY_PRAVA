-- 024_mentor_consent_timestamp.sql
-- Момент получения согласия наставника.
--
-- Код личного кабинета записывал mentors.consent_received_at, но в схеме
-- (миграция 003) такого поля не было: согласие наставника фиксировалось только
-- флагом, без даты и времени, что противоречит пункту 14.3 Положения —
-- при электронной форме согласия фиксируются дата, время и сетевой адрес.
--
-- Поле добавляется, а не заменяется: флаг consent_received остаётся для
-- совместимости, время переносится из updated_at у уже отмеченных согласий.

CREATE SCHEMA IF NOT EXISTS liders;

ALTER TABLE liders.mentors
  ADD COLUMN IF NOT EXISTS consent_received_at TIMESTAMPTZ;

UPDATE liders.mentors
   SET consent_received_at = updated_at
 WHERE consent_received IS TRUE
   AND consent_received_at IS NULL;
