#!/usr/bin/env python3
# FILE: scripts/purge_expired.py
# VERSION: 1.0.0
# START_MODULE_CONTRACT:
# PURPOSE: Удаление или обезличивание ПДн заявок по сроку хранения / отзыву
#          согласия (152-ФЗ: по достижении цели данные удаляют или обезличивают).
# SCOPE: Разовый/по расписанию запуск на сервере. БЕЗОПАСНО: dry-run по умолчанию.
# INPUT: env DB_PATH, RETENTION_DAYS; флаги --apply / --delete / --include-withdrawn.
# OUTPUT: Отчёт (что будет/было затронуто). С --apply меняет БД.
# KEYWORDS: DOMAIN(9): DataRetention; CONCEPT(8): Anonymization; TECH(8): sqlite3
# END_MODULE_CONTRACT
#
# START_RATIONALE:
# Q: Почему обезличивание по умолчанию, а не удаление?
# A: Обезличивание (стереть ПДн, оставить обезличенную строку) сохраняет
#    статистику сезонов и не ломает автоинкремент; удаление — по флагу --delete.
# Q: Почему dry-run по умолчанию?
# A: Необратимая операция над боевыми ПДн. Срок хранения — решение оператора,
#    поэтому без явного --apply скрипт только показывает, что было бы затронуто.
# END_RATIONALE
#
# START_INVARIANTS:
# - Без --apply БД не изменяется.
# - Обезличивание стирает full_name/email/phone/organization/source_ip и ставит
#   status='anonymized'; согласия и даты сохраняются как обезличенный аудит-след.
# END_INVARIANTS

import argparse
import os
import sqlite3
from datetime import datetime, timedelta, timezone

DB_PATH = os.environ.get("DB_PATH", "/var/www/lideryprava/data/applications.db")
DEFAULT_RETENTION_DAYS = int(os.environ.get("RETENTION_DAYS", "1095"))  # 3 года


def select_targets(connection, cutoff_iso, include_withdrawn):
    # Кандидаты: старше срока хранения ИЛИ (опционально) с отозванным согласием.
    where = "datetime(created_at) < datetime(?)"
    params = [cutoff_iso]
    if include_withdrawn:
        where = f"({where}) OR status = 'withdrawn'"
    rows = connection.execute(
        f"SELECT id, created_at, status FROM applications WHERE {where} ORDER BY id",
        params,
    ).fetchall()
    return rows


def main():
    parser = argparse.ArgumentParser(description="Удаление/обезличивание ПДн заявок по сроку хранения (152-ФЗ).")
    parser.add_argument("--retention-days", type=int, default=DEFAULT_RETENTION_DAYS,
                        help=f"Срок хранения в днях (по умолчанию {DEFAULT_RETENTION_DAYS}).")
    parser.add_argument("--include-withdrawn", action="store_true",
                        help="Также обрабатывать заявки со статусом 'withdrawn' (отзыв согласия).")
    parser.add_argument("--apply", action="store_true", help="Применить изменения (иначе только показать).")
    parser.add_argument("--delete", action="store_true", help="Полное удаление строк вместо обезличивания.")
    args = parser.parse_args()

    cutoff = (datetime.now(timezone.utc) - timedelta(days=args.retention_days)).astimezone().isoformat(timespec="seconds")
    connection = sqlite3.connect(DB_PATH, timeout=30)
    try:
        targets = select_targets(connection, cutoff, args.include_withdrawn)
        ids = [r[0] for r in targets]
        mode = "DELETE" if args.delete else "ANONYMIZE"
        print(f"[purge] режим={mode} apply={args.apply} cutoff<{cutoff} "
              f"retention={args.retention_days}д include_withdrawn={args.include_withdrawn}")
        print(f"[purge] под критерий подпадает записей: {len(ids)}")
        if not ids:
            return
        if not args.apply:
            print(f"[purge] DRY-RUN — ничего не изменено. IDs: {ids[:50]}{' …' if len(ids) > 50 else ''}")
            return
        placeholders = ",".join("?" * len(ids))
        if args.delete:
            connection.execute(f"DELETE FROM applications WHERE id IN ({placeholders})", ids)
        else:
            connection.execute(
                f"""UPDATE applications SET
                        full_name='—', email='', phone='', organization='',
                        source_ip='', admin_notes='', status='anonymized'
                    WHERE id IN ({placeholders})""",
                ids,
            )
        connection.commit()
        print(f"[purge] {'удалено' if args.delete else 'обезличено'} записей: {len(ids)}")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
