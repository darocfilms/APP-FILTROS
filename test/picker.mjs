/**
 * picker.mjs — El selector de emulsión: una fila de nombres, sin recuadros.
 *
 * Fija lo que se pidió: nada encima del nombre (ni muestras de color ni
 * miniaturas), las familias Digital, Diapositiva y Creativa fuera del
 * catálogo, y el mismo selector en la cámara y en el laboratorio.
 */
import pw from 'playwright';
const { chromium } = pw;
import { spawn } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const server = spawn('node', [ROOT + '/serve.mjs', '--port=8097'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));

let bad = 0;
const errors = [];
const check = (n, ok, d = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (d ? '  ' + d : '')); if (!ok) bad++; };

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:8097', { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);

console.log('\n── Catálogo ──');
const cat = await page.evaluate(async () => {
  const { FILMS, filmsByKind, getFilm } = await import('./js/data/films.js');
  return {
    ids: FILMS.map((f) => f.id),
    familias: filmsByKind().map((g) => g.kind),
    conNeutro: filmsByKind({ conNeutro: true }).flatMap((g) => g.items.map((f) => f.id)).includes('neutral'),
    retirada: getFilm('velvia50').id,
  };
});
const RETIRADAS = ['velvia50', 'provia100f', 'kodachrome64', 'astia100f', 'lomopurple'];
check('las diapositivas y la LomoChrome ya no están', RETIRADAS.every((id) => !cat.ids.includes(id)), cat.ids.length + ' emulsiones');
check('los selectores no ofrecen Digital, Diapositiva ni Creativa',
  !cat.familias.some((k) => /Digital|Diapositiva|Creativa|Referencia/.test(k)), cat.familias.join(' · '));
check('el neutro sigue existiendo por dentro (punto de partida del laboratorio)', cat.ids.includes('neutral') && cat.conNeutro);
check('una foto hecha con una emulsión retirada se abre en neutro', cat.retirada === 'neutral', cat.retirada);

console.log('\n── El selector ──');
const r = await page.evaluate(async () => {
  const { FilmPicker } = await import('./js/ui/filmpicker.js');
  const elegidas = [];
  const picker = new FilmPicker((id) => elegidas.push(id));
  document.body.append(picker.root);
  picker.select('portra400');
  const raiz = picker.root;
  const nombres = [...raiz.querySelectorAll('.filmname')];
  const out = {
    recuadros: raiz.querySelectorAll('canvas, img, .filmcard__frame, .strip__swatch').length,
    nombres: nombres.length,
    soloTexto: nombres.every((b) => b.children.length === 0 && b.textContent.trim().length > 0),
    activo: raiz.querySelector('.filmname.is-active')?.dataset.film,
    aria: raiz.querySelector('.filmname.is-active')?.getAttribute('aria-selected'),
    rol: raiz.getAttribute('role'),
    alto: Math.round(raiz.getBoundingClientRect().height),
  };
  raiz.querySelector('.filmname[data-film="trix400"]').click();
  // Tocar la que ya está puesta no la vuelve a aplicar.
  raiz.querySelector('.filmname[data-film="trix400"]').click();
  out.elegidas = elegidas;
  out.activoTrasClic = raiz.querySelector('.filmname.is-active')?.dataset.film;
  picker.destroy();
  raiz.remove();
  return out;
});
check('sin recuadros encima del nombre', r.recuadros === 0, r.recuadros + ' recuadros');
check('cada emulsión es sólo su nombre', r.soloTexto, r.nombres + ' nombres');
check('marca la activa', r.activo === 'portra400' && r.aria === 'true');
check('se anuncia como lista para elegir', r.rol === 'listbox');
check('ocupa una sola fila baja', r.alto <= 60, r.alto + ' px');
check('tocar un nombre lo elige, una sola vez', r.elegidas.join(',') === 'trix400' && r.activoTrasClic === 'trix400', r.elegidas.join(','));

console.log('\n── En el laboratorio ──');
const lab = await page.evaluate(() => {
  const n = document.querySelector('#view-lab .filmpicker');
  return { existe: !!n, recuadros: n ? n.querySelectorAll('canvas, img, .filmcard').length : -1 };
});
check('el laboratorio usa el mismo selector, sin miniaturas', lab.existe && lab.recuadros === 0, JSON.stringify(lab));

check('sin errores', errors.length === 0, errors.join(' | '));
await browser.close(); server.kill();
console.log(bad ? `\n${bad} fallo(s)` : '\nEl selector es una fila de nombres.');
process.exit(bad ? 1 : 0);
