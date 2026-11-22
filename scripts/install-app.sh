#!/bin/sh
# Installe (ou remplace) Browsy dans /Applications à partir du build local.
set -eu
APP="dist/mac-arm64/Browsy.app"
[ -d "$APP" ] || { echo "Build introuvable : lancer « npm run package » d'abord." >&2; exit 1; }
if pgrep -xq Browsy; then
  echo "Browsy est ouvert : quitte-le avant l'installation." >&2
  exit 1
fi
rm -rf /Applications/Browsy.app
cp -R "$APP" /Applications/
echo "Browsy installé dans /Applications."
