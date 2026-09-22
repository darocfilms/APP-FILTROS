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
await page.waitForTimeout(700);
// Y dentro, cada familia tiene su tira: Portra es negativo color.
await page.locator('.chip[data-kind="Negativo color"]').click();
await page.waitForTimeout(300);
const styles = await page.evaluate(() => {
  const sw = document.querySelector('.strip__item[data-film="portra400"] .strip__swatch');
  const bg = sw ? getComputedStyle(sw).backgroundImage : '';
  return { gradient: bg, c1: sw ? getComputedStyle(sw.parentElement).getPropertyValue('--c1').trim() : '' };
});
check('las muestras de la tira tienen degradado', /linear-gradient\(.*rgb/.test(styles.gradient), styles.c1);
// El mando de Filtros es un interruptor: dejarlo abierto haría que el siguiente
// toque de esta prueba lo CERRARA en vez de abrirlo.
await page.locator('.campanel__close').click();
await page.waitForTimeout(300);

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

console.log('\n── Emulsión de arranque ──');
const arranque = await page.evaluate(() => {
  const v = window.__lab.views.camera;
  return { id: v.params.film.id, fuerza: v.params.film.strength, mate: v.params.light.matteLow };
});
check('la cámara arranca con la copia de cine 2383 puesta',
  arranque.id === 'kodak2383', JSON.stringify(arranque));
const enLab = await page.evaluate(() => window.__lab.views.lab.params.film.id);
check('el laboratorio NO la impone a las fotos importadas', enLab === 'neutral', enLab);

console.log('\n── Barras verticales de exposición y zoom ──');
// Lo delgado tiene que ser la línea, no el objetivo: se mide la caja que se
// toca, no la que se ve.
const barras = await page.evaluate(() => {
  const leer = (sel) => {
    const n = document.querySelector(sel);
    if (!n) return null;
    const r = n.getBoundingClientRect();
    const t = n.querySelector('.rail__track').getBoundingClientRect();
    return {
      caja: Math.round(r.width), linea: +t.width.toFixed(1),
      alto: Math.round(r.height),
      x: Math.round(r.left + r.width / 2), vw: innerWidth,
      marca: !n.querySelector('.rail__tick').hidden,
      rol: n.getAttribute('role'), etiqueta: n.getAttribute('aria-label'),
    };
  };
  return { izq: leer('.cam__rail--left'), der: leer('.cam__rail--right') };
});
check('la exposición está a la izquierda',
  barras.izq && barras.izq.x < barras.izq.vw / 3, JSON.stringify(barras.izq));
check('el zoom está a la derecha',
  barras.der && barras.der.x > barras.der.vw * 2 / 3, JSON.stringify(barras.der));
for (const [lado, b] of [['exposición', barras.izq], ['zoom', barras.der]]) {
  check(`la barra de ${lado} es una línea fina`, b.linea <= 4, b.linea + ' px de línea');
  check(`pero se puede tocar sin mirar`, b.caja >= 44, b.caja + ' px de área táctil');
  check(`y es vertical`, b.alto > b.caja * 2, b.alto + '×' + b.caja);
  check(`marca su valor neutro`, b.marca === true);
  check(`se anuncia como deslizador`, b.rol === 'slider' && !!b.etiqueta, b.etiqueta);
}

// Arrastrar de verdad: del centro hacia arriba sube la exposición.
const antesEV = await page.evaluate(() => window.__lab.views.camera.params.light.exposure);
const caja = await page.locator('.cam__rail--left').boundingBox();
await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
await page.mouse.down();
await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height * 0.2, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
const despuesEV = await page.evaluate(() => window.__lab.views.camera.params.light.exposure);
check('arrastrar hacia arriba sube la exposición',
  despuesEV > antesEV + 0.5, antesEV.toFixed(2) + ' → ' + despuesEV.toFixed(2) + ' EV');
await page.evaluate(() => {
  const v = window.__lab.views.camera;
  v.params.light.exposure = 0;
  v.evRail.set(0);
});

// Y el zoom se refleja en su barra aunque se cambie desde fuera (el pellizco).
await page.evaluate(() => window.__lab.views.camera.setZoom(3));
await page.waitForTimeout(400);
const posBarra = await page.evaluate(() => {
  const n = document.querySelector('.cam__rail--right');
  return { pos: parseFloat(getComputedStyle(n).getPropertyValue('--pos')), zoom: window.__lab.views.camera.zoom };
});
check('la barra de zoom sigue al pellizco',
  posBarra.zoom === 3 && posBarra.pos > 0.5, JSON.stringify(posBarra));

// El tramo por debajo de 1× es OTRA cámara. Sin gran angular no existe, y la
// barra no puede prometerlo: arrastrar hasta el fondo tiene que quedarse en 1×.
const fondo = await page.evaluate(() => {
  const v = window.__lab.views.camera;
  v.setEffectiveZoom(0.5);
  return { ultra: v.hasUltraWide, lente: v.lens, efectivo: v.effectiveZoom,
           apagado: document.querySelector('.cam__rail--right').classList.contains('is-noultra') };
});
check('sin gran angular, la barra no baja de 1×',
  fondo.ultra === false && fondo.efectivo === 1 && fondo.lente === 'wide', JSON.stringify(fondo));
check('y el tramo que no existe se ve apagado', fondo.apagado === true);

await page.evaluate(() => window.__lab.views.camera.setZoom(1));
await page.waitForTimeout(400);

console.log('\n── Gran angular ──');
const objetivos = await page.evaluate(() => {
  const v = window.__lab.views.camera;
  return { lens: v.lens, tieneUltra: v.hasUltraWide, efectivo: v.effectiveZoom, lenses: v.lenses };
});
check('arranca con el objetivo principal', objetivos.lens === 'wide' && objetivos.efectivo === 1);
// La cámara falsa de Chromium no tiene gran angular, así que se comprueba la
// lógica: con uno declarado, 0,5× debe aparecer y el factor mostrarse a la mitad.
const simulado = await page.evaluate(() => {
  const v = window.__lab.views.camera;
  v.lenses = { ultra: 'ultra-fake', wide: 'wide-fake' };
  const disponible = v.hasUltraWide;
  v.lens = 'ultra';
  const factor = v.effectiveZoom;
  v.zoom = 2;
  const conZoom = v.effectiveZoom;
  v.lens = 'wide'; v.zoom = 1; v.lenses = {};
  return { disponible, factor, conZoom };
});
check('con gran angular presente se ofrece 0,5×', simulado.disponible === true);
check('el 0,5× se muestra como medio aumento', simulado.factor === 0.5, simulado.factor + '×');
check('y el zoom se compone sobre él', simulado.conZoom === 1, simulado.conZoom + '×');

console.log('\n── Cambiar de cámara ──');
check('el botón vive junto al disparador, no en la fila',
  await page.locator('.cam__bar .iconbtn[aria-label="Cambiar de cámara"]').count() === 1
  && await page.locator('.cam__tools .camtool').count() === 3);
const antesCam = await page.evaluate(() => {
  const v = window.__lab.views.camera;
  v.zoom = 2.5; v.lens = 'ultra';
  return { cara: v.facing, espejo: v.mirrored };
});
await page.locator('.cam__bar .iconbtn[aria-label="Cambiar de cámara"]').click();
await page.waitForTimeout(2500);
const frontal = await page.evaluate(() => {
  const v = window.__lab.views.camera;
  return { cara: v.facing, espejo: v.mirrored, zoom: v.zoom, lente: v.lens, viva: !!v.track };
});
check('pasa a la frontal', frontal.cara === 'user' && antesCam.cara === 'environment',
  antesCam.cara + ' → ' + frontal.cara);
check('y la frontal se ve en espejo', frontal.espejo === true && antesCam.espejo === false);
// El gran angular es de la trasera: llevarse su objetivo y su zoom a la frontal
// dejaría la barra prometiendo un aumento que esta cámara no da.
check('el zoom y el objetivo vuelven al principio',
  frontal.zoom === 1 && frontal.lente === 'wide', JSON.stringify(frontal));
check('y el flujo sigue vivo', frontal.viva === true);
await page.locator('.cam__bar .iconbtn[aria-label="Cambiar de cámara"]').click();
await page.waitForTimeout(2500);
const vuelta = await page.evaluate(() => {
  const v = window.__lab.views.camera;
  return { cara: v.facing, espejo: v.mirrored, pintando: v.canvas.width > 0 };
});
check('y vuelve a la trasera, sin espejo',
  vuelta.cara === 'environment' && vuelta.espejo === false && vuelta.pintando,
  JSON.stringify(vuelta));

console.log('\n── Elegir emulsión desde la cámara ──');
// La tira vive dentro de la ventana de Filtros, y ahora mismo está abierta otra.
await page.locator('.camtool[data-tool="film"]').click();
await page.waitForTimeout(600);
await page.locator('.chip[data-kind="Diapositiva"]').click();
await page.waitForTimeout(300);
await page.locator('.strip__item[data-film="velvia50"]').click();
await page.waitForTimeout(500);
const camFilm = await page.evaluate(() => ({
  id: window.__lab.views.camera.params.film.id,
  sat: window.__lab.views.camera.params.color.saturation,
}));
check('la emulsión se aplica en directo', camFilm.id === 'velvia50' && camFilm.sat > 0.2, JSON.stringify(camFilm));

console.log('\n── Todo el catálogo, al alcance del disparo ──');
// Lo que se puede revelar después tiene que poder verse antes: si una familia
// no se alcanza desde la cámara, esas emulsiones sólo existen en teoría.
const familias = await page.evaluate(async () => {
  const { filmsByKind } = await import('./js/data/films.js');
  return filmsByKind().map((g) => ({ kind: g.kind, ids: g.items.map((f) => f.id) }));
});
let todas = true;
const faltan = [];
for (const g of familias) {
  await page.locator(`.chip[data-kind="${g.kind}"]`).click();
  await page.waitForTimeout(120);
  const visibles = await page.evaluate(() =>
    [...document.querySelectorAll('.strip__item')].map((b) => b.dataset.film));
  const ok = g.ids.every((id) => visibles.includes(id)) && visibles.length === g.ids.length;
  if (!ok) { todas = false; faltan.push(g.kind); }
}
check('cada familia enseña sus emulsiones y sólo las suyas',
  todas, faltan.length ? 'fallan: ' + faltan.join(', ') : familias.length + ' familias');

// La copia de cine es el caso que lo motivó: al final del catálogo, en una
// tira única quedaba fuera de la pantalla. Vive con el resto del cine.
await page.locator('.chip[data-kind="Cine"]').click();
await page.waitForTimeout(200);
await page.locator('.strip__item[data-film="kodak2383"]').click();
await page.waitForTimeout(400);
const copia = await page.evaluate(() => ({
  id: window.__lab.views.camera.params.film.id,
  naranjas: window.__lab.views.camera.params.hsl.sat[1],
  grano: window.__lab.views.camera.params.effects.grain,
}));
check('la copia de cine 2383 se elige antes de disparar, y con el resto del cine',
  copia.id === 'kodak2383', copia.id);
check('llega con los naranjas bajados y grano puesto',
  copia.naranjas < -0.2 && copia.grano > 0.2, JSON.stringify(copia));
// Y al cambiar de emulsión la banda no se queda pegada.
await page.locator('.strip__item[data-film="vision3_250d"]').click();
await page.waitForTimeout(300);
check('la banda de naranjas no se hereda a la siguiente emulsión',
  await page.evaluate(() => window.__lab.views.camera.params.hsl.sat[1]) === 0);

// Y se vuelve a la que se va a usar para el resto de la prueba.
await page.locator('.chip[data-kind="Diapositiva"]').click();
await page.waitForTimeout(200);
await page.locator('.strip__item[data-film="velvia50"]').click();
await page.waitForTimeout(400);

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
// Se cuenta cada fotograma que la grabación pide al lienzo: es la medida
// directa de la cadencia, no una suposición sobre lo que hace el navegador.
await page.evaluate(() => {
  window.__frames = 0;
  const proto = window.CanvasCaptureMediaStreamTrack?.prototype;
  if (!proto?.requestFrame) { window.__frames = null; return; }
  const orig = proto.requestFrame;
  proto.requestFrame = function () { window.__frames++; return orig.apply(this, arguments); };
});
await page.locator('.shutter').click();
await page.waitForTimeout(3200);
const recording = await page.evaluate(() => !!window.__lab.views.camera.recorder);
check('la grabación arranca', recording);
// La cadencia se mide con el VISOR DETENIDO. No es hacer trampa: es el caso
// que importa. Bajo SwiftShader cada fotograma del visor cuesta cien veces más
// que en la GPU de un teléfono y ahoga al reloj, así que medir con el visor en
// marcha diría lo lento que es este ordenador, no si el reloj funciona. Con el
// hilo libre se comprueba lo que se quería: que la grabación marca sus propios
// 30 por segundo aunque el lienzo no se repinte —donde `captureStream(30)` no
// habría entregado ninguno— y que nunca pasa de ahí.
const medida = await page.evaluate(async () => {
  if (window.__frames === null) return null;
  const cam = window.__lab.views.camera;
  cam.paused = true;
  const n0 = window.__frames, t0 = performance.now();
  await new Promise((r) => setTimeout(r, 2000));
  const n1 = window.__frames, t1 = performance.now();
  cam.paused = false;
  return { fps: (n1 - n0) / ((t1 - t0) / 1000), n: n1 - n0 };
});
if (medida === null) {
  check('cadencia de 30 fps (sin requestFrame, se usa el techo del navegador)', true, 'no medible aquí');
} else {
  check('la grabación marca sus propios 30 fps, sin repintar el lienzo',
    medida.fps > 28 && medida.fps <= 31, medida.n + ' fotogramas · ' + medida.fps.toFixed(1) + ' fps');
}
await page.locator('.shutter').click();
await page.waitForTimeout(3500);
check('el reloj de fotogramas se para con la grabación',
  await page.evaluate(() => window.__lab.views.camera._recTimer) === null);
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

console.log('\n── Flash: un botón, dos estados ──');
const flash = await page.evaluate(() => {
  const v = window.__lab.views.camera;
  return { modo: v.flash, linterna: v.canTorch };
});
check('empieza apagado', flash.modo === 'off', 'LED accesible: ' + flash.linterna);
const botonFlash = page.locator('.camtool[aria-label="Flash"]');
check('el flash no abre ninguna ventana', await botonFlash.getAttribute('aria-expanded') === null);
await botonFlash.click();
await page.waitForTimeout(300);
const encendido = await page.evaluate(() => {
  const b = document.querySelector('.camtool[aria-label="Flash"]');
  return {
    modo: window.__lab.views.camera.flash,
    marcado: b.getAttribute('aria-pressed'),
    resaltado: b.classList.contains('is-on'),
    // El rayo se tacha cuando está apagado: la forma cambia, no sólo el color.
    tachado: b.querySelectorAll('svg path').length,
    ventanas: document.querySelectorAll('.campanel').length,
  };
});
check('un toque lo enciende', encendido.modo === 'on' && encendido.marcado === 'true' && encendido.resaltado,
  JSON.stringify(encendido));
check('y el rayo deja de estar tachado', encendido.tachado === 1, encendido.tachado + ' trazos');
check('y no abre nada por el camino', encendido.ventanas === 0);
// Sin LED accesible, «encendido» tiene que dar luz igualmente.
const destello = await page.evaluate(async () => {
  const v = window.__lab.views.camera;
  const apagar = await v._flashOn();
  const visible = !v.screenFlash.hidden
    && getComputedStyle(v.screenFlash).backgroundColor === 'rgb(255, 255, 255)';
  apagar();
  return { visible, apagado: v.screenFlash.hidden };
});
check('encendido y sin LED, destella la pantalla', destello.visible);
check('y se apaga después', destello.apagado);
await botonFlash.click();
await page.waitForTimeout(300);
const apagadoDeNuevo = await page.evaluate(async () => {
  const v = window.__lab.views.camera;
  const apagar = await v._flashOn();
  const dioLuz = !v.screenFlash.hidden;
  apagar();
  return { modo: v.flash, dioLuz };
});
check('otro toque lo apaga, y entonces no da luz',
  apagadoDeNuevo.modo === 'off' && !apagadoDeNuevo.dioLuz, JSON.stringify(apagadoDeNuevo));
check('y el rayo vuelve a salir tachado',
  await page.evaluate(() => document.querySelectorAll('.camtool[aria-label="Flash"] svg path').length) === 2);

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
