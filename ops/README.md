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
| API | `server.py` на `:8090` | `liders-api` на `:8100` |
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

## 6. Выкат на прод — пошагово

**Статус: ВЫПОЛНЕН 5 октября 2026 года** (сервер `72.56.38.62`, домен
`lideryprava.ru`). Что сделано и чем подтверждено:

| Шаг | Результат |
|---|---|
| Слепок перед изменениями | `/root/lideryprava-snapshots/20261005-230448` (конфигурация nginx, юнит, копия SQLite через backup API — 18 заявок) |
| Служебные пути закрыты немедленно | `/data/applications.db`, `/data/applications.db-wal`, `/data/auth.log`, `/server.py`, `/scripts/*` отдавали `200` и стали `404` (снимок конфигурации: `20261005-230448`) |
| PostgreSQL | пользователь `liders`, база `liders`; 30 миграций применены с нуля |
| Окружение | `/etc/lideryprava/api.env` (права 640, root:liders), секреты сгенерированы; доступы — `/etc/lideryprava/credentials.txt` (600) |
| Сервис | `liders-api.service`, порт **8100** (8091 занят другим проектом сервера), `Restart=always` |
| Сборка и раскладка | `bash ops/deploy.sh`: API `tsc` → `dist`, публичная сборка с пререндером, админка, зависимости времени выполнения в `/var/www/lideryprava/api` |
| Переключение nginx | снимок `20261005-230507`; конфигурация платформы установлена, `nginx -t` пройден, `reload` без простоя |
| Архив заявок 2026 | `bash ops/import-legacy.sh` — перенесено 18 записей, у всех отмечено согласие на обработку ПДн |
| Резервное копирование | `liders-backup.timer` (03:30 МСК, 30 копий) + пробный дамп 168 КБ с проверкой `pg_restore --list` |
| Проверка снаружи | 32 публичных адреса `200`, `/legal/unknown` и произвольный путь — `404`, `/api/health` — `{"status":"ok","database":"up"}` |
| Сохранение прежних адресов | `/pobediteli.html` → `/winners`, `/index.html` → `/`, `/privacy.html` → `/legal/privacy`, файлы верификации Mail.ru и старые `/assets/**` отдаются |
| Откат | прежний `lideryprava.service` (Python, порт 8090) остановлен не был: возврат — копия конфигурации из снимка и `systemctl reload nginx` |

Замечания, найденные первым выкатом (исправлены в `ops/deploy.sh` и конфигурации):
1. `NODE_ENV=production` из файла окружения мешал установке dev-зависимостей —
   сборка шла без компилятора; теперь сборка идёт с `NODE_ENV=development`.
2. Сборке не хватало зависимостей общего модуля `platform/shared` и типов Node.
3. Сервису нужны зависимости времени выполнения рядом с `dist` — теперь они
   ставятся в `/var/www/lideryprava/api` с `--omit=dev`.
4. Статика переносилась с правами исходных файлов (600) — nginx отвечал `403`;
   теперь права выставляются явно (`www-data`, 644/755) и удаляются служебные
   файлы macOS.
5. Шаблон `[0-9]{4}` в конфигурации nginx требует кавычек, иначе `{` читается
   как начало блока.
6. Префикс `location ^~ /legal/` перекрывал проверки существующих документов —
   заменён на обычный префикс.
7. Сборка админки ссылалась на `/assets/…`, а раздаётся с `/admin/`: панель
   открывалась пустой. Задан `base: '/admin/'`, маршрутизатору передан
   `basename="/admin"`, а сборка проверяет базовый путь (`scripts/check-base.mjs`)
   и падает, если он не применён.

Ниже — исходный порядок шагов (для повторного выката на другой сервер).

Все команды выполняются **на сервере** из каталога развёрнутого репозитория.

### 6.1. Слепок перед изменениями (обязательно)

```bash
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p /root/lideryprava-snapshots/$STAMP
sqlite3 /var/www/lideryprava/data/applications.db ".backup /root/lideryprava-snapshots/$STAMP/applications.db"
tar czf /root/lideryprava-snapshots/$STAMP/www.tgz -C /var/www lideryprava
cp /etc/nginx/sites-available/lideryprava /root/lideryprava-snapshots/$STAMP/nginx.conf
systemctl cat lideryprava > /root/lideryprava-snapshots/$STAMP/lideryprava.service
sha256sum /var/www/lideryprava/*.html /var/www/lideryprava/robots.txt > /root/lideryprava-snapshots/$STAMP/public.sha256
echo "Слепок: /root/lideryprava-snapshots/$STAMP"   # путь фиксируется в отчёте
```

Без слепка к изменениям не приступать.

### 6.2. PostgreSQL, пользователь и база (однократно)

