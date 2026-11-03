#!/usr/bin/env node
/**
 * save.mjs — Guardar fuera de la aplicación, y selección múltiple.
 *
 * Guardar en iPhone falla de formas silenciosas: `navigator.share` exige
 * activación del usuario y esa activación CADUCA, así que revelar una foto de
 * doce megapíxeles entre el toque y la llamada la invalida. Y el atributo
 * `download` de un enlace, que sería la reserva evidente, Safari lo ignora
 * cuando el destino es un blob. Esta suite fija las dos cosas.
 */
import pw from 'playwright';
const { chromium } = pw;
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SHOT = process.env.SHOT_DIR || ROOT + 'test/capturas';
const BASE = 'http://localhost:8084';

fs.mkdirSync(SHOT, { recursive: true });
const server = spawn('node', [path.join(ROOT, 'serve.mjs'), '--port=8084'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));

let failures = 0;
const errors = [];
const check = (n, ok, d = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + n + (d ? '  ' + d : ''));
  if (!ok) failures++;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
         '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  permissions: ['camera', 'microphone'],
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

/* Se simula la hoja de compartir y se registra CUÁNDO se llama, para poder
   comprobar que ocurre dentro del gesto y no después de trabajo asíncrono. */
await page.addInitScript(() => {
  // Safari en iPhone: la web no puede escribir en Fotos y lo más directo es la
  // hoja de compartir. Es el caso difícil, el de la activación que caduca.
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'iPhone', configurable: true });
  window.__shareLog = [];
  navigator.canShare = (d) => !!(d && d.files && d.files.length);
  navigator.share = async (d) => {
    window.__shareLog.push({
      archivos: d.files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
      activo: navigator.userActivation ? navigator.userActivation.isActive : null,
    });
  };
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

console.log('\n── Importar tres archivos ──');
const files = [];
for (let i = 0; i < 3; i++) {
  const p = SHOT + `/save-${i}.jpg`;
  const dataUrl = await page.evaluate((n) => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 1200;
    const g = c.getContext('2d');
    g.fillStyle = ['#2c5f9e', '#9e5f2c', '#2c9e5f'][n];
    g.fillRect(0, 0, 900, 1200);
    g.fillStyle = '#fff'; g.font = 'bold 300px sans-serif';
    g.fillText(String(n + 1), 340, 750);
    return c.toDataURL('image/jpeg', 0.9);
  }, i);
  fs.writeFileSync(p, Buffer.from(dataUrl.split(',')[1], 'base64'));
  files.push(p);
}
await page.setInputFiles('input[type=file]', files);
// Varios archivos a la vez van al menú de importación, todos marcados.
await page.waitForSelector('.imp:not([hidden]) .imp__item');
await page.locator('.imp__acciones .btn--primary').click();
await page.waitForSelector('.imp', { state: 'hidden', timeout: 30_000 });
await page.waitForTimeout(800);
await page.locator('.tabbar__tab[data-tab="library"]').click();
await page.waitForTimeout(1500);
check('los tres archivos están en la biblioteca',
  await page.locator('.tile').count() === 3, (await page.locator('.tile').count()) + ' miniaturas');

console.log('\n── Visor a pantalla completa ──');
await page.locator('.tile').first().click();
await page.waitForFunction(() => !!document.querySelector('.viewer__media'), null, { timeout: 20_000 });
await page.waitForTimeout(500);
const visor = await page.evaluate(() => {
  const v = document.querySelector('.viewer');
  const m = document.querySelector('.viewer__media');
  const r = m.getBoundingClientRect();
  return {
    abierto: !v.hidden,
    fondo: getComputedStyle(v).backgroundColor,
    ocupaAncho: Math.round(r.width) >= innerWidth - 2 || Math.round(r.height) >= innerHeight - 2,
    editar: !!document.querySelector('.viewer__action'),
    acciones: [...document.querySelectorAll('.viewer__action')].map((b) => b.textContent.replace(/[^\wÁÉÍÓÚáéíóúñ]/g, '')),
    contador: document.querySelector('.viewer__counter').textContent,
  };
});
check('el visor se abre a pantalla completa', visor.abierto && visor.ocupaAncho);
check('sobre negro, sin nada más', visor.fondo === 'rgb(0, 0, 0)', visor.fondo);
check('con los tres botones justos', visor.acciones.length === 3, visor.acciones.join(' · '));
check('y borrar está entre ellos', visor.acciones.includes('Borrar'), visor.acciones.join(' · '));
check('y dice por cuál vas', /1 \/ 3/.test(visor.contador), visor.contador);
await page.screenshot({ path: SHOT + '/visor.png' });

