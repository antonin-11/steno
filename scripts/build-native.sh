#!/bin/sh
# Compile le helper natif (détection des appels et enregistrement) dans bin/
set -e
cd "$(dirname "$0")/.."
mkdir -p bin

swiftc -O -swift-version 5 native/recorder.swift -o bin/steno-recorder \
    -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker native/Info.plist
cc -O2 native/disclaim-exec.c -o bin/disclaim-exec

# Signature ad hoc : macOS redemande les permissions après chaque recompilation
codesign --force --sign - --identifier com.devify.steno.recorder bin/steno-recorder
codesign --force --sign - bin/disclaim-exec

echo "Helper compilé dans bin/"
