-- 015_audit_log.sql
-- Журнал действий администраторов и операторов (ТЗ 04, п. 3.7; ТЗ 07).
--
-- access_log фиксирует только входы в кабинет и админку. Этот журнал отвечает на
-- вопрос «кто, что и когда изменил»: решения по заявкам, публикация рейтинга и
-- архива, массовые операции, выгрузки. Для каждой записи хранится состояние
-- «до» и «после», чтобы решение можно было объяснить постфактум.

CREATE SCHEMA IF NOT EXISTS liders;

CREATE TABLE IF NOT EXISTS liders.audit_log (
  id          BIGSERIAL   PRIMARY KEY,
  actor_type  TEXT        NOT NULL DEFAULT 'admin'
                          CHECK (actor_type IN ('admin', 'operator', 'system')),
  user_id     INTEGER     REFERENCES liders.users(id) ON DELETE SET NULL,
  -- Подпись действующего лица на момент записи: остаётся читаемой, даже если
  -- учётная запись позже удалена.
  actor_label TEXT,
  action      TEXT        NOT NULL,
  entity      TEXT        NOT NULL,
  entity_id   TEXT,
  before      JSONB,
  after       JSONB,
  ip          TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_entity_idx
  ON liders.audit_log (entity, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_user_idx
  ON liders.audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_idx
  ON liders.audit_log (action, created_at DESC);