// Un toque limpia la pantalla; otro devuelve los mandos.
await page.locator('.viewer__stage').click({ position: { x: 195, y: 400 } });
await page.waitForTimeout(400);
check('tocar deja la foto sin nada encima',
  await page.evaluate(() => getComputedStyle(document.querySelector('.viewer__bottom')).opacity) === '0');
await page.locator('.viewer__stage').click({ position: { x: 195, y: 400 } });
await page.waitForTimeout(400);
check('y otro toque los devuelve',
  await page.evaluate(() => getComputedStyle(document.querySelector('.viewer__bottom')).opacity) === '1');

// Pasar de una foto a otra deslizando.
const antes = await page.evaluate(() => document.querySelector('.viewer__counter').textContent);
await page.evaluate(() => window.__lab.views.library.viewer.go(1));
await page.waitForTimeout(900);
const despues = await page.evaluate(() => document.querySelector('.viewer__counter').textContent);
check('se pasa de una foto a otra', antes !== despues, antes + ' → ' + despues);

// El botón de laboratorio lleva allí con la foto abierta.
await page.locator('.viewer__action').first().click();
await page.waitForFunction(() => !!window.__lab?.views?.lab?.proxy, null, { timeout: 60_000 });
await page.waitForTimeout(600);
check('el botón de laboratorio abre esa misma foto',
  await page.evaluate(() => window.__lab.current === 'lab' && !!window.__lab.views.lab.item));
check('y el visor se cierra al salir',
  await page.evaluate(() => document.querySelector('.viewer').hidden === true));

console.log('\n── Antes / después en el laboratorio ──');
const compara = async () => page.evaluate(() => ({
  activo: window.__lab.views.lab.comparing,
  fijado: window.__lab.views.lab.compareLocked,
  etiqueta: !document.querySelector('.lab__comparetag').hidden,
}));
await page.locator('.iconbtn[aria-label="Ver el antes"]').click();
await page.waitForTimeout(500);
const conAntes = await compara();
check('el botón fija el antes', conAntes.activo && conAntes.fijado);
check('y se ve una etiqueta que lo dice', conAntes.etiqueta);
await page.locator('.iconbtn[aria-label="Ver el antes"]').click();
await page.waitForTimeout(500);
const sinAntes = await compara();
check('volver a tocarlo devuelve el después', !sinAntes.activo && !sinAntes.etiqueta);

await page.locator('.tabbar__tab[data-tab="library"]').click();
await page.waitForTimeout(1000);

console.log('\n── Selección múltiple ──');
await page.locator('.lib__baractions .btn', { hasText: 'Seleccionar' }).click();
await page.waitForTimeout(400);
check('la barra de selección aparece', await page.locator('.selbar:not([hidden])').count() === 1);
check('las acciones empiezan desactivadas',
  await page.locator('.selbar__actions .btn:not([disabled])').count() === 0);

const tiles = page.locator('.tile');
await tiles.nth(0).click();
await tiles.nth(2).click();
await page.waitForTimeout(400);
check('se marcan los elegidos', await page.locator('.tile.is-selected').count() === 2);
check('el contador refleja la selección',
  (await page.locator('.selbar__count').textContent()).includes('2'),
  await page.locator('.selbar__count').textContent());
// «Pegar ajustes» sigue apagado mientras no se haya copiado nada.
check('las acciones se habilitan',
  await page.locator('.selbar__actions .btn', { hasText: 'Guardar' }).isEnabled()
    && await page.locator('.selbar__actions .btn', { hasText: 'Eliminar' }).isEnabled()
    && await page.locator('.selbar__actions .btn', { hasText: 'Pegar ajustes' }).isDisabled());
await page.screenshot({ path: SHOT + '/save-seleccion.png' });

