#!/usr/bin/env node
/**
 * import.mjs — El menú de importación, la carpeta de Imágenes y la lupa.
 *
 *   · Una «tarjeta de memoria» con subcarpetas, un ARW de verdad, las copias
 *     ocultas «._» que deja el Mac y un XML de Sony: entran las fotos, se
 *     ignora lo demás, y del RAW se ve su vista previa sin revelarlo.
 *   · Marcar una a una, con Mayúsculas un tramo, todas y ninguna.
 *   · Lo importado se reconoce si se vuelve a meter la misma tarjeta.
 *   · Con una carpeta elegida (aquí el selector se simula con una del sistema
 *     de archivos privado, que tiene la misma interfaz), los originales se
 *     escriben en Laboratorio/<subcarpeta>/ con su nombre de siempre.
 *   · La miniatura provisional de un RAW se rehace después con LibRaw.
 *   · En el laboratorio: tira de fotos, doble clic para ampliar al 100 % con la
 *     foto entera, arrastrar para moverla y doble clic para volver.
 */
import pw from 'playwright';
const { chromium } = pw;
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SHOT = process.env.SHOT_DIR || ROOT + 'test/capturas';
const PORT = 8095;
const BASE = `http://localhost:${PORT}`;
const ARW = path.join(SHOT, 'muestra-sony-fx30.ARW');

fs.mkdirSync(SHOT, { recursive: true });
let failures = 0;
const errors = [];
const check = (n, ok, d = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + n + (d ? '  ' + d : ''));
  if (!ok) failures++;
};
/** Sondea una condición asíncrona (waitForFunction no espera a las promesas). */
async function hasta(page, fn, ms = 60_000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await page.evaluate(fn)) return true;
    await page.waitForTimeout(700);
  }
  return false;
}

const conRaw = fs.existsSync(ARW);
if (!conRaw) console.log(`  ⚠ Sin ${path.basename(ARW)} (lo descarga la suite raw): se prueba sin RAW.`);

