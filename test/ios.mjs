#!/usr/bin/env node
/**
 * ios.mjs — El proyecto de Xcode lleva dentro lo mismo que se publica.
 *
 * `ios/App/App/public` es una COPIA de la app web, versionada para que el
 * proyecto se abra en Xcode sin instalar Node en el Mac. Una copia se queda
 * vieja en silencio: cambias la web, olvidas `npm run ios`, y la app del
 * iPhone sigue con la versión anterior sin que nada lo diga. Aquí se dice.
 *
 * También comprueba lo que, si falta, no da un error de compilación sino un
 * cierre de la app en el teléfono: los textos de permiso del Info.plist.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PUBLIC = path.join(ROOT, 'ios/App/App/public');

let failures = 0;
const check = (n, ok, d = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + n + (d ? '  ' + d : ''));
  if (!ok) failures++;
};

const huellas = (dir) => {
  const out = new Map();
  (function recorre(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) recorre(p);
      else if (e.name !== '.nojekyll') {
        out.set(path.relative(dir, p), crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex'));
      }
    }
  })(dir);
  return out;
};

console.log('\n── La copia del proyecto de Xcode está al día ──');
execFileSync(process.execPath, [path.join(ROOT, 'build.mjs')], { stdio: 'ignore' });
check('existe el proyecto de Xcode', fs.existsSync(path.join(ROOT, 'ios/App/App.xcodeproj/project.pbxproj')));
check('lleva la app web dentro', fs.existsSync(path.join(PUBLIC, 'index.html')));
if (fs.existsSync(PUBLIC)) {
  const web = huellas(DIST);
  const app = huellas(PUBLIC);
  const distinto = [...web].filter(([f, h]) => app.get(f) !== h).map(([f]) => f);
  // Capacitor añade sus dos archivos de compatibilidad con Cordova al copiar:
  // son suyos, no un resto de una versión anterior.
  const DE_CAPACITOR = new Set(['cordova.js', 'cordova_plugins.js']);
  const sobra = [...app.keys()].filter((f) => !web.has(f) && !DE_CAPACITOR.has(f));
  check('idéntica a lo que se publica',
    distinto.length === 0 && sobra.length === 0,
    distinto.length || sobra.length
      ? `desfasados: ${[...distinto, ...sobra].slice(0, 5).join(', ')} — ejecuta «npm run ios»`
      : `${web.size} archivos`);
}

console.log('\n── Lo que en el teléfono no da error, da un cierre ──');
const plist = fs.readFileSync(path.join(ROOT, 'ios/App/App/Info.plist'), 'utf8');
for (const [clave, por] of [
  ['NSCameraUsageDescription', 'sin él, pedir la cámara cierra la app'],
  ['NSMicrophoneUsageDescription', 'sin él, grabar vídeo cierra la app'],
  ['NSPhotoLibraryAddUsageDescription', 'sin él, «Añadir a Fotos» cierra la app'],
]) {
  const m = plist.match(new RegExp(`<key>${clave}</key>\\s*<string>([^<]+)</string>`));
  check(`${clave} con texto`, !!m && m[1].trim().length > 10, m ? `«${m[1].slice(0, 48)}…»` : por);
}

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'ios/App/App/capacitor.config.json'), 'utf8'));
// La marca del user agent es lo que impide que la app se tome a sí misma por
// el navegador de WhatsApp y bloquee la cámara. Ver isNativeApp().
check('la app se anuncia como tal en su user agent', cfg.appendUserAgent === 'LaboratorioApp', cfg.appendUserAgent);
const pbx = fs.readFileSync(path.join(ROOT, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
const objetivo = [...pbx.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([0-9.]+);/g)].map((m) => parseFloat(m[1]));
// WebGL2, que hace todo el revelado, llegó a iOS en la 15.
check('pide iOS 15 o posterior', objetivo.length > 0 && objetivo.every((v) => v >= 15), objetivo.join(', '));

console.log('\nResultado: ' + (failures ? failures + ' fallo(s)' : 'todo correcto'));
process.exit(failures ? 1 : 0);