await page.locator('.linkbtn', { hasText: 'Todo' }).click();
await page.waitForTimeout(400);
check('«Todo» selecciona los tres', await page.locator('.tile.is-selected').count() === 3);
await page.locator('.linkbtn', { hasText: 'Ninguno' }).click();
await page.waitForTimeout(300);
check('«Ninguno» limpia la selección', await page.locator('.tile.is-selected').count() === 0);

console.log('\n── Compartir varios a la vez ──');
await tiles.nth(0).click();
await tiles.nth(1).click();
await page.waitForTimeout(300);
await page.locator('.selbar__actions .btn', { hasText: 'Guardar' }).click();
// Un toque: se preparan y se abre la hoja de iOS en el acto, sin hoja propia.
await page.waitForFunction(() => window.__shareLog.length === 1, null, { timeout: 20_000 });
await page.waitForTimeout(300);
check('un toque y van directos, sin una hoja intermedia',
  await page.locator('.sheet-backdrop').count() === 0);
const log = await page.evaluate(() => window.__shareLog);
check('se comparten los dos archivos', log.length === 1 && log[0].archivos.length === 2,
  JSON.stringify(log[0]?.archivos?.map((f) => f.name)));
check('la llamada ocurre con la activación del usuario viva',
  log[0] && log[0].activo !== false,
  'userActivation.isActive = ' + log[0]?.activo);
check('los archivos llevan nombre y contenido',
  log[0]?.archivos?.every((f) => f.size > 1000 && /\.jpg$/.test(f.name)));
const nombres = log[0]?.archivos?.map((f) => f.name) || [];
check('cada archivo tiene un nombre distinto',
  new Set(nombres).size === nombres.length, nombres.join(', '));

console.log('\n── Exportar del laboratorio conserva la activación ──');
await page.evaluate(() => { window.__shareLog.length = 0; });
await page.locator('.lib__baractions .btn', { hasText: 'Hecho' }).click();
await page.waitForTimeout(300);
// Tocar una miniatura abre el VISOR; al laboratorio se llega desde su botón.
await page.locator('.tile').first().click();
await page.waitForFunction(() => !!document.querySelector('.viewer__media'), null, { timeout: 20_000 });
await page.locator('.viewer__action').first().click();
await page.waitForFunction(() => window.__lab.current === 'lab' && !!window.__lab.views.lab.proxy,
  null, { timeout: 60_000 });
await page.waitForTimeout(800);
await page.locator('.lab__export').click();
await page.waitForTimeout(600);
await page.locator('.sheet .btn--primary', { hasText: 'Guardar en el dispositivo' }).click();
// El revelado a resolución completa tarda lo suyo bajo SwiftShader. Si acaba
// con el toque aún vigente, la hoja de iOS se abre en el acto; si lo ha
// agotado, aparece la hoja propia que pide otro. Nunca se comparte sin él.
await page.waitForFunction(
  () => window.__shareLog.length > 0 || document.querySelector('.sheet__title')?.textContent?.includes('Listo para guardar'),
  null, { timeout: 90_000 });
await page.waitForTimeout(300);
const directo = await page.evaluate(() => window.__shareLog.length);
if (!directo) {
  await page.locator('.sheet .btn--primary').click();
  await page.waitForTimeout(900);
}
const log2 = await page.evaluate(() => window.__shareLog);
check('exportar comparte una vez, siempre con la activación viva',
  log2.length === 1 && log2[0].activo !== false,
  (directo ? 'directo' : 'con la hoja de reserva') + ' · activo=' + log2[0]?.activo);

console.log('\n── Reserva cuando no hay hoja del sistema ──');
const fallback = await page.evaluate(async () => {
  const { saveFiles } = await import('./js/utils/share.js');
  const share = navigator.share, canShare = navigator.canShare;
  navigator.canShare = () => false;
  navigator.share = undefined;
  const c = document.createElement('canvas'); c.width = c.height = 40;
  c.getContext('2d').fillRect(0, 0, 40, 40);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg'));
  const result = await saveFiles([blob], ['prueba.jpg']);
  navigator.share = share; navigator.canShare = canShare;
  const overlay = document.querySelector('.longpress');
  const info = { result, overlay: !!overlay, tieneImagen: !!overlay?.querySelector('img') };
  overlay?.remove();
  return info;
});
check('sin hoja del sistema hay una salida y no un callejón',
  fallback.result === 'downloaded' || (fallback.result === 'longpress' && fallback.tieneImagen),
  JSON.stringify(fallback));