const server = spawn('node', [path.join(ROOT, 'serve.mjs'), `--port=${PORT}`], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  // El selector de carpetas del sistema no se puede pulsar desde una prueba:
  // se sustituye por una carpeta del sistema de archivos privado, que tiene la
  // misma interfaz (crear, escribir, borrar, permisos).
  await ctx.addInitScript(() => {
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('Pictures', { create: true });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  console.log('\n── La tarjeta de memoria ──');
  const tarjeta = path.join(SHOT, 'TARJETA');
  fs.rmSync(tarjeta, { recursive: true, force: true });
  const dcim = path.join(tarjeta, 'DCIM', '100MSDCF');
  const otra = path.join(tarjeta, 'DCIM', '101MSDCF');
  fs.mkdirSync(dcim, { recursive: true });
  fs.mkdirSync(otra, { recursive: true });
  fs.mkdirSync(path.join(tarjeta, 'PRIVATE', 'M4ROOT'), { recursive: true });
  const fotos = await page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 6; i++) {
      // La sexta, grande: para ver la lupa al 100 % con la foto entera.
      const c = document.createElement('canvas'); c.width = i === 5 ? 4800 : 1200; c.height = i === 5 ? 3200 : 800;
      const g = c.getContext('2d');
      const k = c.width / 1200;
      g.fillStyle = `hsl(${i * 55}, 55%, 45%)`; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#fff'; g.font = `bold ${300 * k}px sans-serif`; g.fillText(String(i + 1), 500 * k, 520 * k);
      out.push(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
    }
    return out;
  });
  fotos.forEach((b64, i) => fs.writeFileSync(path.join(i < 4 ? dcim : otra, `DSC0${i + 1}.JPG`), Buffer.from(b64, 'base64')));
  fs.writeFileSync(path.join(dcim, '._DSC01.JPG'), Buffer.alloc(4096));          // copia oculta del Mac
  fs.writeFileSync(path.join(tarjeta, 'PRIVATE', 'M4ROOT', 'MEDIAPRO.XML'), '<x/>'); // de los vídeos Sony
  if (conRaw) fs.copyFileSync(ARW, path.join(otra, 'DSC07.ARW'));
  const esperadas = 6 + (conRaw ? 1 : 0);

  console.log('\n── El menú ──');
  await page.locator('.tabbar__tab[data-tab="library"]').click();
  await page.locator('.lib__baractions .btn', { hasText: 'Importar' }).click();
  await page.waitForSelector('.imp:not([hidden])');
  check('Importar abre el menú, con fotos y con carpeta o disco',
    await page.locator('.imp__vacio:not([hidden]) .btn', { hasText: 'Fotos y vídeos' }).count() === 1
      && await page.locator('.imp__vacio:not([hidden]) .btn', { hasText: 'Carpeta o disco' }).count() === 1);
  await page.locator('.imp input[webkitdirectory]').setInputFiles(tarjeta);
  await page.waitForFunction((n) => document.querySelectorAll('.imp__item').length === n, esperadas, { timeout: 15_000 }).catch(() => {});
  const lista = await page.evaluate(() => ({
    n: document.querySelectorAll('.imp__item').length,
    sel: document.querySelectorAll('.imp__item.is-selected').length,
    grupos: [...document.querySelectorAll('.imp__grupotit')].map((g) => g.textContent),
    resumen: document.querySelector('.imp__resumen').textContent,
    nombres: [...document.querySelectorAll('.imp__nombre')].map((n) => n.textContent),
  }));
  check('entran las fotos de todas las subcarpetas', lista.n === esperadas, `${lista.n} de ${esperadas}`);
  check('y las ocultas «._» y el XML se quedan fuera', !lista.nombres.some((n) => n.startsWith('._')) && /1 archivo que no es foto/.test(lista.resumen), lista.resumen);
  check('agrupadas por carpeta', lista.grupos.length === 2 && lista.grupos.every((g) => /DCIM\/10[01]MSDCF/.test(g)), lista.grupos.join(' · '));
  check('todas marcadas para empezar', lista.sel === esperadas);
  await page.waitForFunction((n) => [...document.querySelectorAll('.imp__mini img')].filter((i) => i.src).length >= n, esperadas, { timeout: 30_000 }).catch(() => {});
  const minis = await page.evaluate(() => [...document.querySelectorAll('.imp__item')].map((t) => ({
    nombre: t.querySelector('.imp__nombre').textContent, img: !!t.querySelector('img')?.src,
  })));
  check('cada foto con su miniatura', minis.every((m) => m.img), minis.filter((m) => !m.img).map((m) => m.nombre).join(', '));
  if (conRaw) {
    const raw = await page.evaluate(() => {
      const t = [...document.querySelectorAll('.imp__item')].find((x) => x.textContent.includes('DSC07.ARW'));
      const img = t.querySelector('img');
      return { badge: t.textContent.includes('RAW'), w: img.naturalWidth, h: img.naturalHeight };
    });
    check('el RAW, por su vista previa incrustada, sin revelarlo', raw.badge && raw.w > 100 && raw.h > 50, `${raw.w}×${raw.h}`);
  }
  await page.screenshot({ path: SHOT + '/import-menu.png' });

  await page.locator('.imp__selbtns .btn', { hasText: 'Ninguna' }).click();
  check('«Ninguna» desmarca todo', await page.locator('.imp__item.is-selected').count() === 0
    && await page.locator('.imp__acciones .btn--primary').isDisabled());
  const items = page.locator('.imp__item');
  await items.nth(0).click();
  await items.nth(2).click({ modifiers: ['Shift'] });
  check('un clic marca una; con Mayúsculas, el tramo', await page.locator('.imp__item.is-selected').count() === 3);
  await items.nth(1).click();
  check('y otro clic la desmarca', await page.locator('.imp__item.is-selected').count() === 2);
  await page.locator('.imp__selbtns .btn', { hasText: 'Seleccionar todas' }).click();
  check('«Seleccionar todas» las marca todas', await page.locator('.imp__item.is-selected').count() === esperadas);
  check('el botón dice cuántas', (await page.locator('.imp__acciones .btn--primary').textContent()) === `Importar ${esperadas}`);
  await items.nth(4).click();   // una se queda fuera

  console.log('\n── Guardar en Imágenes ──');
  check('el navegador sin carpeta ofrece guardarlas en Imágenes',
    await page.locator('.imp__destino .linkbtn', { hasText: 'Imágenes' }).count() === 1);
  await page.locator('.imp__destino .linkbtn').click();
  await page.locator('.sheet .btn--primary', { hasText: 'Elegir carpeta' }).click();
  await page.waitForFunction(() => !!document.querySelector('.imp__sub'), null, { timeout: 10_000 });
  const destino = await page.evaluate(() => ({
    texto: document.querySelector('.imp__destinotxt').textContent, sub: document.querySelector('.imp__sub').value,
  }));
  check('dentro de la elegida se crea Laboratorio', /Pictures › Laboratorio/.test(destino.texto), destino.texto);
  check('y propone una subcarpeta con la fecha y el nombre de la tarjeta', /^\d{4}-\d\d-\d\d TARJETA$/.test(destino.sub), destino.sub);
  await page.locator('.imp__sub').fill('Viaje a la costa');
  // Cómo queda el RAW justo al importarlo: el aviso de «cambio» del lote llega
  // antes de que empiece a rehacerse su miniatura en segundo plano.
  await page.evaluate(async () => {
    const { library } = await import('./js/store/library.js');
    library.addEventListener('change', async () => {
      if (window.__rawRecien) return;
      const r = (await library.list()).find((i) => i.raw);
      if (r) window.__rawRecien = { prov: r.thumbProvisional, aprox: r.dimsAprox };
    });
  });

  await page.locator('.imp__acciones .btn--primary').click();
  await page.waitForSelector('.imp', { state: 'hidden', timeout: 120_000 });
  await page.waitForTimeout(800);

  const enCarpeta = await page.evaluate(async () => {
    const raiz = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Pictures')).getDirectoryHandle('Laboratorio');
    const sub = await raiz.getDirectoryHandle('Viaje a la costa');
    const nombres = [];
    for await (const [n] of sub.entries()) nombres.push(n);
    const { library } = await import('./js/store/library.js');
    const items = await library.list();
    return { nombres: nombres.sort(), items: items.map((i) => ({ storage: i.storage, ruta: i.ruta, raw: i.raw, prov: i.thumbProvisional, w: i.width, aprox: i.dimsAprox })) };
  });
  check(`entran ${esperadas - 1}: las marcadas`, enCarpeta.items.length === esperadas - 1, String(enCarpeta.items.length));
  check('los originales, en Laboratorio/Viaje a la costa con su nombre', enCarpeta.nombres.length === esperadas - 1
    && enCarpeta.nombres.includes('DSC01.JPG') && enCarpeta.items.every((i) => i.storage === 'carpeta'), enCarpeta.nombres.join(', '));
  check('y la biblioteca los enseña', await page.locator('.tile').count() === esperadas - 1);
  check('la biblioteca dice dónde están', /Pictures › Laboratorio/.test(await page.locator('.usage__mode').textContent()));
  // Se abre uno desde la carpeta: el visor lo lee de allí.
  await page.locator('.tile').last().click();
  await page.waitForSelector('.viewer__media', { timeout: 20_000 });
  check('el visor abre los que están en la carpeta', await page.locator('.viewer__media').count() === 1);
  await page.locator('.viewer__btn[aria-label="Cerrar"]').click();

  if (conRaw) {
    const recien = await page.evaluate(() => window.__rawRecien);
    check('el RAW entra al momento, con la miniatura de la cámara', recien?.prov === true && recien?.aprox === true, JSON.stringify(recien));
    await hasta(page, async () => {
      const { library } = await import('./js/store/library.js');
      return !(await library.list()).some((i) => i.thumbProvisional);
    }, 120_000);
    const despues = await page.evaluate(async () => {
      const { library } = await import('./js/store/library.js');
      const r = (await library.list()).find((i) => i.raw);
      return { prov: r.thumbProvisional, aprox: r.dimsAprox, w: r.width, h: r.height };
    });
    check('y después se rehace con el revelado de la app, con el tamaño del sensor',
      despues.prov === false && despues.aprox === false && despues.w > 6000, JSON.stringify(despues));
  }

  console.log('\n── Volver a meter la tarjeta ──');
  await page.locator('.lib__baractions .btn', { hasText: 'Importar' }).click();
  await page.locator('.imp input[webkitdirectory]').setInputFiles(tarjeta);
  await page.waitForFunction((n) => document.querySelectorAll('.imp__item').length === n, esperadas, { timeout: 15_000 }).catch(() => {});
  const otraVez = await page.evaluate(() => ({
    dups: [...document.querySelectorAll('.imp__item')].filter((t) => t.textContent.includes('Ya importada')).length,
    sel: document.querySelectorAll('.imp__item.is-selected').length,
  }));
  check('las ya importadas salen avisadas y desmarcadas; la que faltó, marcada',
    otraVez.dups === esperadas - 1 && otraVez.sel === 1, JSON.stringify(otraVez));
  await page.keyboard.press('Escape');
  check('Esc cierra el menú', await page.locator('.imp[hidden]').count() === 1);

  console.log('\n── El laboratorio: tira de fotos y lupa ──');
  await page.locator('.tile').first().click();
  await page.waitForSelector('.viewer__media');
  await page.locator('.viewer__action', { hasText: 'Laboratorio' }).click();
  await page.waitForFunction(() => !!window.__lab.views.lab.proxy && document.querySelector('.busy').hidden, null, { timeout: 60_000 });
  await page.waitForTimeout(600);
  const tira = await page.evaluate(() => ({
    visible: !document.querySelector('.tira').hidden,
    n: document.querySelectorAll('.tira__item').length,
    actual: document.querySelectorAll('.tira__item.is-current').length,
  }));
  check('en el Mac la tira sale abierta, con todas las fotos', tira.visible && tira.n === esperadas - 1 && tira.actual === 1, JSON.stringify(tira));
  const primera = await page.evaluate(() => window.__lab.views.lab.item.id);
  await page.locator('.tira__item').nth(2).click();
  await page.waitForFunction((id) => window.__lab.views.lab.item?.id !== id && document.querySelector('.busy').hidden, primera, { timeout: 60_000 });
  check('tocar una miniatura de la tira abre esa foto', true);
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.querySelector('.busy').hidden, null, { timeout: 60_000 });
  await page.waitForTimeout(400);
  check('← pasa a la anterior', await page.evaluate(() => [...document.querySelectorAll('.tira__item')].indexOf(document.querySelector('.tira__item.is-current'))) === 1);
  await page.locator('.iconbtn[aria-label="Tira de fotos"]').click();
  await page.waitForTimeout(300);
  check('el botón la esconde', await page.locator('.tira[hidden]').count() === 1);
  await page.locator('.iconbtn[aria-label="Tira de fotos"]').click();

  // Lupa, con la foto grande (4800×3200).
  await page.evaluate(async () => {
    const { library } = await import('./js/store/library.js');
    const it = (await library.list()).find((i) => i.fuente?.nombre === 'DSC06.JPG');
    await window.__lab.views.lab.open(it);
  });
  await page.waitForTimeout(500);
  const encajada = await page.evaluate(() => { const b = document.querySelector('.lab__canvas').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  const marco = await page.evaluate(() => { const b = document.querySelector('.lab__frame').getBoundingClientRect(); return { w: b.width, h: b.height }; });
  check('encajada, la foto cabe entera en su hueco', encajada.w <= marco.w + 1 && encajada.h <= marco.h + 1);
  await page.mouse.dblclick(encajada.x + encajada.w * 0.25, encajada.y + encajada.h * 0.25);
  await page.waitForFunction(() => window.__lab.views.lab.zoom && !window.__lab.views.lab.zoom.cargando, null, { timeout: 30_000 });
  await page.waitForTimeout(300);
  const lupa = await page.evaluate(() => {
    const c = document.querySelector('.lab__canvas'); const b = c.getBoundingClientRect();
    const lab = window.__lab.views.lab;
    return { w: b.width, x: b.left, y: b.top, px: c.width, src: lab.sourceWidth, comparando: lab.comparing, tag: document.querySelector('.lab__zoomtag').textContent };
  });
  check('doble clic amplía al 100 %: un píxel de la foto por píxel de pantalla',
    Math.abs(lupa.w * 2 - lupa.px) < 3 && /100 %/.test(lupa.tag), `${Math.round(lupa.w)} pt · lienzo ${lupa.px} px · «${lupa.tag}»`);
  check('con la foto entera, no la vista previa', lupa.px === lupa.src, `${lupa.px} de ${lupa.src}`);
  check('y el doble clic no enseña el «antes»', lupa.comparando === false);
  await page.mouse.move(encajada.x + 300, encajada.y + 300);
  await page.mouse.down();
  await page.mouse.move(encajada.x + 200, encajada.y + 240, { steps: 4 });
  await page.mouse.up();
  const movida = await page.evaluate(() => { const b = document.querySelector('.lab__canvas').getBoundingClientRect(); return { x: b.left, y: b.top }; });
  check('arrastrar mueve la foto ampliada', Math.round(movida.x - lupa.x) === -100 && Math.round(movida.y - lupa.y) === -60,
    `${Math.round(movida.x - lupa.x)}, ${Math.round(movida.y - lupa.y)}`);
  await page.mouse.wheel(0, 80);
  await page.waitForTimeout(150);
  const rodada = await page.evaluate(() => document.querySelector('.lab__canvas').getBoundingClientRect().top);
  // (Chromium emulado a 2× entrega la rueda en píxeles de dispositivo: la mitad en puntos.)
  check('y dos dedos en el trackpad también', rodada - movida.y <= -35, String(Math.round(rodada - movida.y)));
  // Mover un ajuste ampliado redibuja sobre la foto entera.
  await page.evaluate(() => { const lab = window.__lab.views.lab; lab.params.light.exposure = 0.6; lab._changed(true); });
  await page.waitForTimeout(400);
  check('editar ampliada sigue usando la foto entera', await page.evaluate(() => document.querySelector('.lab__canvas').width === window.__lab.views.lab.sourceWidth));
  await page.screenshot({ path: SHOT + '/import-lupa.png' });
  await page.mouse.dblclick(encajada.x + 200, encajada.y + 200);
  await page.waitForTimeout(600);
  const vuelta = await page.evaluate(() => { const b = document.querySelector('.lab__canvas').getBoundingClientRect(); return { w: b.width, h: b.height, zoom: !!window.__lab.views.lab.zoom }; });
  check('otro doble clic vuelve a encajarla', !vuelta.zoom && Math.abs(vuelta.w - encajada.w) < 2 && Math.abs(vuelta.h - encajada.h) < 2);
  await page.keyboard.press('z');
  await page.waitForFunction(() => window.__lab.views.lab.zoom && !window.__lab.views.lab.zoom.cargando, null, { timeout: 30_000 }).catch(() => {});
  check('Z también amplía', await page.evaluate(() => !!window.__lab.views.lab.zoom));
  await page.keyboard.press('Escape');
  check('y Esc vuelve', await page.evaluate(() => !window.__lab.views.lab.zoom));

  // Una foto pequeña al 100 % apenas se ampliaría: entonces se dobla lo encajado.
  await page.evaluate(async () => {
    const { library } = await import('./js/store/library.js');
    await window.__lab.views.lab.open((await library.list()).find((i) => i.fuente?.nombre === 'DSC01.JPG'));
  });
  await page.waitForTimeout(500);
  const chica = await page.evaluate(() => { const b = document.querySelector('.lab__canvas').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  await page.mouse.dblclick(chica.x + chica.w / 2, chica.y + chica.h / 2);
  await page.waitForFunction(() => window.__lab.views.lab.zoom && !window.__lab.views.lab.zoom.cargando, null, { timeout: 30_000 }).catch(() => {});
  const doble = await page.evaluate(() => ({ w: document.querySelector('.lab__canvas').getBoundingClientRect().width, tag: document.querySelector('.lab__zoomtag').textContent }));
  check('una foto pequeña se amplía al doble, y dice cuánto es respecto del original',
    Math.abs(doble.w - chica.w * 2) < 2 && /\d+ %/.test(doble.tag), `${Math.round(doble.w)} pt · «${doble.tag}»`);
  await page.keyboard.press('Escape');

  // Mantener pulsado sigue enseñando el antes.
  const c2 = await page.evaluate(() => { const b = document.querySelector('.lab__canvas').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await page.mouse.move(c2.x, c2.y);
  await page.mouse.down();
  await page.waitForTimeout(400);
  const antes = await page.evaluate(() => window.__lab.views.lab.comparing);
  await page.mouse.up();
  await page.waitForTimeout(100);
  check('mantener pulsado sigue enseñando el antes', antes && !(await page.evaluate(() => window.__lab.views.lab.comparing)));
  await ctx.close();

  console.log('\n── Una sola foto: directa al laboratorio ──');
  const movil = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const p2 = await movil.newPage();
  p2.on('pageerror', (e) => errors.push('pageerror (móvil): ' + e.message));
  await p2.goto(BASE, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(1200);
  await p2.setInputFiles('input[type=file]', path.join(dcim, 'DSC01.JPG'));
  await p2.waitForFunction(() => !!window.__lab?.views?.lab?.proxy && document.querySelector('.busy').hidden, null, { timeout: 60_000 });
  check('elegir una sola foto la importa y la abre, sin menú', await p2.evaluate(() => window.__lab.current === 'lab' && document.querySelector('.imp').hidden));
  check('en el teléfono la tira empieza escondida', await p2.locator('.tira[hidden]').count() === 1);
  await p2.locator('.tabbar__tab[data-tab="library"]').click();
  await p2.locator('.lib__baractions .btn', { hasText: 'Importar' }).click();
  check('en el iPhone el menú no ofrece carpetas si el sistema no deja',
    await p2.locator('.imp__vacio .btn', { hasText: 'Fotos y vídeos' }).count() === 1);
  await p2.screenshot({ path: SHOT + '/import-movil.png' });
  await movil.close();
} catch (err) {
  console.error(err);
  failures++;
}

const reales = errors.filter((e) => !/Failed to load resource/.test(e));
check('sin errores en la consola', reales.length === 0, reales.slice(0, 3).join(' | '));

await browser.close();
server.kill();
console.log(failures ? `\n${failures} fallo(s)\n` : '\nTodo correcto\n');
process.exit(failures ? 1 : 0);
