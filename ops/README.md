# Оps: конфигурации развёртывания

Черновики конфигураций для новой платформы и **немедленное исправление инцидента** на действующем сайте.

## 1. Немедленно: закрыть публичный доступ к служебным файлам

Сейчас nginx отдаёт всё, что лежит в корне сайта (`root /var/www/lideryprava`), поэтому по HTTP доступны:

- `/data/applications.db` и `/data/applications.db-wal` — база заявок с персональными данными;
- `/data/auth.log` — журнал входов;
- `/server.py`, `/scripts/backup_db.py`, `/scripts/purge_expired.py` — код.

Файл с готовой вставкой: [`nginx/00-close-service-paths.conf`](nginx/00-close-service-paths.conf).
Он подключается **до** `location /` и `location ~* \.(…)$` в действующем конфиге `nginx_lideryprava.conf`.

Порядок применения:

```bash
# 1. Сделать резервную копию конфигурации
cp /etc/nginx/sites-available/lideryprava /root/lideryprava.nginx.backup.$(date +%F-%H%M)

# 2. Вставить содержимое 00-close-service-paths.conf внутрь server{} для 443 (до location /)

# 3. Проверить и применить
nginx -t && systemctl reload nginx

# 4. ПРОВЕРИТЬ РЕЗУЛЬТАТ (обязательно)
for p in /data/applications.db /data/applications.db-wal /data/auth.log /server.py /scripts/backup_db.py; do
  printf '%s -> ' "$p"; curl -s -o /dev/null -w '%{http_code}\n' "https://lideryprava.ru$p"
done
# Ожидается 404 (или 403) для каждого пути
```

Дополнительно (устраняет причину, а не следствие): перенести базу и служебные каталоги за пределы корня сайта.

```bash
install -d -o www-data -g www-data -m 750 /var/lib/lideryprava
# после переноса: /var/lib/lideryprava/applications.db, права 640, владелец www-data
```

## 2. Конфигурация новой платформы

Целевой конфиг: [`nginx/lideryprava-platform.conf`](nginx/lideryprava-platform.conf).
Ключевые отличия от текущего:

| Что | Сейчас | Целевое |
|---|---|---|
| Корень | `/var/www/lideryprava` (код, БД и статика в одном каталоге) | `/var/www/lideryprava/public` (только статика) |
| API | `server.py` на `:8090` | `liders-api` на `:8091` |
| Размер тела запроса | 1 МБ | 30 МБ (конкурсные материалы) |
| Несуществующий путь | `200` + главная (soft-404) | `404` + страница 404 |
| Служебные пути | отдаются | запрещены |

## 3. Служебный юнит

[`systemd/liders-api.service`](systemd/liders-api.service) — шаблон юнита API: непривилегированный пользователь, переменные окружения из файла, `Restart=always`, ограничения прав.

## 4. Проверка после выката

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://lideryprava.ru/api/health
curl -s https://lideryprava.ru/api/health
curl -s -o /dev/null -w '%{http_code}\n' https://lideryprava.ru/this-page-does-not-exist   # ожидается 404
curl -s -o /dev/null -w '%{http_code}\n' https://lideryprava.ru/data/applications.db       # ожидается 404
```

## 5. Резервное копирование

- PostgreSQL: `pg_dump` ежедневно в 03:30 (МСК), 30 копий, проверка целостности дампа.
- Скрипт: [`backup/pg-dump.sh`](backup/pg-dump.sh).
- Выгрузка за пределы сервера — зашифрованная, по расписанию (сохранить текущую схему off-site pull).
- Раз в месяц — тестовое восстановление в отдельную БД.