console.log('\n── Guardar manteniendo pulsado (reserva de iPhone) ──');
const longpress = await page.evaluate(async () => {
  const { showLongPressSave } = await import('./js/utils/share.js');
  const c = document.createElement('canvas'); c.width = c.height = 40;
  c.getContext('2d').fillStyle = '#c33'; c.getContext('2d').fillRect(0, 0, 40, 40);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg'));
  const overlay = showLongPressSave(blob, 'prueba.jpg');
  const img = overlay.querySelector('img');
  const info = {
    visible: getComputedStyle(overlay).display !== 'none',
    tieneImagen: !!img && img.src.startsWith('blob:'),

    texto: overlay.querySelector('.longpress__hint').textContent,
  };
  overlay.remove();
  return info;
});
check('la ventana de reserva muestra la imagen', longpress.visible && longpress.tieneImagen);
// `-webkit-touch-callout` es propiedad de WebKit y Chromium la descarta del
// CSSOM, así que no hay forma de observarla desde aquí. Se comprueba sobre la
// hoja SERVIDA, que es exactamente lo que recibirá Safari.
const css = await (await fetch(BASE + '/styles/app.css')).text();
check('la hoja servida declara el menú de mantener pulsado de iOS',
  /\.longpress__media\s*\{[^}]*-webkit-touch-callout:\s*default/.test(css));
check('nada global lo anula',
  !/(^|\})\s*(html|body|\*)[^{]*\{[^}]*(-webkit-touch-callout:\s*none|user-select:\s*none)/.test(css));
check('explica qué hacer', /pulsada/.test(longpress.texto), longpress.texto);

console.log('\n── Borrar desde el visor ──');
await page.locator('.tabbar__tab[data-tab="library"]').click();
await page.waitForTimeout(1000);
const habia = await page.locator('.tile').count();
await page.locator('.tile').first().click();
await page.waitForFunction(() => !!document.querySelector('.viewer__media'), null, { timeout: 20_000 });
await page.waitForTimeout(400);
const borrando = await page.evaluate(() => window.__lab.views.library.viewer.current.id);

await page.locator('.viewer__action--danger').click();
await page.waitForSelector('.sheet--dialog', { timeout: 10_000 });
check('borrar pregunta antes, que no se deshace',
  /Eliminar|eliminar/.test(await page.locator('.sheet__message').textContent()),
  await page.locator('.sheet__message').textContent());
// Cancelar no borra nada.
await page.locator('.sheet--dialog .btn', { hasText: 'Cancelar' }).click();
await page.waitForTimeout(500);
check('cancelar deja la foto donde estaba',
  await page.evaluate(async () => {
    const { library } = await import('./js/store/library.js');
    return (await library.list()).length;
  }) === habia);

await page.locator('.viewer__action--danger').click();
await page.waitForSelector('.sheet--dialog', { timeout: 10_000 });
await page.locator('.sheet--dialog .btn--danger').click();
await page.waitForFunction((n) => document.querySelectorAll('.tile').length === n - 1,
  habia, { timeout: 20_000 });
const quedan = await page.evaluate(async () => {
  const { library } = await import('./js/store/library.js');
  const items = await library.list();
  return { n: items.length, ids: items.map((i) => i.id) };
});
check('confirmar la quita de la carpeta local',
  quedan.n === habia - 1 && !quedan.ids.includes(borrando), `${habia} → ${quedan.n}`);
// Y el visor sigue mirando: pasa a la siguiente en vez de devolver a la rejilla.
const siguiendo = await page.evaluate(() => {
  const v = window.__lab.views.library.viewer;
  return { abierto: !v.root.hidden, restantes: v.items.length, actual: v.current?.id || null };
});
check('el visor sigue con la siguiente foto',
  siguiendo.abierto && siguiendo.restantes === habia - 1 && siguiendo.actual !== borrando,
  JSON.stringify(siguiendo));
await page.screenshot({ path: SHOT + '/visor-borrar.png' });
await page.evaluate(() => window.__lab.views.library.viewer.close());
await page.waitForTimeout(300);

