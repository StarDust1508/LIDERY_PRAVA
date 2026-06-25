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

## Off-site: ежедневная выгрузка на Mac
Копии дублируются на локальный Mac (защита на случай гибели сервера).

- **Доступ:** выделенный SSH-ключ `~/.lideryprava-backup/id_ed25519` (НЕ в репо).
  На сервере он прописан в `/root/.ssh/authorized_keys` с жёстким ограничением:
  `command="tar -C /root/db-backups/lideryprava -cf - .",restrict,no-pty` —
  ключ умеет ТОЛЬКО отдавать архив бэкапов, без shell и root-доступа.
- **Скрипт:** `scripts/mac/pull.sh` (рабочая копия в `~/.lideryprava-backup/pull.sh`)
  тянет tar-поток и распаковывает `.db.gz` в `~/Documents/lideryprava-db-backups/`
  (накопительно). Лог: `~/.lideryprava-backup/state/pull.log`.
- **Расписание:** launchd-агент `scripts/mac/com.lideryprava.dbbackup.plist`
  (`~/Library/LaunchAgents/`), ежедневно 13:30 + при входе в систему; пропущенные
  запуски (Mac спал) выполняются при пробуждении.
- **Проверка/перезагрузка агента:**
  ```
  launchctl list | grep lideryprava
  bash ~/.lideryprava-backup/pull.sh            # ручной прогон
  launchctl bootout gui/$(id -u)/com.lideryprava.dbbackup
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.lideryprava.dbbackup.plist
  ```
- **Восстановление из локальной копии:** распаковать нужный `.db.gz` (gunzip) —
  это готовый файл SQLite-БД, подставляется по процедуре «Восстановление» выше.

> MacOS-rsync (openrsync, proto 29) несовместим с серверным rrsync — поэтому
> используется tar-поток по SSH (версионно-независимо и строже по правам).
