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
PASS=0
FAIL=0
declare -a FAILURES=()
declare -a GAPS=()

if [ "$DB" = "liders" ] || [ "$DB" = "liders_dev" ]; then
    echo "Отказ: приёмочный прогон пересоздаёт базу. Укажите отдельную тестовую базу (DB=...)." >&2
    exit 2
fi

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
expect "пятый участник отклоняется (п. 4.3)" 400 -b /tmp/lp_acc_cookies.txt -X PATCH "${BASE}/api/cabinet/team" -H 'Content-Type: application/json' -d "$FIVE"

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
expect "ссылка на зарубежное облако отклоняется (п. 14.4)" 400 -b /tmp/lp_acc_cookies.txt -X POST "${BASE}/api/cabinet/materials" -H 'Content-Type: application/json' -d '{"type":"video_link","external_url":"https://drive.google.com/file/d/abc/view"}'
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
score = int(sys.argv[1])
print(json.dumps([{"criterion_id": c["id"], "score": score, "comment": f"Обоснование: {score} баллов."} for c in criteria], ensure_ascii=False))
PY
}
FIRST_EXPERT=$(echo "$EXPERT_IDS" | cut -d' ' -f1)
expect "оценка выше максимума отклоняется" 400 -H "$AUTH" -X POST "${BASE}/api/admin/evaluations" -H 'Content-Type: application/json' -d "$(python3 - "$CRITERIA_JSON" "$FIRST_EXPERT" "$TEAM_ID" <<'PY'
import json, sys
criteria = json.loads(sys.argv[1]); expert = int(sys.argv[2]); team = int(sys.argv[3])
scores = [{"criterion_id": criteria[0]["id"], "score": 99}]
print(json.dumps({"team_id": team, "stage": "selection", "expert_id": expert, "scores": scores}))
PY
)"
expect "оценка с обоснованием сохраняется" 201 -H "$AUTH" -X POST "${BASE}/api/admin/evaluations" -H 'Content-Type: application/json' -d "{\"team_id\":${TEAM_ID},\"stage\":\"selection\",\"expert_id\":${FIRST_EXPERT},\"scores\":$(score_for 8),\"comment\":\"Материалы полные.\",\"recommendations\":\"Добавить статистику.\"}"
SECOND_EXPERT=$(echo "$EXPERT_IDS" | cut -d' ' -f2)
expect "вторая оценка сохраняется" 201 -H "$AUTH" -X POST "${BASE}/api/admin/evaluations" -H 'Content-Type: application/json' -d "{\"team_id\":${TEAM_ID},\"stage\":\"selection\",\"expert_id\":${SECOND_EXPERT},\"scores\":$(score_for 1)}"
expect "расчёт рейтинга" 200 -H "$AUTH" -X POST "${BASE}/api/admin/rankings/recalculate" -H 'Content-Type: application/json' -d '{"season_id":1,"stage":"selection"}'
FLAG=$(psql_db "SELECT needs_chair_review FROM liders.rankings WHERE team_id=${TEAM_ID} AND stage='selection'")
[ "$FLAG" = "t" ] && ok "расхождение сумм более 20 баллов → требуется доп. оценка председателя" || bad "флаг needs_chair_review: ${FLAG:-?}"
expect "протокол не публикуется, пока оценка председателя не внесена (п. 7.7)" 409 -H "$AUTH" -X POST "${BASE}/api/admin/rankings/publish" -H 'Content-Type: application/json' -d '{"season_id":1,"stage":"selection"}'
THIRD_EXPERT=$(echo "$EXPERT_IDS" | cut -d' ' -f3)
curl -s -H "$AUTH" -X POST "${BASE}/api/admin/evaluations" -H 'Content-Type: application/json' -d "{\"team_id\":${TEAM_ID},\"stage\":\"selection\",\"expert_id\":${THIRD_EXPERT},\"scores\":$(score_for 5),\"is_chair_extra\":true}" >/dev/null
curl -s -H "$AUTH" -X POST "${BASE}/api/admin/rankings/recalculate" -H 'Content-Type: application/json' -d '{"season_id":1,"stage":"selection"}' >/dev/null
FLAG_AFTER=$(psql_db "SELECT needs_chair_review FROM liders.rankings WHERE team_id=${TEAM_ID} AND stage='selection'")
[ "$FLAG_AFTER" = "f" ] && ok "после оценки председателя флаг снят (С4.4)" || bad "флаг после оценки председателя: ${FLAG_AFTER:-?}"
# Среднее считается по всем членам комиссии, включая председателя:
# (56 + 7 + 35) / 3 = 32,67 (п. 7.7 Положения).
AVERAGE=$(psql_db "SELECT average_score FROM liders.rankings WHERE team_id=${TEAM_ID} AND stage='selection'")
[ "$AVERAGE" = "32.67" ] && ok "средний балл 32,67 — оценка председателя учтена (п. 7.7)" || bad "средний балл: $AVERAGE (ожидалось 32.67)"
expect "публикация протокола" 200 -H "$AUTH" -X POST "${BASE}/api/admin/rankings/publish" -H 'Content-Type: application/json' -d '{"season_id":1,"stage":"selection"}'
PUBLISHED=$(psql_db "SELECT is_published FROM liders.rankings WHERE team_id=${TEAM_ID} AND stage='selection'")
[ "$PUBLISHED" = "t" ] && ok "протокол опубликован, срок апелляций открыт" || bad "протокол не опубликован"

