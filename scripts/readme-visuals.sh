#!/usr/bin/env bash
# scripts/readme-visuals.sh - render the README images in docs/readme/.
#
# 1. Starts `cockpit demo` three times (calm, attention, incident) on a frozen
#    clock, so every run gives the same picture, and screenshots the real UI
#    into docs/readme/src/shots/ (desktop 1440 px and phone 390 px, at 2x).
# 2. Renders each designed page in docs/readme/src/ twice with headless Chrome
#    at 2x: 1100 CSS px wide for desktops and 540 px for phones, trims the
#    transparent margin and saves WebP.
# 3. Renders the 1280x640 social preview (docs/readme/social.png).
#
#   scripts/readme-visuals.sh            # everything
#   scripts/readme-visuals.sh hero       # one page (reuses existing shots)
#
# Needs bin/cockpit (make), google-chrome or chromium (CHROME=...), ImageMagick 7.
set -euo pipefail
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SRC=$REPO/docs/readme/src
OUT=$REPO/docs/readme
BIN=${BIN:-$REPO/bin/cockpit}
AT=2026-03-10T07:42:00Z
CHROME=${CHROME:-$(command -v google-chrome-stable || command -v google-chrome || command -v chromium || true)}
[ -n "$CHROME" ] || { echo "no Chrome or Chromium found (set CHROME=...)" >&2; exit 2; }
command -v magick >/dev/null || { echo "ImageMagick 7 (magick) is required" >&2; exit 2; }
[ -x "$BIN" ] || { echo "build first: make (or BIN=path/to/cockpit)" >&2; exit 2; }

TMP=$(mktemp -d "${TMPDIR:-/tmp}/cockpit-visuals.XXXXXX")
pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$TMP"; }
trap cleanup EXIT

chrome() { # chrome <url> <width> <height> <out.png> <scale> [transparent]
  local bg=()
  [ "${6:-}" = transparent ] && bg=(--default-background-color=00000000)
  timeout 60 "$CHROME" --headless=new --hide-scrollbars --disable-gpu --no-first-run \
    --user-data-dir="$TMP/profile" --force-device-scale-factor="$5" "${bg[@]}" \
    --allow-file-access-from-files --virtual-time-budget=9000 \
    --window-size="$2,$3" --screenshot="$4" "$1" >/dev/null 2>&1
}

pages=("$@")
if [ ${#pages[@]} -eq 0 ]; then
  pages=(hero numbers overview services jump backups alerts sandbox phones proof)
  mkdir -p "$SRC/shots"
  port=8190
  for scen in calm attention incident; do
    port=$((port + 1))
    "$BIN" demo -scenario "$scen" -at "$AT" -listen "127.0.0.1:$port" >/dev/null 2>&1 &
    pids+=($!)
  done
  sleep 1
  shot() { # shot <name> <scenario port> <WxH> <route> [extra query]
    chrome "http://127.0.0.1:$2/?shot${5:+&$5}#/$4" "${3%x*}" "${3#*x}" "$SRC/shots/$1.png" 2
    echo "shot  $1"
  }
  shot overview-calm      8191 1440x1000 "" "since=9h"
  shot mob-overview-calm  8191 390x844   "" "since=9h"
  shot palette            8192 1440x900  "" "palette=vau"
  shot overview-attention 8192 1440x1240 "" "since=3h"
  shot mob-overview-att   8192 390x844   "" "since=3h"
  shot services-open      8192 1440x1300 "services/homeassistant"
  shot mob-services       8192 390x844   "services"
  shot backups            8192 1440x1400 "backups"
  shot mob-backups        8192 390x844   "backups"
  shot alerts             8192 1440x1300 "alerts"
  shot mob-alerts         8192 390x844   "alerts"
  shot mob-overview-inc   8193 390x844   "" "since=2h"
  shot mob-runbook        8193 390x844   "runbooks/dns" "tick=0"
  shot mob-timers         8193 390x844   "timers"
fi

render() { # render <page> <css width> <suffix>
  local png="$TMP/$1$3.png"
  chrome "file://$SRC/$1.html" "$2" 3000 "$png" 2 transparent
  magick "$png" -trim +repage -define webp:method=6 -quality 86 "$OUT/$1$3.webp"
  printf '%-24s %s\n' "$1$3.webp" "$(magick identify -format '%wx%h' "$OUT/$1$3.webp")"
}
for p in "${pages[@]}"; do
  [ -f "$SRC/$p.html" ] || { echo "no page $SRC/$p.html" >&2; exit 2; }
  render "$p" 1100 ""
  render "$p" 540 "-mobile"
done
if [ $# -eq 0 ] || [[ " $* " == *" social "* ]]; then
  chrome "file://$SRC/social.html" 1280 640 "$OUT/social.png" 1
  echo "social.png               $(magick identify -format '%wx%h' "$OUT/social.png")"
fi
du -ch "$OUT"/*.webp "$OUT"/social.png | tail -1
