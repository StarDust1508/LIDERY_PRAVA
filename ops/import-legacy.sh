#!/usr/bin/env bash
# Перенос заявок сезона 2026 из прежней системы в архив платформы.
#
# Требование: ТЗ 10, п. 3.1 — плоские анкеты из SQLite переносятся в таблицу
# `liders.legacy_applications` (полная копия полей + `migrated_at`), доступную
# в админке только на чтение и выгрузку. Смешивать прежнюю модель с командной
# заявкой нельзя: у старой записи нет команды, участников и материалов.
#
# Запуск НА СЕРВЕРЕ (нужны права на чтение базы прежней площадки):
#   bash ops/import-legacy.sh                 # перенос в базу из /etc/lideryprava/api.env
#   DRY_RUN=1 bash ops/import-legacy.sh       # показать, сколько записей будет перенесено
#   LEGACY_DB=/путь/applications.db bash ops/import-legacy.sh
#
# Скрипт идемпотентен: повторный запуск не создаёт дубликатов (UNIQUE по
# `legacy_id`), уже перенесённые записи пропускаются.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEGACY_DB="${LEGACY_DB:-/var/www/lideryprava/data/applications.db}"
ENV_FILE="${ENV_FILE:-/etc/lideryprava/api.env}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP_CSV="${TMP_CSV:-/tmp/lidery-legacy-${STAMP}.csv}"
DRY_RUN="${DRY_RUN:-0}"

step() { printf '\n=== %s ===\n' "$1"; }
note() { printf '    %s\n' "$1"; }
fail() { printf 'ОШИБКА: %s\n' "$1" >&2; exit 1; }

[ -f "$LEGACY_DB" ] || fail "не найдена база прежней системы: $LEGACY_DB"
command -v python3 >/dev/null || fail "нужен python3 для чтения SQLite"

# Секреты подключения: тот же файл, что у сервиса API.
if [ -f "$ENV_FILE" ]; then
    # shellcheck disable=SC1090
    set -a; . "$ENV_FILE"; set +a
fi
DB_NAME="${DATABASE_NAME:-liders}"
DB_USER="${DATABASE_USER:-liders}"
DB_HOST="${DATABASE_HOST:-127.0.0.1}"
DB_PORT="${DATABASE_PORT:-5432}"
export PGPASSWORD="${DATABASE_PASSWORD:-}"

step "1/4 Слепок прежней базы"
# Копия через backup API: обычное копирование файла в режиме WAL теряет
# последние записи, которые ещё лежат в журнале.
SNAPSHOT="${SNAPSHOT:-/root/lideryprava-snapshots/legacy-${STAMP}.db}"
mkdir -p "$(dirname "$SNAPSHOT")"
python3 - "$LEGACY_DB" "$SNAPSHOT" <<'PY'
import sqlite3, sys
src = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
dst = sqlite3.connect(sys.argv[2])
src.backup(dst)
dst.close(); src.close()
print(f"    слепок: {sys.argv[2]}")
PY

step "2/4 Чтение прежних заявок"
TOTAL=$(TMP_CSV="$TMP_CSV" python3 - "$SNAPSHOT" <<'PY'
import csv, os, sqlite3, sys

# Читаем слепок только для чтения и выгружаем в CSV: перенос идёт потоком в
# psql, поэтому промежуточная база и драйверы не нужны.
source = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
rows = source.execute(
    "SELECT id, full_name, email, phone, organization, status, admin_notes,"
    " consent_pdn, consent_terms, consent_marketing, consent_at, source_ip, created_at"
    " FROM applications ORDER BY id"
).fetchall()
with open(os.environ["TMP_CSV"], "w", newline="", encoding="utf-8") as handle:
    writer = csv.writer(handle)
    writer.writerows(rows)
print(len(rows))
PY
)
note "записей в прежней базе: ${TOTAL:-0}; выгрузка: $TMP_CSV"

if [ "${TOTAL:-0}" = "0" ]; then
    note "переносить нечего"
    exit 0
fi

if [ "$DRY_RUN" = "1" ]; then
    step "3/4 Проверка (dry-run)"
    note "будет перенесено записей: $TOTAL"
    note "целевая таблица: ${DB_NAME}.liders.legacy_applications"
    exit 0
fi

step "3/4 Перенос в PostgreSQL"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<SQL
CREATE TEMP TABLE legacy_import (
  legacy_id INTEGER,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  organization TEXT,
  status TEXT,
  admin_notes TEXT,
  consent_pdn BOOLEAN,
  consent_terms BOOLEAN,
  consent_marketing BOOLEAN,
  consent_at TIMESTAMPTZ,
  source_ip TEXT,
  created_at TIMESTAMPTZ
);
\copy legacy_import FROM '$TMP_CSV' WITH (FORMAT csv, NULL '')
INSERT INTO liders.legacy_applications (
  legacy_id, legacy_source, season_year, full_name, email, phone, organization, status, admin_notes,
  consent_pdn, consent_terms, consent_marketing, consent_at, source_ip, submitted_at
)
SELECT legacy_id, 'applications.db', 2026, full_name, COALESCE(email, ''), phone, organization, status,
       admin_notes, COALESCE(consent_pdn, FALSE), COALESCE(consent_terms, FALSE),
       COALESCE(consent_marketing, FALSE), consent_at, source_ip, created_at
  FROM legacy_import
ON CONFLICT (legacy_source, legacy_id) DO NOTHING;
SQL
note "перенос выполнен"

step "4/4 Проверка результата"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT 'перенесено: ' || count(*) FROM liders.legacy_applications"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT 'без согласия на обработку ПДн: ' || count(*) FROM liders.legacy_applications WHERE NOT consent_pdn"

printf '\nГотово. Архив доступен в админке в разделе «Заявки 2026 (архив)».\n'
