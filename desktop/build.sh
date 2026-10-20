#!/usr/bin/env bash
# Packages the ProSE app of this repository (app/) as a desktop application with Neutralinojs
# (https://neutralino.js.org): one zip per platform in desktop/dist/, each with the Neutralino program
# (prose-<platform>), resources.neu (the application) and README.txt.
#
#   desktop/build.sh            needs node (npm, npx), curl, unzip and zip
#
# The app is built with relative paths (VITE_BASE=./), as app/dist is for the site but into a
# directory of its own, so the site's build in app/dist (base /prose-web/) stays as it is. The
# program serves it with the cross-origin isolation headers (serverHeaders in
# neutralino.config.json) at / and opens it in Chrome, Chromium or Edge ("chrome" mode). The page
# loads Neutralino's client library only to hold the connection whose end (the window closed) stops
# the program.
set -euo pipefail

NEUTRALINO_VERSION=6.10.0
NEU_CLI="${NEU_CLI:-npx --yes @neutralinojs/neu@11.8.0}"
PLATFORMS=(linux_x64 linux_arm64 win_x64.exe mac_universal)

DESKTOP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(dirname "$DESKTOP")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# the application: the app, with both module packages: openms/ (wasm32, with the PeptDeep models) and
# openms64/ (wasm64, Memory64: searches above 4 GB; Chrome and Edge have it from 133)
mkdir -p "$WORK/bin"
cp "$DESKTOP/neutralino.config.json" "$WORK/"
[ -d "$REPO/app/node_modules" ] || (cd "$REPO/app" && npm ci --no-audit --no-fund)
# (PROSE_DESKTOP=1: the page loads /neutralino.js; added at build time, so the service worker's
# manifest has the page as it is served)
(cd "$REPO/app" && PROSE_DESKTOP=1 VITE_BASE=./ npx vite build --outDir "$WORK/resources" --emptyOutDir --logLevel warn)
grep -q 'src="./assets/' "$WORK/resources/index.html"
grep -q 'Neutralino.init' "$WORK/resources/index.html"
for f in openms/openms.mjs openms/openms.wasm openms/models/peptdeep_ms2_dynamic.onnx openms64/openms.mjs openms64/openms.wasm; do
  [ -f "$WORK/resources/$f" ] || { echo "the package lacks $f" >&2; exit 1; }
done

# Neutralino's client library (the server prepends the connection token to any *neutralino.js)
curl -fsSL -o "$WORK/resources/neutralino.js" \
  "https://github.com/neutralinojs/neutralino.js/releases/download/v$NEUTRALINO_VERSION/neutralino.js"

# the Neutralino programs
curl -fsSL -o "$WORK/neutralino.zip" \
  "https://github.com/neutralinojs/neutralinojs/releases/download/v$NEUTRALINO_VERSION/neutralinojs-v$NEUTRALINO_VERSION.zip"
for platform in "${PLATFORMS[@]}"; do
  unzip -q -j "$WORK/neutralino.zip" "neutralino-$platform" -d "$WORK/bin"
done

(cd "$WORK" && $NEU_CLI build)

# one zip per platform
mkdir -p "$DESKTOP/dist"
for platform in "${PLATFORMS[@]}"; do
  name="prose-desktop-${platform%.exe}"
  rm -rf "$WORK/$name" "$DESKTOP/dist/$name.zip"
  mkdir "$WORK/$name"
  cp "$WORK/dist/prose/prose-$platform" "$WORK/dist/prose/resources.neu" "$DESKTOP/README.txt" "$WORK/$name/"
  chmod +x "$WORK/$name/prose-$platform"
  (cd "$WORK" && zip -q -r -9 "$DESKTOP/dist/$name.zip" "$name")
done
ls -la "$DESKTOP/dist"
