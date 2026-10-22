#!/bin/bash
# Builds dist/stream-quality-hud.user.js from extension/hud.js for Safari's free "Userscripts" extension
# (or any userscript manager). hud.js already works without the extension APIs: Control+Shift+H toggles it locally.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$ROOT/extension/manifest.json")"
OUT="$ROOT/dist/stream-quality-hud.user.js"
{
  cat <<HEADER
// ==UserScript==
// @name         Stream Quality HUD
// @description  Shows current playback, streaming and disc data grades, and relevant playback issues. A button over the video or Control+Shift+H opens it.
// @version      $VERSION
// @match        *://*/*
// @run-at       document-start
// @inject-into  content
// ==/UserScript==

HEADER
  cat "$ROOT/extension/hud.js"
} > "$OUT"
echo "built $OUT ($VERSION)"
