#!/bin/sh
# Construit Sténo.app, remplace l'app installée dans /Applications et la relance.
# Le mode dev est arrêté aussi : une seule instance de Sténo peut tourner à la fois
set -e
cd "$(dirname "$0")/.."

# Dossier de données de l'app, gardé sous l'ancien nom (voir src/main/index.ts)
DATA="$HOME/Library/Application Support/spell-check-electron"
# Exécutable de Sténo.app, quelle que soit la forme du « é » dans le chemin (macOS en a deux)
INSTALLED_APP='/St[^/]*no\.app/Contents/MacOS/'
DEV_APP="$PWD/node_modules/.*Electron"

if [ ! -f .env ]; then
    echo "Pas de .env dans le projet : l'app installée n'aurait pas de clé API" >&2
    exit 1
fi

sh scripts/package.sh
BUILT=$(ls -d dist/mac*/*.app)
INSTALLED="/Applications/$(basename "$BUILT")"

# SIGTERM : Electron quitte proprement et arrête ses helpers
pkill -f "$INSTALLED_APP" || true
pkill -f "$DEV_APP" || true
tries=0
while pgrep -f "$INSTALLED_APP" >/dev/null || pgrep -f "$DEV_APP" >/dev/null; do
    tries=$((tries + 1))
    if [ "$tries" -gt 50 ]; then
        echo "Sténo ne s'arrête pas : quitte-le à la main puis relance pnpm run release" >&2
        exit 1
    fi
    sleep 0.1
done

# L'app installée lit sa clé API dans le dossier de données
mkdir -p "$DATA"
cp .env "$DATA/.env"

rm -rf "$INSTALLED"
ditto "$BUILT" "$INSTALLED"
open "$INSTALLED"

echo "Sténo installé dans /Applications et relancé"
