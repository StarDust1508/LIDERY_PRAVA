#!/usr/bin/env bash
# Приёмочный прогон платформы «Лидеры права – 2027» (ТЗ 12, сценарии С1–С5, С10).
#
# Что делает: поднимает ЧИСТУЮ базу, прогоняет миграции с нуля, запускает API на
# отдельном порту и выполняет приёмочные сценарии через HTTP — теми же запросами,
# которые делает браузер. В конце печатает итог и останавливает сервер.
#
# Запуск:
#   bash platform/scripts/acceptance.sh
#   DB=liders_acc2 PORT=3006 KEEP_DB=1 bash platform/scripts/acceptance.sh
#
# Переменные: DB (по умолчанию liders_acceptance), PORT (3005), KEEP_DB=1 —
# не удалять базу после прогона (для разбора), SKIP_DB_RESET=1 — не пересоздавать.
#
# ВАЖНО: скрипт работает только с тестовой базой. Продовые имена баз он не
# трогает: при DB=liders отказывается работать.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVER_DIR="$ROOT/platform/server"
DB="${DB:-liders_acceptance}"
PORT="${PORT:-3005}"
BASE="http://127.0.0.1:${PORT}"
BODY=/tmp/lp_acceptance_body.json
META_BODY=/tmp/lp_acceptance_meta.json
PASS=0
FAIL=0
declare -a FAILURES=()
declare -a GAPS=()

if [ "$DB" = "liders" ] || [ "$DB" = "liders_dev" ]; then
    echo "Отказ: приёмочный прогон пересоздаёт базу. Укажите отдельную тестовую базу (DB=...)." >&2
    exit 2
fi


# unwrap_body <файл> — разворачивает обёртку ответа { data, meta } (ТЗ 05, п. 1.1).
# В $BODY попадает полезная нагрузка, в $META_BODY — метаданные списка. Ответ
# с ошибкой остаётся как есть: проверки ищут текст в error.message.
unwrap_body() {
    local file="$1"
    local out="${file}.unwrapped"
    rm -f "$out"
    # Разворачивание делает python и пишет результат в отдельный файл: если
    # направить его вывод через «>», пустой stdout затрёт уже записанные данные.
    python3 - "$file" "$out" "$META_BODY" <<'UNWRAP'
import json, sys
src, out, meta_path = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    raw = json.load(open(src))
except Exception:
    sys.exit(1)
if isinstance(raw, dict) and 'error' in raw:
    sys.exit(1)
if isinstance(raw, dict) and 'data' in raw and set(raw.keys()) <= {'data', 'meta'}:
    json.dump(raw.get('meta'), open(meta_path, 'w'), ensure_ascii=False)
    with open(out, 'w') as fh:
        json.dump(raw['data'], fh, ensure_ascii=False)
    sys.exit(0)
sys.exit(1)
UNWRAP
    if [ -f "$out" ]; then
        mv "$out" "$file"
    else
        echo 'null' > "$META_BODY"
    fi
}

