#!/usr/bin/env bash
# Ежедневный дамп БД платформы «Лидеры права».
# Запускается от systemd-таймера в 03:30 (МСК). Хранит 30 последних копий.
#
# Шифрование и выгрузка за пределы сервера (ТЗ 11, п. 2.8 и 7.3):
#   BACKUP_PASSPHRASE_FILE — путь к файлу с паролем шифрования. Если задан,
#     дамп шифруется (AES-256, PBKDF2) и в каталоге остаётся только .dump.enc.
#     Ключ хранится отдельно от копий и в репозиторий не попадает.
#   BACKUP_REMOTE — адрес для выгрузки (например, user@host:/path или
#     rsync-путь). Если задан, зашифрованная копия отправляется туда.
# Обе возможности выключены по умолчанию: без ключа и адреса скрипт работает
# как раньше и лишь предупреждает, что копии лежат только на сервере.
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
ls -1t "${BACKUP_DIR}"/liders-*.dump "${BACKUP_DIR}"/liders-*.dump.enc 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
    echo "[$(date '+%F %T')] Удаляю старую копию: ${old}"
    rm -f -- "${old}"
done

# Шифрование копии: без него копия, вывезенная за пределы сервера, раскрывает
# персональные данные участников (ТЗ 11, п. 2.8).
PASSPHRASE_FILE="${BACKUP_PASSPHRASE_FILE:-}"
if [ -n "${PASSPHRASE_FILE}" ] && [ -f "${PASSPHRASE_FILE}" ]; then
    ENC_FILE="${FILE}.enc"
    openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
        -pass "file:${PASSPHRASE_FILE}" -in "${FILE}" -out "${ENC_FILE}"
    rm -f -- "${FILE}"
    echo "[$(date '+%F %T')] Копия зашифрована: ${ENC_FILE}"
    FILE="${ENC_FILE}"
else
    echo "[$(date '+%F %T')] ВНИМАНИЕ: ключ шифрования не задан (BACKUP_PASSPHRASE_FILE)." \
         "Копия хранится только на сервере и не зашифрована."
fi

# Выгрузка за пределы сервера: только зашифрованной копии.
REMOTE="${BACKUP_REMOTE:-}"
if [ -n "${REMOTE}" ]; then
    case "${FILE}" in
        *.enc)
            echo "[$(date '+%F %T')] Выгрузка копии: ${REMOTE}"
            if command -v rsync >/dev/null 2>&1; then
                rsync -a --quiet "${FILE}" "${REMOTE%/}/"
            else
                scp -q "${FILE}" "${REMOTE%/}/"
            fi
            ;;
        *)
            echo "[$(date '+%F %T')] Выгрузка пропущена: копия не зашифрована (ТЗ 11, п. 7.3)."
            ;;
    esac
fi

echo "[$(date '+%F %T')] Готово. Копий в каталоге: $(ls -1 "${BACKUP_DIR}"/liders-*.dump* 2>/dev/null | wc -l | tr -d ' ')"