console.log('\n── Guardar en un toque desde el visor ──');
await page.evaluate(() => { window.__shareLog.length = 0; });
await page.locator('.tile').first().click();
await page.waitForFunction(() => !!document.querySelector('.viewer__media'), null, { timeout: 20_000 });
await page.waitForTimeout(400);
await page.locator('.viewer__action--guardar').click();
await page.waitForFunction(() => window.__shareLog.length === 1, null, { timeout: 20_000 });
await page.waitForTimeout(400);
const unToque = await page.evaluate(() => ({
  log: window.__shareLog[0],
  hojas: document.querySelectorAll('.sheet-backdrop').length,
  visor: !document.querySelector('.viewer').hidden,
}));
check('«Guardar» abre la hoja de iOS en el acto, sin menús propios',
  unToque.hojas === 0 && unToque.log?.archivos?.length === 1 && unToque.log.activo !== false, JSON.stringify(unToque.log));
check('y el visor sigue abierto', unToque.visor);

console.log('\n── Ajustes: guardar directamente en la galería ──');
await page.evaluate(() => window.__lab.views.library.viewer.close());
await page.waitForTimeout(300);
await page.locator('.lib__ajustes').click();
await page.waitForSelector('.sheet--ajustes');
await page.waitForTimeout(300);
const ajustes = await page.evaluate(() => {
  const h = document.querySelector('.sheet--ajustes');
  const i = h.querySelector('input[data-ajuste="guardarEnGaleria"]');
  return { titulo: h.querySelector('.sheet__title').textContent, activado: i?.checked, rol: i?.getAttribute('role'),
           texto: h.textContent, formato: h.querySelector('.ajuste__opcion.is-active')?.dataset.formato };
});
check('la rueda de la biblioteca abre los Ajustes', ajustes.titulo === 'Ajustes');
check('«Guardar directamente en la galería» viene activado de fábrica',
  ajustes.activado === true && ajustes.rol === 'switch' && /Guardar directamente en la galería/.test(ajustes.texto));
check('el formato de la cámara está ahí, en JPEG de fábrica', ajustes.formato === 'jpeg');
await page.screenshot({ path: SHOT + '/ajustes.png' });
// Apagado, «Guardar» vuelve a la hoja que deja elegir.
await page.locator('.sheet--ajustes .interruptor').click();
await page.waitForTimeout(200);
check('apagarlo se recuerda',
  await page.evaluate(() => JSON.parse(localStorage.getItem('lab.ajustes.v1')).guardarEnGaleria) === false);
await page.locator('.sheet--ajustes .btn--primary', { hasText: 'Hecho' }).click();
await page.waitForTimeout(400);
await page.evaluate(() => { window.__shareLog.length = 0; });
await page.locator('.tile').first().click();
await page.waitForFunction(() => !!document.querySelector('.viewer__media'), null, { timeout: 20_000 });
await page.locator('.viewer__action--guardar').click();
await page.waitForFunction(() => document.querySelector('.sheet__title')?.textContent?.includes('Listo para guardar'), null, { timeout: 20_000 });
check('apagado, «Guardar» ofrece la hoja de siempre y no comparte solo',
  await page.evaluate(() => window.__shareLog.length) === 0);
await page.locator('.sheet .btn', { hasText: 'Cancelar' }).click();
await page.waitForTimeout(400);
await page.evaluate(async () => {
  const { ajustes } = await import('./js/store/ajustes.js');
  ajustes.set('guardarEnGaleria', true);
  window.__lab.views.library.viewer.close();
});
await page.waitForTimeout(300);