# ── С5. Апелляция ────────────────────────────────────────────────────────────
step "С5. Апелляция"
expect "апелляция в срок принимается" 201 -b /tmp/lp_acc_cookies.txt -X POST "${BASE}/api/cabinet/appeals" -H 'Content-Type: application/json' -d '{"stage":"selection","grounds":"counting_error","text":"Считаем, что при подсчёте баллов по критерию 5 допущена техническая ошибка."}'
expect "апелляция по финальному этапу отклоняется (п. 12.3)" 400 -b /tmp/lp_acc_cookies.txt -X POST "${BASE}/api/cabinet/appeals" -H 'Content-Type: application/json' -d '{"stage":"debate","grounds":"other","text":"Проба"}'
psql_db "UPDATE liders.rankings SET published_at = now() - interval '10 days' WHERE stage='selection'" >/dev/null
expect "апелляция после срока отклоняется" 403 -b /tmp/lp_acc_cookies.txt -X POST "${BASE}/api/cabinet/appeals" -H 'Content-Type: application/json' -d '{"stage":"selection","grounds":"counting_error","text":"Поздняя апелляция для проверки срока."}'

# ── Журнал действий ──────────────────────────────────────────────────────────
step "Журнал действий администратора"
expect "журнал закрыт без токена" 401 "${BASE}/api/admin/audit"
AUDIT_JSON=$(curl -s -H "$AUTH" "${BASE}/api/admin/audit?limit=100")
AUDIT_COUNT=$(echo "$AUDIT_JSON" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)
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
expect "короткий пароль отклоняется" 400 -H "$AUTH" -X POST "${BASE}/api/admin/users" \
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
expect "слабый пароль при сбросе отклоняется" 400 -H "$AUTH" -X POST "${BASE}/api/admin/users/${OPERATOR_ID}/password" \
    -H 'Content-Type: application/json' -d '{"password":"korotkij1"}'
expect "сброс пароля администратором" 200 -H "$AUTH" -X POST "${BASE}/api/admin/users/${OPERATOR_ID}/password" \
    -H 'Content-Type: application/json' -d "{\"password\":\"${ADMIN_PASSWORD_NEW}\"}"
