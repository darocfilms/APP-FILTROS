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
npx electron-builder --mac --universal --dir --publish never
APP="salida/mac-universal/Laboratorio.app"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"
rm -rf salida/dmg salida/Laboratorio.dmg
mkdir -p salida/dmg
cp -R "$APP" salida/dmg/
ln -s /Applications salida/dmg/Aplicaciones
# En los Mac de GitHub, hdiutil falla a veces con «Resource busy» mientras el
# sistema revisa la imagen que se está creando: se reintenta con pausas.
for intento in 1 2 3 4 5 6; do
  if hdiutil create -volname "Laboratorio" -srcfolder salida/dmg -ov -format UDZO salida/Laboratorio.dmg; then
    hdiutil verify salida/Laboratorio.dmg
    echo "Listo: mac/salida/Laboratorio.dmg"
    exit 0
  fi
  echo "hdiutil ocupado (intento $intento); se reintenta"
  sleep $((intento * 5))
done
echo "No se pudo crear el .dmg" >&2
exit 1
