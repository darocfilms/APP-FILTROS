#!/usr/bin/env node
/**
 * smoke-remote.mjs — Comprueba que la aplicación PUBLICADA arranca de verdad.
 *
 *   node test/smoke-remote.mjs https://usuario.github.io/APP-FILTROS/
 *
 * Que los archivos devuelvan 200 no prueba nada: un módulo con una ruta mal
 * resuelta, un shader que no compila en el navegador real o un service worker
 * con un ámbito equivocado dan 200 en todo y una pantalla en negro. Esto abre
 * la página con un navegador de verdad y comprueba que el armazón monta, que
 * el motor compila y que un render produce los píxeles esperados.
 */
import pw from 'playwright';
const { chromium } = pw;

const BASE = process.argv[2];
if (!BASE) {
  console.error('Uso: node test/smoke-remote.mjs <url>');
  process.exit(2);
}

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failures++;
};

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();

const errors = [];
const failedRequests = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', (r) => { if (r.status() >= 400) failedRequests.push(r.status() + ' ' + r.url()); });

console.log('\nAbriendo ' + BASE);
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60_000 });
await page.waitForTimeout(3500);

check('el armazón monta las tres pestañas', await page.locator('.tabbar__tab').count() === 3);
check('no hay pantalla de error fatal', (await page.locator('.fatal').count()) === 0);
check('ningún recurso falla', failedRequests.length === 0, failedRequests.slice(0, 3).join(' | '));

const sw = await page.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  return regs.map((r) => r.scope);
});
check('el service worker se registra en el ámbito correcto',
  sw.length === 1 && BASE.startsWith(sw[0]) || sw.some((s) => BASE.replace(/\/$/, '') === s.replace(/\/$/, '')),
  sw.join(', ') || 'ninguno');

// El motor: los shaders tienen que compilar en el navegador real, no sólo en
// el de desarrollo, y el render tiene que dar los píxeles previstos.
const engine = await page.evaluate(async (base) => {
  const { Renderer } = await import(new URL('js/engine/renderer.js', base).href);
  const { defaultParams, applyFilmLook } = await import(new URL('js/data/params.js', base).href);
  const { getFilm } = await import(new URL('js/data/films.js', base).href);

  const src = document.createElement('canvas');
  src.width = 64; src.height = 64;
  const g = src.getContext('2d');
  g.fillStyle = '#ff0000'; g.fillRect(0, 0, 64, 32);
  g.fillStyle = '#0000ff'; g.fillRect(0, 32, 64, 32);

  const canvas = document.createElement('canvas');
  const r = new Renderer(canvas);
  const programas = Object.keys(r._prog()).length;
  r.setSource(src, 64, 64);

  // Neutro: debe devolver la imagen intacta.
  r.render(defaultParams(), { seed: 1 });
  const arriba = [...r.ctx.readPixels(null, 32, canvas.height - 2, 1, 1)].slice(0, 3);

  // Una emulsión con carácter fuerte debe cambiar el resultado.
  r.render(applyFilmLook(defaultParams(), getFilm('velvia50')), { seed: 1 });
  const conPelicula = [...r.ctx.readPixels(null, 32, canvas.height - 2, 1, 1)].slice(0, 3);

  r.dispose();
  return { programas, arriba, conPelicula };
}, BASE);

check('los seis programas GLSL compilan', engine.programas === 6, engine.programas + '/6');
check('el perfil neutro respeta la imagen y la orientación',
  engine.arriba[0] > 180 && engine.arriba[2] < 80, 'rgb(' + engine.arriba + ')');
check('aplicar una emulsión cambia el resultado',
  engine.conPelicula.join(',') !== engine.arriba.join(','), 'rgb(' + engine.conPelicula + ')');

check('sin errores en consola', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(failures ? `\n${failures} fallo(s)\n` : '\nLa aplicación publicada funciona.\n');
process.exit(failures ? 1 : 0);
