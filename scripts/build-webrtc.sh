#!/bin/sh
# Compile une seule fois l'annulation d'écho de WebRTC (webrtc-audio-processing, celle de Chrome et Google Meet)
# en bibliothèques statiques dans bin/. Nécessite meson et ninja (brew install meson ninja)
set -e
cd "$(dirname "$0")/.."

VERSION=2.1
SHA256=ae9302824b2038d394f10213cab05312c564a038434269f11dbf68f511f9f9fe
DIR=bin/webrtc-audio-processing-$VERSION

if [ -f "$DIR/build/webrtc/modules/audio_processing/libwebrtc-audio-processing-2.a" ]; then
    exit 0
fi

mkdir -p bin
ARCHIVE="$DIR.tar.xz"
curl -fsSL -o "$ARCHIVE" "https://freedesktop.org/software/pulseaudio/webrtc-audio-processing/webrtc-audio-processing-$VERSION.tar.xz"
echo "$SHA256  $ARCHIVE" | shasum -a 256 -c - >/dev/null
rm -rf "$DIR"
tar xf "$ARCHIVE" -C bin
rm "$ARCHIVE"

# meson télécharge aussi abseil, dont la bibliothèque dépend
meson setup "$DIR/build" "$DIR" --buildtype=release -Ddefault_library=static
ninja -C "$DIR/build"
echo "Annulation d'écho de WebRTC compilée dans $DIR"
