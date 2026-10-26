-- 049_team_messages.sql
-- Переписка «администратор ↔ команда» (ТЗ 06, п. 2.4; ТЗ 07, п. 2.15).
--
-- Одна лента на команду: сообщения Оргкомитета и ответы команды лежат в одной
-- таблице, поэтому в карточке команды и в личном кабинете виден весь диалог.
-- Отметки прочтения раздельные: команда и администратор читают ленту в разное
-- время, и счётчик непрочитанного у каждой стороны свой.
--
-- application_id заполняется, если у команды уже есть заявка: по нему сообщение
-- связывается с заявкой при выгрузке и в карточке, но не заменяет team_id —
-- команда остаётся обязательной связью.

CREATE TABLE IF NOT EXISTS liders.team_messages (
  id                SERIAL      PRIMARY KEY,
  team_id           INTEGER     NOT NULL REFERENCES liders.teams(id) ON DELETE CASCADE,
  application_id    INTEGER     REFERENCES liders.applications(id) ON DELETE SET NULL,
  author_role       TEXT        NOT NULL CHECK (author_role IN ('admin', 'team', 'system')),
  author_name       TEXT,
  body              TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_by_team_at   TIMESTAMPTZ,
  read_by_admin_at  TIMESTAMPTZ
);

COMMENT ON TABLE liders.team_messages IS
  'Лента переписки Оргкомитета с командой: сообщения админа, ответы команды и системные записи.';

-- Основной выборки ленты — все сообщения команды в хронологическом порядке.
CREATE INDEX IF NOT EXISTS team_messages_team_created_idx
  ON liders.team_messages (team_id, created_at);
-- Непрочитанные для команды: частичный индекс, чтобы счётчик не читал всю ленту.
CREATE INDEX IF NOT EXISTS team_messages_team_unread_idx
  ON liders.team_messages (team_id, created_at)
  WHERE read_by_team_at IS NULL;
-- Непрочитанные для администратора.
CREATE INDEX IF NOT EXISTS team_messages_admin_unread_idx
  ON liders.team_messages (team_id, created_at)
  WHERE read_by_admin_at IS NULL;
