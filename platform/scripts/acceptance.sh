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
gap "С8.1 (роли admin/operator) — управление пользователями админки не реализовано, роль оператора не проверить"

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
