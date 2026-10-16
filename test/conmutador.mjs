#!/usr/bin/env node
/**
 * conmutador.mjs — El diseño de Fotos y los gestos para cambiar de sección.
 *
 * Los gestos se hacen con el ratón de Playwright (eventos de puntero, como un
 * dedo sobre la cápsula) y los de dos dedos con toques de verdad por CDP. Lo
 * que se mide es lo que se ve: que la vista de al lado entre mientras se
 * arrastra, que las tres secciones se conviertan en tarjetas más pequeñas que
 * la pantalla, que al soltar se llegue a la sección elegida y que no quede
 * ningún estilo del gesto pegado a las vistas.
 */
import pw from 'playwright';
const { chromium } = pw;
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SHOT = process.env.SHOT_DIR || ROOT + 'test/capturas';
fs.mkdirSync(SHOT, { recursive: true });
const PORT = 8112;
const BASE = `http://localhost:${PORT}`;

let failures = 0;
const errors = [];
const check = (n, ok, d = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + n + (d ? '  ' + d : ''));
  if (!ok) failures++;
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('node', [path.join(ROOT, 'serve.mjs'), `--port=${PORT}`], { cwd: ROOT, stdio: 'ignore' });
await esperar(900);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});

try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    serviceWorkers: 'block', permissions: ['camera', 'microphone'],
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', (r) => errors.push('petición fallida: ' + r.url().slice(0, 60)));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // Ocho fotos de colores; una de hace dos meses, para que haya dos meses.
  await page.evaluate(async () => {
    const { importarArchivo } = await import('./js/store/importar.js');
    const { library } = await import('./js/store/library.js');
    const colores = ['#9fb6c8', '#f0a868', '#2c3a4f', '#c9d8e2', '#e7b98a', '#6f8fa8', '#d6d2c8', '#3f5d4a'];
    for (const [i, c] of colores.entries()) {
      const lienzo = document.createElement('canvas'); lienzo.width = 800; lienzo.height = 600;
      const g = lienzo.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, 800, 600);
      g.fillStyle = '#222'; g.fillRect(0, 360, 800, 240);
      const blob = await new Promise((r) => lienzo.toBlob(r, 'image/jpeg', 0.9));
      await importarArchivo(new File([blob], `color-${i}.jpg`, { type: 'image/jpeg' }));
    }
    const [primera] = (await library.list()).slice(-1);
    await library.update(primera.id, { createdAt: Date.now() - 62 * 864e5 });
  });

  const quieto = async () => {
    await page.waitForFunction(() => !window.__lab.conmutador._ocupado, null, { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(150);
  };
  const estado = () => page.evaluate(() => ({
    current: window.__lab.current,
    pegados: [...document.querySelectorAll('.view')].filter((v) => v.style.transform || v.style.display || v.style.borderRadius).length,
    clases: document.querySelector('.stack').className,
    capa: !document.querySelector('.carrusel').hidden,
  }));
  const capsula = async () => {
    const b = await page.locator('.tabbar').boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width };
  };

  console.log('\n── La cápsula de cristal ──');
  await page.locator('.tabbar__tab[data-tab="library"]').click();
  await page.waitForTimeout(700);
  const cap = await page.evaluate(() => {
    const t = document.querySelector('.tabbar');
    const r = t.getBoundingClientRect();
    const cs = getComputedStyle(t);
    const lente = document.querySelector('.tabbar__lente').getBoundingClientRect();
    const activa = document.querySelector('.tabbar__tab.is-active').getBoundingClientRect();
    return {
      ancho: Math.round(r.width), vw: innerWidth, centrada: Math.abs(r.left + r.width / 2 - innerWidth / 2) < 2,
      separada: innerHeight - r.bottom >= 8, redonda: parseFloat(cs.borderRadius) >= r.height / 2 - 1,
      cristal: /blur/.test(cs.backdropFilter || cs.webkitBackdropFilter),
      lente: Math.abs(lente.left - activa.left) < 2,
      iconos: document.querySelectorAll('.tabbar__icon svg').length,
    };
  });
  check('flota en el centro, más estrecha que la pantalla y despegada del borde',
    cap.centrada && cap.ancho < cap.vw * 0.85 && cap.separada && cap.redonda, `${cap.ancho} de ${cap.vw} px`);
  check('es de cristal (desenfoca lo de detrás)', cap.cristal);
  check('con tres iconos dibujados y la lente sobre la sección abierta', cap.iconos === 3 && cap.lente);

  console.log('\n── Deslizar de lado sobre la cápsula ──');
  let c = await capsula();
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(c.x - i * 7, c.y);
  await page.waitForTimeout(120);
  const aMedias = await page.evaluate(() => {
    const lab = document.querySelector('.view--lab');
    const lib = document.querySelector('.view--library');
    return {
      labVisible: getComputedStyle(lab).display !== 'none', labMovida: !!lab.style.transform,
      libMovida: !!lib.style.transform,
      lente: getComputedStyle(document.querySelector('.tabbar')).getPropertyValue('--pos'),
    };
  });
  check('mientras se arrastra, el laboratorio entra y la biblioteca se aparta',
    aMedias.labVisible && aMedias.labMovida && aMedias.libMovida, JSON.stringify(aMedias));
  check('y la lente sigue al dedo', parseFloat(aMedias.lente) < 2 && parseFloat(aMedias.lente) > 1, aMedias.lente);
  await page.mouse.up();
  await quieto();
  let e = await estado();
  check('al soltar pasada la mitad, se queda en el laboratorio', e.current === 'lab', e.current);
  check('y las vistas quedan limpias, sin estilos del gesto', e.pegados === 0 && !/is-pasando|is-asentando/.test(e.clases), JSON.stringify(e));

  // Un golpe rápido y corto también cuenta.
  c = await capsula();
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 14, c.y);
  await page.mouse.move(c.x + 28, c.y);
  await page.mouse.up();
  await quieto();
  e = await estado();
  check('un golpe rápido hacia la derecha lleva a la siguiente (biblioteca)', e.current === 'library', e.current);

  // Poco recorrido y despacio: se vuelve a donde estaba.
  c = await capsula();
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) { await page.mouse.move(c.x - i * 4, c.y); await page.waitForTimeout(40); }
  await page.waitForTimeout(150);
  await page.mouse.up();
  await quieto();
  e = await estado();
  check('poco y despacio no cambia de sección', e.current === 'library' && e.pegados === 0, e.current);

  console.log('\n── Deslizar hacia arriba: el carrusel ──');
  c = await capsula();
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(c.x, c.y - i * 22);
  await page.waitForTimeout(150);
  const subiendo = await page.evaluate(() => {
    const vistas = [...document.querySelectorAll('.view')].filter((v) => getComputedStyle(v).display !== 'none');
    const lib = document.querySelector('.view--library').getBoundingClientRect();
    return {
      vistas: vistas.length, ancho: Math.round(lib.width), vw: innerWidth,
      redondeada: parseFloat(getComputedStyle(document.querySelector('.view--library')).borderTopLeftRadius) > 0,
      titulos: [...document.querySelectorAll('.carrusel__titulo')].map((t) => t.textContent),
    };
  });
  check('la pantalla encoge siguiendo al dedo hasta ser una tarjeta',
    subiendo.ancho < subiendo.vw * 0.75 && subiendo.redondeada, `${subiendo.ancho} de ${subiendo.vw} px`);
  check('con las otras secciones a su lado', subiendo.vistas >= 2, subiendo.vistas + ' tarjetas a la vista');
  check('cada tarjeta con su título', subiendo.titulos.join() === 'Cámara,Laboratorio,Biblioteca', subiendo.titulos.join(' · '));
  await page.screenshot({ path: SHOT + '/conmutador-carrusel.png' });
  await page.mouse.up();
  await quieto();
  await page.waitForTimeout(400);   // la pista aparece con un fundido
  const abierto = await page.evaluate(() => ({
    abierto: document.querySelector('.carrusel').classList.contains('is-abierto'),
    pista: getComputedStyle(document.querySelector('.carrusel__pista')).opacity,
  }));
  check('al soltar, el carrusel se queda abierto', abierto.abierto && abierto.pista === '1', JSON.stringify(abierto));

  // Deslizar de lado en el carrusel mueve las tarjetas; un toque entra.
  await page.mouse.move(200, 420);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(200 + i * 26, 420);
  await page.mouse.up();
  await quieto();
  const centro = await page.evaluate(() => document.querySelector('.carrusel__tarjeta.is-centro')?.dataset.tab);
  check('arrastrar de lado trae la tarjeta de al lado al centro', centro === 'lab', centro);
  await page.locator('.carrusel__tarjeta[data-tab="camera"]').click({ force: true });
  await quieto();
  e = await estado();
  check('tocar una tarjeta entra en esa sección (la cámara)', e.current === 'camera' && !e.capa && e.pegados === 0, JSON.stringify(e));

  // Subir poco y soltar: no se abre.
  c = await capsula();
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  for (let i = 1; i <= 4; i++) { await page.mouse.move(c.x, c.y - i * 9); await page.waitForTimeout(40); }
  await page.waitForTimeout(150);
  await page.mouse.up();
  await quieto();
  e = await estado();
  check('subir poco no abre el carrusel', e.current === 'camera' && !e.capa && e.pegados === 0, JSON.stringify(e));

  console.log('\n── Dos dedos hacia arriba, en cualquier sitio ──');
  const dosDedos = async (pasos, separacion = 0) => {
    const p = (y, k, d = 0) => [{ x: 150 - d, y, id: 1 }, { x: 250 + d, y, id: 2 }][k];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p(520, 0), p(520, 1)] });
    for (let i = 1; i <= pasos; i++) {
      const y = 520 - i * 14, d = (separacion * i) / pasos;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p(y, 0, d), p(y, 1, d)] });
      await esperar(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(100);
    await quieto();
  };
  await dosDedos(10);
  const conDos = await page.evaluate(() => document.querySelector('.carrusel').classList.contains('is-abierto'));
  check('dos dedos que suben juntos abren el carrusel', conDos);
  await page.keyboard.press('Escape');
  await quieto();
  e = await estado();
  check('Escape lo cierra y deja la sección donde estaba', e.current === 'camera' && !e.capa && e.pegados === 0, JSON.stringify(e));
  await dosDedos(10, 70);
  check('un pellizco (los dedos se separan) no lo abre',
    !(await page.evaluate(() => document.querySelector('.carrusel').classList.contains('is-abierto'))));

  console.log('\n── Biblioteca al estilo Fotos ──');
  await page.locator('.tabbar__tab[data-tab="library"]').click();
  await page.waitForTimeout(900);
  const lib = await page.evaluate(() => {
    const titulo = getComputedStyle(document.querySelector('.lib__title'));
    const g = document.querySelector('.gallery');
    const tiles = [...document.querySelectorAll('.tile')].slice(0, 3).map((t) => t.getBoundingClientRect());
    return {
      titulo: parseFloat(titulo.fontSize), sub: document.querySelector('.lib__sub').textContent,
      meses: [...document.querySelectorAll('.gallery__mes')].map((m) => m.textContent),
      columnas: getComputedStyle(g).gridTemplateColumns.split(' ').length,
      junta: Math.round(tiles[1].left - tiles[0].right), borde: Math.round(tiles[0].left),
      cuadradas: tiles.every((r) => Math.abs(r.width - r.height) < 1),
      cristal: [...document.querySelectorAll('.lib__baractions .glass')].length,
    };
  });
  check('título grande y el recuento debajo', lib.titulo >= 30 && /8 fotos/.test(lib.sub), `${lib.titulo}px · «${lib.sub}»`);
  check('cuadrícula de tres columnas, de borde a borde y con junta fina',
    lib.columnas === 3 && lib.borde === 0 && lib.junta <= 2 && lib.cuadradas, `${lib.columnas} col · junta ${lib.junta}px`);
  check('separada por meses', lib.meses.length === 2, lib.meses.join(' · '));
  check('botones de cristal arriba', lib.cristal === 2);

  // Pellizcar la cuadrícula: más columnas, y se recuerda.
  const pellizco = async (d0, d1) => {
    const t = await page.locator('.tile').first().boundingBox();
    const cy = t.y + t.height / 2;
    const p = (d) => [{ x: 195 - d / 2, y: cy, id: 1 }, { x: 195 + d / 2, y: cy, id: 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: p(d0) });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: p(d0 + ((d1 - d0) * i) / 8) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400);
  };
  await pellizco(220, 90);
  const cinco = await page.evaluate(() => getComputedStyle(document.querySelector('.gallery')).gridTemplateColumns.split(' ').length);
  check('juntar los dedos pasa a cinco columnas', cinco === 5, cinco + ' columnas');
  await pellizco(90, 240);
  const tres = await page.evaluate(() => getComputedStyle(document.querySelector('.gallery')).gridTemplateColumns.split(' ').length);
  check('separarlos vuelve a tres', tres === 3, tres + ' columnas');

  // Mantener pulsada una foto abre sus opciones, como el menú de Fotos.
  const t0 = await page.locator('.tile').first().boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: t0.x + 40, y: t0.y + 40, id: 1 }] });
  await esperar(650);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);
  const menu = await page.evaluate(() => ({
    hoja: !!document.querySelector('.sheet-backdrop .sheet'),
    visor: !document.querySelector('.viewer').hidden,
  }));
  check('mantener pulsada una foto abre sus opciones (y no el visor)', menu.hoja && !menu.visor, JSON.stringify(menu));
  await page.evaluate(() => document.querySelector('.sheet-backdrop')?.click());
  await page.waitForTimeout(400);

  console.log('\n── Visor ──');
  await page.locator('.tile').first().click();
  await page.waitForSelector('.viewer__media', { timeout: 20_000 });
  await page.waitForTimeout(300);
  const visor = await page.evaluate(() => {
    const b = document.querySelector('.viewer__actions');
    const cs = getComputedStyle(b);
    const orden = [...document.querySelectorAll('.viewer__action')]
      .map((a) => ({ n: a.textContent.trim(), x: a.getBoundingClientRect().left }))
      .sort((a, z) => a.x - z.x).map((a) => a.n);
    return { cristal: /blur/.test(cs.backdropFilter || cs.webkitBackdropFilter), orden, fecha: document.querySelector('.viewer__dims').textContent };
  });
  check('barra de cristal con guardar, editar y borrar, en ese orden',
    visor.cristal && visor.orden.join() === 'Guardar,Laboratorio,Borrar', visor.orden.join(' · '));
  check('arriba dice el día, como Fotos', visor.fecha === 'Hoy', visor.fecha);
  await page.mouse.move(195, 360);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(195, 360 + i * 22);
  await page.mouse.up();
  await page.waitForTimeout(500);
  check('deslizar hacia abajo cierra el visor', await page.evaluate(() => document.querySelector('.viewer').hidden));

  console.log('\n── Laboratorio: círculos y regla ──');
  await page.locator('.tile').first().click();
  await page.waitForSelector('.viewer__media', { timeout: 20_000 });
  await page.locator('.viewer__action--editar').click();
  await page.waitForFunction(() => !!window.__lab.views.lab.proxy && document.querySelector('.busy').hidden, null, { timeout: 60_000 });
  await page.locator('.panelbar__tab[data-panel="light"]').click();
  await page.waitForTimeout(400);
  const luz = await page.evaluate(() => {
    const visibles = [...document.querySelectorAll('.panel .slider')].filter((s) => s.querySelector('.slider__track').getBoundingClientRect().height > 0);
    return {
      circulos: document.querySelectorAll('.herramienta').length,
      visibles: visibles.map((s) => s.dataset.path),
      elegida: document.querySelector('.herramienta.is-elegida')?.getAttribute('aria-label'),
    };
  });
  check('un círculo por ajuste de luz', luz.circulos === 8, luz.circulos + ' círculos');
  check('y una sola regla, la del elegido', luz.visibles.length === 1 && luz.visibles[0] === 'light.exposure', luz.visibles.join(', '));
  await page.locator('.herramienta[aria-label="Contraste"]').click();
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const i = document.querySelector('.slider[data-path="light.contrast"] input');
    i.value = 0.4;
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  const contraste = await page.evaluate(() => {
    const b = document.querySelector('.herramienta[aria-label="Contraste"]');
    const aro = b.querySelector('.herramienta__aro');
    return {
      regla: [...document.querySelectorAll('.panel .slider')].filter((s) => s.querySelector('.slider__track').getBoundingClientRect().height > 0).map((s) => s.dataset.path),
      valor: b.querySelector('.herramienta__valor').textContent,
      largo: parseFloat(aro.style.getPropertyValue('--largo')),
      marcado: b.classList.contains('is-modified'),
      param: window.__lab.views.lab.params.light.contrast,
    };
  });
  check('tocar «Contraste» trae su regla', contraste.regla.join() === 'light.contrast', contraste.regla.join());
  check('moverla cambia el ajuste, el número del círculo y su aro',
    Math.abs(contraste.param - 0.4) < 1e-6 && contraste.valor === '40' && contraste.largo > 0.15 && contraste.marcado, JSON.stringify(contraste));
  await page.screenshot({ path: SHOT + '/conmutador-lab.png' });

  console.log('\n── Cámara: la última foto junto al disparador ──');
  await page.locator('.tabbar__tab[data-tab="camera"]').click();
  await page.waitForTimeout(1500);
  const ultima = await page.evaluate(() => {
    const b = document.querySelector('.cam__ultima');
    const r = b.getBoundingClientRect(), d = document.querySelector('.shutter').getBoundingClientRect();
    return { visible: !b.hidden && r.width >= 44, izquierda: r.right < d.left, alto: Math.abs((r.top + r.height / 2) - (d.top + d.height / 2)) < 12, img: !!b.querySelector('img').src };
  });
  check('a la izquierda del disparador, con la miniatura', ultima.visible && ultima.izquierda && ultima.alto && ultima.img, JSON.stringify(ultima));
  await page.locator('.cam__ultima').click();
  await page.waitForSelector('.viewer__media', { timeout: 20_000 });
  check('abre el visor sin salir de la cámara', await page.evaluate(() => window.__lab.current === 'camera' && !document.querySelector('.viewer').hidden));
  await page.locator('.viewer__btn[aria-label="Cerrar"]').click();
  await page.waitForTimeout(1200);
  check('y al cerrarlo la cámara sigue encendida',
    await page.evaluate(() => window.__lab.current === 'camera' && !!window.__lab.views.camera.stream?.active));

  const reales = errors.filter((x) => !/favicon|vibrate/i.test(x));
  check('sin errores en la consola', reales.length === 0, reales.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server.kill();
}

console.log(failures ? `\n${failures} comprobaciones fallidas\n` : '\nTodo en orden\n');
process.exit(failures ? 1 : 0);