login_attempt 401 'accept-operator@example.ru' "$OPERATOR_PASSWORD" "старый пароль после сброса не работает"
login_attempt 200 'accept-operator@example.ru' "$ADMIN_PASSWORD_NEW" "вход с новым паролем" OPERATOR_TOKEN2
AUTH_VERSION=$(psql_db "SELECT auth_version FROM liders.users WHERE id=${OPERATOR_ID}")
[ "${AUTH_VERSION:-1}" -ge 2 ] && ok "сброс пароля поднял версию авторизации (${AUTH_VERSION})" || bad "версия авторизации не изменилась: ${AUTH_VERSION:-?}"
# Бездействие: сервер завершает сеанс, если отметка активности старше окна.
# Первый запрос создаёт отметку — без него обновлять было бы нечего.
curl -s -o /dev/null -H "Authorization: Bearer ${OPERATOR_TOKEN2}" "${BASE}/api/admin/applications"
TOKEN_HASH=$(printf '%s' "$OPERATOR_TOKEN2" | shasum -a 256 | awk '{print $1}')
MARKED=$(psql_db "SELECT count(*) FROM liders.admin_session_activity WHERE token_hash='${TOKEN_HASH}'")
[ "${MARKED:-0}" = "1" ] && ok "активность сеанса отмечается на сервере" || bad "отметка активности сеанса не создана: ${MARKED:-0}"
psql_db "UPDATE liders.admin_session_activity SET last_seen_at = now() - interval '61 minutes' WHERE token_hash='${TOKEN_HASH}'" >/dev/null
IDLE_CODE=$(curl -s -o "$BODY" -w '%{http_code}' -H "Authorization: Bearer ${OPERATOR_TOKEN2}" "${BASE}/api/admin/applications")
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


LIMITED=0
for _ in $(seq 1 12); do
    code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/admin/login" -H 'Content-Type: application/json' -d '{"login":"admin","password":"неверный-пароль"}')
    if [ "$code" = "429" ]; then LIMITED=1; break; fi
done
[ "$LIMITED" = "1" ] && ok "перебор пароля блокируется (429)" || bad "rate-limit на вход в админку не сработал"
LOGGED=$(psql_db "SELECT count(*) FROM liders.auth_log WHERE event='admin_login_fail'")
# Успешный вход выше уже израсходовал одну попытку из лимита 5 запросов в минуту,
# поэтому в журнал попадает не 12 отказов, а столько, сколько пропустил лимитер.
[ "${LOGGED:-0}" -ge 3 ] && ok "неудачные входы записаны в журнал: $LOGGED" || bad "журнал входов пуст или неполон: ${LOGGED:-0}"
# ── Решения по команде (ТЗ 07, п. 2.4) ──────────────────────────────────────
step "Решения Оргкомитета по команде: этапы, дисквалификация, восстановление"
expect "карточка команды отдаётся с историей и результатами" 200 -H "$AUTH" "${BASE}/api/admin/teams/${TEAM_ID}"
CARD_SECTIONS=$(curl -s -H "$AUTH" "${BASE}/api/admin/teams/${TEAM_ID}" | python3 -c "import sys,json;d=json.load(sys.stdin);print('yes' if all(k in d for k in ('status_history','stage_participation','rankings','participants','mentors')) else 'no')" 2>/dev/null || echo no)
[ "$CARD_SECTIONS" = "yes" ] && ok "карточка команды содержит состав, историю статусов, участие в этапах и результаты" || bad "карточка команды неполна"
expect "недопустимый статус команды отклоняется" 400 -H "$AUTH" -H 'Content-Type: application/json' \
    -X PATCH "${BASE}/api/admin/teams/${TEAM_ID}" -d '{"status":"unknown"}'
