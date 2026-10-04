-- 023_applications_submission.sql
-- Приём заявок с сайта (ТЗ 05, п. 3.2): публичный номер заявки, защита от
-- повторной отправки, блокировка содержания после приёма и отметка черновика.
--
-- Публичный номер нужен для входа в личный кабинет и для проверки статуса:
-- он не является персональными данными и не даёт доступа к чужим сведениям
-- без адреса электронной почты капитана.
--
-- Идемпотентность: повторная отправка с тем же ключом не создаёт вторую заявку
-- (ТЗ 03, п. 5.5; ТЗ 05, п. 1.5).

CREATE SCHEMA IF NOT EXISTS liders;

ALTER TABLE liders.applications
  ADD COLUMN IF NOT EXISTS public_number    TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key  TEXT,
  -- После окончания приёма содержание инициативы менять нельзя (п. 7.5):
  -- досдаются только недостающие документы по замечанию Оргкомитета.
  ADD COLUMN IF NOT EXISTS content_locked   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS draft_updated_at TIMESTAMPTZ,
  -- Сетевой адрес подачи фиксируется отдельно от адреса создания черновика.
  ADD COLUMN IF NOT EXISTS submitted_ip     TEXT;

-- Номер уникален, но допускает пустое значение у заявок, перенесённых из архива.
CREATE UNIQUE INDEX IF NOT EXISTS applications_public_number_idx
  ON liders.applications (public_number) WHERE public_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS applications_idempotency_key_idx
  ON liders.applications (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Номер вида LP-2027-000123: год сезона и порядковый идентификатор заявки.
UPDATE liders.applications a
   SET public_number = 'LP-' || s.year || '-' || lpad(a.id::text, 6, '0')
  FROM liders.seasons s
 WHERE s.id = a.season_id
   AND a.public_number IS NULL;

-- Черновик, который не отправлен, легко найти для напоминаний и уборки.
CREATE INDEX IF NOT EXISTS applications_draft_idx
  ON liders.applications (draft_updated_at DESC)
  WHERE submitted_at IS NULL;
