#!/bin/sh
# hacer-zip.sh — El proyecto de Xcode listo para instalar Laboratorio en un
# iPhone, en un solo .zip que no necesita nada más que Xcode.
#
#   sh ios/hacer-zip.sh        →  ios/salida/Laboratorio-Xcode.zip
#
# El proyecto (ios/App) enlaza el plugin de Fotos (@capacitor-community/media)
# desde node_modules, con una ruta relativa: ../../../node_modules/… Para que
# funcione sin Node ni npm en el Mac, el .zip lleva esa carpeta del plugin al
# lado, en el mismo sitio relativo. Capacitor y SDWebImage los descarga Xcode
# solo (Swift Package Manager) al abrir el proyecto.
#
# Antes hay que tener la web copiada dentro (npm run ios), que es lo que hace
# este script si no se le pide lo contrario con SIN_SYNC=1.
set -eu

RAIZ=$(cd "$(dirname "$0")/.." && pwd)
cd "$RAIZ"

if [ "${SIN_SYNC:-}" != "1" ]; then
  npm run ios
fi

PLUGIN=node_modules/@capacitor-community/media
[ -f "$PLUGIN/Package.swift" ] || { echo "Falta $PLUGIN: ejecuta npm install" >&2; exit 1; }

SALIDA="$RAIZ/ios/salida"
TMP="$SALIDA/Laboratorio-Xcode"
rm -rf "$SALIDA"
mkdir -p "$TMP/node_modules/@capacitor-community"

# La carpeta ios/ entera: el proyecto busca cosas fuera de ios/App, como
# ios/debug.xcconfig (sin él Xcode no compila). Fuera sólo lo de este script
# y lo que Xcode genera por su cuenta.
mkdir -p "$TMP/ios"
for f in ios/* ios/.[!.]*; do
  [ -e "$f" ] || continue
  case "$(basename "$f")" in
    salida|hacer-zip.sh|LEEME-iPhone.txt|.gitignore|.DS_Store) ;;
    *) cp -R "$f" "$TMP/ios/" ;;
  esac
done
rm -rf "$TMP/ios/App/build" "$TMP/ios/App/DerivedData" \
       "$TMP/ios/App/App.xcodeproj/xcuserdata" "$TMP/ios/App/App.xcodeproj/project.xcworkspace/xcuserdata"

# El plugin de Fotos: lo justo para Swift Package Manager.
mkdir -p "$TMP/$PLUGIN"
cp "$PLUGIN/Package.swift" "$PLUGIN/package.json" "$TMP/$PLUGIN/"
cp -R "$PLUGIN/ios" "$TMP/$PLUGIN/ios"
[ -f "$PLUGIN/LICENSE" ] && cp "$PLUGIN/LICENSE" "$TMP/$PLUGIN/" || true

cp ios/LEEME-iPhone.txt "$TMP/LEEME.txt"

(cd "$SALIDA" && zip -qry Laboratorio-Xcode.zip Laboratorio-Xcode)
rm -rf "$TMP"
echo "  ios/salida/Laboratorio-Xcode.zip · $(du -h "$SALIDA/Laboratorio-Xcode.zip" | cut -f1)"
