#!/usr/bin/env bash
# Packages the ProSE web application of this repository as a desktop application with
# Neutralinojs (https://neutralino.js.org): one zip per platform in desktop/dist/, each with the
# Neutralino program (prose-<platform>), resources.neu (the application) and README.txt.
#
#   desktop/build.sh            needs node (npx), curl, unzip and zip
#
# The program serves the application with the cross-origin isolation headers (serverHeaders in
# neutralino.config.json) and opens it in Chrome, Chromium or Edge ("chrome" mode). The page loads
# Neutralino's client library only to hold the connection whose end (the window closed) stops the
# program.
set -euo pipefail

NEUTRALINO_VERSION=6.10.0
NEU_CLI="${NEU_CLI:-npx --yes @neutralinojs/neu@11.8.0}"
PLATFORMS=(linux_x64 linux_arm64 win_x64.exe mac_universal)

DESKTOP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(dirname "$DESKTOP")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# the application: the module and the demo applications of the repository
mkdir -p "$WORK/resources" "$WORK/bin"
cp "$DESKTOP/neutralino.config.json" "$WORK/"
cp "$REPO/openms.mjs" "$REPO/openms.wasm" "$REPO/package.json" "$WORK/resources/"
cp -r "$REPO/examples" "$WORK/resources/"
rm -rf "$WORK/resources/examples/node"

# Neutralino's client library (the server prepends the connection token to any *neutralino.js)
curl -fsSL -o "$WORK/resources/neutralino.js" \
  "https://github.com/neutralinojs/neutralino.js/releases/download/v$NEUTRALINO_VERSION/neutralino.js"
sed -i 's|  <script type="module" src="app.mjs"></script>|  <script src="/neutralino.js"></script>\n  <script>Neutralino.init();</script>\n&|' \
  "$WORK/resources/examples/prose/index.html"
grep -q 'Neutralino.init' "$WORK/resources/examples/prose/index.html"

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
