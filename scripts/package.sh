#!/bin/sh
# Compile le helper et l'app (out/), puis construit dist/mac-arm64/Sténo.app avec electron-builder (configuration : "build" dans package.json)
set -e
cd "$(dirname "$0")/.."

sh scripts/build-native.sh
pnpm run build
electron-builder --dir -c.mac.identity="$(sh scripts/signing-identity.sh)"
