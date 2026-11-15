#!/usr/bin/env bash
# Builds the Ithil prototype .deb into dist/.
# The version comes from package.json (the owner sets it; this script never changes it).
# The package installs files only: no services, no boot changes, nothing started automatically.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/package.json').version")"
if [ -z "$VERSION" ] || [ "$VERSION" = "undefined" ]; then
  echo "package.json has no version; the owner must set one" >&2
  exit 1
fi
PKG=ithil-prototype
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
OUT="$ROOT/dist/${PKG}_${VERSION}_all.deb"

# ---- files ------------------------------------------------------------
install -d "$STAGE/opt/ithil" "$STAGE/usr/bin" "$STAGE/usr/share/applications" "$STAGE/DEBIAN"
cp -r "$ROOT/ithil" "$ROOT/test" "$ROOT/docs" "$STAGE/opt/ithil/"
cp "$ROOT/package.json" "$ROOT/README.md" "$STAGE/opt/ithil/"

cat > "$STAGE/usr/bin/ithil-selftest" <<'SH'
#!/bin/sh
# Runs Ithil's unit tests on this machine. Writes only to the temp folder.
if ! command -v node >/dev/null 2>&1; then
  echo "ithil-selftest: Node.js 22.13 or newer is needed (not found)." >&2; exit 1
fi
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'; then
  echo "ithil-selftest: Node.js 22.13 or newer is needed (found $(node --version))." >&2; exit 1
fi
cd /opt/ithil && exec node --test test/*.test.js
SH

cat > "$STAGE/usr/bin/ithil-mockups" <<'SH'
#!/bin/sh
# Opens the Ithil mockups in the browser. Usage: ithil-mockups [app|brain]
case "${1:-app}" in
  brain) f=/opt/ithil/docs/mockups/ithil-brain.html ;;
  app)   f=/opt/ithil/docs/mockups/ithil-app.html ;;
  *) echo "usage: ithil-mockups [app|brain]" >&2; exit 2 ;;
esac
exec xdg-open "$f"
SH
chmod 755 "$STAGE/usr/bin/ithil-selftest" "$STAGE/usr/bin/ithil-mockups"

cat > "$STAGE/usr/share/applications/ithil-mockups.desktop" <<'DT'
[Desktop Entry]
Type=Application
Name=Ithil (prototype mockups)
Comment=Mockups of Ithil's app. Not connected to a running Ithil.
Exec=ithil-mockups app
Terminal=false
Categories=Development;
DT

# ---- control ----------------------------------------------------------
SIZE="$(du -sk "$STAGE/opt" "$STAGE/usr" | awk '{s+=$1} END {print s}')"
cat > "$STAGE/DEBIAN/control" <<CTL
Package: $PKG
Version: $VERSION
Section: misc
Priority: optional
Architecture: all
Maintainer: Dragongamer9 <Dragongamer9@users.noreply.github.com>
Installed-Size: $SIZE
Recommends: nodejs (>= 22.13), xdg-utils
Description: Ithil core mind prototype (not a working assistant yet)
 PROTOTYPE. Contains Ithil's event log, hard-limit gate and the
 brain-inspired loop (workspace, needs, confidence tags, prediction,
 sleep cycle, attention and self-model) as code with unit tests, plus
 mockups of her app and a 3D brain viewer.
 .
 What works: ithil-selftest runs the unit tests; ithil-mockups opens
 the mockups. What does NOT work yet: talking to Ithil. No language
 model is connected, there is no running service, and it is not
 connected to the Hearth AI app.
 .
 Installs files only (to /opt/ithil and /usr/bin). It adds no services,
 starts nothing and does not touch boot files.
CTL

mkdir -p "$ROOT/dist"
dpkg-deb --root-owner-group --build "$STAGE" "$OUT" >/dev/null
echo "$OUT"
