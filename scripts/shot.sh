#!/usr/bin/env bash
# shot.sh URL WIDTH HEIGHT OUT.png [SCALE] - one headless Chrome screenshot.
set -euo pipefail
url=$1 w=$2 h=$3 out=$4 scale=${5:-2}
prof=$(mktemp -d)
trap 'rm -rf "$prof"' EXIT
timeout 40 google-chrome-stable --headless=new --hide-scrollbars --disable-gpu --no-first-run \
  --user-data-dir="$prof" --force-device-scale-factor="$scale" --virtual-time-budget=5000 \
  --window-size="$w,$h" --screenshot="$out" "$url" >/dev/null 2>&1
