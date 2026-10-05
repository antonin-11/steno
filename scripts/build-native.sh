#!/bin/sh
# Compile le helper natif (détection des appels, enregistrement, annulation d'écho) dans bin/
set -e
cd "$(dirname "$0")/.."
mkdir -p bin

IDENTITY=$(sh scripts/signing-identity.sh)

# Annulation d'écho de WebRTC, liée en statique dans le helper
sh scripts/build-webrtc.sh
WEBRTC=bin/webrtc-audio-processing-2.1
ABSEIL=$(echo $WEBRTC/subprojects/abseil-cpp-*/)
clang++ -std=c++17 -O2 -c native/echo-canceller.cc -o bin/echo-canceller.o -I$WEBRTC -I$WEBRTC/webrtc -I$ABSEIL

# Supprime avant de recompiler : un helper en cours d'exécution garde son fichier au lieu d'être écrasé
rm -f bin/steno-recorder bin/disclaim-exec

swiftc -O -swift-version 5 native/recorder.swift -import-objc-header native/echo-canceller.h -o bin/steno-recorder \
    bin/echo-canceller.o $WEBRTC/build/webrtc/modules/audio_processing/libwebrtc-audio-processing-2.a \
    $WEBRTC/build/subprojects/abseil-cpp-*/libabsl_*.a -lc++ \
    -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker native/Info.plist
cc -O2 native/disclaim-exec.c -o bin/disclaim-exec

codesign --force --sign "$IDENTITY" --identifier com.devify.steno.recorder bin/steno-recorder
codesign --force --sign "$IDENTITY" bin/disclaim-exec

echo "Helper compilé dans bin/"
