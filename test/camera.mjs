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
// La tira de emulsiones vive dentro de su ventana flotante: hay que abrirla.
await page.locator('.camtool[data-tool="film"]').click();
await page.waitForTimeout(500);
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
await page.locator('.campanel__close').click();
await page.waitForTimeout(300);
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

console.log('\n── Volver a la cámara después de salir ──');
/* El bug: al salir se destruía el renderer, y `dispose` devolvía el contexto
   WebGL con `loseContext`. Un lienzo con el contexto perdido no puede dar otro,
   así que al volver todo salía en negro. Se comprueba con píxeles reales. */
const vivo = async (etiqueta) => {
  const r = await page.evaluate(() => {
    const v = window.__lab.views.camera;
    const c = v.canvas;
    if (!c.width) return { pinta: false, motivo: 'lienzo sin tamaño' };
    // Se lee del framebuffer: si el contexto está muerto, sale todo a cero.
    const px = v.renderer?.ctx?.readPixels?.(null, (c.width / 2) | 0, (c.height / 2) | 0, 1, 1);
    const suma = px ? px[0] + px[1] + px[2] : 0;
    return {
      pinta: suma > 12,
      lienzo: c.width + '×' + c.height,
      perdido: !!v.renderer?.lost,
      corriendo: v.running,
      pista: v.track?.readyState || 'sin pista',
      centro: px ? [px[0], px[1], px[2]] : null,
    };
  });
  check(etiqueta, r.pinta && !r.perdido,
    `${r.lienzo} centro=${JSON.stringify(r.centro)} contextoPerdido=${r.perdido} pista=${r.pista}`);
  return r;
};

await page.locator('.tabbar__tab[data-tab="camera"]').click();
await page.waitForTimeout(2500);
await vivo('la cámara pinta al entrar');

await page.locator('.tabbar__tab[data-tab="library"]').click();
await page.waitForTimeout(1200);
await page.locator('.tabbar__tab[data-tab="camera"]').click();
await page.waitForTimeout(3000);
await vivo('sigue pintando tras pasar por Biblioteca');

await page.locator('.tabbar__tab[data-tab="lab"]').click();
await page.waitForTimeout(1200);
await page.locator('.tabbar__tab[data-tab="camera"]').click();
await page.waitForTimeout(3000);
await vivo('sigue pintando tras pasar por Laboratorio');

// Ida y vuelta repetidas: el fallo aparecía a la primera, pero conviene que no
// se acumule nada tampoco.
for (let i = 0; i < 3; i++) {
  await page.locator('.tabbar__tab[data-tab="library"]').click();
  await page.waitForTimeout(700);
  await page.locator('.tabbar__tab[data-tab="camera"]').click();
  await page.waitForTimeout(1800);
}
await vivo('sigue pintando tras tres idas y vueltas');

console.log('\n── La aplicación pasa a segundo plano (compartir un enlace) ──');
/* Al compartir el enlace, iOS manda la aplicación al fondo: se dispara
   visibilitychange, la vista se desactiva y la cámara se cierra. Al volver
   tiene que reponerse sola. */
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(900);
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(3200);
await vivo('vuelve a pintar tras volver de segundo plano');

console.log('\n── Zoom ──');
const zoom0 = await page.evaluate(() => {
  const v = window.__lab.views.camera;
  return { zoom: v.zoom, recorte: { ...v.params.geometry.crop }, nativo: v.nativeZoomMax, max: v.zoomMax };
});
check('empieza sin acercar', zoom0.zoom === 1, 'sensor hasta ' + zoom0.nativo + '×, tope ' + zoom0.max + '×');
await page.evaluate(() => window.__lab.views.camera.setZoom(2));
await page.waitForTimeout(700);
const zoom2 = await page.evaluate(() => {
  const v = window.__lab.views.camera;
  return { zoom: v.zoom, recorte: { ...v.params.geometry.crop }, lienzo: v.canvas.width + 'x' + v.canvas.height };
});
check('a 2× el encuadre se estrecha a la mitad',
  Math.abs(zoom2.recorte.w - zoom0.recorte.w / 2) < 0.01
  && Math.abs(zoom2.recorte.h - zoom0.recorte.h / 2) < 0.01,
  `w ${zoom0.recorte.w.toFixed(3)} → ${zoom2.recorte.w.toFixed(3)}`);
check('el acercamiento queda centrado',
  Math.abs((zoom2.recorte.x + zoom2.recorte.w / 2) - 0.5) < 0.01
  && Math.abs((zoom2.recorte.y + zoom2.recorte.h / 2) - 0.5) < 0.01);
await page.evaluate(() => window.__lab.views.camera.setZoom(999));
await page.waitForTimeout(400);
const zoomTope = await page.evaluate(() => window.__lab.views.camera.zoom);
check('el zoom no se pasa de su tope', zoomTope === zoom0.max, zoomTope + '×');
await page.evaluate(() => window.__lab.views.camera.setZoom(1));
await page.waitForTimeout(500);

console.log('\n── Flash ──');
const flash = await page.evaluate(() => {
  const v = window.__lab.views.camera;
  return { modo: v.flash, linterna: v.canTorch };
});
check('empieza apagado', flash.modo === 'off', 'LED accesible: ' + flash.linterna);
const destello = await page.evaluate(async () => {
  const v = window.__lab.views.camera;
  v.setFlash('screen');
  const apagar = await v._flashOn();
  const visible = !v.screenFlash.hidden
    && getComputedStyle(v.screenFlash).backgroundColor === 'rgb(255, 255, 255)';
  apagar();
  const apagado = v.screenFlash.hidden;
  v.setFlash('off');
  return { visible, apagado };
});
check('el destello de pantalla se enciende', destello.visible);
check('y se apaga después', destello.apagado);

console.log('\n── Navegador dentro de otra aplicación ──');
/* Abrir el enlace desde WhatsApp o Instagram lo muestra en una vista web
   incrustada, que en iPhone no da acceso a la cámara por mucho que el sitio sea
   HTTPS. Sin decirlo, el fallo parece del sitio. */
const detecta = await page.evaluate(async () => {
  const { inAppBrowser } = await import('./js/views/camera.js');
  const real = navigator.userAgent;
  const probar = (ua) => {
    Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
    return inAppBrowser();
  };
  const casos = {
    instagram: probar('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Instagram 300.0'),
    facebook: probar('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 [FBAN/FBIOS]'),
    webviewGenerica: probar('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'),
    safariReal: probar('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'),
    chromeIOS: probar('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/120 Mobile/15E148 Safari/604.1'),
    escritorio: probar('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'),
  };
  Object.defineProperty(navigator, 'userAgent', { value: real, configurable: true });
  return casos;
});
check('detecta Instagram', detecta.instagram === true);
check('detecta Facebook', detecta.facebook === true);
check('detecta una vista web genérica de iOS', detecta.webviewGenerica === true);
check('NO confunde el Safari de verdad', detecta.safariReal === false);
check('NO confunde Chrome en iOS', detecta.chromeIOS === false);
check('NO confunde un navegador de escritorio', detecta.escritorio === false);

console.log('\n── Errores de consola ──');
const real = errors.filter((e) => !/favicon|vibrate/i.test(e));
check('sin errores', real.length === 0, real.slice(0, 3).join(' | '));

console.log('\nResultado: ' + (failures ? failures + ' fallo(s)' : 'todo correcto'));
await browser.close(); server.kill();
process.exit(failures ? 1 : 0);
