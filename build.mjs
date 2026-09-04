#!/usr/bin/env node
/**
 * build.mjs — Reúne en `dist/` sólo lo que se sirve.
 *
 * No hay compilación ni empaquetado: la aplicación son módulos ES nativos que
 * el navegador carga tal cual. Esto se limita a copiar el armazón y dejar fuera
 * lo que no pinta nada en producción (las pruebas, el servidor de desarrollo,
 * node_modules).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, 'dist');

const INCLUDE = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'styles',
  'js',
  'icons',
];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let files = 0;
let bytes = 0;

for (const entry of INCLUDE) {
  const src = path.join(ROOT, entry);
  if (!fs.existsSync(src)) {
    console.error(`  falta: ${entry}`);
    process.exitCode = 1;
    continue;
  }
  const dst = path.join(OUT, entry);
  fs.cpSync(src, dst, { recursive: true });
}

(function measure(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) measure(p);
    else { files++; bytes += fs.statSync(p).size; }
  }
})(OUT);

// El service worker precachea una lista fija: si no coincide con lo que se
// publica, la aplicación no arrancaría sin conexión. Se comprueba aquí porque
// es el momento en que el desajuste es barato de arreglar.
const sw = fs.readFileSync(path.join(OUT, 'sw.js'), 'utf8');
const listed = [...sw.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]).filter(Boolean);
const missing = listed.filter((f) => f && !fs.existsSync(path.join(OUT, f)));
if (missing.length) {
  console.error('  el service worker precachea archivos que no se publican: ' + missing.join(', '));
  process.exitCode = 1;
}

console.log(`  dist/ · ${files} archivos · ${(bytes / 1024).toFixed(0)} KB`);
