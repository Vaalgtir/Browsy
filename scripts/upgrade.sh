#!/bin/sh
# Mise à jour de sécurité : dernière version stable d'Electron (donc de Chromium)
# et des bibliothèques d'extensions, puis rebuild et réinstallation.
set -eu
cd "$(dirname "$0")/.."
BEFORE=$(node -p "require('electron/package.json').version")
npm install --save-dev electron@latest
npm install electron-chrome-extensions@latest electron-chrome-web-store@latest
npx install-electron
AFTER=$(node -p "require('electron/package.json').version")
echo "Electron : $BEFORE → $AFTER"
npm run typecheck
npm test
npm run install-app
