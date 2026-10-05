#!/usr/bin/env bash
# Ежедневный дамп БД платформы «Лидеры права».
# Запускается от systemd-таймера в 03:30 (МСК). Хранит 30 последних копий.
set -euo pipefail

DB_NAME="${DB_NAME:-liders}"
DB_USER="${DB_USER:-liders}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
BACKUP_DIR="${BACKUP_DIR:-/root/db-backups/lideryprava}"
KEEP="${KEEP:-30}"
STAMP="$(date +%Y%m%d-%H%M%S)"

# Пароль берём из того же файла окружения, что и сервис API: systemd передаёт
# DATABASE_PASSWORD, а pg_dump читает PGPASSWORD.
export PGPASSWORD="${PGPASSWORD:-${DATABASE_PASSWORD:-}}"
FILE="${BACKUP_DIR}/liders-${STAMP}.dump"

install -d -m 700 "${BACKUP_DIR}"

echo "[$(date '+%F %T')] Дамп ${DB_NAME} → ${FILE}"
pg_dump --format=custom --no-owner --no-privileges \
        --host="${DB_HOST}" --port="${DB_PORT}" --username="${DB_USER}" \
        --file="${FILE}" "${DB_NAME}"

# Проверка целостности дампа сразу после создания — иначе копия бесполезна
pg_restore --list "${FILE}" > /dev/null
SIZE="$(du -h "${FILE}" | cut -f1)"
echo "[$(date '+%F %T')] Дамп создан и проверен: ${FILE} (${SIZE})"

# Ротация: оставить KEEP последних копий
ls -1t "${BACKUP_DIR}"/liders-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
    echo "[$(date '+%F %T')] Удаляю старую копию: ${old}"
    rm -f -- "${old}"
done

echo "[$(date '+%F %T')] Готово. Копий в каталоге: $(ls -1 "${BACKUP_DIR}"/liders-*.dump 2>/dev/null | wc -l | tr -d ' ')"
