/**
 * Prueba de integración: arranca la app en Chromium real y ejercita el motor.
 */
import pw from 'playwright';
const { chromium } = pw;
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const SHOT = process.env.SHOT_DIR || ROOT + 'test/capturas';
const BASE = 'http://localhost:8099';

fs.mkdirSync(SHOT, { recursive: true });
const server = spawn('node', [ROOT + '/serve.mjs', '--port=8099'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));

const errors = [];
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failures++;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  permissions: ['camera', 'microphone'],
});
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

console.log('\n── Arranque ──');
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

check('la app monta la barra de pestañas', await page.locator('.tabbar__tab').count() === 3);
check('sin errores fatales', !(await page.locator('.fatal').count()), errors.slice(0, 2).join(' | '));

console.log('\n── Compilación de shaders (WebGL2 real) ──');
const shaderTest = await page.evaluate(async () => {
  const { Renderer } = await import('./js/engine/renderer.js');
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const r = new Renderer(c);
  const names = [];
  try {
    const p = r._prog();
    for (const k of Object.keys(p)) names.push(k);
    return { ok: true, programs: names, maxTexture: r.maxTexture };
  } catch (e) {
    return { ok: false, error: String(e.message).slice(0, 900) };
  } finally { r.dispose(); }
});
check('los 6 programas compilan y enlazan', shaderTest.ok && shaderTest.programs.length === 6,
  shaderTest.ok ? shaderTest.programs.join(', ') : shaderTest.error);
if (shaderTest.ok) console.log('    MAX_TEXTURE_SIZE = ' + shaderTest.maxTexture);

if (!shaderTest.ok) {
  console.log('\nAbortado: sin shaders no tiene sentido seguir.');
  await browser.close(); server.kill(); process.exit(1);
}

console.log('\n── Render con cada emulsión ──');
const filmResults = await page.evaluate(async () => {
  const { Renderer } = await import('./js/engine/renderer.js');
  const { FILMS } = await import('./js/data/films.js');
  const { defaultParams, applyFilmLook } = await import('./js/data/params.js');

  // Carta de prueba: rampa de grises + parches de color saturados.
  const src = document.createElement('canvas');
  src.width = 256; src.height = 256;
  const g = src.getContext('2d');
  for (let x = 0; x < 256; x++) {
    g.fillStyle = `rgb(${x},${x},${x})`;
    g.fillRect(x, 0, 1, 128);
  }
  const patches = ['#e03030', '#30c040', '#3060e0', '#e0c020', '#20c0c0', '#c030c0', '#f0d0b0', '#402020'];
  patches.forEach((c, i) => { g.fillStyle = c; g.fillRect(i * 32, 128, 32, 128); });

  const canvas = document.createElement('canvas');
  const r = new Renderer(canvas);
  r.setSource(src, 256, 256);

  const out = [];
  for (const f of FILMS) {
    const p = applyFilmLook(defaultParams(), f);
    r.render(p, { seed: 1 });
    const px = r.ctx.readPixels(null, 0, 0, 256, 256);
    let sum = [0, 0, 0], n = 0;
    let black = 0, white = 0;
    for (let i = 0; i < px.length; i += 4) {
      sum[0] += px[i]; sum[1] += px[i + 1]; sum[2] += px[i + 2]; n++;
      const l = (px[i] + px[i + 1] + px[i + 2]) / 3;
      if (l < 2) black++; if (l > 253) white++;
    }
    out.push({
      id: f.id,
      mean: sum.map((v) => +(v / n).toFixed(1)),
      clipBlack: +(black / n * 100).toFixed(1),
      clipWhite: +(white / n * 100).toFixed(1),
    });
  }
  r.dispose();
  return out;
});

const neutral = filmResults.find((f) => f.id === 'neutral');
console.log('    emulsión         media RGB            recorte ▼ / ▲');
for (const f of filmResults) {
  console.log('    ' + f.id.padEnd(16) + JSON.stringify(f.mean).padEnd(22) + f.clipBlack + '% / ' + f.clipWhite + '%');
}
check('todas las emulsiones renderizan', filmResults.length === 19);
const distinct = new Set(filmResults.map((f) => f.mean.join(','))).size;
check('cada emulsión da un resultado distinto', distinct >= 17, distinct + '/19 firmas únicas');
const overClipped = filmResults.filter((f) => f.clipBlack > 12 || f.clipWhite > 12);
check('ninguna emulsión recorta en exceso', overClipped.length === 0,
  overClipped.map((f) => f.id + ' ' + f.clipBlack + '/' + f.clipWhite).join(', '));

