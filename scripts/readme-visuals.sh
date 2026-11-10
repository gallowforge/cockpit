#!/usr/bin/env bash
# scripts/readme-visuals.sh - render the README images in docs/readme/.
#
# The images show the real UI as frosted-glass windows floating in a night sky (the "Glass"
# look; docs/readme/IDENTITY.md). Three steps, all from docs/readme/src/:
#   1. textures.mjs starts `cockpit demo` three times (calm, attention, incident) on a frozen
#      clock and captures the real UI into shots/ (desktop 1440 px at 2x, phone 390 px at 3x).
#      It also runs `cockpit check` on a demo snapshot and typesets it, the end-to-end output
#      in demo/e2e.txt, the design diagram and the numbers band, each dark and light.
#   2. glass/render.cjs renders each composition in layouts.js with three.js in headless
#      Chromium: desktop 840 CSS px wide at 2x, phone 381 px at 1080/381, dark and light.
#      Cockpit has one theme, night, so the light images keep its dark screens on bright glass.
#   3. The hero is an 8-second loop (animated WebP): the glass holds still while the light
#      moves, and the horizon banks amber for one caution and levels again. Every other
#      image is a still WebP; social.png is the 1280x640 preview for Settings > Social preview.
#
#   scripts/readme-visuals.sh                  # every image
#   scripts/readme-visuals.sh backups alerts   # only these (reuses the captures in shots/)
#
# Needs bin/cockpit (make), Node 22+, ImageMagick 7, ffmpeg with libwebp, and the
# `playwright` and `three` packages on NODE_PATH with Playwright's Chromium, for example:
#   npm i --prefix ~/.cache/glass playwright three && npx --prefix ~/.cache/glass playwright install chromium
#   NODE_PATH=~/.cache/glass/node_modules scripts/readme-visuals.sh
set -euo pipefail
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SRC=$REPO/docs/readme/src
OUT=$REPO/docs/readme
export BIN=${BIN:-$REPO/bin/cockpit}
for t in node magick ffmpeg; do command -v "$t" >/dev/null || { echo "missing tool: $t" >&2; exit 2; }; done
[ -x "$BIN" ] || { echo "build first: make (or BIN=path/to/cockpit)" >&2; exit 2; }
node -e "require('playwright'); require('three')" 2>/dev/null || { echo "set NODE_PATH to a node_modules with playwright and three (see the header)" >&2; exit 2; }

STILLS=(numbers overview services backups history phones design proof)
pages=("$@")
[ ${#pages[@]} -gt 0 ] || pages=(hero "${STILLS[@]}" social)

TMP=$(mktemp -d "${TMPDIR:-/tmp}/readme-visuals.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

if [ $# -eq 0 ] || [ ! -f "$SRC/shots/boxes.js" ]; then node "$SRC/textures.mjs"; fi

webp() { magick "$1" -strip -define webp:method=6 -quality "${3:-88}" "$2"; printf '%-28s %s\n' "${2##*/}" "$(du -h "$2" | cut -f1)"; }
loop() { # loop <layout> <theme> <out.webp> <frames> <fps> <quality>
  node "$SRC/glass/render.cjs" "$1,$2,anim,$4,$TMP/$1-$2" >/dev/null
  ffmpeg -y -loglevel error -framerate "$5" -i "$TMP/$1-$2/f%04d.png" -c:v libwebp_anim -lossless 0 \
    -quality "$6" -compression_level 6 -loop 0 "$OUT/$3"
  printf '%-28s %s\n' "$3" "$(du -h "$OUT/$3" | cut -f1)"
}

for p in "${pages[@]}"; do
  case $p in
    hero)
      for t in dark light; do loop hero "$t" "hero-$t.webp" 96 12 72; loop hero-phone "$t" "hero-$t-phone.webp" 72 9 62; done ;;
    social)
      node "$SRC/glass/render.cjs" "social,dark,still,0,$TMP/social.png" >/dev/null
      magick "$TMP/social.png" -strip -define png:compression-level=9 "$OUT/social.png"
      echo "social.png                   $(magick identify -format '%wx%h' "$OUT/social.png")" ;;
    *)
      jobs=()
      for t in dark light; do jobs+=("$p,$t,still,0,$TMP/$p-$t.png" "$p-phone,$t,still,0,$TMP/$p-$t-phone.png"); done
      node "$SRC/glass/render.cjs" "${jobs[@]}" >/dev/null
      for t in dark light; do webp "$TMP/$p-$t.png" "$OUT/$p-$t.webp"; webp "$TMP/$p-$t-phone.png" "$OUT/$p-$t-phone.webp" 86; done ;;
  esac
done
du -ch "$OUT"/*.webp "$OUT"/social.png | tail -1
