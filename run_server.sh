#!/bin/zsh

set -euo pipefail

PROJECT_DIR="/Users/ilya/Downloads/лидеры права сайт"
LOG_DIR="$PROJECT_DIR/data/logs"
PYTHON_BIN="/usr/bin/python3"

mkdir -p "$LOG_DIR"
cd "$PROJECT_DIR"

exec "$PYTHON_BIN" server.py >> "$LOG_DIR/server.log" 2>&1
