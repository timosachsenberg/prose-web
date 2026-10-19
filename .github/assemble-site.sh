#!/usr/bin/env bash
# Assembles the GitHub Pages site (https://timosachsenberg.github.io/prose-web/) in _site/: run by
# .github/workflows/pages.yml after `npm ci && npm run build` in app/, and the same way locally.
#
#   .github/assemble-site.sh [<site directory>]      (default: _site in the repository)
#
#   /prose-web/                the ProSE app (app/dist, built with the base /prose-web/)
#   /prose-web/examples/prose/ a redirect to the app (the address of the earlier demo)
#   /prose-web/examples/browser/  a redirect to openms-demo/
#   /prose-web/openms-demo/    the general OpenMS demo (examples/browser) with its module and its
#                              service worker, in one directory
#   /prose-web/data/, prose-single-file.html, README.md: unchanged
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE="$(realpath -m "${1:-$REPO/_site}")"
[ -f "$REPO/app/dist/index.html" ] && [ -f "$REPO/app/dist/sw.js" ] ||
  { echo "app/dist is missing: run npm ci && npm run build in app/ first" >&2; exit 1; }
if grep -q "__BUILD_ID__" "$REPO/app/dist/sw.js" || ! grep -q 'name="prose-build" content="[0-9a-f]\{12\}"' "$REPO/app/dist/index.html"; then
  echo "app/dist is not stamped (sw.js, index.html)" >&2; exit 1
fi
grep -q 'src="/prose-web/assets/' "$REPO/app/dist/index.html" ||
  { echo "app/dist is not built for /prose-web/ (VITE_BASE set?)" >&2; exit 1; }

rm -rf "$SITE"
mkdir -p "$SITE"

# the app
cp -r "$REPO/app/dist/." "$SITE/"

# unchanged
cp -r "$REPO/data" "$SITE/data"
cp "$REPO/prose-single-file.html" "$REPO/README.md" "$SITE/"

# the OpenMS demo: examples/browser, its module (the repository root's package) and the service
# worker of the demos, in one directory; their relative paths change accordingly
DEMO="$SITE/openms-demo"
mkdir -p "$DEMO"
cp "$REPO/examples/browser/index.html" "$REPO/examples/browser/app.mjs" "$REPO/examples/browser/style.css" "$DEMO/"
cp "$REPO/examples/sw.js" "$REPO/examples/sw-client.mjs" "$DEMO/"
cp "$REPO/openms.mjs" "$REPO/openms.wasm" "$REPO/package.json" "$REPO/LICENSE" "$DEMO/"
replace() { # file, text, replacement (literal): fails if the text is not there
  python3 - "$@" <<'PY'
import sys
path, old, new = sys.argv[1:4]
text = open(path).read()
if old not in text:
    sys.exit(f"{path}: {old!r} not found")
open(path, "w").write(text.replace(old, new))
PY
}
replace "$DEMO/app.mjs" 'from "../../openms.mjs"' 'from "./openms.mjs"'
replace "$DEMO/app.mjs" 'from "../sw-client.mjs"' 'from "./sw-client.mjs"'
replace "$DEMO/sw.js" 'new URL("../package.json", self.location.href)' 'new URL("./package.json", self.location.href)'
# The demo's client took a page under the worker for an isolated one; but clients.claim() can make
# the worker the page's controller before the page reloads, which left a first visit on one thread.
replace "$DEMO/sw-client.mjs" 'if (navigator.serviceWorker.controller) {' 'if (navigator.serviceWorker.controller && crossOriginIsolated) {'
# The demo's worker drops every store not named after its version; the site is one origin, so it
# would drop the app's stores too (openms-module-<id>, prose-app-<id>). Only its own (<version>
# = 1.2.3...) are its to drop.
replace "$DEMO/sw.js" 'if (name !== META_CACHE && !name.endsWith(' 'if (name !== META_CACHE && /^openms-(module|app)-\d+\.\d+\.\d+/.test(name) && !name.endsWith('

# the addresses of the earlier demos
redirect() { # directory, target (relative), name of the target
  mkdir -p "$1"
  cat > "$1/index.html" <<HTML
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Moved: $3</title>
  <meta http-equiv="refresh" content="3; url=$2">
  <script>
    // the earlier demos' service workers (scopes within examples/: examples/prose/, examples/browser/)
    // are not needed any more
    const earlier = new URL("../", location.href).href;
    Promise.resolve(navigator.serviceWorker?.getRegistrations() ?? [])
      .then((all) => Promise.all(all.filter((r) => r.scope.startsWith(earlier)).map((r) => r.unregister())))
      .catch(() => {})
      .finally(() => location.replace("$2" + location.hash));
  </script>
</head>
<body>
  <p>$3 is now at <a href="$2">$2</a>.</p>
</body>
</html>
HTML
}
redirect "$SITE/examples/prose" "../../" "ProSE"
redirect "$SITE/examples/browser" "../../openms-demo/" "The OpenMS demo"

echo "site assembled in $SITE ($(du -sh "$SITE" | cut -f1))"