```bash
apt-get update && apt-get install -y postgresql nodejs npm
sudo -u postgres psql -c "CREATE USER liders WITH PASSWORD 'ЗАМЕНИТЕ_СЕКРЕТОМ';"
sudo -u postgres createdb -O liders liders
sudo -u postgres psql -c "\\l liders"
```

**Необязательно: PDF бланка заявки.** Бланк по Приложению № 1 формируется в DOCX
средствами сервера; PDF получается конвертацией через LibreOffice:

```bash
apt-get install -y libreoffice-writer     # нужен только для PDF
which soffice && soffice --version
# если LibreOffice установлен в нестандартное место:
# SOFFICE_BIN=/opt/libreoffice/program/soffice в /etc/lideryprava/api.env
```

Без LibreOffice кабинет отдаёт DOCX и сообщает, что PDF недоступен, — заявки
принимаются в любом случае. Конвертация запускается по запросу (не фоновым
заданием) с отдельным профилем и таймаутом 60 секунд.

### 6.3. Пользователь сервиса, каталоги, секреты

```bash
useradd --system --home /var/www/lideryprava --shell /usr/sbin/nologin liders || true
install -d -o liders -g liders -m 750 /var/www/lideryprava/api /var/www/lideryprava/admin
install -d -m 750 -o root -g liders /etc/lideryprava

# Шаблон окружения: ops/api.env.example (в нём же команды генерации секретов).
install -m 640 -o root -g liders ops/api.env.example /etc/lideryprava/api.env
nano /etc/lideryprava/api.env          # вставить сгенерированные секреты
```

Секреты генерируются командами `openssl rand -base64 48` (два ключа подписи) и
`openssl rand -base64 24` (пароль БД и пароль администратора). Пароль админки и
ключи подписи — разные значения.

### 6.4. Сборка, миграции и раскладка артефактов

```bash
bash ops/deploy.sh                 # сборка + миграции + раскладка + рестарт
DRY_RUN=1 bash ops/deploy.sh       # предварительный просмотр шагов
RUN_MIGRATIONS=0 bash ops/deploy.sh  # выкат без миграций
```

Скрипт собирает API (`tsc` → `dist`), собирает `platform/web` и `platform/admin`
(если каталоги уже есть), применяет миграции и раскладывает артефакты в
`/var/www/lideryprava/{api,public,admin}`, после чего перезапускает юнит и
проверяет `/api/health`.

### 6.5. Юнит systemd (однократно)

```bash
cp ops/systemd/liders-api.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now liders-api
systemctl status liders-api --no-pager
curl -s http://127.0.0.1:8100/api/health      # ожидается {"status":"ok","database":"up",…}
```

Старый `server.py` под юнитом `lideryprava` продолжает работать: публичный сайт
не переключается до готовности приёма заявок и админки.

### 6.6. Переключение nginx (в согласованное окно)

```bash
cp ops/nginx/lideryprava-platform.conf /etc/nginx/sites-available/lideryprava
ln -sfn /etc/nginx/sites-available/lideryprava /etc/nginx/sites-enabled/lideryprava
nginx -t && systemctl reload nginx
```

### 6.7. Проверки после переключения

```bash
for p in / /about /stages /initiatives /masterclasses /winners /documents /contacts /apply \
         /legal/offer /legal/privacy /robots.txt /sitemap.xml /favicon.ico; do
  printf '%-22s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' https://lideryprava.ru$p)"
done
curl -s https://lideryprava.ru/api/health
curl -s -o /dev/null -w '%{http_code}\n' https://lideryprava.ru/this-path-does-not-exist   # 404
curl -s -o /dev/null -w '%{http_code}\n' https://lideryprava.ru/data/applications.db       # 404
for p in /cabinet/access /admin/; do
  printf '%-18s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' https://lideryprava.ru$p)"
done
```

Проверить вручную: тестовая подача заявки, вход в кабинет, отказ по дедлайну,
выгрузка CSV в админке.

### 6.8. Откат

```bash
cp /root/lideryprava-snapshots/$STAMP/nginx.conf /etc/nginx/sites-available/lideryprava
nginx -t && systemctl reload nginx
systemctl stop liders-api
systemctl start lideryprava
```

Заявки, поданные через новую платформу до отката, остаются в PostgreSQL и
переносятся повторно после исправления — терять их нельзя.

### 6.9. Наблюдение и история

```bash
journalctl -u liders-api -f
tail -f /var/log/nginx/lideryprava.error.log
```

Первые 72 часа — наблюдение; старый сайт, `server.py`, SQLite и прежние
конфигурации сохраняются минимум 30 дней. Перенос заявок сезонов до 2027 года —
в `legacy_applications` (только чтение в админке), по разделу 10 ТЗ.

