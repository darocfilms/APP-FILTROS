/** Cámara: captura de foto, grabación de vídeo y estilos derivados. */
import pw from 'playwright';
const { chromium } = pw;
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const SHOT = process.env.SHOT_DIR || ROOT + 'test/capturas';
fs.mkdirSync(SHOT, { recursive: true });
const server = spawn('node', [ROOT + '/serve.mjs', '--port=8096'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));

let failures = 0;
const errors = [];
const check = (n, ok, d = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (d ? '  ' + d : '')); if (!ok) failures++; };

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
         '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
         '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  permissions: ['camera', 'microphone'],
});
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto('http://localhost:8096', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

console.log('\n── Estilos derivados de propiedades personalizadas ──');
const styles = await page.evaluate(() => {
  const sw = document.querySelector('.strip__item[data-film="portra400"] .strip__swatch');
  const bg = sw ? getComputedStyle(sw).backgroundImage : '';
  return { gradient: bg, c1: sw ? getComputedStyle(sw.parentElement).getPropertyValue('--c1').trim() : '' };
});
check('las muestras de la tira tienen degradado', /linear-gradient\(.*rgb/.test(styles.gradient), styles.c1);

console.log('\n── Vista de cámara en marcha ──');
const cam = await page.evaluate(() => {
  const v = window.__lab.views.camera;
  return {
    running: v.running,
    video: v.video.videoWidth + 'x' + v.video.videoHeight,
    canvas: v.canvas.width + 'x' + v.canvas.height,
    message: v.message.hidden,
  };
});
check('el flujo de la cámara está activo', cam.running && cam.video !== '0x0', 'vídeo ' + cam.video);
check('el lienzo renderiza fotogramas', cam.canvas !== '0x0', 'lienzo ' + cam.canvas);
check('no hay mensaje de error de cámara', cam.message);

console.log('\n── Elegir emulsión desde la cámara ──');
await page.locator('.strip__item[data-film="velvia50"]').click();
await page.waitForTimeout(500);
const camFilm = await page.evaluate(() => ({
  id: window.__lab.views.camera.params.film.id,
  sat: window.__lab.views.camera.params.color.saturation,
}));
check('la emulsión se aplica en directo', camFilm.id === 'velvia50' && camFilm.sat > 0.2, JSON.stringify(camFilm));

console.log('\n── Disparar una foto ──');
await page.locator('.shutter').click();
// El revelado a 3840×2160 por software (SwiftShader) es lento; se espera a que
// la vista deje de estar ocupada en lugar de a un tiempo fijo.
await page.waitForFunction(() => !window.__lab.views.camera.busy, null, { timeout: 60000 });
await page.waitForTimeout(600);
const shot = await page.evaluate(async () => {
  const { library } = await import('./js/store/library.js');
  const items = await library.list();
  return items[0] || null;
});
check('la foto se guarda en la carpeta local', !!shot, shot ? `${shot.width}×${shot.height}, ${Math.round(shot.size / 1024)} KB` : 'ninguna');
check('a resolución nativa del sensor, no la de previsualización',
  shot && shot.width >= 640, shot ? shot.width + ' px de ancho' : '');
check('registra la emulsión usada', shot?.filmId === 'velvia50', shot?.filmName || '');
check('no guarda ajustes activos (evita revelar dos veces)',
  shot && shot.params === null && !!shot.appliedParams);
const thumbOk = await page.evaluate(async () => {
  const { library } = await import('./js/store/library.js');
  const items = await library.list();
  const t = await library.getThumbBlob(items[0].id);
  return !!t && t.size > 500;
});
check('genera miniatura', thumbOk);

console.log('\n── Grabar vídeo ──');
await page.locator('.cam__mode[data-mode="video"]').click();
await page.waitForTimeout(400);
await page.locator('.shutter').click();
await page.waitForTimeout(3200);
const recording = await page.evaluate(() => !!window.__lab.views.camera.recorder);
check('la grabación arranca', recording);
await page.locator('.shutter').click();
await page.waitForTimeout(3500);
const vid = await page.evaluate(async () => {
  const { library } = await import('./js/store/library.js');
  const items = await library.list();
  return items.find((i) => i.kind === 'video') || null;
});
check('el vídeo se guarda', !!vid, vid ? `${vid.width}×${vid.height}, ${Math.round(vid.size / 1024)} KB, ${Math.round(vid.durationMs / 1000)} s, ${vid.mime}` : 'ninguno');
check('el vídeo tiene contenido', vid && vid.size > 10000);

console.log('\n── Reabrir la captura en el laboratorio ──');
await page.evaluate(async () => {
  const { library } = await import('./js/store/library.js');
  const items = await library.list();
  window.__lab.openInLab(items.find((i) => i.kind === 'photo'));
});
await page.waitForTimeout(3000);
const reopened = await page.evaluate(() => ({
  film: window.__lab.views.lab.params.film.id,
  hasImage: window.__lab.views.lab.root.classList.contains('has-image'),
}));
check('se abre con ajustes limpios, sin duplicar la emulsión',
  reopened.film === 'neutral' && reopened.hasImage, JSON.stringify(reopened));

await page.locator('.tabbar__tab[data-tab="camera"]').click();
await page.waitForTimeout(2500);
await page.screenshot({ path: SHOT + '/ui-camera2.png' });

console.log('\n── Errores de consola ──');
const real = errors.filter((e) => !/favicon|vibrate/i.test(e));
check('sin errores', real.length === 0, real.slice(0, 3).join(' | '));

console.log('\nResultado: ' + (failures ? failures + ' fallo(s)' : 'todo correcto'));
await browser.close(); server.kill();
process.exit(failures ? 1 : 0);
