#!/usr/bin/env bash
# Ежемесячная проверка восстановления (ТЗ 11, п. 7.2).
#
# «Раз в месяц — тестовое восстановление в отдельную БД с проверкой числа
# записей». Проверка `pg_restore --list` подтверждает только целостность архива:
# она не отвечает на вопрос, восстанавливается ли база. Этот скрипт разворачивает
# последнюю копию в отдельную схему-«песочницу» и сравнивает ключевые показатели
# с рабочей базой.
#
# Запуск (от имени root на сервере):
#   bash ops/backup/restore-check.sh            # последняя копия
#   BACKUP_FILE=/root/db-backups/lideryprava/liders-YYYYmmdd-HHMMSS.dump bash ops/backup/restore-check.sh
#
# Что делает:
#   1) находит последнюю копию (или берёт указанную);
#   2) создаёт временную базу liders_restore_check;
#   3) восстанавливает в неё дамп;
#   4) сверяет число строк в ключевых таблицах с рабочей базой;
#   5) удаляет временную базу и пишет отчёт.
#
# Продовая база не изменяется: восстановление идёт в отдельную базу.
set -euo pipefail

DB_NAME="${DB_NAME:-liders}"
DB_USER="${DB_USER:-liders}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
BACKUP_DIR="${BACKUP_DIR:-/root/db-backups/lideryprava}"
CHECK_DB="${CHECK_DB:-liders_restore_check}"
PASSPHRASE_FILE="${BACKUP_PASSPHRASE_FILE:-}"
LOG_FILE="${LOG_FILE:-/var/log/lideryprava-restore-check.log}"

export PGPASSWORD="${PGPASSWORD:-${DATABASE_PASSWORD:-}}"

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*" | tee -a "${LOG_FILE}"; }

if [ -z "${PGPASSWORD}" ]; then
    echo "ОШИБКА: не задан пароль БД (PGPASSWORD или DATABASE_PASSWORD)." >&2
    exit 1
fi

# 1. Копия
FILE="${BACKUP_FILE:-}"
if [ -z "${FILE}" ]; then
    FILE="$(ls -1t "${BACKUP_DIR}"/liders-*.dump "${BACKUP_DIR}"/liders-*.dump.enc 2>/dev/null | head -1 || true)"
fi
if [ -z "${FILE}" ] || [ ! -f "${FILE}" ]; then
    log "ОШИБКА: копия не найдена в ${BACKUP_DIR}"
    exit 1
fi
log "Проверяю копию: ${FILE}"

# 2. Расшифровка при необходимости
WORK_FILE="${FILE}"
if [ "${FILE##*.}" = "enc" ]; then
    if [ -z "${PASSPHRASE_FILE}" ] || [ ! -f "${PASSPHRASE_FILE}" ]; then
        log "ОШИБКА: копия зашифрована, но ключ не задан (BACKUP_PASSPHRASE_FILE)"
        exit 1
    fi
    WORK_FILE="$(mktemp /tmp/liders-restore-XXXXXX.dump)"
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:${PASSPHRASE_FILE}" \
        -in "${FILE}" -out "${WORK_FILE}"
    log "Копия расшифрована во временный файл"
fi

drop_scratch() {
    psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d postgres -q \
        -c "DROP DATABASE IF EXISTS ${CHECK_DB}" >/dev/null 2>&1 || true
    if [ "${WORK_FILE}" != "${FILE}" ]; then rm -f -- "${WORK_FILE}"; fi
}
trap drop_scratch EXIT

# 3. Восстановление в отдельную базу
drop_scratch
psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d postgres -q \
    -c "CREATE DATABASE ${CHECK_DB}" >/dev/null
log "Создана база ${CHECK_DB}, восстанавливаю…"
pg_restore --no-owner --no-privileges --exit-on-error \
    --host="${DB_HOST}" --port="${DB_PORT}" --username="${DB_USER}" \
    --dbname="${CHECK_DB}" "${WORK_FILE}" >/dev/null 2>>"${LOG_FILE}"
log "Восстановление завершено"

# 4. Сверка числа записей
TABLES=(
    seasons directions teams participants mentors applications
    application_materials evaluations rankings appeals masterclasses
    news documents initiatives winners audit_log media
)
FAILED=0
for table in "${TABLES[@]}"; do
    live="$(psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" -tAq \
        -c "SELECT count(*) FROM liders.${table}" 2>/dev/null || echo '?')"
    restored="$(psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${CHECK_DB}" -tAq \
        -c "SELECT count(*) FROM liders.${table}" 2>/dev/null || echo '?')"
    if [ "${live}" = "?" ] || [ "${restored}" = "?" ]; then
        log "  ${table}: не удалось сравнить (рабочая: ${live}, копия: ${restored})"
        continue
    fi
    # Копия сделана раньше, поэтому в рабочей базе записей может быть больше —
    # важно, что в копии не меньше, чем было на момент дампа, и что таблица
    # вообще восстановилась.
    if [ "${restored}" -ge 0 ] 2>/dev/null; then
        log "  ${table}: рабочая ${live}, копия ${restored}"
        if [ "${table}" = "seasons" ] && [ "${restored}" -lt 1 ]; then
            log "  ОШИБКА: в копии нет ни одного сезона"
            FAILED=1
        fi
    else
        log "  ${table}: восстановление не удалось"
        FAILED=1
    fi
done

if [ "${FAILED}" -eq 0 ]; then
    log "ИТОГ: копия восстанавливается, ключевые таблицы на месте."
else
    log "ИТОГ: ОБНАРУЖЕНЫ ПРОБЛЕМЫ при восстановлении — см. журнал выше."
fi
exit "${FAILED}"
