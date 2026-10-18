#!/usr/bin/env bash
# Сторож API: проверяет health-эндпоинт и поднимает сервис, если он остановлен.
#
# Зачем: 14 октября 2026 сервис liders-api остановили вручную и отключили —
# сайт четыре дня отдавал статику без данных, и никто об этом не узнал.
# Юнит уже объявляет Restart=always, но ручной `systemctl stop` его обходит.
# Сторож запускается таймером каждые 2 минуты, пишет в journal, поднимает
# сервис и оставляет след в /var/log/liders-api-watchdog.log.

set -u

SERVICE="liders-api"
HEALTH_URL="http://127.0.0.1:8100/api/health"
LOG="/var/log/liders-api-watchdog.log"

stamp() { date --iso-8601=seconds; }

if curl -fsS --max-time 10 "$HEALTH_URL" >/dev/null 2>&1; then
    exit 0
fi

echo "$(stamp) health недоступен, состояние: $(systemctl is-active "$SERVICE")" >> "$LOG"

if ! systemctl is-enabled --quiet "$SERVICE"; then
    systemctl enable "$SERVICE" >> "$LOG" 2>&1
    echo "$(stamp) сервис был отключён — включён" >> "$LOG"
fi

if ! systemctl is-active --quiet "$SERVICE"; then
    systemctl start "$SERVICE" >> "$LOG" 2>&1
    sleep 3
fi

if curl -fsS --max-time 10 "$HEALTH_URL" >/dev/null 2>&1; then
    echo "$(stamp) сервис поднят, health в норме" >> "$LOG"
else
    echo "$(stamp) ПОДНЯТЬ НЕ УДАЛОСЬ: journalctl -u $SERVICE -n 50" >> "$LOG"
    exit 1
fi