console.log('\n── Neutro = identidad ──');
const identity = await page.evaluate(async () => {
  const { Renderer } = await import('./js/engine/renderer.js');
  const { defaultParams } = await import('./js/data/params.js');
  const src = document.createElement('canvas');
  src.width = 64; src.height = 64;
  const g = src.getContext('2d');
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    g.fillStyle = `rgb(${x * 4},${y * 4},${(x + y) * 2})`;
    g.fillRect(x, y, 1, 1);
  }
  const canvas = document.createElement('canvas');
  const r = new Renderer(canvas);
  r.setSource(src, 64, 64);
  r.render(defaultParams(), { seed: 1 });
  const got = r.ctx.readPixels(null, 0, 0, 64, 64);
  const want = g.getImageData(0, 0, 64, 64).data;
  let maxDiff = 0, sumDiff = 0;
  // readPixels devuelve las filas al revés respecto de getImageData.
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const a = ((63 - y) * 64 + x) * 4;
    const b = (y * 64 + x) * 4;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(got[a + c] - want[b + c]);
      maxDiff = Math.max(maxDiff, d); sumDiff += d;
    }
  }
  r.dispose();
  return { maxDiff, avgDiff: +(sumDiff / (64 * 64 * 3)).toFixed(3) };
});
check('el perfil neutro deja la imagen intacta', identity.maxDiff <= 2,
  'máx Δ=' + identity.maxDiff + ' medio Δ=' + identity.avgDiff);

console.log('\n── Geometría ──');
const geo = await page.evaluate(async () => {
  const { Renderer } = await import('./js/engine/renderer.js');
  const { defaultParams } = await import('./js/data/params.js');
  // Patrón asimétrico: cada cuadrante un color.
  const src = document.createElement('canvas');
  src.width = 80; src.height = 40;
  const g = src.getContext('2d');
  g.fillStyle = '#ff0000'; g.fillRect(0, 0, 40, 20);    // arriba-izq  rojo
  g.fillStyle = '#00ff00'; g.fillRect(40, 0, 40, 20);   // arriba-der  verde
  g.fillStyle = '#0000ff'; g.fillRect(0, 20, 40, 20);   // abajo-izq   azul
  g.fillStyle = '#ffff00'; g.fillRect(40, 20, 40, 20);  // abajo-der   amarillo

  const canvas = document.createElement('canvas');
  const r = new Renderer(canvas);
  r.setSource(src, 80, 40);

  const nameOf = (p) => {
    const [R, G, B] = p;
    if (R > 180 && G < 80 && B < 80) return 'rojo';
    if (G > 180 && R < 80 && B < 80) return 'verde';
    if (B > 180 && R < 80 && G < 80) return 'azul';
    if (R > 180 && G > 180 && B < 80) return 'amarillo';
    return 'otro(' + p.join(',') + ')';
  };
  // Esquina superior izquierda de la SALIDA (readPixels va de abajo arriba).
  const topLeft = () => {
    const w = canvas.width, h = canvas.height;
    const px = r.ctx.readPixels(null, 2, h - 3, 1, 1);
    return nameOf([px[0], px[1], px[2]]);
  };

  const cases = {};
  const run = (label, mutate) => {
    const p = defaultParams();
    mutate(p);
    r.render(p, { seed: 1 });
    cases[label] = { corner: topLeft(), size: canvas.width + 'x' + canvas.height };
  };

  run('sin cambios', () => {});
  run('giro 90', (p) => { p.geometry.rotate = 90; });
  run('giro 180', (p) => { p.geometry.rotate = 180; });
  run('giro 270', (p) => { p.geometry.rotate = 270; });
  run('espejo H', (p) => { p.geometry.flipH = true; });
  run('voltear V', (p) => { p.geometry.flipV = true; });
  run('recorte der.', (p) => { p.geometry.crop = { x: 0.5, y: 0, w: 0.5, h: 1 }; });
  run('recorte abajo', (p) => { p.geometry.crop = { x: 0, y: 0.5, w: 1, h: 0.5 }; });
  r.dispose();
  return cases;
});
const expect = {
  'sin cambios': ['rojo', '80x40'],
  'giro 90': ['azul', '40x80'],
  'giro 180': ['amarillo', '80x40'],
  'giro 270': ['verde', '40x80'],
  'espejo H': ['verde', '80x40'],
  'voltear V': ['azul', '80x40'],
  'recorte der.': ['verde', '40x40'],
  'recorte abajo': ['azul', '80x20'],
};
for (const [k, v] of Object.entries(expect)) {
  const got = geo[k];
  check('  ' + k.padEnd(14) + '→ ' + got.corner + ' ' + got.size,
    got.corner === v[0] && got.size === v[1], got.corner === v[0] && got.size === v[1] ? '' : 'esperado ' + v.join(' '));
}

