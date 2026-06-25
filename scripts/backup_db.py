#!/usr/bin/env python3
# FILE: scripts/backup_db.py
# VERSION: 1.0.0
# START_MODULE_CONTRACT:
# PURPOSE: Консистентный онлайн-бэкап SQLite-БД заявок (PII, 152-ФЗ) с проверкой
#          целостности, gzip-сжатием, верификацией копии и ротацией.
# SCOPE: Серверная задача по расписанию (systemd timer). Не зависит от Claude.
# INPUT: env DB_PATH, BACKUP_DIR, KEEP (или дефолты для прод-сервера).
# OUTPUT: Файл applications-YYYYMMDD-HHMMSS.db.gz в BACKUP_DIR (права 600).
# KEYWORDS: DOMAIN(9): Backup; CONCEPT(8): OnlineBackup; TECH(9): sqlite3.backup
# END_MODULE_CONTRACT
#
# START_RATIONALE:
# Q: Почему sqlite3.Connection.backup(), а не копирование файла?
# A: При WAL копия файла .db без -wal неполна/повреждена. Backup API делает
#    консистентный снимок онлайн, без блокировки писателей.
# Q: Почему read-only mode=ro?
# A: Бэкап не должен случайно менять боевую БД и не плодит -wal/-shm от root.
# END_RATIONALE
#
# START_INVARIANTS:
# - Бэкап создаётся только если PRAGMA integrity_check == 'ok'.
# - Число строк в копии совпадает с боевой БД, иначе exit(1) (видно в systemd).
# - В BACKUP_DIR хранится не более KEEP последних копий.
# END_INVARIANTS

import gzip
import os
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(os.environ.get("DB_PATH", "/var/www/lideryprava/data/applications.db"))
BACKUP_DIR = Path(os.environ.get("BACKUP_DIR", "/root/db-backups/lideryprava"))
KEEP = int(os.environ.get("KEEP", "30"))


def main():
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    os.chmod(BACKUP_DIR, 0o700)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    tmp_db = BACKUP_DIR / f".tmp-{timestamp}.db"
    final_gz = BACKUP_DIR / f"applications-{timestamp}.db.gz"

    # START_BLOCK_SNAPSHOT: read-only снимок + проверка целостности
    source = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=30)
    integrity = source.execute("PRAGMA integrity_check").fetchone()[0]
    source_rows = source.execute("SELECT COUNT(*) FROM applications").fetchone()[0]
    destination = sqlite3.connect(tmp_db)
    with destination:
        source.backup(destination)
    destination.close()
    source.close()
    # END_BLOCK_SNAPSHOT

    # START_BLOCK_COMPRESS: gzip + права 600
    with open(tmp_db, "rb") as fin, gzip.open(final_gz, "wb", compresslevel=9) as fout:
        shutil.copyfileobj(fin, fout)
    os.remove(tmp_db)
    os.chmod(final_gz, 0o600)
    # END_BLOCK_COMPRESS

    # START_BLOCK_VERIFY: распаковать копию и сверить число строк
    verify_db = BACKUP_DIR / f".verify-{timestamp}.db"
    with gzip.open(final_gz, "rb") as fin, open(verify_db, "wb") as fout:
        shutil.copyfileobj(fin, fout)
    verify_conn = sqlite3.connect(verify_db)
    verify_rows = verify_conn.execute("SELECT COUNT(*) FROM applications").fetchone()[0]
    verify_conn.close()
    os.remove(verify_db)
    # END_BLOCK_VERIFY

    # START_BLOCK_ROTATE: хранить не более KEEP последних
    backups = sorted(BACKUP_DIR.glob("applications-*.db.gz"))
    removed = 0
    for old in backups[:-KEEP] if len(backups) > KEEP else []:
        old.unlink()
        removed += 1
    kept = min(len(backups), KEEP)
    # END_BLOCK_ROTATE

    print(
        f"[backup] {final_gz.name} size={final_gz.stat().st_size}B "
        f"integrity={integrity} rows={source_rows} verified_rows={verify_rows} "
        f"kept={kept} removed={removed}"
    )
    if integrity != "ok" or source_rows != verify_rows:
        print("[backup] FAILED: integrity/row-count mismatch", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
