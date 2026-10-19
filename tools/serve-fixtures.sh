#!/bin/bash
# Serves the test fixtures on two loopback origins for 10 minutes: 8794 is the page origin,
# 8795 stands in for a CDN without CORS (the tests reach it as cdn.test).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGS="${TMPDIR:-/tmp}/stream-quality-hud-fixtures"
mkdir -p "$LOGS"
cd "$ROOT/fixtures"
pkill -f 'http.server 879[45]' 2>/dev/null || true
(timeout 600 python3 -m http.server 8794 --bind 127.0.0.1 >"$LOGS/8794.log" 2>&1 &)
(timeout 600 python3 -m http.server 8795 --bind 127.0.0.1 >"$LOGS/8795.log" 2>&1 &)
sleep 1
curl -s -o /dev/null -w 'page %{http_code}, ' http://127.0.0.1:8794/mse.html
curl -s -o /dev/null -w 'cdn %{http_code}\n' http://127.0.0.1:8795/master.m3u8
