#!/bin/sh
# Affiche l'identité de signature à utiliser : STENO_SIGN_IDENTITY si elle est définie,
# sinon le certificat « Steno Dev » du trousseau s'il existe, sinon « - » (signature ad hoc).
#
# Avec un certificat, la signature reste la même d'une compilation à l'autre :
# macOS garde les permissions (Accessibilité, micro, son système) au lieu de les redemander.
# Le certificat doit être approuvé pour la signature de code : electron-builder ignore les autres

if [ -n "$STENO_SIGN_IDENTITY" ]; then
    echo "$STENO_SIGN_IDENTITY"
elif security find-identity -v -p codesigning | grep -q '"Steno Dev"'; then
    echo "Steno Dev"
else
    echo "Pas de certificat « Steno Dev » : signature ad hoc, macOS redemandera les permissions" >&2
    echo "-"
fi