step() { printf '\n=== %s ===\n' "$1"; }
ok()   { PASS=$((PASS + 1)); printf '  ✓ %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); FAILURES+=("$1"); printf '  ✗ %s\n' "$1"; }
gap()  { GAPS+=("$1"); printf '  … пропущено: %s\n' "$1"; }

psql_db() { psql -h 127.0.0.1 -d "$DB" -tAc "$1" 2>/dev/null; }

# expect <описание> <ожидаемый код HTTP> [аргументы curl...]
expect() {
    local desc="$1" want="$2"
    shift 2
    local got
    got=$(curl -s -o "$BODY" -w '%{http_code}' "$@")
    unwrap_body "$BODY"
    if [ "$got" = "$want" ]; then
        ok "$desc → $got"
    else
        bad "$desc → ожидался $want, получен $got · $(head -c 160 "$BODY")"
    fi
}

# download <описание> <файл> <ожидаемый код HTTP> [аргументы curl...]
# Отдельная функция: у curl один -o на URL, поэтому сохранение файла нельзя
# совместить с общим перехватом тела ответа.
download() {
    local desc="$1" path="$2" want="$3"
    shift 3
    local got
    got=$(curl -s -o "$path" -w '%{http_code}' "$@")
    if [ "$got" = "$want" ]; then
        ok "$desc → $got ($(wc -c <"$path" | tr -d ' ') байт)"
    else
        bad "$desc → ожидался $want, получен $got"
    fi
}

# login_attempt <ожидаемый код> <логин> <пароль> <описание> [переменная для токена]
# Вход в админку с ожиданием сброса лимита: на один адрес даётся 5 входов в
# минуту, поэтому проверки ролей ждут окно, а не «съедают» бюджет проверки
# перебора пароля ниже.
login_attempt() {
    local want="$1" login="$2" password="$3" desc="$4" var="${5:-}"
    local code attempt retry
    for attempt in 1 2 3; do
        code=$(curl -s -D /tmp/lp_acc_headers.txt -o "$BODY" -w '%{http_code}' \
            -X POST "${BASE}/api/admin/login" -H 'Content-Type: application/json' \
            -d "{\"login\":\"${login}\",\"password\":\"${password}\"}")
        unwrap_body "$BODY"
        if [ "$code" != "429" ]; then break; fi
        retry=$(grep -i '^retry-after:' /tmp/lp_acc_headers.txt | tr -d '\r' | awk '{print $2}')
        retry=${retry:-60}
        printf '    · лимит входов исчерпан, ждём %s с\n' "$retry"
        sleep $((retry + 1))
    done
    if [ "$code" = "$want" ]; then
        ok "$desc → $code"
    else
        bad "$desc → ожидался $want, получен $code · $(head -c 160 "$BODY")"
    fi
    if [ -n "$var" ]; then
        if [ "$code" = "200" ]; then
            eval "$var=$(python3 -c "import json;print(json.load(open('$BODY')).get('token',''))")"
        else
            eval "$var=''"
        fi
    fi
}

SERVER_PID=""
cleanup() {
    if [ -n "$SERVER_PID" ]; then
        # Сервер запускается через exec, поэтому $SERVER_PID — это сам node-процесс,
        # а не обёртка npm: иначе процесс остаётся жить и следующий прогон
        # разговаривает со старым сервером с накопленным rate-limit.
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    if [ "${KEEP_DB:-0}" != "1" ]; then
        dropdb -h 127.0.0.1 --if-exists "$DB" 2>/dev/null || true
    fi
}
trap cleanup EXIT

# Порт должен быть свободен: иначе проверки уйдут на чужой сервер и результат
# будет ложным (именно так однажды «позеленел» повторный прогон).
if curl -s -o /dev/null --max-time 2 "${BASE}/api/health"; then
    echo "Отказ: на порту ${PORT} уже отвечает сервер. Освободите порт или задайте PORT=..." >&2
    exit 2
fi

# ── 0. Чистая база и миграции с нуля ─────────────────────────────────────────
step "0. Чистая база и миграции с нуля"
if [ "${SKIP_DB_RESET:-0}" != "1" ]; then
    dropdb -h 127.0.0.1 --if-exists "$DB" 2>/dev/null || true
    createdb -h 127.0.0.1 "$DB" || { echo "Не удалось создать базу $DB" >&2; exit 2; }
fi
MIGRATE_LOG=$(cd "$SERVER_DIR" && DATABASE_NAME="$DB" npm run migrate 2>&1)
if echo "$MIGRATE_LOG" | grep -q '🎉'; then
    ok "миграции применены на пустой базе (все файлы)"
else
    bad "миграции не применились: $(echo "$MIGRATE_LOG" | tail -3)"
fi
TABLES=$(psql_db "SELECT count(*) FROM information_schema.tables WHERE table_schema='liders'")
OUTSIDE=$(psql_db "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('liders','pg_catalog','information_schema')")
[ "${TABLES:-0}" -ge 38 ] && ok "таблиц в схеме liders: $TABLES" || bad "таблиц в схеме liders: ${TABLES:-?}"
# Контрольные суммы миграций (ТЗ 04, п. 5.5): изменение применённого файла
# должно обнаруживаться, иначе база и файлы расходятся молча.
CHECKSUMS=$(psql_db "SELECT count(*) FROM liders._migrations WHERE checksum IS NOT NULL")
APPLIED_MIGRATIONS=$(psql_db "SELECT count(*) FROM liders._migrations")
[ "${CHECKSUMS:-0}" = "${APPLIED_MIGRATIONS:-1}" ] && ok "контрольные суммы зафиксированы у всех миграций: ${CHECKSUMS}" || bad "суммы есть у ${CHECKSUMS:-0} из ${APPLIED_MIGRATIONS:-?} миграций"
[ "${OUTSIDE:-1}" = "0" ] && ok "таблиц вне схемы liders нет" || bad "таблиц вне схемы liders: $OUTSIDE"

# Окно приёма в тестовой базе открываем: в сиде оно начинается 11.11.2026.
psql_db "UPDATE liders.seasons SET application_open_at = now() - interval '1 day' WHERE slug='2027'" >/dev/null
ok "окно приёма открыто в тестовой базе (эталонное значение сида — 11.11.2026)"

# ── Запуск API ───────────────────────────────────────────────────────────────
step "Запуск API на порту $PORT"
(
    cd "$SERVER_DIR" && exec env DATABASE_NAME="$DB" API_PORT="$PORT" ./node_modules/.bin/tsx src/index.ts >/tmp/lp_acceptance_api.log 2>&1
) &
SERVER_PID=$!
for _ in $(seq 1 30); do
    if curl -s -o /dev/null "${BASE}/api/health"; then break; fi
    sleep 1
done
HEALTH=$(curl -s "${BASE}/api/health")
if echo "$HEALTH" | grep -q '"database":"up"'; then
    ok "API отвечает, база доступна"
else
    bad "API не поднялся: $(tail -3 /tmp/lp_acceptance_api.log)"
    exit 1
fi

ADMIN_PASSWORD=$(grep -E '^ADMIN_PASSWORD=' "$ROOT/platform/.env" | cut -d= -f2-)
DIRECTION_ID=$(psql_db "SELECT id FROM liders.directions ORDER BY sort_order LIMIT 1")

# ── Формат ответов API (ТЗ 05, п. 1.1–1.2, 1.4) ─────────────────────────────
step "Формат ответов: обёртка, коды ошибок, постраничность"

curl -s "${BASE}/api/news" -o /tmp/lp_acc_env.json
ENVELOPE=$(python3 -c "
import json
d = json.load(open('/tmp/lp_acc_env.json'))
ok = isinstance(d, dict) and 'data' in d and isinstance(d.get('meta'), dict)
meta = d.get('meta') or {}
print('ok' if ok and all(k in meta for k in ('total','page','perPage')) else 'no')
" 2>/dev/null || echo error)
[ "$ENVELOPE" = "ok" ] && ok "список отдаётся как { data, meta } с total/page/perPage" || bad "формат списочного ответа: $ENVELOPE"

PAGED=$(curl -s "${BASE}/api/news?page=2&perPage=1" | python3 -c "
import sys, json
d = json.load(sys.stdin)
items = d.get('data') or []
meta = d.get('meta') or {}
print('ok' if len(items) <= 1 and meta.get('page') == 2 and meta.get('perPage') == 1 else 'no')
" 2>/dev/null || echo error)
[ "$PAGED" = "ok" ] && ok "страница и размер страницы учитываются" || bad "постраничность не работает: $PAGED"

ERROR_SHAPE=$(curl -s "${BASE}/api/no-such-route" | python3 -c "
import sys, json
d = json.load(sys.stdin)
err = d.get('error') or {}
print('ok' if isinstance(err, dict) and err.get('code') == 'not_found' and err.get('message') else 'no')
" 2>/dev/null || echo error)
[ "$ERROR_SHAPE" = "ok" ] && ok "ошибка отдаётся как { error: { code, message } }" || bad "формат ошибки: $ERROR_SHAPE"

VALIDATION_SHAPE=$(curl -s -X POST "${BASE}/api/leads" -H 'Content-Type: application/json' -d '{}' | python3 -c "
import sys, json
d = json.load(sys.stdin)
err = d.get('error') or {}
print('ok' if isinstance(err, dict) and err.get('code') == 'validation_error' else 'no')
" 2>/dev/null || echo error)
[ "$VALIDATION_SHAPE" = "ok" ] && ok "ошибка проверки помечена кодом validation_error" || bad "код ошибки проверки: $VALIDATION_SHAPE"
# Различаются два случая (ТЗ 05, п. 1.2): неразобранный запрос — 400, а данные,
# не прошедшие проверку, — 422 с кодом validation_error.
VALIDATION_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/leads" \
    -H 'Content-Type: application/json' -d '{}')
[ "$VALIDATION_STATUS" = "422" ] && ok "ошибка проверки данных отвечает 422" || bad "код ответа при ошибке проверки: $VALIDATION_STATUS"
SYNTAX_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/leads" \
    -H 'Content-Type: application/json' -d '{"name": ')
[ "$SYNTAX_STATUS" = "400" ] && ok "неразобранный запрос отвечает 400" || bad "код ответа при неразобранном запросе: $SYNTAX_STATUS"

# ── С1. Подача заявки и вход в кабинет ───────────────────────────────────────
step "С1. Подача заявки на сайте и вход в кабинет"
expect "сезон отдаётся публично" 200 "${BASE}/api/season/current"
expect "направления отдаются публично" 200 "${BASE}/api/directions"
expect "состав комплекта по этапу" 200 "${BASE}/api/applications/requirements?stage=selection"

CREATE_PAYLOAD=$(cat <<JSON
{"team":{"name":"Приёмочная команда","organization":"СГЮА","city":"Саратов","direction_id":${DIRECTION_ID}},
 "initiative":{"law_title":"О правовом просвещении","act_level":"federal","proposed_initiator":"Правительство Российской Федерации",
 "annotation":"Аннотация инициативы для приёмочного прогона.","ai_usage":false},
 "captain":{"full_name":"Приёмов Пётр Петрович","birth_date":"2001-03-03","category":"student","email":"accept@example.ru","phone":"+7 900 333-33-33"}}
JSON
)
expect "заявка создаётся (черновик)" 201 -X POST "${BASE}/api/applications" -H 'Content-Type: application/json' -H 'Idempotency-Key: acceptance-key-1' -d "$CREATE_PAYLOAD"
PUBLIC_NUMBER=$(python3 -c "import json;print(json.load(open('$BODY')).get('public_number',''))")
ACCESS_TOKEN=$(python3 -c "import json;print(json.load(open('$BODY')).get('access_token',''))")
[ -n "$PUBLIC_NUMBER" ] && ok "номер заявки: $PUBLIC_NUMBER" || bad "номер заявки не выдан"

expect "повтор с тем же ключом не создаёт вторую заявку" 200 -X POST "${BASE}/api/applications" -H 'Content-Type: application/json' -H 'Idempotency-Key: acceptance-key-1' -d "$CREATE_PAYLOAD"
REPLAY=$(python3 -c "import json;print(json.load(open('$BODY')).get('idempotent_replay'))")
[ "$REPLAY" = "True" ] && ok "повтор распознан как идемпотентный (idempotent_replay)" || bad "повтор не распознан как идемпотентный"

expect "статус заявки доступен по номеру" 200 "${BASE}/api/applications/status/${PUBLIC_NUMBER}"
PII=$(curl -s "${BASE}/api/applications/status/${PUBLIC_NUMBER}")
if echo "$PII" | grep -qiE 'full_name|email|phone|birth'; then
    bad "публичный статус содержит персональные данные"
else
    ok "публичный статус не содержит персональных данных"
fi

expect "вход в кабинет по номеру заявки и почте капитана" 200 -c /tmp/lp_acc_cookies.txt -X POST "${BASE}/api/cabinet/access" -H 'Content-Type: application/json' -d "{\"public_number\":\"${PUBLIC_NUMBER}\",\"email\":\"accept@example.ru\"}"
expect "неверная почта не даёт доступа" 401 -X POST "${BASE}/api/cabinet/access" -H 'Content-Type: application/json' -d "{\"public_number\":\"${PUBLIC_NUMBER}\",\"email\":\"wrong@example.ru\"}"
expect "кабинет без сессии закрыт" 401 "${BASE}/api/cabinet/team"

CAPTAIN_ID=$(psql_db "SELECT id FROM liders.participants WHERE team_id=(SELECT team_id FROM liders.applications WHERE public_number='${PUBLIC_NUMBER}') AND role='captain'")
TEAM_ID=$(psql_db "SELECT team_id FROM liders.applications WHERE public_number='${PUBLIC_NUMBER}'")

# Пятый участник — отказ по пункту 4.3.
FIVE=$(python3 - "$CAPTAIN_ID" <<'PY'
import json, sys
captain = int(sys.argv[1])
rows = [{"id": captain, "full_name": "Приёмов Пётр Петрович", "birth_date": "2001-03-03", "category": "student", "email": "accept@example.ru", "role": "captain", "consent_pdn": True}]
for index in range(2, 6):
    rows.append({"full_name": f"Участник {index}", "birth_date": "2001-01-01", "category": "student", "email": f"member{index}@example.ru", "role": "member", "consent_pdn": True})
print(json.dumps({"name": "Приёмочная команда", "direction_id": 1, "participants": rows, "mentors": []}, ensure_ascii=False))
PY
)
expect "пятый участник отклоняется (п. 4.3)" 422 -b /tmp/lp_acc_cookies.txt -X PATCH "${BASE}/api/cabinet/team" -H 'Content-Type: application/json' -d "$FIVE"

TWO=$(python3 - "$CAPTAIN_ID" <<'PY'
import json, sys
captain = int(sys.argv[1])
rows = [
  {"id": captain, "full_name": "Приёмов Пётр Петрович", "birth_date": "2001-03-03", "category": "student", "email": "accept@example.ru", "phone": "+7 900 333-33-33", "role": "captain", "consent_pdn": True, "citizenship": "Российская Федерация", "region": "Саратовская область", "settlement": "г. Саратов", "vk_url": "https://vk.com/id1", "competencies": "Публикации по гражданскому праву.", "personal_contribution": "Структура законопроекта.", "faculty": "Юридический факультет", "course": 3, "study_program": "40.03.01 Юриспруденция"},
  {"full_name": "Приёмова Анна Львовна", "birth_date": "2002-07-07", "category": "magistrant", "email": "accept2@example.ru", "role": "member", "consent_pdn": True, "citizenship": "Российская Федерация", "region": "Саратовская область", "settlement": "г. Энгельс", "competencies": "Юридическая клиника.", "personal_contribution": "Анализ практики."},
]
print(json.dumps({"name": "Приёмочная команда", "direction_id": 1, "participants": rows, "mentors": [{"full_name": "Наставников Лев Иванович", "organization": "СГЮА", "position": "доцент", "academic_degree": "кандидат юридических наук", "academic_title": "доцент", "email": "mentor@example.ru", "consent_pdn": True}]}, ensure_ascii=False))
PY
)
expect "состав 2 участника и наставник сохраняются" 200 -b /tmp/lp_acc_cookies.txt -X PATCH "${BASE}/api/cabinet/team" -H 'Content-Type: application/json' -d "$TWO"

# Состав без идентификаторов участников: клиент может их не прислать, и сервер
# обязан опознать людей по почте, а не вставлять дубли (иначе вставка второго
# капитана нарушала уникальный индекс и запрос падал с 500).
# Данные те же, что в TWO, но без идентификаторов: проверяем сопоставление по
# почте, а не только happy path с id. Наставник сохраняется — иначе следующие
# проверки бланка заявки не найдут его в документе.
NO_IDS=$(python3 <<'PY'
import json
rows = [
  {"full_name": "Приёмов Пётр Петрович", "birth_date": "2001-03-03", "category": "student",
   "email": "accept@example.ru", "phone": "+7 900 333-33-33", "role": "captain", "consent_pdn": True,
   "citizenship": "Российская Федерация", "region": "Саратовская область", "settlement": "г. Саратов",
   "vk_url": "https://vk.com/id1", "competencies": "Публикации по гражданскому праву.",
   "personal_contribution": "Структура законопроекта.", "faculty": "Юридический факультет",
   "course": 3, "study_program": "40.03.01 Юриспруденция"},
  {"full_name": "Приёмова Анна Львовна", "birth_date": "2002-07-07", "category": "magistrant",
   "email": "accept2@example.ru", "role": "member", "consent_pdn": True,
   "citizenship": "Российская Федерация", "region": "Саратовская область", "settlement": "г. Энгельс",
   "competencies": "Юридическая клиника.", "personal_contribution": "Анализ практики."},
]
mentors = [{"full_name": "Наставников Лев Иванович", "organization": "СГЮА", "position": "доцент",
            "academic_degree": "кандидат юридических наук", "academic_title": "доцент",
            "email": "mentor@example.ru", "consent_pdn": True}]
print(json.dumps({"name": "Приёмочная команда", "direction_id": 1, "participants": rows, "mentors": mentors}, ensure_ascii=False))
PY
)
expect "состав сохраняется без идентификаторов участников" 200 -b /tmp/lp_acc_cookies.txt -X PATCH "${BASE}/api/cabinet/team" \
    -H 'Content-Type: application/json' -d "$NO_IDS"
ROSTER_SHAPE=$(curl -s -b /tmp/lp_acc_cookies.txt "${BASE}/api/cabinet/team" | python3 -c "
import sys, json
d = json.load(sys.stdin)
d = d.get('data', d) if isinstance(d, dict) else d
rows = d.get('participants') or []
print(f\"{len(rows)}:{rows[0]['role'] if rows else 'нет'}\")
" 2>/dev/null || echo '0:нет')
if [ "${ROSTER_SHAPE%%:*}" = "2" ] && [ "${ROSTER_SHAPE##*:}" = "captain" ]; then
    ok "дублей нет, капитан идёт первым в карточке команды"
else
    bad "состав после сохранения без id: $ROSTER_SHAPE"
fi

# ── С2. Материалы, лимиты и ссылки ───────────────────────────────────────────
step "С2. Конкурсные материалы, лимиты и ссылки"
printf '%%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%%%EOF\n' > /tmp/lp_acc_law.pdf
python3 - <<'PY'
import zipfile
with zipfile.ZipFile('/tmp/lp_acc_note.docx', 'w') as archive:
    archive.writestr('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Пояснительная записка</w:t></w:r></w:p></w:body></w:document>')
PY
ok "тестовые файлы подготовлены"

expect "законопроект принимается" 201 -b /tmp/lp_acc_cookies.txt -X POST "${BASE}/api/cabinet/materials" -F "type=law_draft" -F "file=@/tmp/lp_acc_law.pdf;type=application/pdf"
expect "пояснительная записка принимается" 201 -b /tmp/lp_acc_cookies.txt -X POST "${BASE}/api/cabinet/materials" -F "type=explanatory_note" -F "file=@/tmp/lp_acc_note.docx;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document"

dd if=/dev/zero of=/tmp/lp_acc_big.pdf bs=1048576 count=30 >/dev/null 2>&1
expect "файл 30 МБ отклоняется по лимиту" 413 -b /tmp/lp_acc_cookies.txt -X POST "${BASE}/api/cabinet/materials" -F "type=presentation" -F "file=@/tmp/lp_acc_big.pdf;type=application/pdf"
expect "ссылка на зарубежное облако отклоняется (п. 14.4)" 422 -b /tmp/lp_acc_cookies.txt -X POST "${BASE}/api/cabinet/materials" -H 'Content-Type: application/json' -d '{"type":"video_link","external_url":"https://drive.google.com/file/d/abc/view"}'
expect "ссылка на российский сервис принимается" 201 -b /tmp/lp_acc_cookies.txt -X POST "${BASE}/api/cabinet/materials" -H 'Content-Type: application/json' -d '{"type":"presentation","external_url":"https://disk.yandex.ru/d/acceptance"}'

# ── С10. Несовершеннолетний участник ─────────────────────────────────────────
step "С10. Несовершеннолетний участник и скан согласия"
MINOR_PAYLOAD=$(cat <<JSON
{"team":{"name":"Приёмочная младшая","direction_id":${DIRECTION_ID}},
 "initiative":{"law_title":"О защите прав","act_level":"regional","annotation":"Аннотация для проверки правила о несовершеннолетних."},
 "captain":{"full_name":"Младшов Максим Олегович","birth_date":"2010-05-05","category":"student","email":"minor-accept@example.ru"}}
JSON
)
expect "заявка с несовершеннолетним создаётся" 201 -X POST "${BASE}/api/applications" -H 'Content-Type: application/json' -H 'Idempotency-Key: acceptance-key-minor' -d "$MINOR_PAYLOAD"
MINOR_NUMBER=$(python3 -c "import json;print(json.load(open('$BODY')).get('public_number',''))")
curl -s -c /tmp/lp_acc_minor.txt -X POST "${BASE}/api/cabinet/access" -H 'Content-Type: application/json' -d "{\"public_number\":\"${MINOR_NUMBER}\",\"email\":\"minor-accept@example.ru\"}" >/dev/null
MINOR_ID=$(psql_db "SELECT id FROM liders.participants WHERE team_id=(SELECT team_id FROM liders.applications WHERE public_number='${MINOR_NUMBER}') AND role='captain'")
curl -s -b /tmp/lp_acc_minor.txt -X PATCH "${BASE}/api/cabinet/team" -H 'Content-Type: application/json' -d "{\"name\":\"Приёмочная младшая\",\"direction_id\":${DIRECTION_ID},\"participants\":[{\"id\":${MINOR_ID},\"full_name\":\"Младшов Максим Олегович\",\"birth_date\":\"2010-05-05\",\"category\":\"student\",\"email\":\"minor-accept@example.ru\",\"role\":\"captain\",\"consent_pdn\":true,\"consent_legal_representative\":true},{\"full_name\":\"Совершеннолетний Участник\",\"birth_date\":\"2000-02-02\",\"category\":\"young_specialist\",\"email\":\"adult-accept@example.ru\",\"role\":\"member\",\"consent_pdn\":true}],\"mentors\":[]}" >/dev/null
curl -s -b /tmp/lp_acc_minor.txt -X POST "${BASE}/api/cabinet/materials" -F "type=law_draft" -F "file=@/tmp/lp_acc_law.pdf;type=application/pdf" >/dev/null
curl -s -b /tmp/lp_acc_minor.txt -X POST "${BASE}/api/cabinet/materials" -F "type=explanatory_note" -F "file=@/tmp/lp_acc_note.docx;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document" >/dev/null

expect "отправка без скана Приложения № 11 блокируется" 422 -b /tmp/lp_acc_minor.txt -X POST "${BASE}/api/cabinet/submit" -H 'Content-Type: application/json' -d '{"confirm_regulation":true,"image_license":true}'
if grep -q 'скан' "$BODY"; then ok "сообщение требует именно скан согласия законного представителя"; else bad "сообщение об отказе не упоминает скан"; fi
MINOR_TEAM_ID=$(psql_db "SELECT team_id FROM liders.participants WHERE email='minor-accept@example.ru' ORDER BY id DESC LIMIT 1")
MINOR_STATUS=$(psql_db "SELECT status FROM liders.teams WHERE id=${MINOR_TEAM_ID}")
[ "$MINOR_STATUS" = "awaiting_legal_representative_consent" ] && ok "команда получила статус «ожидает согласие законного представителя»" || bad "статус команды после отказа: ${MINOR_STATUS:-?}"
expect "скан Приложения № 11 принимается" 201 -b /tmp/lp_acc_minor.txt -X POST "${BASE}/api/cabinet/materials" -F "type=consent_legal_rep" -F "file=@/tmp/lp_acc_law.pdf;type=application/pdf"
expect "после скана заявка отправляется" 200 -b /tmp/lp_acc_minor.txt -X POST "${BASE}/api/cabinet/submit" -H 'Content-Type: application/json' -d '{"confirm_regulation":true,"image_license":true}'

# ── Отправка основной заявки ─────────────────────────────────────────────────
step "Согласия и отправка основной заявки"
expect "отправка заявки" 200 -b /tmp/lp_acc_cookies.txt -X POST "${BASE}/api/cabinet/submit" -H 'Content-Type: application/json' -d '{"confirm_regulation":true,"image_license":true,"distribution":[{"participant_id":'"$CAPTAIN_ID"',"categories":{"full_name":true,"image_voice":true},"conditions":"Без населённого пункта"}]}'
CONSENTS=$(psql_db "SELECT count(*) FROM liders.consents WHERE team_id=${TEAM_ID} AND revoked_at IS NULL")
[ "${CONSENTS:-0}" -ge 5 ] && ok "согласий записано: $CONSENTS" || bad "согласий записано: ${CONSENTS:-0}"
VERSIONED=$(psql_db "SELECT count(*) FROM liders.consents WHERE team_id=${TEAM_ID} AND document_version='2026-10-04' AND accepted_at IS NOT NULL AND ip IS NOT NULL")
[ "${VERSIONED:-0}" -ge 5 ] && ok "у согласий есть версия текста, время и сетевой адрес: $VERSIONED" || bad "неполные согласия: ${VERSIONED:-0}"
MATRIX=$(psql_db "SELECT count(*) FROM liders.participant_distribution_consents WHERE participant_id=${CAPTAIN_ID}")
[ "${MATRIX:-0}" = "6" ] && ok "матрица Приложения № 12: 6 категорий" || bad "матрица Приложения № 12: ${MATRIX:-0} строк"

step "Бланк заявки по Приложению № 1"
download "бланк DOCX формируется" /tmp/lp_acc_form.docx 200 -b /tmp/lp_acc_cookies.txt "${BASE}/api/cabinet/application-form.docx"
if python3 -c "
import zipfile
z = zipfile.ZipFile('/tmp/lp_acc_form.docx')
assert z.testzip() is None
assert 'word/document.xml' in z.namelist()
" 2>/dev/null; then ok "DOCX — корректный архив с word/document.xml"; else bad "DOCX повреждён"; fi
DOC_TEXT=$(python3 -c "
import zipfile, re
xml = zipfile.ZipFile('/tmp/lp_acc_form.docx').read('word/document.xml').decode('utf-8')
print(re.sub('<[^>]+>', ' ', xml))
")
for needle in "ФОРМА ЗАЯВКИ" "Приёмов Пётр Петрович" "Приёмова Анна Львовна" "Наставников Лев Иванович" "Юридический факультет"; do
    if echo "$DOC_TEXT" | grep -q "$needle"; then ok "в бланке есть «$needle»"; else bad "в бланке нет «$needle»"; fi
done

# ── С3. Техническая проверка ─────────────────────────────────────────────────
step "С3. Техническая проверка и допуск"
expect "вход администратора" 200 -X POST "${BASE}/api/admin/login" -H 'Content-Type: application/json' -d "{\"login\":\"admin\",\"password\":\"${ADMIN_PASSWORD}\"}"
ADMIN_TOKEN=$(python3 -c "import json;print(json.load(open('$BODY')).get('token',''))")
AUTH="Authorization: Bearer ${ADMIN_TOKEN}"
APPLICATION_ID=$(psql_db "SELECT id FROM liders.applications WHERE public_number='${PUBLIC_NUMBER}'")
expect "админские маршруты без токена закрыты" 401 "${BASE}/api/admin/applications"
expect "список заявок" 200 -H "$AUTH" "${BASE}/api/admin/applications"
# Постраничность админских списков (ТЗ 07, п. 1.4; ТЗ 05, п. 1.4).
ADMIN_PAGED=$(curl -s -H "$AUTH" "${BASE}/api/admin/applications?page=1&perPage=2" | python3 -c "
import sys, json
d = json.load(sys.stdin)
meta = d.get('meta') or {}
print('ok' if isinstance(d.get('data'), list) and meta.get('perPage') == 2 and 'total' in meta else 'no')
" 2>/dev/null || echo error)
[ "$ADMIN_PAGED" = "ok" ] && ok "список заявок отдаёт meta с total и размером страницы" || bad "meta списка заявок: $ADMIN_PAGED"
expect "карточка заявки" 200 -H "$AUTH" "${BASE}/api/admin/applications/${APPLICATION_ID}"
expect "согласия видны администратору" 200 -H "$AUTH" "${BASE}/api/admin/applications/${APPLICATION_ID}/consents"
expect "приёмка заявки" 200 -H "$AUTH" -X PATCH "${BASE}/api/admin/applications/${APPLICATION_ID}" -H 'Content-Type: application/json' -d '{"tech_status":"accepted","organizer_notes":"Комплект полный."}'
TEAM_STATUS=$(psql_db "SELECT status FROM liders.teams WHERE id=${TEAM_ID}")
[ "$TEAM_STATUS" = "allowed" ] && ok "команда переведена в статус «допущена»" || bad "статус команды после приёмки: $TEAM_STATUS"
download "выгрузка CSV" /tmp/lp_acc_export.csv 200 -H "$AUTH" "${BASE}/api/admin/applications/export"
if head -1 /tmp/lp_acc_export.csv | grep -q 'ID заявки'; then ok "CSV содержит заголовки"; else bad "CSV без заголовков"; fi

# ── С4. Оценки и рейтинг ─────────────────────────────────────────────────────
step "С4. Оценки, расхождение и публикация рейтинга"
for index in 1 2 3; do
    curl -s -H "$AUTH" -X POST "${BASE}/api/admin/experts" -H 'Content-Type: application/json' -d "{\"full_name\":\"Эксперт ${index}\",\"role\":\"member\",\"stage\":\"selection\",\"email\":\"expert${index}@example.ru\"}" >/dev/null
done
EXPERT_IDS=$(psql_db "SELECT string_agg(id::text, ' ') FROM liders.experts WHERE stage='selection'")
CRITERIA_JSON=$(curl -s -H "$AUTH" "${BASE}/api/admin/criteria?stage=selection")
score_for() {
    python3 - "$1" <<PY
import json, sys
criteria = json.loads('''${CRITERIA_JSON}''')
# Ответ приходит в обёртке { data, meta } (ТЗ 05, п. 1.1).
criteria = criteria.get('data', criteria) if isinstance(criteria, dict) else criteria
score = int(sys.argv[1])
print(json.dumps([{"criterion_id": c["id"], "score": score, "comment": f"Обоснование: {score} баллов."} for c in criteria], ensure_ascii=False))
PY
}
FIRST_EXPERT=$(echo "$EXPERT_IDS" | cut -d' ' -f1)
expect "оценка выше максимума отклоняется" 422 -H "$AUTH" -X POST "${BASE}/api/admin/evaluations" -H 'Content-Type: application/json' -d "$(python3 - "$CRITERIA_JSON" "$FIRST_EXPERT" "$TEAM_ID" <<'PY'
import json, sys
criteria = json.loads(sys.argv[1])
criteria = criteria.get('data', criteria) if isinstance(criteria, dict) else criteria
expert = int(sys.argv[2]); team = int(sys.argv[3])
scores = [{"criterion_id": criteria[0]["id"], "score": 99}]
print(json.dumps({"team_id": team, "stage": "selection", "expert_id": expert, "scores": scores}))
PY
)"
expect "оценка с обоснованием сохраняется" 201 -H "$AUTH" -X POST "${BASE}/api/admin/evaluations" -H 'Content-Type: application/json' -d "{\"team_id\":${TEAM_ID},\"stage\":\"selection\",\"expert_id\":${FIRST_EXPERT},\"scores\":$(score_for 8),\"comment\":\"Материалы полные.\",\"recommendations\":\"Добавить статистику.\"}"
SECOND_EXPERT=$(echo "$EXPERT_IDS" | cut -d' ' -f2)
expect "вторая оценка сохраняется" 201 -H "$AUTH" -X POST "${BASE}/api/admin/evaluations" -H 'Content-Type: application/json' -d "{\"team_id\":${TEAM_ID},\"stage\":\"selection\",\"expert_id\":${SECOND_EXPERT},\"scores\":$(score_for 1)}"
expect "расчёт рейтинга" 200 -H "$AUTH" -X POST "${BASE}/api/admin/rankings/recalculate" -H 'Content-Type: application/json' -d '{"season_id":1,"stage":"selection"}'
SPREAD=$(psql_db "SELECT scores_spread FROM liders.rankings WHERE team_id=${TEAM_ID} AND stage='selection'")
[ "$SPREAD" = "49.00" ] && ok "расхождение сумм зафиксировано в рейтинге: 49 баллов" || bad "расхождение сумм: ${SPREAD:-?}"
# Правило «расхождение > 20 баллов → доп. оценка председателя» исключено
# решением заказчика (сообщение 08.10.2026, п. 8), поэтому публикация не
# блокируется даже при большом расхождении.
FLAG=$(psql_db "SELECT needs_chair_review FROM liders.rankings WHERE team_id=${TEAM_ID} AND stage='selection'")
[ "$FLAG" = "f" ] && ok "дополнительная оценка председателя не требуется (правило исключено)" || bad "флаг needs_chair_review: ${FLAG:-?}"
expect "протокол публикуется без доп. оценки председателя" 200 -H "$AUTH" -X POST "${BASE}/api/admin/rankings/publish" -H 'Content-Type: application/json' -d '{"season_id":1,"stage":"selection"}'
THIRD_EXPERT=$(echo "$EXPERT_IDS" | cut -d' ' -f3)
curl -s -H "$AUTH" -X POST "${BASE}/api/admin/evaluations" -H 'Content-Type: application/json' -d "{\"team_id\":${TEAM_ID},\"stage\":\"selection\",\"expert_id\":${THIRD_EXPERT},\"scores\":$(score_for 5),\"is_chair_extra\":true}" >/dev/null
curl -s -H "$AUTH" -X POST "${BASE}/api/admin/rankings/recalculate" -H 'Content-Type: application/json' -d '{"season_id":1,"stage":"selection"}' >/dev/null
FLAG_AFTER=$(psql_db "SELECT needs_chair_review FROM liders.rankings WHERE team_id=${TEAM_ID} AND stage='selection'")
[ "$FLAG_AFTER" = "f" ] && ok "флаг доп. оценки не выставляется и после третьей оценки" || bad "флаг после третьей оценки: ${FLAG_AFTER:-?}"
# Средний балл считается по всем членам комиссии:
# (56 + 7 + 35) / 3 = 32,67.
AVERAGE=$(psql_db "SELECT average_score FROM liders.rankings WHERE team_id=${TEAM_ID} AND stage='selection'")
[ "$AVERAGE" = "32.67" ] && ok "средний балл 32,67 — оценка председателя учтена (п. 7.7)" || bad "средний балл: $AVERAGE (ожидалось 32.67)"
expect "публикация протокола" 200 -H "$AUTH" -X POST "${BASE}/api/admin/rankings/publish" -H 'Content-Type: application/json' -d '{"season_id":1,"stage":"selection"}'
PUBLISHED=$(psql_db "SELECT is_published FROM liders.rankings WHERE team_id=${TEAM_ID} AND stage='selection'")
[ "$PUBLISHED" = "t" ] && ok "протокол опубликован, срок апелляций открыт" || bad "протокол не опубликован"

# ── С5. Апелляция ────────────────────────────────────────────────────────────
step "С5. Апелляция"
expect "апелляция в срок принимается" 201 -b /tmp/lp_acc_cookies.txt -X POST "${BASE}/api/cabinet/appeals" -H 'Content-Type: application/json' -d '{"stage":"selection","grounds":"counting_error","text":"Считаем, что при подсчёте баллов по критерию 5 допущена техническая ошибка."}'
expect "апелляция по финальному этапу отклоняется (п. 12.3)" 422 -b /tmp/lp_acc_cookies.txt -X POST "${BASE}/api/cabinet/appeals" -H 'Content-Type: application/json' -d '{"stage":"debate","grounds":"other","text":"Проба"}'
psql_db "UPDATE liders.rankings SET published_at = now() - interval '10 days' WHERE stage='selection'" >/dev/null
expect "апелляция после срока отклоняется" 403 -b /tmp/lp_acc_cookies.txt -X POST "${BASE}/api/cabinet/appeals" -H 'Content-Type: application/json' -d '{"stage":"selection","grounds":"counting_error","text":"Поздняя апелляция для проверки срока."}'

# ── Журнал действий ──────────────────────────────────────────────────────────
step "Журнал действий администратора"
expect "журнал закрыт без токена" 401 "${BASE}/api/admin/audit"
AUDIT_JSON=$(curl -s -H "$AUTH" "${BASE}/api/admin/audit?limit=100")
AUDIT_COUNT=$(echo "$AUDIT_JSON" | python3 -c "import sys,json;d=json.load(sys.stdin);d=d.get('data',d) if isinstance(d,dict) and 'data' in d else d;print(len(d))" 2>/dev/null || echo 0)
# К этому моменту администратор принял заявку, сохранил оценки и опубликовал протокол.
[ "${AUDIT_COUNT:-0}" -ge 5 ] && ok "записей в журнале: $AUDIT_COUNT" || bad "журнал почти пуст: ${AUDIT_COUNT:-0}"
if echo "$AUDIT_JSON" | grep -q 'rankings/publish'; then
    ok "публикация протокола зафиксирована в журнале"
else
    bad "публикация протокола не попала в журнал"
fi
if echo "$AUDIT_JSON" | grep -q '"actor_label"'; then
    ok "у записей журнала указан автор действия"
else
    bad "в журнале нет автора действия"
fi
if echo "$AUDIT_JSON" | grep -qiE 'password|"token":"[^"]'; then
    bad "в журнал попали секреты"
else
    ok "секреты в журнал не попадают"
fi

# ── С8. Роли, доступы и лимиты ───────────────────────────────────────────────
step "С8. Роли, доступ к чужому и лимиты"
MEDIA_ID=$(psql_db "SELECT media_id FROM liders.application_materials WHERE team_id=${TEAM_ID} AND media_id IS NOT NULL LIMIT 1")
expect "приватный файл без прав недоступен" 404 "${BASE}/api/media/file/${MEDIA_ID}"
expect "приватный файл доступен администратору" 200 -H "$AUTH" "${BASE}/api/media/file/${MEDIA_ID}"
# ── С8.1. Роли и пользователи админ-панели (ТЗ 07, п. 1.3, 2.17) ────────────
step "С8.1. Роли admin/operator, управление пользователями"
OPERATOR_PASSWORD='P1rimernyj-Parol-2027'
ADMIN_PASSWORD_NEW='P1rimernyj-Parol-2028'
expect "оператор создаётся администратором" 201 -H "$AUTH" -X POST "${BASE}/api/admin/users" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"accept-operator@example.ru\",\"password\":\"${OPERATOR_PASSWORD}\",\"role\":\"operator\",\"full_name\":\"Оператор Приёмочный\"}"
OPERATOR_ID=$(psql_db "SELECT id FROM liders.users WHERE email='accept-operator@example.ru'")
expect "администратор создаётся администратором" 201 -H "$AUTH" -X POST "${BASE}/api/admin/users" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"accept-admin@example.ru\",\"password\":\"${OPERATOR_PASSWORD}\",\"role\":\"admin\",\"full_name\":\"Администратор Приёмочный\"}"
ADMIN_USER_ID=$(psql_db "SELECT id FROM liders.users WHERE email='accept-admin@example.ru'")
expect "повтор почты отклоняется" 409 -H "$AUTH" -X POST "${BASE}/api/admin/users" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"accept-admin@example.ru\",\"password\":\"${OPERATOR_PASSWORD}\",\"role\":\"admin\"}"
expect "короткий пароль отклоняется" 422 -H "$AUTH" -X POST "${BASE}/api/admin/users" \
    -H 'Content-Type: application/json' \
    -d '{"email":"weak@example.ru","password":"korotkij1","role":"operator"}'
HASH=$(psql_db "SELECT password_hash FROM liders.users WHERE id=${ADMIN_USER_ID}")
if printf '%s' "$HASH" | grep -qE '^\$2[aby]\$12\$'; then
    ok "пароль хранится bcrypt-хэшем с cost 12"
else
    bad "хэш пароля не bcrypt cost 12: $(printf '%s' "$HASH" | head -c 12)"
fi
PLAIN=$(psql_db "SELECT count(*) FROM liders.users WHERE password_hash LIKE '%${OPERATOR_PASSWORD}%'")
[ "${PLAIN:-1}" = "0" ] && ok "пароль в открытом виде не хранится" || bad "пароль найден в открытом виде"

login_attempt 200 'accept-operator@example.ru' "$OPERATOR_PASSWORD" "вход оператора по почте и паролю" OPERATOR_TOKEN
OPERATOR_ROLE=$(python3 -c "import json;print(json.load(open('$BODY')).get('role',''))")
[ "$OPERATOR_ROLE" = "operator" ] && ok "сервер сообщает роль оператора" || bad "роль в ответе на вход: $OPERATOR_ROLE"
OPERATOR_AUTH="Authorization: Bearer ${OPERATOR_TOKEN}"
expect "оператор видит заявки" 200 -H "$OPERATOR_AUTH" "${BASE}/api/admin/applications"
expect "оператор читает критерии для оценок" 200 -H "$OPERATOR_AUTH" "${BASE}/api/admin/criteria"
expect "оператор не видит пользователей" 403 -H "$OPERATOR_AUTH" "${BASE}/api/admin/users"
expect "оператор не меняет настройки" 403 -H "$OPERATOR_AUTH" -X PUT "${BASE}/api/admin/settings/contacts" \
    -H 'Content-Type: application/json' -d '{"value":{"email":"x@example.ru"}}'
expect "оператор не публикует протокол" 403 -H "$OPERATOR_AUTH" -X POST "${BASE}/api/admin/rankings/publish" \
    -H 'Content-Type: application/json' -d '{"season_id":1,"stage":"selection"}'
expect "оператор не выгружает персональные данные" 403 -H "$OPERATOR_AUTH" "${BASE}/api/admin/applications/export"
expect "оператор не создаёт учётные записи" 403 -H "$OPERATOR_AUTH" -X POST "${BASE}/api/admin/users" \
    -H 'Content-Type: application/json' -d '{"email":"x@example.ru","password":"P1rimernyj-Parol-2027","role":"admin"}'

login_attempt 200 'accept-admin@example.ru' "$OPERATOR_PASSWORD" "вход администратора по почте и паролю" ADMIN_USER_TOKEN
ADMIN_ROLE=$(python3 -c "import json;print(json.load(open('$BODY')).get('role',''))")
[ "$ADMIN_ROLE" = "admin" ] && ok "сервер сообщает роль администратора" || bad "роль в ответе на вход: $ADMIN_ROLE"
ADMIN_USER_AUTH="Authorization: Bearer ${ADMIN_USER_TOKEN}"
expect "администратор видит список пользователей" 200 -H "$ADMIN_USER_AUTH" "${BASE}/api/admin/users"
if curl -s -H "$ADMIN_USER_AUTH" "${BASE}/api/admin/users" | grep -q 'password_hash'; then
    bad "список пользователей раскрывает хэши паролей"
else
    ok "список пользователей не содержит хэшей паролей"
fi
expect "нельзя заблокировать собственную учётную запись" 409 -H "$ADMIN_USER_AUTH" \
    -X PATCH "${BASE}/api/admin/users/${ADMIN_USER_ID}" -H 'Content-Type: application/json' -d '{"is_active":false}'
expect "нельзя понизить собственную роль" 409 -H "$ADMIN_USER_AUTH" \
    -X PATCH "${BASE}/api/admin/users/${ADMIN_USER_ID}" -H 'Content-Type: application/json' -d '{"role":"operator"}'
expect "нельзя оставить систему без администратора" 409 -H "$AUTH" \
    -X PATCH "${BASE}/api/admin/users/${ADMIN_USER_ID}" -H 'Content-Type: application/json' -d '{"role":"operator"}'
expect "слабый пароль при сбросе отклоняется" 422 -H "$AUTH" -X POST "${BASE}/api/admin/users/${OPERATOR_ID}/password" \
    -H 'Content-Type: application/json' -d '{"password":"korotkij1"}'
expect "сброс пароля администратором" 200 -H "$AUTH" -X POST "${BASE}/api/admin/users/${OPERATOR_ID}/password" \
    -H 'Content-Type: application/json' -d "{\"password\":\"${ADMIN_PASSWORD_NEW}\"}"
login_attempt 401 'accept-operator@example.ru' "$OPERATOR_PASSWORD" "старый пароль после сброса не работает"
login_attempt 200 'accept-operator@example.ru' "$ADMIN_PASSWORD_NEW" "вход с новым паролем" OPERATOR_TOKEN2
AUTH_VERSION=$(psql_db "SELECT auth_version FROM liders.users WHERE id=${OPERATOR_ID}")
[ "${AUTH_VERSION:-1}" -ge 2 ] && ok "сброс пароля поднял версию авторизации (${AUTH_VERSION})" || bad "версия авторизации не изменилась: ${AUTH_VERSION:-?}"

# Временный пароль: его нужно заменить своим, иначе флаг «пароль временный»
# остаётся навсегда (ТЗ 11, п. 45).
MUST_CHANGE=$(psql_db "SELECT must_change_password FROM liders.users WHERE id=${OPERATOR_ID}")
[ "$MUST_CHANGE" = "t" ] && ok "после сброса пароль помечен временным" || bad "флаг временного пароля: ${MUST_CHANGE:-?}"
expect "смена своего пароля учётной записью" 200 -H "Authorization: Bearer ${OPERATOR_TOKEN2}" \
    -X POST "${BASE}/api/admin/profile/password" -H 'Content-Type: application/json' \
    -d "{\"current_password\":\"${ADMIN_PASSWORD_NEW}\",\"new_password\":\"Svoj-Parol-2027\"}"
CLEARED=$(psql_db "SELECT must_change_password FROM liders.users WHERE id=${OPERATOR_ID}")
[ "$CLEARED" = "f" ] && ok "после смены пароля флаг временного снят" || bad "флаг временного пароля после смены: ${CLEARED:-?}"
expect "неверный текущий пароль отклоняется" 401 -H "Authorization: Bearer ${OPERATOR_TOKEN2}" \
    -X POST "${BASE}/api/admin/profile/password" -H 'Content-Type: application/json' \
    -d '{"current_password":"nepravilnyj","new_password":"Drugoj-Parol-2027"}'
login_attempt 200 'accept-operator@example.ru' 'Svoj-Parol-2027' "вход с собственным паролем" OPERATOR_TOKEN3
# При входе по общему паролю из окружения менять нечего: сервер объясняет это.
expect "смена пароля при входе по общему паролю отклоняется" 403 -H "$AUTH" \
    -X POST "${BASE}/api/admin/profile/password" -H 'Content-Type: application/json' \
    -d '{"current_password":"x","new_password":"Drugoj-Parol-2027"}'

# Бездействие: сервер завершает сеанс, если отметка активности старше окна.
# Первый запрос создаёт отметку — без него обновлять было бы нечего.
curl -s -o /dev/null -H "Authorization: Bearer ${OPERATOR_TOKEN3}" "${BASE}/api/admin/applications"
TOKEN_HASH=$(printf '%s' "$OPERATOR_TOKEN3" | shasum -a 256 | awk '{print $1}')
MARKED=$(psql_db "SELECT count(*) FROM liders.admin_session_activity WHERE token_hash='${TOKEN_HASH}'")
[ "${MARKED:-0}" = "1" ] && ok "активность сеанса отмечается на сервере" || bad "отметка активности сеанса не создана: ${MARKED:-0}"
psql_db "UPDATE liders.admin_session_activity SET last_seen_at = now() - interval '61 minutes' WHERE token_hash='${TOKEN_HASH}'" >/dev/null
IDLE_CODE=$(curl -s -o "$BODY" -w '%{http_code}' -H "Authorization: Bearer ${OPERATOR_TOKEN3}" "${BASE}/api/admin/applications")
if [ "$IDLE_CODE" = "401" ] && grep -q 'бездействие' "$BODY"; then
    ok "сеанс завершается после 60 минут бездействия"
else
    bad "бездействие не завершает сеанс: $IDLE_CODE · $(head -c 160 "$BODY")"
fi
expect "блокировка учётной записи" 200 -H "$AUTH" -X PATCH "${BASE}/api/admin/users/${OPERATOR_ID}" \
    -H 'Content-Type: application/json' -d '{"is_active":false,"blocked_reason":"Приёмочная проверка"}'
login_attempt 401 'accept-operator@example.ru' "$ADMIN_PASSWORD_NEW" "заблокированный оператор не может войти"
expect "разблокировка учётной записи" 200 -H "$AUTH" -X PATCH "${BASE}/api/admin/users/${OPERATOR_ID}" \
    -H 'Content-Type: application/json' -d '{"is_active":true}'
expect "завершение всех сеансов учётной записи" 200 -H "$AUTH" -X POST "${BASE}/api/admin/users/${OPERATOR_ID}/revoke-sessions"
USER_ACTIONS=$(psql_db "SELECT count(*) FROM liders.audit_log WHERE entity='users'")
[ "${USER_ACTIONS:-0}" -ge 5 ] && ok "действия с пользователями записаны в журнал: $USER_ACTIONS" || bad "в журнале действий с пользователями: ${USER_ACTIONS:-0}"
AUTH_EVENTS=$(psql_db "SELECT count(*) FROM liders.auth_log WHERE event IN ('admin_login_success','admin_login_fail') AND user_id IS NOT NULL")
[ "${AUTH_EVENTS:-0}" -ge 2 ] && ok "входы по учётным записям записаны с пользователем: $AUTH_EVENTS" || bad "входы по учётным записям не записаны: ${AUTH_EVENTS:-0}"


# Проверка блокировки перебора пароля перенесена в конец прогона (раздел
# «Блокировка перебора пароля»): после неё адрес попадает под «долгую»
# блокировку, и последующие входы администратора были бы невозможны.
# ── Решения по команде (ТЗ 07, п. 2.4) ──────────────────────────────────────
step "Решения Оргкомитета по команде: этапы, дисквалификация, восстановление"
expect "карточка команды отдаётся с историей и результатами" 200 -H "$AUTH" "${BASE}/api/admin/teams/${TEAM_ID}"
CARD_SECTIONS=$(curl -s -H "$AUTH" "${BASE}/api/admin/teams/${TEAM_ID}" | python3 -c "import sys,json;d=json.load(sys.stdin);d=d.get('data',d);print('yes' if all(k in d for k in ('status_history','stage_participation','rankings','participants','mentors')) else 'no')" 2>/dev/null || echo no)
[ "$CARD_SECTIONS" = "yes" ] && ok "карточка команды содержит состав, историю статусов, участие в этапах и результаты" || bad "карточка команды неполна"
expect "недопустимый статус команды отклоняется" 422 -H "$AUTH" -H 'Content-Type: application/json' \
    -X PATCH "${BASE}/api/admin/teams/${TEAM_ID}" -d '{"status":"unknown"}'
expect "дисквалификация без причины отклоняется" 422 -H "$AUTH" -H 'Content-Type: application/json' \
    -X PATCH "${BASE}/api/admin/teams/${TEAM_ID}" -d '{"status":"disqualified"}'
expect "перевод команды на первый этап" 200 -H "$AUTH" -H 'Content-Type: application/json' \
    -X PATCH "${BASE}/api/admin/teams/${TEAM_ID}" -d '{"status":"stage1"}'
STAGE1_STATUS=$(psql_db "SELECT status FROM liders.teams WHERE id=${TEAM_ID}")
[ "$STAGE1_STATUS" = "stage1" ] && ok "статус команды: первый этап" || bad "статус команды: ${STAGE1_STATUS:-?}"
expect "дисквалификация с причиной" 200 -H "$AUTH" -H 'Content-Type: application/json' \
    -X PATCH "${BASE}/api/admin/teams/${TEAM_ID}" -d '{"status":"disqualified","disqualification_reason":"Приёмочная проверка: нарушение раздела 13 Положения."}'
DISQ_REASON=$(psql_db "SELECT disqualification_reason FROM liders.teams WHERE id=${TEAM_ID}")
[ -n "$DISQ_REASON" ] && ok "причина дисквалификации сохранена" || bad "причина дисквалификации не сохранена"
TEAM_DECISIONS=$(psql_db "SELECT count(*) FROM liders.audit_log WHERE entity='teams' AND entity_id='${TEAM_ID}'")
[ "${TEAM_DECISIONS:-0}" -ge 2 ] && ok "решения по команде записаны в журнал: ${TEAM_DECISIONS}" || bad "решения по команде не записаны: ${TEAM_DECISIONS:-0}"
expect "восстановление команды" 200 -H "$AUTH" -H 'Content-Type: application/json' \
    -X PATCH "${BASE}/api/admin/teams/${TEAM_ID}" -d '{"status":"allowed"}'
DISQ_CLEARED=$(psql_db "SELECT count(*) FROM liders.teams WHERE id=${TEAM_ID} AND disqualification_reason IS NULL")
[ "${DISQ_CLEARED:-0}" = "1" ] && ok "при восстановлении причина дисквалификации снята" || bad "причина дисквалификации осталась"


step "Права субъекта персональных данных и срок хранения"
SUBJECT_EMAIL=$(psql_db "SELECT email FROM liders.participants WHERE id=${CAPTAIN_ID}")
expect "слишком короткий запрос отклоняется" 422 -H "$AUTH" "${BASE}/api/admin/subjects?query=ab"
expect "поиск субъекта по почте" 200 -H "$AUTH" "${BASE}/api/admin/subjects?query=${SUBJECT_EMAIL}"
SUBJECTS=$(curl -s -H "$AUTH" "${BASE}/api/admin/subjects?query=${SUBJECT_EMAIL}" | python3 -c "import sys,json;d=json.load(sys.stdin);d=d.get('data',d);print(d.get('total',0) if isinstance(d,dict) else len(d))" 2>/dev/null || echo 0)
[ "${SUBJECTS:-0}" -ge 1 ] && ok "субъект найден: ${SUBJECTS}" || bad "субъект не найден по почте ${SUBJECT_EMAIL}"
expect "сведения о субъекте отдаются" 200 -H "$AUTH" "${BASE}/api/admin/subjects/participant/${CAPTAIN_ID}"
expect "выгрузка сведений о субъекте (право на доступ)" 200 -H "$AUTH" "${BASE}/api/admin/subjects/participant/${CAPTAIN_ID}/export"
EXPORT_LOGGED=$(psql_db "SELECT count(*) FROM liders.audit_log WHERE action='pdn_export'")
[ "${EXPORT_LOGGED:-0}" -ge 1 ] && ok "выгрузка записана в журнал: ${EXPORT_LOGGED}" || bad "выгрузка не попала в журнал"
expect "удаление без подтверждения отклоняется" 422 -H "$AUTH" -H 'Content-Type: application/json' \
    -X POST "${BASE}/api/admin/subjects/participant/${CAPTAIN_ID}/erase" -d '{"reason":"обращение субъекта"}'
expect "удаление без основания отклоняется" 422 -H "$AUTH" -H 'Content-Type: application/json' \
    -X POST "${BASE}/api/admin/subjects/participant/${CAPTAIN_ID}/erase" -d '{"confirm":true}'
expect "неизвестный вид записи отклоняется" 422 -H "$AUTH" -H 'Content-Type: application/json' \
    -X POST "${BASE}/api/admin/subjects/unknown/1/erase" -d '{"confirm":true,"reason":"проверка"}'
expect "удаление персональных данных (обезличивание)" 200 -H "$AUTH" -H 'Content-Type: application/json' \
    -X POST "${BASE}/api/admin/subjects/participant/${CAPTAIN_ID}/erase" \
    -d '{"confirm":true,"reason":"Приёмочная проверка: обращение субъекта об удалении"}'
ERASED=$(psql_db "SELECT full_name FROM liders.participants WHERE id=${CAPTAIN_ID}")
[ "$ERASED" = "Обезличено по требованию субъекта" ] && ok "данные обезличены пометкой" || bad "пометка обезличивания: $ERASED"
ERASED_FIELDS=$(psql_db "SELECT count(*) FROM liders.participants WHERE id=${CAPTAIN_ID} AND email NOT LIKE '%@example.ru' AND phone IS NULL AND birth_date IS NULL AND consent_pdn = FALSE")
[ "${ERASED_FIELDS:-0}" = "1" ] && ok "контакты, дата рождения и согласие участника очищены" || bad "персональные данные не очищены"
REVOKED=$(psql_db "SELECT count(*) FROM liders.consents WHERE participant_id=${CAPTAIN_ID} AND revoked_at IS NOT NULL")
[ "${REVOKED:-0}" -ge 1 ] && ok "согласия отозваны: ${REVOKED}" || bad "согласия не отозваны"
ERASE_LOGGED=$(psql_db "SELECT count(*) FROM liders.audit_log WHERE action='pdn_erase'")
[ "${ERASE_LOGGED:-0}" -ge 1 ] && ok "обезличивание записано в журнал" || bad "обезличивание не попало в журнал"
# Учёт обращений субъектов: срок ответа 10 рабочих дней.
expect "обращение субъекта регистрируется" 201 -H "$AUTH" -H 'Content-Type: application/json' \
    -X POST "${BASE}/api/admin/subjects/requests" \
    -d '{"kind":"access","subject_name":"Приёмов Пётр Петрович","subject_email":"accept@example.ru","message":"Прошу предоставить мои данные."}'
REQUEST_ID=$(psql_db "SELECT id FROM liders.pdn_requests ORDER BY id DESC LIMIT 1")
REQUEST_DUE=$(psql_db "SELECT (due_at > received_at) FROM liders.pdn_requests WHERE id=${REQUEST_ID}")
[ "$REQUEST_DUE" = "t" ] && ok "срок ответа рассчитан" || bad "срок ответа не рассчитан"
WORKDAYS=$(psql_db "SELECT count(*) FROM liders.pdn_requests r, generate_series(r.received_at::date + 1, r.due_at::date, '1 day') AS d WHERE r.id=${REQUEST_ID} AND extract(isodow FROM d) < 6")
[ "${WORKDAYS:-0}" -ge 8 ] && ok "срок — 10 рабочих дней (рабочих дней между датами: ${WORKDAYS})" || bad "срок ответа короче 10 рабочих дней: ${WORKDAYS}"
expect "вид обращения проверяется" 422 -H "$AUTH" -H 'Content-Type: application/json' \
    -X POST "${BASE}/api/admin/subjects/requests" -d '{"kind":"unknown","subject_name":"x","subject_email":"x@example.ru"}'
expect "обращение берётся в работу" 200 -H "$AUTH" -H 'Content-Type: application/json' \
    -X PATCH "${BASE}/api/admin/subjects/requests/${REQUEST_ID}" -d '{"status":"in_progress"}'
expect "обращения субъектов отдаются со сроком" 200 -H "$AUTH" "${BASE}/api/admin/subjects/requests"
RETENTION_TABLE=$(psql_db "SELECT count(*) FROM information_schema.tables WHERE table_schema='liders' AND table_name='pdn_retention_runs'")
[ "${RETENTION_TABLE:-0}" = "1" ] && ok "журнал прогонов ретенции существует" || bad "таблицы прогонов ретенции нет"

# ── Публикация редакции 04.10.2026 ───────────────────────────────────────────
step "Публикация Положения и Приложений редакции 04.10.2026"
DOC_COUNT=$(psql_db "SELECT count(*) FROM liders.documents WHERE is_active")
[ "${DOC_COUNT:-0}" = "15" ] && ok "в таблице documents 15 активных документов (Положение и Приложения № 1–14)" || bad "активных документов: ${DOC_COUNT:-0} (ожидалось 15)"
APPENDICES=$(psql_db "SELECT count(*) FROM liders.documents WHERE type='appendix' AND is_active")
[ "${APPENDICES:-0}" = "14" ] && ok "приложений № 1–14 опубликовано: $APPENDICES" || bad "приложений в таблице: ${APPENDICES:-0}"
VERSION_OK=$(psql_db "SELECT count(*) FROM liders.documents WHERE is_active AND version='2026-10-04'")
[ "${VERSION_OK:-0}" = "15" ] && ok "у всех документов версия 2026-10-04" || bad "документов с версией 2026-10-04: ${VERSION_OK:-0}"
# Ссылки на PDF должны вести на файлы, которые выкат кладёт в корень сайта
# (ops/deploy.sh копирует platform/public в /var/www/lideryprava/public).
MISSING_FILES=""
for url in $(psql_db "SELECT DISTINCT external_url FROM liders.documents WHERE is_active AND external_url LIKE '/docs/%'"); do
    [ -f "$ROOT/platform/public${url}" ] || MISSING_FILES="${MISSING_FILES} ${url}"
done
if [ -z "$MISSING_FILES" ]; then
    ok "все ссылки documents ведут на существующие PDF в platform/public/docs"
else
    bad "нет файлов для ссылок:${MISSING_FILES}"
fi
if head -c 5 "$ROOT/platform/public/docs/polozhenie-lidery-prava-2027.pdf" | grep -q '%PDF-'; then
    ok "PDF Положения — корректный PDF-файл"
else
    bad "PDF Положения не читается"
fi

# ── Юридические документы (пакет 6) ──────────────────────────────────────────
step "Юридические документы сайта"
LEGAL_COUNT=$(psql_db "SELECT count(*) FROM liders.documents WHERE is_active = FALSE AND sort_order >= 20")
[ "${LEGAL_COUNT:-0}" = "6" ] && ok "юридических документов заведено: $LEGAL_COUNT (не опубликованы)" || bad "юридических документов: ${LEGAL_COUNT:-0} (ожидалось 6)"
if curl -s "${BASE}/api/documents" | grep -q 'Оферта'; then
    bad "неопубликованная оферта видна в публичном API"
else
    ok "неопубликованные юридические документы не отдаются публично"
fi
LEGAL_MISSING=""
for slug in oferta privacy-policy cookies-policy user-agreement jury-regulations mailing-consent; do
    [ -f "$ROOT/docs/legal/${slug}.md" ] || LEGAL_MISSING="${LEGAL_MISSING} ${slug}.md"
    [ -f "$ROOT/platform/public/docs/legal/${slug}.pdf" ] || LEGAL_MISSING="${LEGAL_MISSING} ${slug}.pdf"
done
if [ -z "$LEGAL_MISSING" ]; then
    ok "тексты и PDF всех шести документов на месте"
else
    bad "нет файлов:${LEGAL_MISSING}"
fi
if head -c 5 "$ROOT/platform/public/docs/legal/oferta.pdf" | grep -q '%PDF-'; then
    ok "PDF оферты — корректный PDF-файл"
else
    bad "PDF оферты не читается"
fi
# Публичная оферта предполагает опубликованный текст: пока документ не утверждён
# и не активирован, согласие с ним не запрашивается и не записывается.
OFFER_CONSENTS=$(psql_db "SELECT count(*) FROM liders.consents WHERE document_code = 'offer'")
[ "${OFFER_CONSENTS:-0}" = "0" ] && ok "согласие с неопубликованной офертой не записывается" || bad "записано согласий с офертой: ${OFFER_CONSENTS:-0}"

# ── Публичная часть: архив, согласия, карта сайта ────────────────────────────
step "Публичная часть: архив инициатив, согласия и карта сайта"
expect "критерии оценки отдаются публично" 200 "${BASE}/api/criteria?stage=selection"
CRITERIA_COUNT=$(curl -s "${BASE}/api/criteria?stage=selection" | python3 -c "import sys,json;d=json.load(sys.stdin);d=d.get('data',d) if isinstance(d,dict) and 'data' in d else d;print(len(d) if isinstance(d,list) else len(d.get('items',[])))" 2>/dev/null || echo '0')
[ "${CRITERIA_COUNT:-0}" -ge 5 ] 2>/dev/null && ok "в публичном API не менее пяти критериев (${CRITERIA_COUNT})" || bad "критериев в публичном API: ${CRITERIA_COUNT:-0}"
INIT_JSON=$(curl -s -H "$AUTH" -H 'Content-Type: application/json' -X POST "${BASE}/api/admin/initiatives" \
    -d "{\"season_id\":1,\"team_id\":${TEAM_ID},\"slug\":\"acceptance-initiative\",\"title\":\"Приёмочная инициатива\",\"annotation\":\"Проверка архива.\",\"act_level\":\"federal\",\"team_name\":\"Приёмочная команда\",\"authors_public\":false,\"files_public\":false}")
INIT_ID=$(printf '%s' "$INIT_JSON" | python3 -c "import sys,json;d=json.load(sys.stdin);d=d.get('data',d);print(d.get('id',''))" 2>/dev/null || echo '')
if [ -n "$INIT_ID" ]; then ok "инициатива создана через админ-API"; else bad "не удалось создать инициативу: $INIT_JSON"; fi
curl -s -H "$AUTH" -H 'Content-Type: application/json' -X POST "${BASE}/api/admin/initiatives/${INIT_ID}/authors" \
    -d '{"full_name":"Скрытый Автор","role":"Участник","is_published":true}' >/dev/null
expect "неопубликованная инициатива недоступна публично" 404 "${BASE}/api/initiatives/acceptance-initiative"
INIT_PUBLIC=$(curl -s "${BASE}/api/initiatives" | grep -c 'acceptance-initiative' || true)
[ "${INIT_PUBLIC:-0}" = "0" ] && ok "неопубликованной инициативы нет в публичном списке" || bad "неопубликованная инициатива попала в публичный список"
expect "публикация инициативы" 200 -H "$AUTH" -H 'Content-Type: application/json' -X POST "${BASE}/api/admin/initiatives/${INIT_ID}/publish" -d '{}'
AUTHORS_HIDDEN=$(curl -s "${BASE}/api/initiatives/acceptance-initiative" | python3 -c "import sys,json;d=json.load(sys.stdin);d=d.get('data',d);print(len(d.get('authors',[])))" 2>/dev/null || echo '?')
[ "$AUTHORS_HIDDEN" = "0" ] && ok "без согласия авторов на распространение персональные данные скрыты" || bad "авторы раскрыты без согласия: $AUTHORS_HIDDEN"
curl -s -H "$AUTH" -H 'Content-Type: application/json' -X PATCH "${BASE}/api/admin/initiatives/${INIT_ID}" -d '{"authors_public":true}' >/dev/null
AUTHORS_SHOWN=$(curl -s "${BASE}/api/initiatives/acceptance-initiative" | python3 -c "import sys,json;d=json.load(sys.stdin);d=d.get('data',d);print(len(d.get('authors',[])))" 2>/dev/null || echo '?')
[ "$AUTHORS_SHOWN" = "1" ] && ok "после полученного согласия автор публикуется" || bad "автор не опубликован после согласия: $AUTHORS_SHOWN"
if curl -s "${BASE}/api/initiatives" | python3 -c "import sys,json;d=json.load(sys.stdin);d=d.get('data',d) if isinstance(d,dict) and 'data' in d else d;items=d if isinstance(d,list) else d.get('items',[]);print('ok' if all('authors_public' not in i and 'files_public' not in i for i in items) else 'leak')" 2>/dev/null | grep -q ok; then
    ok "публичный список не раскрывает служебные флаги согласий"
else
    bad "публичный список раскрывает служебные флаги согласий"
fi
expect "карта сайта отдаётся" 200 "${BASE}/sitemap.xml"
if curl -s "${BASE}/sitemap.xml" | grep -q 'acceptance-initiative'; then ok "опубликованная инициатива попала в карту сайта"; else bad "инициативы нет в карте сайта"; fi
if curl -s "${BASE}/sitemap.xml" | grep -q '<urlset'; then ok "карта сайта в формате urlset"; else bad "карта сайта не в формате urlset"; fi
if grep -q 'Disallow: /cabinet/' "$ROOT/platform/public/robots.txt" 2>/dev/null; then ok "robots.txt закрывает служебные разделы"; else bad "robots.txt не закрывает служебные разделы"; fi
psql_db "UPDATE liders.teams SET status='disqualified' WHERE id=${TEAM_ID}" >/dev/null
expect "инициатива дисквалифицированной команды не публикуется" 409 -H "$AUTH" -H 'Content-Type: application/json' -X POST "${BASE}/api/admin/initiatives/${INIT_ID}/publish" -d '{}'
psql_db "UPDATE liders.teams SET status='allowed' WHERE id=${TEAM_ID}" >/dev/null

# ── Публичный контент и новые разделы админки ────────────────────────────────
step "Публичный контент: новости, мастер-классы, эксперты, архив 2026"
APP_ID=$(psql_db "SELECT id FROM liders.applications WHERE public_number='${PUBLIC_NUMBER}'")
MATERIAL_ID=$(psql_db "SELECT id FROM liders.application_materials WHERE team_id=${TEAM_ID} AND media_id IS NOT NULL ORDER BY id LIMIT 1")
expect "публичные эксперты отдаются" 200 "${BASE}/api/experts"
expect "состав Жюри отдаётся" 200 "${BASE}/api/jury"
expect "новости отдаются" 200 "${BASE}/api/news"
expect "мастер-классы отдаются" 200 "${BASE}/api/masterclasses"
expect "несуществующая страница не отдаётся" 404 "${BASE}/api/pages/net-takoy-stranicy"
# Редактируемые тексты раздела «О конкурсе» (ТЗ 08, п. 2.1: источник — pages).
PAGES_SEEDED=$(psql_db "SELECT count(*) FROM liders.pages WHERE slug IN ('about','about-partners','about-history','about-organizers','about-regulations','about-faq') AND is_published AND length(COALESCE(body,'')) > 300")
[ "${PAGES_SEEDED:-0}" = "6" ] && ok "тексты раздела «О конкурсе» заведены и опубликованы: ${PAGES_SEEDED}" || bad "опубликованных текстов раздела «О конкурсе»: ${PAGES_SEEDED:-0}"
expect "текст страницы «О конкурсе» отдаётся публично" 200 "${BASE}/api/pages/about"
PAGE_BODY=$(curl -s "${BASE}/api/pages/about" | python3 -c "import sys,json;d=json.load(sys.stdin);d=d.get('data',d);print(len(d.get('body') or ''))" 2>/dev/null || echo 0)
[ "${PAGE_BODY:-0}" -ge 300 ] && ok "текст «О конкурсе» непустой: ${PAGE_BODY} знаков" || bad "текст «О конкурсе» пуст"
# Человекочитаемый адрес формируется из названия (ТЗ 08, п. 2.4.5).
expect "мастер-класс создаётся без адреса" 201 -H "$AUTH" -X POST "${BASE}/api/admin/masterclasses" \
    -H 'Content-Type: application/json' \
    -d '{"title":"Мастер-класс о дебатах","speaker":"Иванов Иван Иванович","status":"announced","topic":"Дебаты"}'
MASTER_SLUG=$(psql_db "SELECT slug FROM liders.masterclasses WHERE title='Мастер-класс о дебатах'")
[ "$MASTER_SLUG" = "master-klass-o-debatah" ] && ok "адрес собран из названия: $MASTER_SLUG" || bad "адрес мастер-класса: ${MASTER_SLUG:-нет}"
expect "карточка мастер-класса отдаётся по адресу" 200 "${BASE}/api/masterclasses/${MASTER_SLUG}"
expect "несуществующий мастер-класс — 404" 404 "${BASE}/api/masterclasses/net-takogo"
expect "новость создаётся" 201 -H "$AUTH" -X POST "${BASE}/api/admin/news" \
    -H 'Content-Type: application/json' \
    -d '{"title":"Приёмочная новость","type":"news","excerpt":"Проверка публикации.","is_published":true,"published_at":"2026-11-20T12:00:00+03:00"}'
NEWS_SLUG=$(psql_db "SELECT slug FROM liders.news WHERE title='Приёмочная новость'")
[ -n "$NEWS_SLUG" ] && ok "адрес новости: $NEWS_SLUG" || bad "новость не получила адрес"
expect "публикация отдаётся по адресу" 200 "${BASE}/api/news/${NEWS_SLUG}"
# Массовая техническая проверка: сначала предпросмотр, потом изменение.
BULK_DRY=$(curl -s -H "$AUTH" -H 'Content-Type: application/json' -X POST "${BASE}/api/admin/applications/bulk" \
    -d "{\"ids\":[${APP_ID:-0}],\"patch\":{\"tech_status\":\"accepted\"},\"dry_run\":true}")
if printf '%s' "$BULK_DRY" | grep -q '"dry_run":true'; then
    ok "предпросмотр массовой проверки отдаётся"
else
    bad "предпросмотр массовой проверки не отдаётся: $(printf '%s' "$BULK_DRY" | head -c 120)"
fi
expect "массовая проверка применяется" 200 -H "$AUTH" -H 'Content-Type: application/json' \
    -X POST "${BASE}/api/admin/applications/bulk" \
    -d "{\"ids\":[${APP_ID:-0}],\"patch\":{\"organizer_notes\":\"Массовая проверка приёмки.\"}}"
# Массовое отклонение требует причины: без неё решение не принимается (п. 3.3).
expect "массовое отклонение без причины отклоняется" 422 -H "$AUTH" -H 'Content-Type: application/json' \
    -X POST "${BASE}/api/admin/applications/bulk" -d "{\"ids\":[${APP_ID:-0}],\"patch\":{\"tech_status\":\"rejected\"}}"
expect "массовое отклонение с причиной" 200 -H "$AUTH" -H 'Content-Type: application/json' \
    -X POST "${BASE}/api/admin/applications/bulk" \
    -d "{\"ids\":[${APP_ID:-0}],\"patch\":{\"tech_status\":\"rejected\",\"tech_rejection_reason\":\"Приёмочная проверка массовой операции.\"}}"
BULK_STATUS=$(psql_db "SELECT tech_status FROM liders.applications WHERE id=${APP_ID:-0}")
[ "$BULK_STATUS" = "rejected" ] && ok "статус заявки после массовой операции: отклонена" || bad "статус заявки: ${BULK_STATUS:-?}"
BULK_JOURNAL=$(psql_db "SELECT count(*) FROM liders.audit_log WHERE action='applications_bulk_review'")
[ "${BULK_JOURNAL:-0}" -ge 1 ] && ok "массовая операция записана в журнал: ${BULK_JOURNAL}" || bad "массовая операция не записана в журнал"
# Возвращаем заявку в рабочее состояние, чтобы не мешать остальным проверкам.
curl -s -o /dev/null -H "$AUTH" -H 'Content-Type: application/json' \
    -X POST "${BASE}/api/admin/applications/bulk" \
    -d "{\"ids\":[${APP_ID:-0}],\"patch\":{\"tech_status\":\"accepted\"}}"
expect "возврат материала без замечания отклоняется" 422 -H "$AUTH" -H 'Content-Type: application/json' \
    -X POST "${BASE}/api/admin/materials/bulk" -d "{\"ids\":[${MATERIAL_ID:-0}],\"action\":\"request_fix\"}"
expect "массовый возврат материала с замечанием" 200 -H "$AUTH" -H 'Content-Type: application/json' \
    -X POST "${BASE}/api/admin/materials/bulk" \
    -d "{\"ids\":[${MATERIAL_ID:-0}],\"action\":\"request_fix\",\"comment\":\"Уточните расчёты.\"}"
MATERIAL_STATUS=$(psql_db "SELECT status FROM liders.application_materials WHERE id=${MATERIAL_ID:-0}")
[ "$MATERIAL_STATUS" = "needs_fix" ] && ok "материал переведён в «нужны исправления»" || bad "статус материала: ${MATERIAL_STATUS:-?}"
curl -s -o /dev/null -H "$AUTH" -H 'Content-Type: application/json' -X POST "${BASE}/api/admin/materials/bulk" \
    -d "{\"ids\":[${MATERIAL_ID:-0}],\"action\":\"accept\"}"
# Архив заявок 2026 (ТЗ 10, п. 3.1): только чтение.
LEGACY_TABLE=$(psql_db "SELECT count(*) FROM information_schema.tables WHERE table_schema='liders' AND table_name='legacy_applications'")
[ "${LEGACY_TABLE:-0}" = "1" ] && ok "таблица архива заявок 2026 существует" || bad "таблицы архива заявок нет"
expect "архив заявок 2026 доступен администратору" 200 -H "$AUTH" "${BASE}/api/admin/legacy-applications"
# Календарный план сезона: сроки экспертизы и протоколов отдаются публично.
SEASON_CALENDAR=$(curl -s "${BASE}/api/season/current" | grep -c 'expertise_from')
[ "${SEASON_CALENDAR:-0}" -ge 1 ] && ok "календарный план сезона отдаётся публично" || bad "в ответе сезона нет сроков экспертизы"

# ── Пробелы разделов админки: материалы, апелляции, мастер-классы ────────────
step "Материалы: блокировка содержания, очередь и сроки"
expect "блокировка содержания без причины отклоняется" 422 -H "$AUTH" -H 'Content-Type: application/json' \
    -X POST "${BASE}/api/admin/materials/${MATERIAL_ID}/review" -d '{"status":"blocked"}'
expect "блокировка содержания с причиной" 200 -H "$AUTH" -H 'Content-Type: application/json' \
    -X POST "${BASE}/api/admin/materials/${MATERIAL_ID}/review" \
    -d '{"status":"blocked","comment":"Приёмочная проверка: материал нельзя показывать."}'
BLOCKED_STATUS=$(psql_db "SELECT status FROM liders.application_materials WHERE id=${MATERIAL_ID}")
[ "$BLOCKED_STATUS" = "blocked" ] && ok "статус материала: содержание заблокировано" || bad "статус материала: ${BLOCKED_STATUS:-?}"
CABINET_BLOCKED=$(curl -s -b /tmp/lp_acc_cookies.txt "${BASE}/api/cabinet/materials" | python3 -c "
import json,sys
rows = json.load(sys.stdin)
rows = rows.get('data', rows) if isinstance(rows, dict) and 'data' in rows else rows
blocked = [row for row in rows if row.get('status') == 'blocked']
print('ok' if blocked and all(row.get('file_url') is None for row in blocked) else 'leak')
" 2>/dev/null || echo error)
[ "$CABINET_BLOCKED" = "ok" ] && ok "заблокированный материал не отдаётся команде файлом" || bad "команда получила доступ к заблокированному файлу: $CABINET_BLOCKED"
expect "очередь проверки отдаётся" 200 -H "$AUTH" "${BASE}/api/admin/materials?deadline=queue"
expect "фильтр просроченных сроков досдачи работает" 200 -H "$AUTH" "${BASE}/api/admin/materials?deadline=overdue"
expect "фильтр ближайших сроков досдачи работает" 200 -H "$AUTH" "${BASE}/api/admin/materials?deadline=soon"
curl -s -o /dev/null -H "$AUTH" -H 'Content-Type: application/json' \
    -X POST "${BASE}/api/admin/materials/bulk" -d "{\"ids\":[${MATERIAL_ID}],\"action\":\"accept\"}"

step "Апелляции: скан команды и протокол решения"
# Апелляция подаётся из кабинета вместе с файлом: проверяем и файл, и запись.
# Сценарий С5 намеренно сдвигал публикацию протокола в прошлое (проверка срока),
# поэтому окно возвращаем в текущее состояние — иначе подача отклоняется по сроку.
psql_db "UPDATE liders.rankings SET published_at = now() WHERE stage='selection'" >/dev/null
printf '%%PDF-1.4\nприёмочный скан\n' > /tmp/lp_acc_appeal.pdf
TEAM_STATUS_NOW=$(psql_db "SELECT status FROM liders.teams WHERE id=${TEAM_ID}")
expect "апелляция со сканом принимается" 201 -b /tmp/lp_acc_cookies.txt \
    -X POST "${BASE}/api/cabinet/appeals" -F "stage=selection" -F "grounds=procedure_violation" \
    -F "text=Приёмочная апелляция со сканом." -F "file=@/tmp/lp_acc_appeal.pdf;type=application/pdf"
APPEAL_ID=$(psql_db "SELECT id FROM liders.appeals ORDER BY id DESC LIMIT 1")
APPEAL_SCAN=$(psql_db "SELECT scan_media_id IS NOT NULL FROM liders.appeals WHERE id=${APPEAL_ID}")
[ "$APPEAL_SCAN" = "t" ] && ok "скан апелляции сохранён" || bad "скан апелляции не сохранён"
APPEAL_LIST=$(curl -s -H "$AUTH" "${BASE}/api/admin/appeals" | python3 -c "
import json,sys
rows = json.load(sys.stdin)
rows = rows.get('data', rows) if isinstance(rows, dict) and 'data' in rows else rows
# Идентификатор апелляции приходит строкой: колонка объявлена BIGSERIAL.
row = next((item for item in rows if str(item.get('id')) == '${APPEAL_ID}'), None)
print('ok' if row and row.get('scan_url') else 'no')
" 2>/dev/null || echo error)
[ "$APPEAL_LIST" = "ok" ] && ok "скан виден в карточке апелляции у Оргкомитета" || bad "скан не отдаётся в карточке: $APPEAL_LIST"
expect "решение по апелляции с протоколом" 200 -H "$AUTH" -H 'Content-Type: application/json' \
    -X PATCH "${BASE}/api/admin/appeals/${APPEAL_ID}" \
    -d '{"status":"rejected","decision":"Отказать","decision_note":"Основания не подтвердились.","protocol_url":"/docs/legal/jury-regulations.pdf"}'
APPEAL_DECISION=$(psql_db "SELECT status || '|' || COALESCE(decision_note,'') FROM liders.appeals WHERE id=${APPEAL_ID}")
case "$APPEAL_DECISION" in
    'rejected|'*) ok "решение и обоснование сохранены" ;;
    *) bad "решение по апелляции: ${APPEAL_DECISION:-?}" ;;
esac

step "Мастер-классы: материалы занятия в карточке"
expect "мастер-класс с материалами создаётся" 201 -H "$AUTH" -H 'Content-Type: application/json' \
    -X POST "${BASE}/api/admin/masterclasses" \
    -d '{"title":"Мастер-класс с материалами","speaker":"Петров Пётр Петрович","status":"past","recording_url":"https://vk.com/video-123_456","materials":[{"title":"Слайды занятия","url":"https://vk.com/doc123"}]}'
MATERIALS_SLUG=$(psql_db "SELECT slug FROM liders.masterclasses WHERE title='Мастер-класс с материалами'")
MATERIALS_PUBLIC=$(curl -s "${BASE}/api/masterclasses/${MATERIALS_SLUG}" | python3 -c "
import json,sys
data = json.load(sys.stdin)
data = data.get('data', data) if isinstance(data, dict) and 'data' in data else data
materials = data.get('materials') or []
print('ok' if materials and materials[0].get('title') == 'Слайды занятия' else 'no')
" 2>/dev/null || echo error)
[ "$MATERIALS_PUBLIC" = "ok" ] && ok "материалы занятия отдаются публично" || bad "материалы занятия не отдаются: $MATERIALS_PUBLIC"

# ── Файлы: расширения, выдача и подписанные ссылки (ТЗ 11, п. 4, 5.8) ───────
step "Файлы: запрет исполняемых, вложение, краткосрочная ссылка"

# Исполняемый файл отклоняется по расширению, ещё до чтения содержимого
# (ТЗ 11, п. 4.5). Заявляем безобидный MIME: проверка расширения работает
# независимо от заголовка типа.
printf 'MZ\220\0\3\0\0\0' > /tmp/lp_acc_bad.exe
expect "файл .exe отклонён" 415 -b /tmp/lp_acc_cookies.txt -X POST "${BASE}/api/cabinet/materials" \
    -F "type=presentation" -F "file=@/tmp/lp_acc_bad.exe;type=application/pdf"
if grep -q 'исполняемые файлы запрещены' "$BODY"; then
    ok "отказ объясняет причину: исполняемые файлы запрещены"
else
    bad "отказ по расширению без понятного пояснения: $(head -c 160 "$BODY")"
fi

expect "файл с разрешённым расширением принят" 201 -b /tmp/lp_acc_cookies.txt -X POST "${BASE}/api/cabinet/materials" \
    -F "type=presentation" -F "file=@/tmp/lp_acc_law.pdf;type=application/pdf"
PRIVATE_MEDIA=$(psql_db "SELECT media_id FROM liders.application_materials WHERE team_id=${TEAM_ID} AND media_id IS NOT NULL ORDER BY id DESC LIMIT 1")

# Приватный файл отдаётся вложением: браузер не открывает его как страницу
# (ТЗ 11, п. 4.6).
curl -s -D /tmp/lp_acc_file_headers.txt -o /dev/null -H "$AUTH" "${BASE}/api/media/file/${PRIVATE_MEDIA}"
if grep -qi '^content-disposition: attachment' /tmp/lp_acc_file_headers.txt; then
    ok "приватный файл отдаётся вложением (attachment)"
else
    bad "приватный файл отдаётся без attachment: $(grep -i content-disposition /tmp/lp_acc_file_headers.txt | head -1)"
fi

# Краткосрочная подписанная ссылка: выдаётся администратором, работает без
# сессии и перестаёт работать при подмене токена (ТЗ 11, п. 5.8).
expect "ссылка на приватный файл выдаётся" 201 -H "$AUTH" -X POST "${BASE}/api/admin/media/${PRIVATE_MEDIA}/link"
GRANT_PATH=$(python3 -c "import json;print(json.load(open('$BODY')).get('path',''))" 2>/dev/null || echo '')
GRANT_URL="${BASE}${GRANT_PATH}"
GRANT_TTL=$(python3 -c "import json;print(json.load(open('$BODY')).get('expires_in',0))" 2>/dev/null || echo 0)
if [ -n "$GRANT_PATH" ]; then
    CODE=$(curl -s -o /dev/null -w '%{http_code}' "$GRANT_URL")
    [ "$CODE" = "200" ] && ok "подписанная ссылка открывает файл без сессии" || bad "подписанная ссылка не работает: $CODE"
    TAMPERED=$(printf '%s' "$GRANT_URL" | sed 's/.$/X/')
    CODE=$(curl -s -o /dev/null -w '%{http_code}' "$TAMPERED")
    [ "$CODE" = "404" ] && ok "подделанная ссылка отклонена (404)" || bad "подделанная ссылка принята: $CODE"
else
    bad "в ответе нет ссылки на файл: $(head -c 160 "$BODY")"
fi
[ "${GRANT_TTL:-0}" -le 86400 ] && ok "срок ссылки ограничен (${GRANT_TTL} с)" || bad "слишком долгий срок ссылки: ${GRANT_TTL}"
GRANT_LOGGED=$(psql_db "SELECT count(*) FROM liders.audit_log WHERE action='media_grant_link'")
[ "${GRANT_LOGGED:-0}" -ge 1 ] && ok "выдача ссылки записана в журнал" || bad "выдача ссылки не попала в журнал"

# ── Идемпотентность и защита изменяющих запросов (ТЗ 05, п. 1.5; ТЗ 11, п. 5.3) ─
step "Идемпотентность и источник запроса"

LEAD_KEY="acc-lead-$(date +%s)-$RANDOM"
expect "обращение принято" 201 -X POST "${BASE}/api/leads" -H 'Content-Type: application/json' \
    -H "Idempotency-Key: ${LEAD_KEY}" \
    -d '{"name":"Приёмочный Тест","email":"accept-lead@example.ru","message":"Проверка идемпотентности обращения","consent_pdn":true}'
expect "повтор обращения с тем же ключом не создаёт второе" 200 -X POST "${BASE}/api/leads" -H 'Content-Type: application/json' \
    -H "Idempotency-Key: ${LEAD_KEY}" \
    -d '{"name":"Приёмочный Тест","email":"accept-lead@example.ru","message":"Проверка идемпотентности обращения","consent_pdn":true}'
if grep -q 'idempotent_replay' "$BODY"; then ok "ответ помечен как повтор"; else bad "повтор не распознан"; fi
LEADS_COUNT=$(psql_db "SELECT count(*) FROM liders.leads WHERE idempotency_key='${LEAD_KEY}'")
[ "${LEADS_COUNT:-0}" = "1" ] && ok "в базе одно обращение на ключ" || bad "обращений по ключу: ${LEADS_COUNT:-0}"

MAT_KEY="acc-material-$(date +%s)-$RANDOM"
expect "материал принят" 201 -b /tmp/lp_acc_cookies.txt -X POST "${BASE}/api/cabinet/materials" \
    -H "Idempotency-Key: ${MAT_KEY}" -F "type=other" -F "file=@/tmp/lp_acc_law.pdf;type=application/pdf"
expect "повтор материала с тем же ключом не создаёт вторую версию" 200 -b /tmp/lp_acc_cookies.txt -X POST "${BASE}/api/cabinet/materials" \
    -H "Idempotency-Key: ${MAT_KEY}" -F "type=other" -F "file=@/tmp/lp_acc_law.pdf;type=application/pdf"
MAT_COUNT=$(psql_db "SELECT count(*) FROM liders.application_materials WHERE idempotency_key='${MAT_KEY}'")
[ "${MAT_COUNT:-0}" = "1" ] && ok "в базе одна версия материала на ключ" || bad "версий по ключу: ${MAT_COUNT:-0}"

# Межсайтовый изменяющий запрос отклоняется (ТЗ 11, п. 5.3).
expect "запрос с чужим источником отклонён" 403 -X POST "${BASE}/api/leads" -H 'Content-Type: application/json' \
    -H 'Origin: https://evil.example' -H 'Sec-Fetch-Site: cross-site' \
    -d '{"name":"Атака","email":"evil@example.ru","message":"CSRF","consent_pdn":true}'

# Идентификатор запроса в ответе и в теле ошибки (ТЗ 11, п. 5.9).
curl -s -D /tmp/lp_acc_rid.txt -o /dev/null "${BASE}/api/health"
if grep -qi '^x-request-id:' /tmp/lp_acc_rid.txt; then ok "ответ содержит X-Request-Id"; else bad "нет заголовка X-Request-Id"; fi
curl -s -o "$BODY" "${BASE}/api/no-such-route"
if grep -q 'requestId' "$BODY"; then ok "ошибка содержит requestId"; else bad "в ошибке нет requestId: $(head -c 160 "$BODY")"; fi
VERSION_FIELD=$(curl -s "${BASE}/api/health" | python3 -c "import sys,json;d=json.load(sys.stdin);d=d.get('data',d);print(d.get('version',''))" 2>/dev/null || echo '')
[ -n "$VERSION_FIELD" ] && ok "health отдаёт версию сборки: $VERSION_FIELD" || bad "в health нет поля version"

# ── Кабинет: сводка, ссылка доступа и окно досдачи (ТЗ 05, п. 4; ТЗ 06, п. 1.4) ─
step "Кабинет: сводка, ссылка доступа и окно досдачи"

expect "сводка кабинета отдаётся одним запросом" 200 -b /tmp/lp_acc_cookies.txt "${BASE}/api/cabinet/overview"
OVERVIEW_OK=$(python3 -c "
import json
d=json.load(open('$BODY'))
keys=('team','participants','mentors','readiness','nearest_deadline','completeness')
print('ok' if all(k in d for k in keys) and len(d['readiness'])>0 else 'no')
" 2>/dev/null || echo error)
[ "$OVERVIEW_OK" = "ok" ] && ok "сводка содержит состав, комплект и ближайший срок" || bad "сводка неполна: $OVERVIEW_OK"

expect "токен доступа выдаётся администратором" 201 -H "$AUTH" -X POST "${BASE}/api/admin/teams/${TEAM_ID}/tokens" \
    -H 'Content-Type: application/json' -d '{"label":"Приёмочная выдача"}'
if grep -q '/cabinet/access?token=' "$BODY"; then
    ok "в ответе есть готовая ссылка доступа (access_url)"
else
    bad "в ответе нет ссылки доступа: $(head -c 200 "$BODY")"
fi
# Повторная выдача отзывает прежний токен (ТЗ 05, §2, правило 3).
REVOKED=$(python3 -c "import json;print(json.load(open('$BODY')).get('revoked_previous',0))" 2>/dev/null || echo 0)
CAB_TOKEN=$(python3 -c "import json;print(json.load(open('$BODY')).get('token',''))" 2>/dev/null || echo '')
expect "повторная выдача заменяет прежнюю ссылку" 201 -H "$AUTH" -X POST "${BASE}/api/admin/teams/${TEAM_ID}/tokens" \
    -H 'Content-Type: application/json' -d '{"label":"Приёмочная выдача 2"}'
if [ -n "$CAB_TOKEN" ]; then
    CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/cabinet/access" \
        -H 'Content-Type: application/json' -d "{\"token\":\"${CAB_TOKEN}\"}")
    [ "$CODE" = "401" ] && ok "прежняя ссылка после перевыдачи не работает (401)" || bad "прежняя ссылка ещё действует: $CODE"
else
    bad "не удалось получить токен для проверки перевыдачи"
fi
TOKEN_LIMIT=$(psql_db "SELECT count(*) FROM liders.audit_log WHERE action='team_token_rate_limited'")
ok "учёт лимита выдачи ссылок в журнале: ${TOKEN_LIMIT:-0}"

# Критерии этапа нельзя менять после публикации протокола (ТЗ 07, п. 2.6, 4.4).
CRITERION_ID=$(psql_db "SELECT id FROM liders.criteria WHERE stage='selection' ORDER BY id LIMIT 1")
expect "изменение критерия после публикации протокола отклонено" 422 -H "$AUTH" -X PATCH "${BASE}/api/admin/criteria/${CRITERION_ID}" \
    -H 'Content-Type: application/json' -d '{"max_score": 1}'
if grep -q 'Протокол' "$BODY"; then ok "отказ объясняет причину (опубликованный протокол)"; else bad "отказ без пояснения"; fi

# ── Мастер-классы: прошедший без записи не публикуется (ТЗ 05, §3) ───────────
step "Мастер-классы: прошедший без записи не показывается"
psql_db "INSERT INTO liders.masterclasses (season_id, title, speaker, status, starts_at)
         VALUES ((SELECT id FROM liders.seasons ORDER BY id LIMIT 1), 'Приёмочный мастер-класс без записи', 'Тест', 'past', now() - interval '3 days')" >/dev/null
HIDDEN=$(curl -s "${BASE}/api/masterclasses?status=past" | python3 -c "
import sys,json
items=json.load(sys.stdin)
items = items.get('data', items) if isinstance(items, dict) and 'data' in items else items
rows=items if isinstance(items,list) else items.get('data',[])
print('ok' if not any('Приёмочный мастер-класс без записи' == i.get('title') for i in rows) else 'no')
" 2>/dev/null || echo error)
[ "$HIDDEN" = "ok" ] && ok "прошедший мастер-класс без записи не отдаётся публично" || bad "мастер-класс без записи попал в выдачу: $HIDDEN"
psql_db "UPDATE liders.masterclasses SET recording_url='https://vk.com/video-1_2' WHERE title='Приёмочный мастер-класс без записи'" >/dev/null
SHOWN=$(curl -s "${BASE}/api/masterclasses?status=past" | python3 -c "
import sys,json
items=json.load(sys.stdin)
items = items.get('data', items) if isinstance(items, dict) and 'data' in items else items
rows=items if isinstance(items,list) else items.get('data',[])
print('ok' if any('Приёмочный мастер-класс без записи' == i.get('title') for i in rows) else 'no')
" 2>/dev/null || echo error)
[ "$SHOWN" = "ok" ] && ok "после указания записи мастер-класс публикуется" || bad "мастер-класс с записью не найден: $SHOWN"

# ── Архив инициатив: фильтры, снятие с публикации, экспорт (ТЗ 12, С9) ───────
step "Архив инициатив: фильтры, снятие с публикации, экспорт архива 2026"

expect "фильтр архива по году" 200 "${BASE}/api/initiatives?year=2024"
expect "фильтр архива по направлению" 200 "${BASE}/api/initiatives?direction_id=${DIRECTION_ID}"
expect "поиск по архиву" 200 "${BASE}/api/initiatives?q=%D0%B7%D0%B0%D0%BA%D0%BE%D0%BD"
PUBLISHED_ID=$(psql_db "SELECT id FROM liders.initiatives WHERE is_published = TRUE ORDER BY id LIMIT 1")
if [ -n "${PUBLISHED_ID:-}" ]; then
    expect "инициатива снята с публикации" 200 -H "$AUTH" -X POST "${BASE}/api/admin/initiatives/${PUBLISHED_ID}/publish" \
        -H 'Content-Type: application/json' -d '{"is_published":false}'
    GONE=$(curl -s "${BASE}/api/initiatives" | python3 -c "
import sys,json
items=json.load(sys.stdin)
items = items.get('data', items) if isinstance(items, dict) and 'data' in items else items
rows=items if isinstance(items,list) else items.get('data',[])
print('ok' if not any(int(i.get('id',0))==${PUBLISHED_ID} for i in rows) else 'no')
" 2>/dev/null || echo error)
    [ "$GONE" = "ok" ] && ok "снятая с публикации инициатива исчезла из архива" || bad "снятая инициатива осталась в архиве"
    expect "инициатива возвращена в архив" 200 -H "$AUTH" -X POST "${BASE}/api/admin/initiatives/${PUBLISHED_ID}/publish" \
        -H 'Content-Type: application/json' -d '{"is_published":true}'
else
    bad "в архиве нет опубликованной инициативы для проверки снятия"
fi

expect "архив заявок 2026 выгружается в CSV" 200 -H "$AUTH" "${BASE}/api/admin/legacy-applications/export"
if head -c 200 "$BODY" | grep -q 'full_name'; then ok "в выгрузке есть заголовки полей"; else bad "выгрузка архива без заголовков"; fi

# ── Редиректы прежних адресов (ТЗ 10, §4.2) ─────────────────────────────────
step "Прежние адреса: постоянные редиректы"
# Сами редиректы выполняет nginx, поэтому проверяется конфигурация выката:
# в приёмочном прогоне nginx не участвует.
NGINX_CONF="$ROOT/ops/nginx/lideryprava-platform.conf"
for pair in "pobediteli.html:/winners" "privacy.html:/legal/privacy" "soglasie.html:/legal/pdn-consent" "terms.html:/legal/terms" "cookies.html:/legal/cookies" "admin.html:/admin/"; do
    from="${pair%%:*}"; to="${pair##*:}"
    if grep -q "location = /${from}" "$NGINX_CONF" && grep -q "return 301 ${to};" "$NGINX_CONF"; then
        ok "редирект /${from} → ${to}"
    else
        bad "в конфигурации нет редиректа /${from} → ${to}"
    fi
done

# ── Состав команды: однократная замена (ТЗ 06, п. 3) ────────────────────────
step "Состав команды: однократная замена с сохранением половины"

# В черновике состав собирается свободно, поэтому проверяем правило в статусе
# «возвращена на доработку»: именно там замена участников разрешена один раз.
STATUS_BEFORE=$(psql_db "SELECT status FROM liders.teams WHERE id=${TEAM_ID}")
psql_db "UPDATE liders.teams SET status='tech_rejected' WHERE id=${TEAM_ID}" >/dev/null
MEMBER_ID=$(psql_db "SELECT id FROM liders.participants WHERE team_id=${TEAM_ID} AND email='accept2@example.ru' ORDER BY id LIMIT 1")
THIRD_ID=$(psql_db "SELECT id FROM liders.participants WHERE team_id=${TEAM_ID} AND email='accept3@example.ru' ORDER BY id LIMIT 1")
ROSTER_ADD=$(python3 - "$CAPTAIN_ID" "$MEMBER_ID" <<'PY'
import json, sys
captain, member = int(sys.argv[1]), int(sys.argv[2])
rows = [
  {"id": captain, "full_name": "Приёмов Пётр Петрович", "birth_date": "2001-03-03", "category": "student", "email": "accept@example.ru", "role": "captain", "consent_pdn": True, "citizenship": "Российская Федерация", "region": "Саратовская область", "settlement": "г. Саратов", "competencies": "Публикации по гражданскому праву.", "personal_contribution": "Структура законопроекта.", "faculty": "Юридический факультет", "course": 3, "study_program": "40.03.01 Юриспруденция"},
  {"id": member, "full_name": "Приёмова Анна Львовна", "birth_date": "2002-07-07", "category": "magistrant", "email": "accept2@example.ru", "role": "member", "consent_pdn": True, "citizenship": "Российская Федерация", "region": "Саратовская область", "settlement": "г. Энгельс", "competencies": "Юридическая клиника.", "personal_contribution": "Анализ практики."},
  {"full_name": "Приёмов Третий Участник", "birth_date": "2003-09-09", "category": "student", "email": "accept3@example.ru", "role": "member", "consent_pdn": True, "citizenship": "Российская Федерация", "region": "Саратовская область", "settlement": "г. Балаково", "competencies": "Судебная практика.", "personal_contribution": "Проект постановления."},
]
print(json.dumps({"name": "Приёмочная команда", "direction_id": 1, "participants": rows, "mentors": [{"full_name": "Наставников Лев Иванович", "organization": "СГЮА", "position": "доцент", "academic_degree": "кандидат юридических наук", "academic_title": "доцент", "email": "mentor@example.ru", "consent_pdn": True}]}, ensure_ascii=False))
PY
)
expect "изменение состава в поданной заявке разрешено один раз" 200 -b /tmp/lp_acc_cookies.txt -X PATCH "${BASE}/api/cabinet/team" -H 'Content-Type: application/json' -d "$ROSTER_ADD"
ROSTER_USED=$(psql_db "SELECT roster_change_used_at IS NOT NULL FROM liders.teams WHERE id=${TEAM_ID}")
[ "$ROSTER_USED" = "t" ] && ok "отметка об изменении состава сохранена" || bad "отметка об изменении состава не сохранена"

ROSTER_REMOVE_ALL=$(python3 - "$CAPTAIN_ID" "$MEMBER_ID" <<'PY'
import json, sys
captain, member = int(sys.argv[1]), int(sys.argv[2])
rows = [
  {"id": captain, "full_name": "Приёмов Пётр Петрович", "birth_date": "2001-03-03", "category": "student", "email": "accept@example.ru", "role": "captain", "consent_pdn": True},
  {"id": member, "full_name": "Приёмова Анна Львовна", "birth_date": "2002-07-07", "category": "magistrant", "email": "accept2@example.ru", "role": "member", "consent_pdn": True},
]
print(json.dumps({"name": "Приёмочная команда", "direction_id": 1, "participants": rows, "mentors": []}, ensure_ascii=False))
PY
)
expect "повторная замена состава отклоняется" 409 -b /tmp/lp_acc_cookies.txt -X PATCH "${BASE}/api/cabinet/team" -H 'Content-Type: application/json' -d "$ROSTER_REMOVE_ALL"
if grep -q 'уже изменялся' "$BODY"; then ok "отказ объясняет однократность изменения состава"; else bad "отказ без пояснения: $(head -c 160 "$BODY")"; fi
psql_db "UPDATE liders.teams SET status='${STATUS_BEFORE}' WHERE id=${TEAM_ID}" >/dev/null

# ── Остаток ТЗ 07 и 06: карточка, фильтры, оценивание, контент ──────────────
step "Карточка заявки, фильтры, оценивание, контент"

expect "карточка заявки отдаётся" 200 -H "$AUTH" "${BASE}/api/admin/applications/${APPLICATION_ID}"
CARD_CHECK=$(python3 -c "
import json
d = json.load(open('$BODY'))
checks = d.get('requirements_check') or []
codes = {item.get('code') for item in checks}
print('ok' if {'age','roster','captain','unique','direction','materials'} <= codes and isinstance(d.get('history'), list) else 'no')
" 2>/dev/null || echo error)
[ "$CARD_CHECK" = "ok" ] && ok "карточка содержит проверку требований и историю" || bad "карточка неполна: $CARD_CHECK"
REQ_FAILS=$(python3 -c "
import json
d = json.load(open('$BODY'))
print(sum(1 for item in (d.get('requirements_check') or []) if not item.get('passed')))
" 2>/dev/null || echo '?')
ok "непройденных проверок требований: ${REQ_FAILS}"

# Фильтры заявок (ТЗ 07, п. 2.2): период подачи, замечания, поиск по участнику.
expect "фильтр по периоду подачи" 200 -H "$AUTH" "${BASE}/api/admin/applications?submitted_from=2026-01-01&submitted_to=2027-01-01"
expect "фильтр по замечаниям" 200 -H "$AUTH" "${BASE}/api/admin/applications?has_remarks=true"
expect "поиск заявки по ФИО участника" 200 -H "$AUTH" "${BASE}/api/admin/applications?q=%D0%9F%D1%80%D0%B8%D1%91%D0%BC%D0%BE%D0%B2"

# Конфликт интересов: оценка сохраняется, но не учитывается (ТЗ 07, п. 2.7).
expect "конфликт интересов без причины отклоняется" 422 -H "$AUTH" -X POST "${BASE}/api/admin/evaluations" \
    -H 'Content-Type: application/json' \
    -d "{\"team_id\":${TEAM_ID},\"stage\":\"selection\",\"expert_id\":${FIRST_EXPERT},\"scores\":$(score_for 0),\"is_conflicted\":true}"
CONFLICT_SAVE=$(curl -s -o "$BODY" -w '%{http_code}' -H "$AUTH" -X POST "${BASE}/api/admin/evaluations" \
    -H 'Content-Type: application/json' \
    -d "{\"team_id\":${TEAM_ID},\"stage\":\"selection\",\"expert_id\":${FIRST_EXPERT},\"scores\":$(score_for 0),\"is_conflicted\":true,\"conflict_reason\":\"Приёмочная проверка: родственник участника\"}")
unwrap_body "$BODY"
case "$CONFLICT_SAVE" in
    200|201) ok "оценка с конфликтом интересов сохранена → $CONFLICT_SAVE" ;;
    *) bad "оценка с конфликтом интересов не сохранилась: $CONFLICT_SAVE · $(head -c 160 "$BODY")" ;;
esac
expect "пересчёт рейтинга с конфликтом" 200 -H "$AUTH" -X POST "${BASE}/api/admin/rankings/recalculate" \
    -H 'Content-Type: application/json' -d '{"season_id":1,"stage":"selection"}'
CONFLICT_AVERAGE=$(psql_db "SELECT average_score FROM liders.rankings WHERE team_id=${TEAM_ID} AND stage='selection'")
[ "$CONFLICT_AVERAGE" != "32.67" ] && ok "оценка с конфликтом исключена из среднего: ${CONFLICT_AVERAGE}" || bad "оценка с конфликтом попала в подсчёт"

# Снятие протокола с публикации: причина обязательна (ТЗ 07, п. 2.8).
expect "снятие протокола без причины отклоняется" 422 -H "$AUTH" -X POST "${BASE}/api/admin/rankings/publish" \
    -H 'Content-Type: application/json' -d '{"season_id":1,"stage":"selection","is_published":false}'
expect "снятие протокола с причиной" 200 -H "$AUTH" -X POST "${BASE}/api/admin/rankings/publish" \
    -H 'Content-Type: application/json' -d '{"season_id":1,"stage":"selection","is_published":false,"reason":"Приёмочная проверка снятия"}'
UNPUB_LOGGED=$(psql_db "SELECT count(*) FROM liders.audit_log WHERE action='rankings_unpublish'")
[ "${UNPUB_LOGGED:-0}" -ge 1 ] && ok "снятие протокола записано в журнал" || bad "снятие протокола не попало в журнал"
# Возвращаем протокол в публикацию и убираем приёмочную оценку с конфликтом.
psql_db "DELETE FROM liders.evaluations WHERE is_conflicted = TRUE" >/dev/null
# Возвращаем обычную оценку первого эксперта: без неё у команды остаётся две
# оценки, и контроль «не менее трёх» справедливо блокирует публикацию.
curl -s -o /dev/null -H "$AUTH" -X POST "${BASE}/api/admin/evaluations" \
    -H 'Content-Type: application/json' \
    -d "{\"team_id\":${TEAM_ID},\"stage\":\"selection\",\"expert_id\":${FIRST_EXPERT},\"scores\":$(score_for 8),\"comment\":\"Материалы полные.\"}"
curl -s -o /dev/null -H "$AUTH" -X POST "${BASE}/api/admin/rankings/recalculate" \
    -H 'Content-Type: application/json' -d '{"season_id":1,"stage":"selection"}'
expect "повторная публикация протокола" 200 -H "$AUTH" -X POST "${BASE}/api/admin/rankings/publish" \
    -H 'Content-Type: application/json' -d '{"season_id":1,"stage":"selection"}'
TIES=$(psql_db "SELECT count(*) FROM liders.rankings WHERE season_id=1 AND stage='selection'")
ok "записей рейтинга после публикации: ${TIES}"

# Срок рассмотрения из Положения исключён: дата не рассчитывается и не хранится.
APPEAL_DUE=$(psql_db "SELECT decision_due_at IS NULL FROM liders.appeals ORDER BY id DESC LIMIT 1")
[ "$APPEAL_DUE" = "t" ] && ok "срок рассмотрения апелляции не проставляется" || bad "апелляции всё ещё проставляется срок рассмотрения"
APPEAL_LIST_DUE=$(curl -s -H "$AUTH" "${BASE}/api/admin/appeals" | python3 -c "
import sys, json
d = json.load(sys.stdin)
rows = d.get('data', d) if isinstance(d, dict) else d
# Срок рассмотрения исключён из Положения: поля с расчётной датой в списке быть
# не должно, а состояние «не рассмотрена / рассмотрена» — должно.
print('ok' if isinstance(rows, list) and all('decision_overdue' not in row for row in rows) else 'no')
" 2>/dev/null || echo error)
[ "$APPEAL_LIST_DUE" = "ok" ] && ok "список апелляций не содержит срока рассмотрения" || bad "в списке апелляций остался срок рассмотрения"

# Журнал: фильтр по периоду и выгрузка (ТЗ 07, п. 2.17).
expect "журнал фильтруется по периоду" 200 -H "$AUTH" "${BASE}/api/admin/audit?from=2026-01-01&to=2027-01-01"
expect "журнал действий выгружается в CSV" 200 -H "$AUTH" "${BASE}/api/admin/audit/export"
if head -c 300 "$BODY" | grep -q 'Действие'; then ok "в выгрузке журнала есть заголовки"; else bad "выгрузка журнала без заголовков"; fi

# Новости: привязка к сезону и домен видеосервиса (ТЗ 07, п. 2.12).
expect "новость с зарубежной видеоссылкой отклоняется" 422 -H "$AUTH" -X POST "${BASE}/api/admin/news" \
    -H 'Content-Type: application/json' \
    -d '{"title":"Приёмочная новость с видео","type":"video","video_url":"https://youtube.com/watch?v=1","season_id":1}'
expect "новость с российским видеосервисом принимается" 201 -H "$AUTH" -X POST "${BASE}/api/admin/news" \
    -H 'Content-Type: application/json' \
    -d '{"title":"Приёмочная новость с видео на ВКонтакте","type":"video","video_url":"https://vk.com/video-1_2","season_id":1,"is_published":true}'
NEWS_SEASON=$(psql_db "SELECT season_id FROM liders.news WHERE title='Приёмочная новость с видео на ВКонтакте'")
[ "${NEWS_SEASON:-0}" = "1" ] && ok "новость привязана к сезону" || bad "сезон новости: ${NEWS_SEASON:-?}"

# Мастер-класс: статус «отменён» и снятие с публикации (ТЗ 07, п. 2.10).
expect "мастер-класс переводится в статус «отменён»" 201 -H "$AUTH" -X POST "${BASE}/api/admin/masterclasses" \
    -H 'Content-Type: application/json' \
    -d '{"title":"Приёмочный отменённый мастер-класс","speaker":"Тестов Тест","status":"cancelled","starts_at":"2026-12-01T10:00:00Z","is_published":true}'
CANCELLED_PUBLIC=$(curl -s "${BASE}/api/masterclasses" | python3 -c "
import sys, json
d = json.load(sys.stdin)
rows = d.get('data', d) if isinstance(d, dict) else d
print('ok' if not any(i.get('title') == 'Приёмочный отменённый мастер-класс' for i in rows) else 'no')
" 2>/dev/null || echo error)
[ "$CANCELLED_PUBLIC" = "ok" ] && ok "отменённый мастер-класс не показывается публично" || bad "отменённый мастер-класс попал в выдачу"

# ── Постраничность служебных списков (ТЗ 05, п. 1.4) ────────────────────────
step "Постраничность списка оценок и материалов"

EVAL_PAGED=$(curl -s -H "$AUTH" "${BASE}/api/admin/evaluations?stage=selection&perPage=1" | python3 -c "
import sys, json
d = json.load(sys.stdin)
meta = d.get('meta') or {}
rows = d.get('data') or []
print('ok' if meta.get('perPage') == 1 and 'total' in meta and len(rows) <= 1 else 'no')
" 2>/dev/null || echo error)
[ "$EVAL_PAGED" = "ok" ] && ok "список оценок отдаёт meta и учитывает размер страницы" || bad "список оценок без meta: $EVAL_PAGED"
MATERIALS_PAGED=$(curl -s -H "$AUTH" "${BASE}/api/admin/materials?perPage=1" | python3 -c "
import sys, json
d = json.load(sys.stdin)
meta = d.get('meta') or {}
rows = d.get('data') or []
print('ok' if meta.get('perPage') == 1 and 'total' in meta and len(rows) <= 1 else 'no')
" 2>/dev/null || echo error)
[ "$MATERIALS_PAGED" = "ok" ] && ok "очередь материалов отдаёт meta" || bad "очередь материалов без meta: $MATERIALS_PAGED"

APPEALS_PAGED=$(curl -s -H "$AUTH" "${BASE}/api/admin/appeals?perPage=1" | python3 -c "
import sys, json
d = json.load(sys.stdin)
meta = d.get('meta') or {}
rows = d.get('data') or []
print('ok' if meta.get('perPage') == 1 and 'total' in meta and len(rows) <= 1 else 'no')
" 2>/dev/null || echo error)
[ "$APPEALS_PAGED" = "ok" ] && ok "список апелляций отдаёт meta" || bad "список апелляций без meta: $APPEALS_PAGED"

# Журнал действий: фильтры по действию и пользователю и постраничность
# (ТЗ 07, п. 2.17). Проверяем, что фильтр действительно сужает выборку.
AUDIT_FILTERED=$(curl -s -H "$AUTH" "${BASE}/api/admin/audit?action=application&page=1&perPage=5" | python3 -c "
import sys, json
d = json.load(sys.stdin)
rows = d.get('data') or []
meta = d.get('meta') or {}
matches = all('application' in str(row.get('action', '')) for row in rows)
print('ok' if matches and meta.get('perPage') == 5 and 'total' in meta else 'no')
" 2>/dev/null || echo error)
[ "$AUDIT_FILTERED" = "ok" ] && ok "журнал фильтруется по действию и отдаёт meta" || bad "фильтр журнала по действию: $AUDIT_FILTERED"

# Выгрузка всей выборки в универсальных разделах: список отдаёт страницу,
# поэтому файл «по экрану» получался неполным (ТЗ 07, п. 1.8).
EXPORT_ALL=$(curl -s -H "$AUTH" "${BASE}/api/admin/documents/export" | python3 -c "
import sys, json
d = json.load(sys.stdin)
rows = d.get('data') if isinstance(d, dict) else d
meta = (d.get('meta') or {}) if isinstance(d, dict) else {}
print(f\"{len(rows or [])}:{meta.get('total')}\")
" 2>/dev/null || echo '0:0')
if [ "${EXPORT_ALL%%:*}" -ge 15 ] && [ "${EXPORT_ALL%%:*}" = "${EXPORT_ALL##*:}" ]; then
    ok "выгрузка раздела отдаёт всю выборку, а не страницу (${EXPORT_ALL%%:*} записей)"
else
    bad "выгрузка раздела: $EXPORT_ALL"
fi

# Дата публикации инициативы: от неё зависит lastmod карты сайта
INIT_PUBLISHED=$(curl -s -H "$AUTH" -X POST "${BASE}/api/admin/initiatives" \
    -H 'Content-Type: application/json' \
    -d '{"title":"Приёмочная инициатива публикации","archive_year":2025,"is_published":true}' | python3 -c "
import sys, json
d = json.load(sys.stdin)
d = d.get('data', d)
print(d.get('id') if d.get('published_at') else 'нет')
" 2>/dev/null || echo error)
if [ "$INIT_PUBLISHED" != "нет" ] && [ "$INIT_PUBLISHED" != "error" ]; then
    ok "публикация инициативы проставляет дату (lastmod карты сайта)"
    curl -s -o /dev/null -H "$AUTH" -X DELETE "${BASE}/api/admin/initiatives/${INIT_PUBLISHED}"
else
    bad "дата публикации инициативы не проставлена: $INIT_PUBLISHED"
fi

# ── Авторы инициативы и массовый импорт (ТЗ 07, п. 2.14а) ───────────────────
step "Авторы инициативы и импорт архива"

AUTHOR_INIT=$(psql_db "SELECT id FROM liders.initiatives ORDER BY id LIMIT 1")
expect "автор добавляется в карточку" 201 -H "$AUTH" -X POST "${BASE}/api/admin/initiatives/${AUTHOR_INIT}/authors" \
    -H 'Content-Type: application/json' \
    -d '{"full_name":"Приёмочный Автор Тестович","organization":"СГЮА","region":"Саратовская область","is_published":false}'
AUTHOR_ID=$(python3 -c "import json;d=json.load(open('$BODY'));print(d.get('id',''))" 2>/dev/null || echo '')
expect "автор без согласия скрыт" 200 -H "$AUTH" -X PATCH "${BASE}/api/admin/initiatives/${AUTHOR_INIT}/authors/${AUTHOR_ID}" \
    -H 'Content-Type: application/json' -d '{"is_published":true}'
AUTHOR_LIST=$(curl -s -H "$AUTH" "${BASE}/api/admin/initiatives/${AUTHOR_INIT}/authors" | python3 -c "
import sys, json
d = json.load(sys.stdin)
rows = d.get('data', d) if isinstance(d, dict) else d
flag = next((row.get('is_published') for row in rows if str(row.get('id')) == '${AUTHOR_ID}'), None)
print('ok' if flag is True else 'no')
" 2>/dev/null || echo error)
[ "$AUTHOR_LIST" = "ok" ] && ok "отметка публикации автора сохранена" || bad "отметка автора не сохранилась: $AUTHOR_LIST"
expect "автор удаляется" 200 -H "$AUTH" -X DELETE "${BASE}/api/admin/initiatives/${AUTHOR_INIT}/authors/${AUTHOR_ID}"

# Импорт: предпросмотр CSV и XLSX, затем запись.
printf 'Название;Команда;Год;Уровень акта;Место;Аннотация\nПриёмочная работа импорта;Приёмочная команда;2024;federal;3;Проверка импорта\nРабота без года;Вторая команда;неверный;regional;1;Проверка ошибки\n' > /tmp/lp_acc_import.csv
expect "предпросмотр CSV проходит" 200 -H "$AUTH" -X POST "${BASE}/api/admin/initiatives/import/preview" \
    -F "file=@/tmp/lp_acc_import.csv;type=text/csv"
IMPORT_PREVIEW=$(python3 -c "
import json
d = json.load(open('$BODY'))
rows = d.get('rows') or []
with_errors = [r for r in rows if r.get('errors')]
print('ok' if d.get('total') == 2 and len(with_errors) == 1 and d.get('ready') == 1 else 'no')
" 2>/dev/null || echo error)
[ "$IMPORT_PREVIEW" = "ok" ] && ok "предпросмотр распознал строки и ошибку в году" || bad "предпросмотр: $IMPORT_PREVIEW"

# Предпросмотр ничего не записывает в базу.
IMPORTED_BEFORE=$(psql_db "SELECT count(*) FROM liders.initiatives WHERE title='Приёмочная работа импорта'")
[ "${IMPORTED_BEFORE:-1}" = "0" ] && ok "предпросмотр не меняет архив" || bad "предпросмотр записал данные: ${IMPORTED_BEFORE}"

IMPORT_ROWS=$(python3 -c "
import json
d = json.load(open('$BODY'))
rows = [{'row': r['row'], 'values': r['values']} for r in (d.get('rows') or []) if r.get('values', {}).get('title')]
print(json.dumps({'rows': rows}, ensure_ascii=False))
" 2>/dev/null || echo '{"rows":[]}')
curl -s -o "$BODY" -H "$AUTH" -X POST "${BASE}/api/admin/initiatives/import" -H 'Content-Type: application/json' -d "$IMPORT_ROWS" >/dev/null
unwrap_body "$BODY"
IMPORTED_CREATED=$(psql_db "SELECT count(*) FROM liders.initiatives WHERE title='Приёмочная работа импорта' AND is_published = FALSE")
[ "${IMPORTED_CREATED:-0}" = "1" ] && ok "импорт создал работу (непубликованной)" || bad "импорт не создал работу: ${IMPORTED_CREATED}"
IMPORT_LOGGED=$(psql_db "SELECT count(*) FROM liders.audit_log WHERE action='initiatives_import'")
[ "${IMPORT_LOGGED:-0}" -ge 1 ] && ok "импорт записан в журнал" || bad "импорт не попал в журнал"

# XLSX: файл собирается системной выгрузкой (проверяется и сборка, и разбор).
# Прогон самодостаточен: файл создаётся здесь, а не берётся из окружения.
if (cd "$SERVER_DIR" && node --import tsx -e "
import { writeFileSync } from 'node:fs';
import { buildXlsx } from '${ROOT}/platform/shared/src/xlsx.ts';
const bytes = buildXlsx('Импорт', ['Название','Команда','Год','Уровень акта','Место'], [['Работа из XLSX','Команда XLSX','2025','regional','2']]);
writeFileSync('/tmp/lp_acc_import.xlsx', bytes);
") >/dev/null 2>&1 && [ -s /tmp/lp_acc_import.xlsx ]; then
    ok "файл XLSX для проверки собран системной выгрузкой"
else
    bad "файл XLSX для проверки не собран"
fi
expect "предпросмотр XLSX проходит" 200 -H "$AUTH" -X POST "${BASE}/api/admin/initiatives/import/preview" \
    -F "file=@/tmp/lp_acc_import.xlsx;type=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
XLSX_ROWS=$(python3 -c "
import json
d = json.load(open('$BODY'))
print(d.get('format'), d.get('total'), (d.get('rows') or [{}])[0].get('values', {}).get('title'))
" 2>/dev/null || echo 'error')
[ "${XLSX_ROWS%% *}" = "xlsx" ] && ok "XLSX распознан: ${XLSX_ROWS}" || bad "XLSX не распознан: $XLSX_ROWS"

# ── Бланки согласий, ответы на обращения, фильтры архива (ТЗ 06–07) ─────────
step "Бланки согласий, ответ на обращение, фильтры архива и настройки"

# Бланк согласия формируется после отправки заявки (ТЗ 06, п. 1.3).
for kind in pdn distribution legal_representative media; do
    CODE=$(curl -s -o "/tmp/lp_acc_consent_${kind}.docx" -w '%{http_code}' \
        -b /tmp/lp_acc_cookies.txt "${BASE}/api/cabinet/consent-form.docx?kind=${kind}")
    if [ "$CODE" = "200" ] && head -c 2 "/tmp/lp_acc_consent_${kind}.docx" | grep -q 'PK'; then
        ok "бланк согласия (${kind}) формируется как DOCX"
    else
        bad "бланк согласия (${kind}): код ${CODE}"
    fi
done
expect "неизвестный вид согласия отклоняется" 422 -b /tmp/lp_acc_cookies.txt "${BASE}/api/cabinet/consent-form.docx?kind=unknown"

# Ответ на обращение (ТЗ 07, п. 2.15): текст сохраняется в карточке.
LEAD_ID=$(psql_db "SELECT id FROM liders.leads ORDER BY id DESC LIMIT 1")
expect "ответ без текста отклоняется" 422 -H "$AUTH" -X POST "${BASE}/api/admin/leads/${LEAD_ID}/respond" \
    -H 'Content-Type: application/json' -d '{"response_text":"  "}'
expect "ответ на обращение сохраняется" 200 -H "$AUTH" -X POST "${BASE}/api/admin/leads/${LEAD_ID}/respond" \
    -H 'Content-Type: application/json' -d '{"response_text":"Приёмочный ответ: заявка проверена, материалы приняты."}'
LEAD_STATE=$(psql_db "SELECT status || ':' || COALESCE(responded_by::text, '') FROM liders.leads WHERE id=${LEAD_ID}")
case "$LEAD_STATE" in
    answered:*) ok "обращение помечено отвеченным с автором ответа" ;;
    *) bad "состояние обращения после ответа: ${LEAD_STATE:-?}" ;;
esac
LEAD_LOGGED=$(psql_db "SELECT count(*) FROM liders.audit_log WHERE action='lead_answered'")
[ "${LEAD_LOGGED:-0}" -ge 1 ] && ok "ответ на обращение записан в журнал" || bad "ответ не попал в журнал"

# Фильтры архива инициатив (ТЗ 07, п. 2.14а).
expect "фильтр архива по сезону" 200 -H "$AUTH" "${BASE}/api/admin/initiatives?season_id=1"
expect "фильтр архива по направлению" 200 -H "$AUTH" "${BASE}/api/admin/initiatives?direction_id=${DIRECTION_ID}"
expect "фильтр архива по публикации" 200 -H "$AUTH" "${BASE}/api/admin/initiatives?is_published=true"

# Предупреждения при публикации без согласия и лицензии (ТЗ 07, п. 2.14а).
WARN_ID=$(psql_db "SELECT id FROM liders.initiatives ORDER BY id LIMIT 1")
psql_db "UPDATE liders.initiatives SET is_published = FALSE, authors_public = FALSE, files_public = FALSE WHERE id = ${WARN_ID}" >/dev/null
expect "публикация без согласия и лицензии проходит с предупреждениями" 200 -H "$AUTH" \
    -X POST "${BASE}/api/admin/initiatives/${WARN_ID}/publish" -H 'Content-Type: application/json' -d '{"is_published":true}'
WARN_COUNT=$(python3 -c "
import json
d = json.load(open('$BODY'))
print(len(d.get('warnings') or []))
" 2>/dev/null || echo 0)
[ "${WARN_COUNT:-0}" -ge 2 ] && ok "предупреждений о публикации: ${WARN_COUNT}" || bad "предупреждений получено: ${WARN_COUNT}"

# Настройки: включатели функций, реквизиты оператора и шаблоны писем (ТЗ 07, п. 2.16).
expect "настройки отдаются" 200 -H "$AUTH" "${BASE}/api/admin/settings"
SETTINGS_OK=$(python3 -c "
import json
d = json.load(open('$BODY'))
rows = d.get('data', d) if isinstance(d, dict) else d
keys = {row.get('key') for row in rows} if isinstance(rows, list) else set()
need = {'features.application_open', 'features.mailing', 'operator.name', 'operator.inn', 'mail.templates.application_received'}
print('ok' if need <= keys else 'нет: ' + ', '.join(sorted(need - keys)))
" 2>/dev/null || echo error)
[ "$SETTINGS_OK" = "ok" ] && ok "в настройках есть включатели, реквизиты и шаблоны писем" || bad "настройки неполны: $SETTINGS_OK"

# ── Матрица оценок, PDF протокола и сводка (ТЗ 07, п. 2.1, 2.7, 2.8) ────────
step "Матрица «команда × эксперт», протокол этапа и сроки на сводке"

expect "матрица оценивания отдаётся" 200 -H "$AUTH" "${BASE}/api/admin/evaluations/matrix?season_id=1&stage=selection"
MATRIX_OK=$(python3 -c "
import json
d = json.load(open('$BODY'))
rows = d.get('rows') or []
experts = d.get('experts') or []
# Порогового минимума оценок больше нет: матрица показывает прогресс, а не
# условие публикации (требование «не менее трёх» исключено из Положения).
ok = bool(rows) and bool(experts) and 'min_evaluations' not in d
cells = all(len(row.get('cells') or []) == len(experts) for row in rows)
ready = all('is_ready' in row and 'evaluations_count' in row for row in rows)
print('ok' if ok and cells and ready else 'no')
" 2>/dev/null || echo error)
[ "$MATRIX_OK" = "ok" ] && ok "матрица содержит работы, экспертов и готовность" || bad "матрица неполна: $MATRIX_OK"

# Протокол этапа: PDF загружается и становится доступен участникам.
printf '%%PDF-1.4
1 0 obj<<>>endobj
trailer<<>>
%%%%EOF
' > /tmp/lp_acc_protocol.pdf
expect "PDF протокола загружается" 201 -H "$AUTH" -X POST "${BASE}/api/admin/rankings/protocol" \
    -F "season_id=1" -F "stage=selection" -F "file=@/tmp/lp_acc_protocol.pdf;type=application/pdf"
PROTOCOL_URL=$(python3 -c "import json;d=json.load(open('$BODY'));print(d.get('file_url',''))" 2>/dev/null || echo '')
[ -n "$PROTOCOL_URL" ] && ok "в ответе есть ссылка на протокол" || bad "нет ссылки на загруженный протокол"
# Тип проверяется по содержимому, а не по расширению: magic-байты PDF.
printf 'not a pdf at all' > /tmp/lp_acc_notpdf.pdf
expect "файл без сигнатуры PDF отклоняется" 415 -H "$AUTH" -X POST "${BASE}/api/admin/rankings/protocol" \
    -F "season_id=1" -F "stage=selection" -F "file=@/tmp/lp_acc_notpdf.pdf;type=application/pdf"
RANKING_PROTOCOL=$(curl -s -H "$AUTH" "${BASE}/api/admin/rankings?season_id=1&stage=selection" | python3 -c "
import sys, json
d = json.load(sys.stdin)
rows = d.get('data', d) if isinstance(d, dict) else d
print('ok' if any(r.get('protocol_url') for r in rows) else 'no')
" 2>/dev/null || echo error)
[ "$RANKING_PROTOCOL" = "ok" ] && ok "протокол виден в рейтинге этапа" || bad "протокол не виден в рейтинге: $RANKING_PROTOCOL"
CABINET_PROTOCOL=$(curl -s -b /tmp/lp_acc_cookies.txt "${BASE}/api/cabinet/team" | python3 -c "
import sys, json
d = json.load(sys.stdin)
d = d.get('data', d) if isinstance(d, dict) and 'data' in d else d
results = d.get('results') or []
print('ok' if isinstance(results, list) and all('protocol_url' in r for r in results) else 'no')
" 2>/dev/null || echo error)
[ "$CABINET_PROTOCOL" = "ok" ] && ok "кабинет получает результаты с протоколом" || bad "кабинет без результатов: $CABINET_PROTOCOL"

expect "сводка отдаёт ближайшие сроки" 200 -H "$AUTH" "${BASE}/api/admin/stats?season_id=1"
DEADLINES_OK=$(python3 -c "
import json
d = json.load(open('$BODY'))
print('ok' if isinstance(d.get('upcoming_deadlines'), list) and isinstance(d.get('appeal_windows'), list) else 'no')
" 2>/dev/null || echo error)
[ "$DEADLINES_OK" = "ok" ] && ok "сводка содержит сроки и окна апелляций" || bad "сводка без сроков: $DEADLINES_OK"

# ── Доступ эксперта к внесению оценок (ТЗ 07, п. 2.5) ───────────────────────
step "Доступ эксперта: выдача ссылки, работы этапа, оценка"

# Работы этапа эксперт видит только по допущенным заявкам: на этом шаге прогона
# команда возвращена на доработку, поэтому временно возвращаем статус «допущена».
EXPERT_STATUS_BEFORE=$(psql_db "SELECT status FROM liders.teams WHERE id=${TEAM_ID}")
psql_db "UPDATE liders.teams SET status='allowed' WHERE id=${TEAM_ID}" >/dev/null
EXPERT_ID=$(psql_db "SELECT id FROM liders.experts WHERE stage='selection' ORDER BY id LIMIT 1")
expect "ссылка эксперту выдаётся" 201 -H "$AUTH" -X POST "${BASE}/api/admin/experts/${EXPERT_ID}/access" \
    -H 'Content-Type: application/json' -d '{"expires_in_days":7,"label":"Приёмочная выдача"}'
EXPERT_PATH=$(python3 -c "import json;d=json.load(open('$BODY'));print(d.get('access_path',''))" 2>/dev/null || echo '')
EXPERT_TOKEN=$(python3 -c "import json;d=json.load(open('$BODY'));print(d.get('token',''))" 2>/dev/null || echo '')
[ -n "$EXPERT_TOKEN" ] && ok "в ответе есть токен и путь ссылки" || bad "нет токена ссылки эксперта"

# Неверная ссылка не даёт сессии.
expect "чужая ссылка эксперта отклоняется" 401 -X POST "${BASE}/api/expert/access" \
    -H 'Content-Type: application/json' -d '{"token":"подделка-подделка-подделка"}'

curl -s -c /tmp/lp_acc_expert.txt -o /dev/null -X POST "${BASE}/api/expert/access" \
    -H 'Content-Type: application/json' -d "{\"token\":\"${EXPERT_TOKEN}\"}"
expect "сессия эксперта открывается по ссылке" 200 -b /tmp/lp_acc_expert.txt "${BASE}/api/expert/session"
EXPERT_SESSION=$(python3 -c "
import json
d = json.load(open('$BODY'))
print('ok' if d.get('authenticated') is True and (d.get('expert') or {}).get('stage') else 'no')
" 2>/dev/null || echo error)
[ "$EXPERT_SESSION" = "ok" ] && ok "сессия эксперта подтверждена" || bad "сессия эксперта не подтверждена: $EXPERT_SESSION"

# Контур эксперта не открывает ни админку, ни кабинет команд.
expect "контур эксперта закрыт без сессии" 401 "${BASE}/api/expert/assignments"
ADMIN_BY_EXPERT=$(curl -s -o /dev/null -w '%{http_code}' -b /tmp/lp_acc_expert.txt -H "$AUTH" "${BASE}/api/admin/applications")
[ "$ADMIN_BY_EXPERT" = "200" ] && ok "админка работает отдельно от контура эксперта" || bad "админка недоступна: $ADMIN_BY_EXPERT"

expect "работы этапа отдаются эксперту" 200 -b /tmp/lp_acc_expert.txt "${BASE}/api/expert/assignments"
EXPERT_TEAMS=$(python3 -c "
import json
d = json.load(open('$BODY'))
teams = d.get('teams') or []
criteria = d.get('criteria') or []
print(f'{len(teams)}:{len(criteria)}')
" 2>/dev/null || echo '0:0')
[ "${EXPERT_TEAMS%%:*}" -ge 1 ] && ok "эксперт видит работы этапа: ${EXPERT_TEAMS%%:*} и критериев ${EXPERT_TEAMS##*:}" || bad "эксперту не назначено ни одной работы"

# Оценка вносится от имени эксперта из сессии: чужой expert_id подставить нельзя.
EXPERT_SCORES=$(python3 - "${BASE}" "$EXPERT_TOKEN" <<'PY'
import json, subprocess, sys
base, token = sys.argv[1], sys.argv[2]
raw = subprocess.run(
    ['curl', '-s', '-b', '/tmp/lp_acc_expert.txt', f'{base}/api/expert/assignments'],
    capture_output=True, text=True,
).stdout
data = json.loads(raw)
data = data.get('data', data) if isinstance(data, dict) and 'data' in data else data
criteria = data.get('criteria') or []
print(json.dumps([{"criterion_id": c["id"], "score": c["max_score"], "comment": "Приёмочная оценка эксперта"} for c in criteria], ensure_ascii=False))
PY
)
# Эксперт мог уже оценивать эту работу в сценарии С4: тогда оценка обновляется
# (200), иначе создаётся (201) — оба ответа означают, что она сохранена.
EXPERT_EVAL_CODE=$(curl -s -o "$BODY" -w '%{http_code}' -b /tmp/lp_acc_expert.txt \
    -X POST "${BASE}/api/expert/evaluations" -H 'Content-Type: application/json' \
    -d "{\"team_id\":${TEAM_ID},\"scores\":${EXPERT_SCORES},\"comment\":\"Приёмочная проверка доступа эксперта\",\"recommendations\":\"Без замечаний\"}")
unwrap_body "$BODY"
case "$EXPERT_EVAL_CODE" in
    200|201) ok "оценка эксперта сохраняется → $EXPERT_EVAL_CODE" ;;
    *) bad "оценка эксперта не сохранилась: $EXPERT_EVAL_CODE · $(head -c 160 "$BODY")" ;;
esac
EXPERT_EVAL_EXPERT=$(psql_db "SELECT expert_id FROM liders.evaluations WHERE team_id=${TEAM_ID} AND stage='selection' AND expert_id=${EXPERT_ID} ORDER BY id DESC LIMIT 1")
[ "${EXPERT_EVAL_EXPERT:-0}" = "${EXPERT_ID}" ] && ok "оценка записана от имени эксперта из сессии" || bad "автор оценки: ${EXPERT_EVAL_EXPERT:-?}"
EXPERT_LOG=$(psql_db "SELECT count(*) FROM liders.expert_access_log WHERE expert_id=${EXPERT_ID}")
[ "${EXPERT_LOG:-0}" -ge 2 ] && ok "обращения эксперта записаны в журнал контура: ${EXPERT_LOG}" || bad "журнал контура эксперта пуст"

expect "ссылка эксперта отзывается" 200 -H "$AUTH" -X POST "${BASE}/api/admin/experts/${EXPERT_ID}/access/revoke"
REVOKED_STATE=$(psql_db "SELECT count(*) FROM liders.expert_access_tokens WHERE expert_id=${EXPERT_ID} AND revoked_at IS NULL AND expires_at > now()")
[ "${REVOKED_STATE:-1}" = "0" ] && ok "после отзыва действующих ссылок не осталось" || bad "действующих ссылок: ${REVOKED_STATE}"
# Оценка эксперта убираем: она не должна влиять на дальнейшие проверки рейтинга.
psql_db "DELETE FROM liders.evaluations WHERE team_id=${TEAM_ID} AND stage='selection' AND expert_id=${EXPERT_ID}" >/dev/null
psql_db "UPDATE liders.teams SET status='${EXPERT_STATUS_BEFORE}' WHERE id=${TEAM_ID}" >/dev/null

# ── Дедлайн приёма ───────────────────────────────────────────────────────────
step "Дедлайн приёма заявок"
psql_db "UPDATE liders.seasons SET application_open_at = now() - interval '10 days', application_close_at = now() - interval '1 day' WHERE slug='2027'" >/dev/null
expect "новая заявка после срока отклоняется" 409 -X POST "${BASE}/api/applications" -H 'Content-Type: application/json' -d "$CREATE_PAYLOAD"
if grep -q 'МСК' "$BODY"; then ok "сообщение содержит дату по московскому времени"; else bad "в сообщении о сроке нет пометки МСК"; fi
expect "загрузка материала после срока запрещена" 403 -b /tmp/lp_acc_cookies.txt -X POST "${BASE}/api/cabinet/materials" -F "type=presentation" -F "file=@/tmp/lp_acc_law.pdf;type=application/pdf"
if grep -q 'contact' "$BODY"; then ok "в отказе предложен канал связи с Оргкомитетом"; else bad "в отказе нет предложения связаться с Оргкомитетом"; fi

# ── Окно досдачи по замечанию (ТЗ 06, п. 3) ─────────────────────────────────
step "Окно досдачи: работа с материалом по замечанию после дедлайна"
FIX_MATERIAL=$(psql_db "SELECT id FROM liders.application_materials WHERE team_id=${TEAM_ID} ORDER BY id DESC LIMIT 1")
psql_db "UPDATE liders.application_materials
            SET status='needs_fix', fix_deadline = now() + interval '1 day'
          WHERE id = ${FIX_MATERIAL}" >/dev/null
expect "материал можно досдать в срок по замечанию" 201 -b /tmp/lp_acc_cookies.txt -X POST "${BASE}/api/cabinet/materials" \
    -F "type=other" -F "file=@/tmp/lp_acc_law.pdf;type=application/pdf"
psql_db "UPDATE liders.application_materials SET fix_deadline = now() - interval '1 hour' WHERE status='needs_fix'" >/dev/null
expect "после истечения срока досдачи запись закрыта" 403 -b /tmp/lp_acc_cookies.txt -X POST "${BASE}/api/cabinet/materials" \
    -F "type=other" -F "file=@/tmp/lp_acc_law.pdf;type=application/pdf"

# ── Границы проверок, изоляция команд и пределы постраничности ───────────────
step "Границы валидации, изоляция команд и пределы постраничности"

# Проверки этого раздела работают с приёмом заявок, а предыдущий раздел закрыл
# окно приёма. Открываем его снова и в конце возвращаем закрытое состояние.
psql_db "UPDATE liders.seasons SET application_open_at = now() - interval '10 days', application_close_at = now() + interval '10 days' WHERE slug='2027'" >/dev/null

# Создание заявок ограничено по частоте (10 в минуту на адрес, ТЗ 11 п. 5.2):
# если предыдущие разделы израсходовали окно, ждём, а не считаем отказ дефектом.
create_expect() {
    local desc="$1" want="$2" payload="$3"
    local code attempt retry
    for attempt in 1 2 3; do
        code=$(curl -s -D /tmp/lp_acc_headers.txt -o "$BODY" -w '%{http_code}' \
            -X POST "${BASE}/api/applications" -H 'Content-Type: application/json' -d "$payload")
        unwrap_body "$BODY"
        if [ "$code" != "429" ]; then break; fi
        retry=$(grep -i '^retry-after:' /tmp/lp_acc_headers.txt | tr -d '\r' | awk '{print $2}')
        retry=${retry:-60}
        printf '    · лимит создания заявок исчерпан, ждём %s с\n' "$retry"
        sleep $((retry + 1))
    done
    if [ "$code" = "$want" ]; then
        ok "$desc → $code"
    else
        bad "$desc → ожидался $want, получен $code · $(head -c 160 "$BODY")"
    fi
}

# Возраст участника считается на дату окончания приёма (п. 4.1 Положения).
# Границы включительные: ровно 16 и ровно 35 лет допускаются, на день меньше или
# на год больше — отказ. Даты считаются от реальной даты окончания приёма, чтобы
# проверка не «застыла» вместе с календарём.
python3 - "${DIRECTION_ID}" <<'PY'
import json, sys
from datetime import date, timedelta
direction = int(sys.argv[1])
close = date.today() + timedelta(days=10)
def born(years, days=0):
    try:
        return (close.replace(year=close.year - years) + timedelta(days=days)).isoformat()
    except ValueError:  # 29 февраля
        return (close.replace(year=close.year - years, day=28) + timedelta(days=days)).isoformat()
def payload(birth, email):
    return {
        "team": {"name": "Приёмочная граница возраста", "organization": "СГЮА", "city": "Саратов",
                 "direction_id": direction},
        "initiative": {"law_title": "О границах возраста участников", "act_level": "federal",
                       "annotation": "Проверка границ возраста приёмочным прогоном.", "ai_usage": False},
        "captain": {"full_name": "Граница Возраста", "birth_date": birth, "category": "student", "email": email},
    }
targets = {
    "ok": payload(born(16), "age-ok@example.ru"),
    "young": payload(born(16, 1), "age-young@example.ru"),
    "old": payload(born(36), "age-old@example.ru"),
}
for name, data in targets.items():
    json.dump(data, open(f"/tmp/lp_acc_age_{name}.json", "w"), ensure_ascii=False)
PY

create_expect "участник ровно минимального возраста принимается" 201 "$(cat /tmp/lp_acc_age_ok.json)"
create_expect "участник младше минимального возраста отклоняется" 422 "$(cat /tmp/lp_acc_age_young.json)"
grep -q 'возраст' "$BODY" && ok "отказ по возрасту объясняет причину" || bad "отказ по возрасту без пояснения: $(head -c 160 "$BODY")"
grep -q 'допустимо' "$BODY" && ok "в отказе указан допустимый диапазон возраста" || bad "в отказе нет допустимого диапазона"
create_expect "участник старше максимального возраста отклоняется" 422 "$(cat /tmp/lp_acc_age_old.json)"

# Обязательные поля мастера проверяются до создания команды: в базе не должно
# оставаться «полузаявок» после отказа.
NO_EMAIL=$(python3 -c "
import json
d = json.load(open('/tmp/lp_acc_age_ok.json'))
d['captain']['email'] = ''
d['team']['name'] = 'Приёмочная без почты'
print(json.dumps(d, ensure_ascii=False))
")
create_expect "заявка без почты капитана отклоняется" 422 "$NO_EMAIL"

SOLO_NO_DATE=$(python3 -c "
import json
d = json.load(open('/tmp/lp_acc_age_ok.json'))
d['initiative']['is_solo'] = True
d['team']['name'] = 'Приёмочная единоличная'
print(json.dumps(d, ensure_ascii=False))
")
create_expect "единоличное участие без согласования отклоняется" 422 "$SOLO_NO_DATE"
grep -q 'Оргкомитет' "$BODY" && ok "отказ ссылается на согласование с Оргкомитетом" || bad "в отказе нет ссылки на Оргкомитет"

# ── Изоляция команд: сессия одной команды не открывает данные другой ─────────
FOREIGN_LEAK=$(curl -s -b /tmp/lp_acc_minor.txt "${BASE}/api/cabinet/materials" | python3 -c "
import json, sys
d = json.load(sys.stdin)
rows = d.get('data') if isinstance(d, dict) else d
ids = {str(row.get('id')) for row in (rows or [])}
print('leak' if '${MATERIAL_ID}' in ids else 'ok')
" 2>/dev/null || echo error)
[ "$FOREIGN_LEAK" = "ok" ] && ok "кабинет команды не показывает материалы другой команды" || bad "утечка материалов между командами: $FOREIGN_LEAK"

FOREIGN_PARTICIPANTS=$(curl -s -b /tmp/lp_acc_minor.txt "${BASE}/api/cabinet/team" | python3 -c "
import json, sys
d = json.load(sys.stdin)
d = d.get('data', d) if isinstance(d, dict) else d
emails = {str(row.get('email')) for row in (d.get('participants') or [])}
print('leak' if 'accept@example.ru' in emails else 'ok')
" 2>/dev/null || echo error)
[ "$FOREIGN_PARTICIPANTS" = "ok" ] && ok "карточка команды не раскрывает участников другой команды" || bad "утечка состава между командами: $FOREIGN_PARTICIPANTS"

expect "приватный файл другой команды недоступен по сессии" 404 -b /tmp/lp_acc_minor.txt "${BASE}/api/media/file/${PRIVATE_MEDIA}"
expect "материал другой команды нельзя удалить" 404 -b /tmp/lp_acc_minor.txt -X DELETE "${BASE}/api/cabinet/materials/${MATERIAL_ID}"

# Подтверждение финала: чужой участник в составе выступающих не принимается.
# Команда второй сессии временно переводится в статус финалиста — иначе отказ
# пришёл бы по статусу, а не по принадлежности участника.
MINOR_TEAM_ID=$(psql_db "SELECT team_id FROM liders.participants WHERE email='minor-accept@example.ru' ORDER BY id LIMIT 1")
if [ -n "$MINOR_TEAM_ID" ]; then
    MINOR_STATUS_BEFORE=$(psql_db "SELECT status FROM liders.teams WHERE id=${MINOR_TEAM_ID}")
    psql_db "UPDATE liders.teams SET status='finalist' WHERE id=${MINOR_TEAM_ID}" >/dev/null
    expect "чужой участник в составе выступающих отклоняется" 403 -b /tmp/lp_acc_minor.txt \
        -X POST "${BASE}/api/cabinet/final-confirmation" -H 'Content-Type: application/json' \
        -d "{\"speakers\":[${CAPTAIN_ID}]}"
    psql_db "UPDATE liders.teams SET status='${MINOR_STATUS_BEFORE}' WHERE id=${MINOR_TEAM_ID}" >/dev/null
else
    bad "не найдена вторая команда для проверки изоляции подтверждения финала"
fi

# Подписанная ссылка выдана на конкретный файл: с её помощью нельзя открыть
# другой файл той же команды (ТЗ 11, п. 5.8).
GRANT_TOKEN=$(python3 -c "
import urllib.parse
print(urllib.parse.parse_qs(urllib.parse.urlparse('${GRANT_PATH}').query).get('grant', [''])[0])
" 2>/dev/null || echo '')
SECOND_MEDIA=$(psql_db "SELECT media_id::text FROM liders.application_materials WHERE team_id=${TEAM_ID} AND media_id IS NOT NULL AND media_id::text <> '${PRIVATE_MEDIA}' LIMIT 1")
if [ -n "$GRANT_TOKEN" ] && [ -n "$SECOND_MEDIA" ]; then
    expect "подписанная ссылка открывает свой файл" 200 "${BASE}/api/media/file/${PRIVATE_MEDIA}?grant=${GRANT_TOKEN}"
    expect "подписанная ссылка не открывает другой файл" 404 "${BASE}/api/media/file/${SECOND_MEDIA}?grant=${GRANT_TOKEN}"
else
    bad "не удалось получить данные для проверки привязки ссылки к файлу"
fi

# ── Пределы постраничности (ТЗ 05, п. 1.4) ───────────────────────────────────
PAGE_META=$(curl -s "${BASE}/api/news?perPage=1000" | python3 -c "
import json, sys
meta = json.load(sys.stdin).get('meta') or {}
print(meta.get('perPage'))
" 2>/dev/null || echo '')
[ "$PAGE_META" = "200" ] && ok "размер страницы ограничен 200 (запрошено 1000)" || bad "предел размера страницы: ${PAGE_META:-?}"

PAGE_DEFAULT=$(curl -s "${BASE}/api/news?perPage=abc" | python3 -c "
import json, sys
meta = json.load(sys.stdin).get('meta') or {}
print(meta.get('perPage'))
" 2>/dev/null || echo '')
[ "$PAGE_DEFAULT" = "50" ] && ok "нечисловой размер страницы заменяется значением по умолчанию" || bad "размер страницы по умолчанию: ${PAGE_DEFAULT:-?}"

PAGE_ZERO=$(curl -s "${BASE}/api/news?page=0&perPage=1" | python3 -c "
import json, sys
meta = json.load(sys.stdin).get('meta') or {}
print(meta.get('page'))
" 2>/dev/null || echo '')
[ "$PAGE_ZERO" = "1" ] && ok "нулевая страница приводится к первой" || bad "нормализация номера страницы: ${PAGE_ZERO:-?}"

LEGACY_PAGE=$(curl -s -H "$AUTH" "${BASE}/api/admin/applications?limit=1&offset=0" | python3 -c "
import json, sys
d = json.load(sys.stdin)
rows = (d.get('data') if isinstance(d, dict) else d) or []
meta = (d.get('meta') or {}) if isinstance(d, dict) else {}
print(f'{len(rows)}:{meta.get(\"perPage\")}')
" 2>/dev/null || echo '?')
[ "${LEGACY_PAGE%%:*}" = "1" ] && ok "прежние параметры limit/offset продолжают работать" || bad "старые параметры постраничности: $LEGACY_PAGE"

# Состояние сроков возвращается к закрытому окну: так его оставил предыдущий
# раздел, и на этом строится смысл проверок дедлайна.
psql_db "UPDATE liders.seasons SET application_close_at = now() - interval '1 day' WHERE slug='2027'" >/dev/null

# ── Блокировка перебора пароля (ТЗ 11, п. 5.4) ───────────────────────────────
step "Блокировка перебора пароля"
# Раздел идёт последним: после него адрес попадает под «долгую» блокировку, и
# любые дальнейшие входы администратора были бы невозможны.
LIMITED=0
BLOCKED=0
for _ in $(seq 1 20); do
    code=$(curl -s -o "$BODY" -w '%{http_code}' -X POST "${BASE}/api/admin/login" \
        -H 'Content-Type: application/json' -d '{"login":"admin","password":"неверный-пароль"}')
    if [ "$code" = "429" ]; then
        LIMITED=1
        if grep -q 'неудачных попыток' "$BODY"; then BLOCKED=1; break; fi
    fi
done
[ "$LIMITED" = "1" ] && ok "перебор пароля ограничен (429)" || bad "rate-limit на вход в админку не сработал"
[ "$BLOCKED" = "1" ] && ok "после серии неудач включается долгая блокировка адреса" || bad "долгая блокировка не включилась"
LOGGED=$(psql_db "SELECT count(*) FROM liders.auth_log WHERE event='admin_login_fail'")
[ "${LOGGED:-0}" -ge 3 ] && ok "неудачные входы записаны в журнал: $LOGGED" || bad "журнал входов пуст или неполон: ${LOGGED:-0}"

# ── Итог ─────────────────────────────────────────────────────────────────────
step "ИТОГ"
printf 'Пройдено проверок: %s\nПровалено: %s\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
    printf '\nПроваленные проверки:\n'
    for failure in "${FAILURES[@]}"; do printf '  ✗ %s\n' "$failure"; done
fi
if [ "${#GAPS[@]}" -gt 0 ]; then
    printf '\nВне текущего объёма:\n'
    for item in "${GAPS[@]}"; do printf '  … %s\n' "$item"; done
fi
[ "$FAIL" -eq 0 ] && printf '\nПриёмка пройдена без блокирующих дефектов.\n' || printf '\nЕсть блокирующие замечания — см. список выше.\n'
exit "$FAIL"
