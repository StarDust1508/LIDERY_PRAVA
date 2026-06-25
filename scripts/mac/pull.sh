#!/bin/bash
# Ежедневная выгрузка бэкапов БД «Лидеры Права» с сервера на Mac.
# Тянет tar-поток через ограниченный SSH-ключ (forced-command tar, без shell)
# и распаковывает .db.gz в ~/Documents/lideryprava-db-backups (накопительно).
set -uo pipefail
KDIR="$HOME/.lideryprava-backup"
DEST="$HOME/Documents/lideryprava-db-backups"
LOG="$KDIR/state/pull.log"
mkdir -p "$DEST" "$KDIR/state"

ssh -i "$KDIR/id_ed25519" \
    -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=30 \
    -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$KDIR/known_hosts" \
    root@72.56.38.62 2>>"$LOG" | tar -xf - -C "$DEST"
rc=${PIPESTATUS[0]}

count=$(ls "$DEST"/applications-*.db.gz 2>/dev/null | wc -l | tr -d ' ')
echo "$(date '+%Y-%m-%d %H:%M:%S') pull rc=$rc local_backups=$count" >> "$LOG"
exit "$rc"
