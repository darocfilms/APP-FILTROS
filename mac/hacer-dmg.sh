#!/bin/sh
# hacer-dmg.sh — Construye Laboratorio.app (Intel y Apple Silicon) y su .dmg.
#
# Se ejecuta en un Mac (lo hace GitHub Actions, .github/workflows/mac.yml, en
# cada cambio). Sin certificado de desarrollador de Apple la app va firmada «ad
# hoc»: un Mac con Apple Silicon no abre una app sin ninguna firma, y con ésta
# basta para abrirla después de autorizarla una vez (ver el README).
set -e
cd "$(dirname "$0")"
[ -d node_modules ] || npm ci
node ../build.mjs
npx electron-builder --mac --universal --dir
APP="salida/mac-universal/Laboratorio.app"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"
rm -rf salida/dmg salida/Laboratorio.dmg
mkdir -p salida/dmg
cp -R "$APP" salida/dmg/
ln -s /Applications salida/dmg/Aplicaciones
hdiutil create -volname "Laboratorio" -srcfolder salida/dmg -ov -format UDZO salida/Laboratorio.dmg
echo "Listo: mac/salida/Laboratorio.dmg"
