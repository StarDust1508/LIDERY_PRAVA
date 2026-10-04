#!/usr/bin/env bash
# Гейты разделения с проектом «ТехнологИИ Права» (docs/tz/03-architecture.md, п. 6).
# Запускается локально и в CI. Ненулевой код возврата = разделение нарушено.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLATFORM="${ROOT}/platform"
FAILED=0

fail() { echo "  ✗ $1"; FAILED=1; }
pass() { echo "  ✓ $1"; }

check_zero() {
    local title="$1" pattern="$2" path="$3"
    local hits
    hits="$(grep -rniE "${pattern}" "${path}" 2>/dev/null | grep -v 'check-decoupling.sh' || true)"
    if [ -n "${hits}" ]; then
        fail "${title}"
        echo "${hits}" | head -20 | sed 's/^/      /'
    else
        pass "${title}"
    fi
}

echo "Гейты разделения: ${PLATFORM}"
echo

echo "Г1. Нет упоминаний проекта-донора"
check_zero "нет tech-pravo/pravotech/expertum/NeuroPravo/TechPravoAI" \
    "tech-pravo|pravotech|expertum|NeuroPravo|TechPravoAI" "${PLATFORM}"

echo "Г2. Нет доменных сущностей донора"
check_zero "нет manyasha/webinar/conference/speaker/yookassa/yandex-pay/academy/slot" \
    "manyasha|webinar|conference|speaker|yookassa|yandex-pay|academy|slot" \
    "${PLATFORM}/server/src ${PLATFORM}/migrations"

echo "Г3. Нет чужих дефолтов БД"
check_zero "нет bankruptcy_academy/ba_app/схемы pravo" \
    "bankruptcy_academy|ba_app|search_path[^;]*pravo" "${PLATFORM}"

echo "Г5. Одна схема БД (все CREATE TABLE — в liders)"
if [ -d "${PLATFORM}/migrations" ]; then
    BAD="$(grep -rniE "create table" "${PLATFORM}/migrations" 2>/dev/null \
        | grep -viE "liders\." || true)"
    if [ -n "${BAD}" ]; then
        fail "есть CREATE TABLE вне схемы liders"
        echo "${BAD}" | head -20 | sed 's/^/      /'
    else
        pass "все CREATE TABLE — в схеме liders"
    fi
else
    fail "каталог platform/migrations не найден"
fi

echo "Г6. Нет скрытых монтирований роутеров"
if [ -d "${PLATFORM}/server/src/routes" ]; then
    HIDDEN="$(grep -rnE "install[A-Z][A-Za-z]*\(" "${PLATFORM}/server/src/routes" 2>/dev/null || true)"
    if [ -n "${HIDDEN}" ]; then
        fail "найдены install*() внутри роутеров"
        echo "${HIDDEN}" | sed 's/^/      /'
    else
        pass "роутеры не монтируют другие роутеры"
    fi
fi

echo "Г7. Типы (tsc --noEmit)"
if [ -f "${PLATFORM}/server/package.json" ]; then
    if (cd "${PLATFORM}/server" && npx --no-install tsc --noEmit >/dev/null 2>&1); then
        pass "tsc --noEmit без ошибок"
    else
        if [ -d "${PLATFORM}/server/node_modules" ]; then
            fail "tsc --noEmit вернул ошибки (запустите вручную: cd platform/server && npx tsc --noEmit)"
        else
            echo "  … пропущено: не установлены зависимости (npm install в platform/server)"
        fi
    fi
else
    echo "  … пропущено: platform/server/package.json ещё не создан"
fi

echo
if [ "${FAILED}" -eq 0 ]; then
    echo "ИТОГ: разделение в порядке."
else
    echo "ИТОГ: есть нарушения — см. выше."
fi
exit "${FAILED}"
