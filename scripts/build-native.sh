#!/bin/sh
# Compile le helper natif (détection des appels et enregistrement) dans bin/
set -e
cd "$(dirname "$0")/.."
mkdir -p bin

IDENTITY=$(sh scripts/signing-identity.sh)

# Supprime avant de recompiler : un helper en cours d'exécution garde son fichier au lieu d'être écrasé
rm -f bin/steno-recorder bin/disclaim-exec

swiftc -O -swift-version 5 native/recorder.swift -o bin/steno-recorder \
    -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker native/Info.plist
cc -O2 native/disclaim-exec.c -o bin/disclaim-exec

codesign --force --sign "$IDENTITY" --identifier com.devify.steno.recorder bin/steno-recorder
codesign --force --sign "$IDENTITY" bin/disclaim-exec

echo "Helper compilé dans bin/"