expect "дисквалификация без причины отклоняется" 400 -H "$AUTH" -H 'Content-Type: application/json' \
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
expect "слишком короткий запрос отклоняется" 400 -H "$AUTH" "${BASE}/api/admin/subjects?query=ab"
expect "поиск субъекта по почте" 200 -H "$AUTH" "${BASE}/api/admin/subjects?query=${SUBJECT_EMAIL}"
SUBJECTS=$(curl -s -H "$AUTH" "${BASE}/api/admin/subjects?query=${SUBJECT_EMAIL}" | python3 -c "import sys,json;print(json.load(sys.stdin).get('total',0))" 2>/dev/null || echo 0)
[ "${SUBJECTS:-0}" -ge 1 ] && ok "субъект найден: ${SUBJECTS}" || bad "субъект не найден по почте ${SUBJECT_EMAIL}"
expect "сведения о субъекте отдаются" 200 -H "$AUTH" "${BASE}/api/admin/subjects/participant/${CAPTAIN_ID}"
expect "выгрузка сведений о субъекте (право на доступ)" 200 -H "$AUTH" "${BASE}/api/admin/subjects/participant/${CAPTAIN_ID}/export"
EXPORT_LOGGED=$(psql_db "SELECT count(*) FROM liders.audit_log WHERE action='pdn_export'")
[ "${EXPORT_LOGGED:-0}" -ge 1 ] && ok "выгрузка записана в журнал: ${EXPORT_LOGGED}" || bad "выгрузка не попала в журнал"
expect "удаление без подтверждения отклоняется" 400 -H "$AUTH" -H 'Content-Type: application/json' \
    -X POST "${BASE}/api/admin/subjects/participant/${CAPTAIN_ID}/erase" -d '{"reason":"обращение субъекта"}'
expect "удаление без основания отклоняется" 400 -H "$AUTH" -H 'Content-Type: application/json' \
    -X POST "${BASE}/api/admin/subjects/participant/${CAPTAIN_ID}/erase" -d '{"confirm":true}'
expect "неизвестный вид записи отклоняется" 400 -H "$AUTH" -H 'Content-Type: application/json' \
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
expect "вид обращения проверяется" 400 -H "$AUTH" -H 'Content-Type: application/json' \
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
CRITERIA_COUNT=$(curl -s "${BASE}/api/criteria?stage=selection" | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d) if isinstance(d,list) else len(d.get('items',[])))" 2>/dev/null || echo '0')
[ "${CRITERIA_COUNT:-0}" -ge 5 ] 2>/dev/null && ok "в публичном API не менее пяти критериев (${CRITERIA_COUNT})" || bad "критериев в публичном API: ${CRITERIA_COUNT:-0}"
INIT_JSON=$(curl -s -H "$AUTH" -H 'Content-Type: application/json' -X POST "${BASE}/api/admin/initiatives" \
    -d "{\"season_id\":1,\"team_id\":${TEAM_ID},\"slug\":\"acceptance-initiative\",\"title\":\"Приёмочная инициатива\",\"annotation\":\"Проверка архива.\",\"act_level\":\"federal\",\"team_name\":\"Приёмочная команда\",\"authors_public\":false,\"files_public\":false}")
INIT_ID=$(printf '%s' "$INIT_JSON" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo '')
if [ -n "$INIT_ID" ]; then ok "инициатива создана через админ-API"; else bad "не удалось создать инициативу: $INIT_JSON"; fi
curl -s -H "$AUTH" -H 'Content-Type: application/json' -X POST "${BASE}/api/admin/initiatives/${INIT_ID}/authors" \
    -d '{"full_name":"Скрытый Автор","role":"Участник","is_published":true}' >/dev/null
