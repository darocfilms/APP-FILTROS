#!/usr/bin/env node
/**
 * Lanza todas las suites en serie y resume el resultado.
 *
 *   npm test
 *
 * Cada suite arranca el servidor de desarrollo en su propio puerto, abre
 * Chromium de verdad y ejercita la aplicación: no hay simulacros del motor, los
 * shaders se compilan y los píxeles se leen del framebuffer.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SUITES = [
  ['engine', 'motor de color, geometría, histograma y orientación'],
  ['flow', 'importar → editar → exportar → persistencia'],
  ['camera', 'captura de foto, grabación y estilos'],
  ['picker', 'miniaturas del selector de emulsión'],
  ['wheel', 'ruedas de etalonaje'],
  ['context', 'pérdida y recuperación del contexto WebGL'],
];

const only = process.argv[2];
const results = [];

for (const [name, description] of SUITES) {
  if (only && name !== only) continue;
  process.stdout.write(`\n\x1b[1m▸ ${name}\x1b[0m — ${description}\n`);
  const code = await new Promise((resolve) => {
    spawn(process.execPath, [path.join(DIR, name + '.mjs')], { stdio: 'inherit' })
      .on('close', resolve);
  });
  results.push([name, code === 0]);
}

console.log('\n' + '─'.repeat(52));
for (const [name, ok] of results) {
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`);
}
const failed = results.filter(([, ok]) => !ok).length;
console.log(failed ? `\n  ${failed} suite(s) con fallos\n` : '\n  Todas las suites correctas\n');
process.exit(failed ? 1 : 0);