console.log('\n── En la app nativa: directo a Fotos ──');
// Un iPhone con la app: el puente de Capacitor con el plugin de la galería.
const nativa = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  permissions: ['camera', 'microphone'],
});
await nativa.addInitScript(() => {
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'iPhone', configurable: true });
  window.__fotos = [];
  window.__shareLog = [];
  navigator.canShare = () => true;
  navigator.share = async () => { window.__shareLog.push(1); };
  const Media = {
    savePhoto: async (o) => { window.__fotos.push({ tipo: 'foto', ruta: o.path.slice(0, 30), largo: o.path.length, album: o.albumIdentifier || null }); return { identifier: 'x' }; },
    saveVideo: async (o) => { window.__fotos.push({ tipo: 'video', ruta: o.path.slice(0, 30), largo: o.path.length }); return { identifier: 'y' }; },
  };
  window.Capacitor = {
    isNativePlatform: () => true, getPlatform: () => 'ios',
    isPluginAvailable: (n) => n === 'Media', Plugins: { Media },
  };
});
const pn = await nativa.newPage();
pn.on('pageerror', (e) => errors.push('nativa: ' + e.message));
await pn.goto(BASE, { waitUntil: 'networkidle' });
await pn.waitForTimeout(3000);
check('la app ve la galería', await pn.evaluate(async () => (await import('./js/utils/galeria.js')).galeriaNativa()));
// Una foto con la cámara: se copia sola a Fotos.
await pn.locator('.shutter').click();
await pn.waitForFunction(() => window.__fotos.length === 1, null, { timeout: 90_000 });
const copia = await pn.evaluate(() => window.__fotos[0]);
check('cada foto de la cámara se copia sola a Fotos',
  copia.tipo === 'foto' && copia.ruta.startsWith('data:image/jpeg;base64,') && copia.largo > 10_000, JSON.stringify(copia));
check('sin álbum en iOS (permiso de sólo añadir)', copia.album === null);
await pn.waitForTimeout(500);
check('y lo dice', /en Fotos/.test(await pn.evaluate(() => document.getElementById('toast')?.textContent || '')),
  await pn.evaluate(() => document.getElementById('toast')?.textContent || ''));
// Desde la biblioteca, «Guardar» es un toque: ni hoja propia ni la de iOS.
await pn.locator('.tabbar__tab[data-tab="library"]').click();
await pn.waitForTimeout(1200);
await pn.locator('.tile').first().click();
await pn.waitForFunction(() => !!document.querySelector('.viewer__media'), null, { timeout: 20_000 });
await pn.locator('.viewer__action--guardar').click();
await pn.waitForFunction(() => window.__fotos.length === 2, null, { timeout: 20_000 });
await pn.waitForTimeout(400);
const nativo = await pn.evaluate(() => ({
  hojas: document.querySelectorAll('.sheet-backdrop').length, compartir: window.__shareLog.length,
  aviso: document.getElementById('toast')?.textContent, visor: !document.querySelector('.viewer').hidden,
}));
check('«Guardar» la manda a Fotos sin ninguna hoja', nativo.hojas === 0 && nativo.compartir === 0, JSON.stringify(nativo));
check('avisa y deja el visor abierto', /Guardada en Fotos/.test(nativo.aviso) && nativo.visor, nativo.aviso);
// Si el permiso se deniega, se dice cómo darlo.
const denegado = await pn.evaluate(async () => {
  window.Capacitor.Plugins.Media.savePhoto = async () => { throw new Error('Access to photos not allowed by user'); };
  const r = await window.__lab.guardar([new Blob([new Uint8Array(100)], { type: 'image/jpeg' })], ['a.jpg']);
  return { r, aviso: document.getElementById('toast')?.textContent };
});
check('sin permiso, explica dónde activarlo', denegado.r === 'error' && /Ajustes → Laboratorio → Fotos/.test(denegado.aviso), denegado.aviso);
await nativa.close();

console.log('\n── En el ordenador: descarga directa ──');
const escritorio = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
const pd = await escritorio.newPage();
pd.on('pageerror', (e) => errors.push('escritorio: ' + e.message));
await pd.goto(BASE, { waitUntil: 'networkidle' });
await pd.waitForTimeout(1500);
const [descarga] = await Promise.all([
  pd.waitForEvent('download', { timeout: 15_000 }),
  pd.evaluate(() => window.__lab.guardar([new Blob([new Uint8Array(2000)], { type: 'image/jpeg' })], ['foto.jpg'])),
]);
check('«Guardar» descarga el archivo sin preguntar',
  descarga.suggestedFilename() === 'foto.jpg' && await pd.locator('.sheet-backdrop').count() === 0, descarga.suggestedFilename());
await escritorio.close();

console.log('\n── Errores de consola ──');
const real = errors.filter((e) => !/favicon|vibrate/i.test(e));
check('sin errores', real.length === 0, real.slice(0, 3).join(' | '));

console.log(failures ? `\n${failures} fallo(s)\n` : '\nGuardar funciona.\n');
await browser.close();
server.kill();
process.exit(failures ? 1 : 0);