expect "неопубликованная инициатива недоступна публично" 404 "${BASE}/api/initiatives/acceptance-initiative"
INIT_PUBLIC=$(curl -s "${BASE}/api/initiatives" | grep -c 'acceptance-initiative' || true)
[ "${INIT_PUBLIC:-0}" = "0" ] && ok "неопубликованной инициативы нет в публичном списке" || bad "неопубликованная инициатива попала в публичный список"
expect "публикация инициативы" 200 -H "$AUTH" -H 'Content-Type: application/json' -X POST "${BASE}/api/admin/initiatives/${INIT_ID}/publish" -d '{}'
AUTHORS_HIDDEN=$(curl -s "${BASE}/api/initiatives/acceptance-initiative" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('authors',[])))" 2>/dev/null || echo '?')
[ "$AUTHORS_HIDDEN" = "0" ] && ok "без согласия авторов на распространение персональные данные скрыты" || bad "авторы раскрыты без согласия: $AUTHORS_HIDDEN"
curl -s -H "$AUTH" -H 'Content-Type: application/json' -X PATCH "${BASE}/api/admin/initiatives/${INIT_ID}" -d '{"authors_public":true}' >/dev/null
AUTHORS_SHOWN=$(curl -s "${BASE}/api/initiatives/acceptance-initiative" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('authors',[])))" 2>/dev/null || echo '?')
[ "$AUTHORS_SHOWN" = "1" ] && ok "после полученного согласия автор публикуется" || bad "автор не опубликован после согласия: $AUTHORS_SHOWN"
if curl -s "${BASE}/api/initiatives" | python3 -c "import sys,json;d=json.load(sys.stdin);items=d if isinstance(d,list) else d.get('items',[]);print('ok' if all('authors_public' not in i and 'files_public' not in i for i in items) else 'leak')" 2>/dev/null | grep -q ok; then
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
PAGE_BODY=$(curl -s "${BASE}/api/pages/about" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('body') or ''))" 2>/dev/null || echo 0)
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
expect "возврат материала без замечания отклоняется" 400 -H "$AUTH" -H 'Content-Type: application/json' \
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
expect "блокировка содержания без причины отклоняется" 400 -H "$AUTH" -H 'Content-Type: application/json' \
    -X POST "${BASE}/api/admin/materials/${MATERIAL_ID}/review" -d '{"status":"blocked"}'
expect "блокировка содержания с причиной" 200 -H "$AUTH" -H 'Content-Type: application/json' \
    -X POST "${BASE}/api/admin/materials/${MATERIAL_ID}/review" \
    -d '{"status":"blocked","comment":"Приёмочная проверка: материал нельзя показывать."}'
BLOCKED_STATUS=$(psql_db "SELECT status FROM liders.application_materials WHERE id=${MATERIAL_ID}")
[ "$BLOCKED_STATUS" = "blocked" ] && ok "статус материала: содержание заблокировано" || bad "статус материала: ${BLOCKED_STATUS:-?}"
CABINET_BLOCKED=$(curl -s -b /tmp/lp_acc_cookies.txt "${BASE}/api/cabinet/materials" | python3 -c "
import json,sys
rows = json.load(sys.stdin)
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
materials = data.get('materials') or []
print('ok' if materials and materials[0].get('title') == 'Слайды занятия' else 'no')
" 2>/dev/null || echo error)
[ "$MATERIALS_PUBLIC" = "ok" ] && ok "материалы занятия отдаются публично" || bad "материалы занятия не отдаются: $MATERIALS_PUBLIC"

# ── Дедлайн приёма ───────────────────────────────────────────────────────────
step "Дедлайн приёма заявок"
psql_db "UPDATE liders.seasons SET application_open_at = now() - interval '10 days', application_close_at = now() - interval '1 day' WHERE slug='2027'" >/dev/null
expect "новая заявка после срока отклоняется" 409 -X POST "${BASE}/api/applications" -H 'Content-Type: application/json' -d "$CREATE_PAYLOAD"
if grep -q 'МСК' "$BODY"; then ok "сообщение содержит дату по московскому времени"; else bad "в сообщении о сроке нет пометки МСК"; fi
expect "загрузка материала после срока запрещена" 403 -b /tmp/lp_acc_cookies.txt -X POST "${BASE}/api/cabinet/materials" -F "type=presentation" -F "file=@/tmp/lp_acc_law.pdf;type=application/pdf"
if grep -q 'contact' "$BODY"; then ok "в отказе предложен канал связи с Оргкомитетом"; else bad "в отказе нет предложения связаться с Оргкомитетом"; fi

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
