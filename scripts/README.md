# Бэкап БД заявок «Лидеры Права»

Автоматический бэкап SQLite-БД (`data/applications.db`) с PII заявок (152-ФЗ).

## Как работает
- `backup_db.py` — онлайн-бэкап (`sqlite3.Connection.backup`, консистентно с WAL),
  проверка `PRAGMA integrity_check`, gzip, верификация копии (распаковка + сверка
  числа строк), ротация (по умолчанию 30 последних). Права файлов `600`.
- `lideryprava-dbbackup.service` + `.timer` — запуск ежедневно в 03:30 (МСК) через
  systemd, `Persistent=true` (догоняет пропущенные запуски).
- Копии: `/root/db-backups/lideryprava/applications-YYYYMMDD-HHMMSS.db.gz`
  (папка `700`, только root — защита PII).

## Установка на сервере (однократно)
```
rsync scripts/backup_db.py root@SERVER:/var/www/lideryprava/scripts/
cp scripts/lideryprava-dbbackup.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now lideryprava-dbbackup.timer
systemctl start lideryprava-dbbackup.service   # первый прогон
```

## Проверка
```
systemctl list-timers lideryprava-dbbackup.timer
journalctl -u lideryprava-dbbackup.service -n 20
ls -la /root/db-backups/lideryprava/
```

## Восстановление из бэкапа
```
systemctl stop lideryprava
LATEST=$(ls -t /root/db-backups/lideryprava/applications-*.db.gz | head -1)
python3 -c "import gzip,shutil; shutil.copyfileobj(gzip.open('$LATEST','rb'), open('/var/www/lideryprava/data/applications.db','wb'))"
# убрать устаревшие WAL/SHM, чтобы не наложились на восстановленный файл:
mv /var/www/lideryprava/data/applications.db-wal /tmp/ 2>/dev/null || true
mv /var/www/lideryprava/data/applications.db-shm /tmp/ 2>/dev/null || true
chown www-data:www-data /var/www/lideryprava/data/applications.db
chmod 600 /var/www/lideryprava/data/applications.db
systemctl start lideryprava
```

## Параметры (env, опционально)
- `DB_PATH` — путь к БД (дефолт `/var/www/lideryprava/data/applications.db`)
- `BACKUP_DIR` — куда складывать (дефолт `/root/db-backups/lideryprava`)
- `KEEP` — сколько копий хранить (дефолт `30`)