console.log('\n── Histograma ──');
const hist = await page.evaluate(async () => {
  const { Renderer } = await import('./js/engine/renderer.js');
  const { defaultParams } = await import('./js/data/params.js');
  const src = document.createElement('canvas');
  src.width = 256; src.height = 256;
  const g = src.getContext('2d');
  for (let x = 0; x < 256; x++) { g.fillStyle = `rgb(${x},${x},${x})`; g.fillRect(x, 0, 1, 256); }
  const canvas = document.createElement('canvas');
  const r = new Renderer(canvas);
  r.setSource(src, 256, 256);

  r.render(defaultParams(), { seed: 1 });
  const sinPase = r.histogram(64);

  r.render(defaultParams(), { seed: 1, histogram: true });
  const h = r.histogram(64);
  const total = h.l.reduce((a, b) => a + b, 0);
  // Una rampa uniforme debe repartirse de forma casi plana entre los cubos.
  const nonEmpty = h.l.filter((v) => v > 0).length;
  const max = Math.max(...h.l), min = Math.min(...h.l);
  r.dispose();
  return { sinPase: sinPase === null, total, nonEmpty, spread: +(max / Math.max(min, 1)).toFixed(2) };
});
check('sin el pase extra no hay histograma (nada lee el lienzo entero)', hist.sinPase);
check('con el pase extra sí lo hay', hist.total > 1000, hist.total + ' muestras');
check('una rampa uniforme llena todos los cubos', hist.nonEmpty === 64,
  hist.nonEmpty + '/64, desviación ×' + hist.spread);

console.log('\n── Orientación según el tipo de fuente ──');
const orient = await page.evaluate(async () => {
  const { Renderer } = await import('./js/engine/renderer.js');
  const { defaultParams } = await import('./js/data/params.js');
  const src = document.createElement('canvas');
  src.width = 64; src.height = 64;
  const g = src.getContext('2d');
  g.fillStyle = '#ff0000'; g.fillRect(0, 0, 64, 32);   // mitad superior roja
  g.fillStyle = '#0000ff'; g.fillRect(0, 32, 64, 32);  // mitad inferior azul

  const blob = await new Promise((r) => src.toBlob(r, 'image/png'));
  const bitmap = await createImageBitmap(blob);
  const img = new Image();
  await new Promise((r) => { img.onload = r; img.src = URL.createObjectURL(blob); });

  const canvas = document.createElement('canvas');
  const r = new Renderer(canvas);
  const out = {};
  for (const [label, source] of [['canvas', src], ['ImageBitmap', bitmap], ['HTMLImageElement', img]]) {
    r.setSource(source, 64, 64);
    // Sin geometría, y también con geometría activa (pasa por otro camino).
    for (const [suffix, mutate] of [['', () => {}], ['+recorte', (p) => { p.geometry.crop = { x: 0, y: 0, w: 1, h: 0.5 }; }]]) {
      const p = defaultParams();
      mutate(p);
      r.render(p, { seed: 1 });
      const px = r.ctx.readPixels(null, 32, canvas.height - 2, 1, 1);
      out[label + suffix] = px[0] > 180 && px[2] < 80 ? 'rojo' : px[2] > 180 && px[0] < 80 ? 'azul' : 'otro';
    }
  }
  r.dispose();
  bitmap.close?.();
  return out;
});
for (const [k, v] of Object.entries(orient)) {
  check('  arriba en ' + k.padEnd(24) + '→ ' + v, v === 'rojo', v === 'rojo' ? '' : 'invertida');
}

console.log('\n── Errores de consola ──');
check('sin errores en consola', errors.length === 0, errors.slice(0, 3).join(' | '));

await page.screenshot({ path: SHOT + '/shot-camera.png' });
console.log('\nResultado: ' + (failures ? failures + ' fallo(s)' : 'todo correcto'));
await browser.close();
server.kill();
process.exit(failures ? 1 : 0);
