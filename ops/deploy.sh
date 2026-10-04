#!/usr/bin/env bash
# Выкат платформы «Лидеры права» на боевой сервер.
#
# ВАЖНО: скрипт выполняется НА СЕРВЕРЕ из каталога развёрнутого репозитория.
# Пакет 7 задания отложен: сетевого доступа к серверу из окружения разработки
# нет, поэтому скрипт подготовлен и проверен только синтаксически (bash -n) —
# на проде он не запускался. Первый запуск делать в согласованное окно
# и после слепка (см. ops/README.md, раздел «Выкат на прод — пошагово»).
#
# Что делает:
#   0) подхватывает секреты из /etc/lideryprava/api.env
#   1) собирает API (npm ci + tsc → dist)
#   2) собирает публичную часть и админку, если каталоги уже есть
#   3) применяет миграции БД
#   4) раскладывает артефакты в /var/www/lideryprava/{api,public,admin}
#   5) перезапускает сервис и проверяет /api/health
#
# Переменные (все необязательные):
#   REPO_DIR  каталог репозитория (по умолчанию — родитель этого скрипта)
#   WWW_DIR   каталог развёртывания (по умолчанию /var/www/lideryprava)
#   ENV_FILE  файл окружения (по умолчанию /etc/lideryprava/api.env)
#   SERVICE   имя systemd-юнита (по умолчанию liders-api)
#   APP_USER  владелец каталога API (по умолчанию liders)
#   RUN_MIGRATIONS  1 — применять миграции (по умолчанию 1)
#   DRY_RUN   1 — показать шаги, ничего не меняя

set -euo pipefail

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
WWW_DIR="${WWW_DIR:-/var/www/lideryprava}"
ENV_FILE="${ENV_FILE:-/etc/lideryprava/api.env}"
SERVICE="${SERVICE:-liders-api}"
APP_USER="${APP_USER:-liders}"
RUN_MIGRATIONS="${RUN_MIGRATIONS:-1}"
DRY_RUN="${DRY_RUN:-0}"

step() { printf '\n=== %s ===\n' "$1"; }
note() { printf '    %s\n' "$1"; }
fail() { printf 'ОШИБКА: %s\n' "$1" >&2; exit 1; }

run() {
    if [ "$DRY_RUN" = "1" ]; then
        printf '    [dry-run] %s\n' "$*"
    else
        "$@"
    fi
}

[ -d "$REPO_DIR/platform/server" ] || fail "не найден каталог $REPO_DIR/platform/server"

step "0/5 Окружение"
if [ -f "$ENV_FILE" ]; then
    # shellcheck disable=SC1090
    set -a; . "$ENV_FILE"; set +a
    note "секреты подхвачены из $ENV_FILE"
else
    note "файл $ENV_FILE не найден — беру переменные из текущего окружения"
fi
API_PORT="${API_PORT:-8091}"
note "репозиторий: $REPO_DIR"
note "развёртывание: $WWW_DIR"
note "порт API: $API_PORT"

step "1/5 Сборка API"
if [ -f "$REPO_DIR/platform/server/package-lock.json" ]; then
    run bash -c "cd '$REPO_DIR/platform/server' && npm ci --no-audit --no-fund"
else
    run bash -c "cd '$REPO_DIR/platform/server' && npm install --no-audit --no-fund"
fi
run bash -c "cd '$REPO_DIR/platform/server' && npm run build"
[ "$DRY_RUN" = "1" ] || [ -f "$REPO_DIR/platform/server/dist/index.js" ] \
    || fail "сборка API не создала dist/index.js"

step "2/5 Сборка интерфейсов"
if [ -d "$REPO_DIR/platform/web" ]; then
    run bash -c "cd '$REPO_DIR/platform/web' && npm ci --no-audit --no-fund && npm run build"
    note "публичная сборка: platform/web"
else
    note "platform/web ещё нет — пропускаю (пакет 5)"
fi
if [ -d "$REPO_DIR/platform/admin" ]; then
    run bash -c "cd '$REPO_DIR/platform/admin' && npm ci --no-audit --no-fund && npm run build"
    note "сборка админки: platform/admin"
else
    note "platform/admin ещё нет — пропускаю (пакет 4)"
fi

step "3/5 Миграции БД"
if [ "$RUN_MIGRATIONS" = "1" ]; then
    run bash -c "cd '$REPO_DIR/platform/server' && npm run migrate"
else
    note "RUN_MIGRATIONS=0 — миграции пропущены"
fi

step "4/5 Раскладка артефактов"
run install -d "$WWW_DIR/api" "$WWW_DIR/public" "$WWW_DIR/admin"
run install -d "$WWW_DIR/api/dist"
# dist перезаписываем целиком: старые файлы сборки не должны оставаться.
run rsync -a --delete "$REPO_DIR/platform/server/dist/" "$WWW_DIR/api/dist/"
run cp "$REPO_DIR/platform/server/package.json" "$WWW_DIR/api/package.json"
# PDF Положения и Приложений — часть публичной статики.
[ -d "$REPO_DIR/platform/public" ] && run rsync -a "$REPO_DIR/platform/public/" "$WWW_DIR/public/"
# Публичная сборка и админка — без --delete: старые файлы удаляются осознанно,
# отдельным решением, чтобы случайно не снести рабочий сайт.
if [ -d "$REPO_DIR/platform/web/dist" ]; then
    run rsync -a "$REPO_DIR/platform/web/dist/" "$WWW_DIR/public/"
fi
if [ -d "$REPO_DIR/platform/admin/dist" ]; then
    run rsync -a "$REPO_DIR/platform/admin/dist/" "$WWW_DIR/admin/"
fi
if [ "$DRY_RUN" != "1" ] && [ "$(id -u)" = "0" ]; then
    chown -R "$APP_USER:$APP_USER" "$WWW_DIR/api"
fi

step "5/5 Перезапуск и проверка"
run systemctl restart "$SERVICE"
if [ "$DRY_RUN" != "1" ]; then
    sleep 2
    systemctl is-active --quiet "$SERVICE" || fail "сервис $SERVICE не запустился: journalctl -u $SERVICE -n 50"
    if curl -fsS "http://127.0.0.1:${API_PORT}/api/health" >/dev/null; then
        note "health-check пройден: http://127.0.0.1:${API_PORT}/api/health"
    else
        fail "health-check не пройден: journalctl -u $SERVICE -n 50"
    fi
fi

printf '\nВыкат завершён. Проверки публичных путей — в ops/README.md, раздел «Выкат на прод — пошагово».\n'
