#!/bin/sh
# LocalTeX - arranque em Linux/macOS.  Ex.: ./start.sh --host 0.0.0.0 --password segredo
cd "$(dirname "$0")" || exit 1
exec python3 server.py "$@"
