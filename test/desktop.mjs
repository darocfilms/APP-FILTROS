#!/usr/bin/env node
/**
 * desktop.mjs — El Mac, y los ajustes que viajan.
 *
 * Tres cosas que se rompen sin hacer ruido:
 *   · En pantalla ancha los ajustes van en una columna al lado y la foto no
 *     queda debajo de ellos.
 *   · Lo editado en el laboratorio es lo que enseña y entrega la biblioteca:
 *     la miniatura, el visor y «Guardar». Si no, se edita una foto y se
 *     guarda otra.
 *   · Copiar el color de una foto y pegarlo en muchas respeta el encuadre de
 *     cada una, y el laboratorio se entera si la foto abierta cambió fuera.
 */
import pw from 'playwright';
const { chromium } = pw;
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SHOT = process.env.SHOT_DIR || ROOT + 'test/capturas';
const PORT = 8091;
const BASE = `http://localhost:${PORT}`;

fs.mkdirSync(SHOT, { recursive: true });
const server = spawn('node', [path.join(ROOT, 'serve.mjs'), `--port=${PORT}`], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));

let failures = 0;
const errors = [];
const check = (n, ok, d = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + n + (d ? '  ' + d : ''));
  if (!ok) failures++;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  // La hoja de compartir se simula y se queda con los archivos, para poder
  // abrirlos y ver qué se habría guardado de verdad.
  await ctx.addInitScript(() => {
    window.__shared = [];
    navigator.canShare = (d) => !!(d && d.files && d.files.length);
    navigator.share = async (d) => { window.__shared.push(...d.files); };
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Brillo medio de una imagen (0–255) y su tamaño, desde un <img> o un blob.
  await page.evaluate(() => {
    window.__medir = async (src) => {
      const bmp = await createImageBitmap(src instanceof Blob ? src : await (await fetch(src)).blob());
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const g = c.getContext('2d');
      g.drawImage(bmp, 0, 0, 64, 64);
      const d = g.getImageData(0, 0, 64, 64).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      const out = { brillo: s / (d.length / 4), w: bmp.width, h: bmp.height };
      bmp.close();
      return out;
    };
    // La cuadrícula se repinta entera de vez en cuando: si la casilla aún no
    // está, se espera a que vuelva.
    window.__miniatura = async (i) => {
      for (let n = 0; n < 100; n++) {
        const img = document.querySelectorAll('.tile .tile__img')[i];
        if (img?.src) { try { return await window.__medir(img.src); } catch { /* url ya soltada */ } }
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error('no aparece la miniatura ' + i);
    };
    window.__esperaOcupado = () => new Promise((r) => {
      const t = setInterval(() => { if (document.querySelector('.busy').hidden) { clearInterval(t); r(); } }, 50);
    });
  });

  console.log('\n── Importar tres fotos ──');
  const files = [];
  for (let i = 0; i < 3; i++) {
    const p = SHOT + `/escritorio-${i}.jpg`;
    const dataUrl = await page.evaluate((n) => {
      const c = document.createElement('canvas'); c.width = 900; c.height = 1200;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 0, 1200);
      grad.addColorStop(0, ['#3a5f8e', '#8e5f3a', '#3a8e5f'][n]);
      grad.addColorStop(1, '#202020');
      g.fillStyle = grad; g.fillRect(0, 0, 900, 1200);
      g.fillStyle = '#ddd'; g.font = 'bold 300px sans-serif';
      g.fillText(String(n + 1), 340, 750);
      return c.toDataURL('image/jpeg', 0.9);
    }, i);
    fs.writeFileSync(p, Buffer.from(dataUrl.split(',')[1], 'base64'));
    files.push(p);
  }
  await page.setInputFiles('input[type=file]', files);
  await page.waitForFunction(() => document.querySelector('.busy').hidden, null, { timeout: 30_000 });
  await page.locator('.tabbar__tab[data-tab="library"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.tile .tile__img[src]').length === 3, null, { timeout: 20_000 });
  const original = await page.evaluate(() => Promise.all([0, 1, 2].map((i) => window.__miniatura(i))));
  check('las tres fotos están en la biblioteca', original.length === 3);

  console.log('\n── El laboratorio en el Mac: ajustes al lado ──');
  await page.locator('.tile').first().click();
  await page.waitForSelector('.viewer__media', { timeout: 20_000 });
  await page.locator('.viewer__action', { hasText: 'Laboratorio' }).click();
  await page.waitForFunction(() => !!window.__lab.views.lab.proxy, null, { timeout: 60_000 });
  await page.waitForTimeout(800);
  const caja = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const lienzo = r('.lab__canvas'), panel = r('.panels'), cuerpo = r('.panelbody'), barra = r('.panelbar');
    return {
      lienzoDer: lienzo.right, panelIzq: panel.left, panelAncho: panel.width, panelAlto: panel.height,
      cuerpoAlto: cuerpo.height, barraAbajo: barra.bottom, cuerpoArriba: cuerpo.top,
      clip: [...document.querySelectorAll('.lab__clip')].map((b) => getComputedStyle(b).display),
    };
  });
  check('los ajustes van en una columna a la derecha', caja.panelIzq > 1440 * 0.6 && caja.panelAncho >= 300,
    `columna de ${Math.round(caja.panelAncho)} px desde x=${Math.round(caja.panelIzq)}`);
  check('la foto no queda debajo de la columna', caja.lienzoDer <= caja.panelIzq + 1,
    `foto hasta x=${Math.round(caja.lienzoDer)}`);
  check('la columna ocupa el alto de la ventana', caja.panelAlto > 900 * 0.7, Math.round(caja.panelAlto) + ' px');
  check('las pestañas arriba y los ajustes debajo', caja.barraAbajo <= caja.cuerpoArriba + 1 && caja.cuerpoAlto > 300);
  check('copiar y pegar a la vista en la barra', caja.clip.every((d) => d !== 'none') && caja.clip.length === 2, caja.clip.join(','));

  // Tocar la pestaña activa en el teléfono pliega los ajustes; en el Mac no hay
  // nada que plegar, y quedarse sin ellos sería un callejón sin salida.
  const activa = page.locator('.panelbar__tab.is-active');
  await activa.click();
  await page.waitForTimeout(300);
  check('tocar la pestaña activa no esconde los ajustes', await page.evaluate(() => !window.__lab.views.lab.collapsed));
  await page.screenshot({ path: SHOT + '/escritorio-laboratorio.png' });

  console.log('\n── Lo editado se ve en la biblioteca ──');
  await page.evaluate(() => {
    const lab = window.__lab.views.lab;
    lab._pickFilm('portra400');
    lab.params.light.exposure = 1.2;
    lab.params.geometry.rotate = 90;          // el encuadre también es una edición
    lab.panels.syncAll();
    lab._changed(true);
  });
  await page.waitForTimeout(400);
  await page.locator('.tabbar__tab[data-tab="library"]').click();
  // La miniatura sale del lienzo del laboratorio al salir, sin esperar.
  await page.waitForFunction(async () => { const m = await window.__miniatura(0); return m.w > m.h; },
    null, { timeout: 15_000 }).catch(() => {});
  const editada = await page.evaluate(() => window.__miniatura(0));
  check('la miniatura enseña la foto editada', editada.brillo > original[0].brillo + 15,
    `brillo ${original[0].brillo.toFixed(0)} → ${editada.brillo.toFixed(0)}`);
  check('con el giro incluido', editada.w > editada.h, `${editada.w}×${editada.h}`);
  const insignia = await page.locator('.tile').first().locator('.tile__badge--edit').textContent().catch(() => '');
  check('y una marca dice con qué está editada', /Portra 400/.test(insignia), insignia);
  check('las demás siguen igual', await page.locator('.tile__badge--edit').count() === 1);
  check('y ninguna casilla repetida al volver', await page.locator('.tile').count() === 3,
    (await page.locator('.tile').count()) + ' casillas');

  console.log('\n── El visor y «Guardar» entregan la editada ──');
  await page.locator('.tile').first().click();
  await page.waitForSelector('.viewer__media', { timeout: 30_000 });
  await page.waitForTimeout(400);
  const enVisor = await page.evaluate(() => window.__medir(document.querySelector('.viewer__media').src));
  check('el visor la enseña revelada', enVisor.brillo > original[0].brillo + 15 && enVisor.w > enVisor.h,
    `${enVisor.w}×${enVisor.h}, brillo ${enVisor.brillo.toFixed(0)}`);
  check('y dice con qué', /Portra 400/.test(await page.locator('.viewer__meta').textContent()));
  await page.locator('.viewer__action', { hasText: 'Guardar' }).click();
  await page.waitForSelector('.sheet-backdrop', { timeout: 30_000 });
  await page.locator('.sheet', { hasText: 'Listo para guardar' }).locator('.btn--primary').click();
  await page.waitForTimeout(600);
  const guardada = await page.evaluate(async () => {
    const f = window.__shared.at(-1);
    return { name: f.name, ...(await window.__medir(f)) };
  });
  check('lo que se guarda es la editada, a resolución completa',
    guardada.w === 1200 && guardada.h === 900 && guardada.brillo > original[0].brillo + 15,
    `${guardada.name} · ${guardada.w}×${guardada.h} · brillo ${guardada.brillo.toFixed(0)}`);
  check('con el nombre de la emulsión', /portra400\.jpg$/.test(guardada.name), guardada.name);

  await page.locator('.tile').first().locator('.tile__more').click();
  await page.waitForSelector('.sheet-backdrop');
  check('la ficha dice qué ajustes lleva', /Portra 400/.test(await page.locator('.meta').textContent()));
  await page.locator('.sheet .btn', { hasText: 'Guardar el original' }).click();
  await page.waitForSelector('.sheet-backdrop', { timeout: 20_000 });
  await page.locator('.sheet', { hasText: 'Listo para guardar' }).locator('.btn--primary').click();
  await page.waitForTimeout(600);
  const delOriginal = await page.evaluate(async () => {
    const f = window.__shared.at(-1);
    return { size: f.size, ...(await window.__medir(f)) };
  });
  check('y el original sigue a mano, tal como entró',
    delOriginal.size === fs.statSync(files[0]).size || delOriginal.w === 900,
    `${delOriginal.w}×${delOriginal.h} · ${delOriginal.size} bytes`);

  console.log('\n── Copiar y pegar en todas ──');
  // La tercera tiene su propio encuadre: pegar no se lo puede quitar.
  await page.evaluate(async () => {
    const lib = window.__lab.views.library;
    const tercera = lib.items[2];
    const { library } = await import('./js/store/library.js');
    await library.update(tercera.id, { params: { geometry: { rotate: 0, straighten: 0, flipH: true, flipV: false, aspect: 'free', crop: { x: 0, y: 0, w: 1, h: 0.5 } } } });
    await lib.render();
  });
  // Y la segunda se deja abierta en el laboratorio, sin editar, para ver que
  // se entera de lo que se le pegue desde fuera.
  await page.evaluate(async () => {
    const lib = window.__lab.views.library;
    window.__lab.openInLab(lib.items[1]);
  });
  await page.waitForFunction(() => window.__lab.views.lab.item?.id === window.__lab.views.library.items[1].id && !document.querySelector('.busy:not([hidden])'), null, { timeout: 60_000 });
  await page.waitForTimeout(500);
  await page.locator('.tabbar__tab[data-tab="library"]').click();
  await page.waitForTimeout(800);

  await page.locator('.tile').first().locator('.tile__more').click();
  await page.waitForSelector('.sheet-backdrop');
  await page.locator('.sheet .btn', { hasText: 'Copiar ajustes' }).click();
  await page.waitForTimeout(300);
  check('copiar avisa de lo copiado', /Ajustes copiados · Portra 400/.test(await page.locator('#toast').textContent()));
  const copiado = await page.evaluate(() => JSON.parse(localStorage.getItem('lab.portapapeles.v1')));
  check('lo copiado es el color, no el encuadre', copiado?.params?.film?.id === 'portra400' && !('geometry' in copiado.params));

  await page.locator('.lib__baractions .btn', { hasText: 'Seleccionar' }).click();
  await page.locator('.selbar .linkbtn', { hasText: 'Todo' }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: SHOT + '/escritorio-seleccion.png' });
  await page.locator('.selbar .btn', { hasText: 'Pegar ajustes' }).click();
  await page.waitForSelector('.sheet--dialog');
  const pregunta = await page.locator('.sheet--dialog .sheet__message').textContent();
  check('pregunta antes de pegar en varias', /3 fotos/.test(pregunta) && /encuadre/.test(pregunta), pregunta);
  await page.locator('.sheet--dialog .btn--primary').click();
  await page.evaluate(() => window.__esperaOcupado());
  await page.waitForTimeout(800);

  const tras = await page.evaluate(async () => {
    const { library } = await import('./js/store/library.js');
    const items = await library.list();
    return {
      params: items.map((i) => i.params),
      marcas: document.querySelectorAll('.tile__badge--edit').length,
      miniaturas: await Promise.all([0, 1, 2].map((i) => window.__miniatura(i))),
      aviso: document.querySelector('#toast').textContent,
    };
  });
  check('las tres llevan ya la emulsión', tras.params.every((p) => p?.film?.id === 'portra400' && p.light.exposure === 1.2));
  check('cada una conserva su encuadre',
    tras.params[0].geometry.rotate === 90 && tras.params[1].geometry.rotate === 0
      && tras.params[2].geometry.flipH === true && tras.params[2].geometry.crop.h === 0.5);
  check('las miniaturas se rehacen', tras.miniaturas[1].brillo > original[1].brillo + 15 && tras.miniaturas[2].brillo > original[2].brillo + 15,
    tras.miniaturas.map((m) => m.brillo.toFixed(0)).join(' · '));
  check('y la del encuadre propio sale recortada', tras.miniaturas[2].w > tras.miniaturas[2].h,
    `${tras.miniaturas[2].w}×${tras.miniaturas[2].h}`);
  check('todas marcadas como editadas', tras.marcas === 3);
  check('y lo dice al terminar', /3 fotos/.test(tras.aviso), tras.aviso);

  console.log('\n── El laboratorio se entera ──');
  await page.locator('.lib__baractions .btn', { hasText: 'Hecho' }).click();
  await page.locator('.tabbar__tab[data-tab="lab"]').click();
  await page.waitForFunction(() => window.__lab.views.lab.params.film.id === 'portra400', null, { timeout: 5000 }).catch(() => {});
  const enLab = await page.evaluate(() => ({ film: window.__lab.views.lab.params.film.id, exp: window.__lab.views.lab.params.light.exposure }));
  check('la foto abierta recoge lo pegado al volver', enLab.film === 'portra400' && enLab.exp === 1.2, JSON.stringify(enLab));

  // Atajos del Mac.
  await page.locator('.lab__canvas').click({ position: { x: 10, y: 10 } }).catch(() => {});
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(300);
  check('⌘Z deshace lo pegado', await page.evaluate(() => window.__lab.views.lab.params.light.exposure === 0));
  await page.keyboard.press('Meta+Shift+z');
  await page.waitForTimeout(300);
  check('⇧⌘Z lo rehace', await page.evaluate(() => window.__lab.views.lab.params.light.exposure === 1.2));
  // Entre cambio y cambio, lo que tarda el historial en apuntarlo: sin esa
  // pausa dos cambios seguidos son un solo paso de deshacer, como al arrastrar.
  await page.evaluate(() => { const lab = window.__lab.views.lab; lab.params.light.exposure = -0.5; lab._changed(true); });
  await page.waitForTimeout(400);
  await page.keyboard.press('Meta+c');
  await page.waitForTimeout(200);
  check('⌘C copia los ajustes de la foto abierta',
    await page.evaluate(() => JSON.parse(localStorage.getItem('lab.portapapeles.v1')).params.light.exposure === -0.5));
  await page.evaluate(() => { const lab = window.__lab.views.lab; lab.params.light.exposure = 0.3; lab._changed(true); });
  await page.waitForTimeout(400);
  await page.keyboard.press('Meta+v');
  await page.waitForTimeout(400);
  check('⌘V los pega', await page.evaluate(() => window.__lab.views.lab.params.light.exposure === -0.5));
  // El deslizador se queda con el foco tras arrastrarlo: ⌘Z tiene que seguir.
  await page.locator('.panelbar__tab[data-panel="light"]').click();
  await page.waitForTimeout(300);
  const enFoco = await page.evaluate(() => {
    document.querySelector('.panelbody input[type=range]')?.focus();
    return document.activeElement?.type;
  });
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(300);
  check('⌘Z funciona con un deslizador en foco',
    enFoco === 'range' && await page.evaluate(() => window.__lab.views.lab.params.light.exposure === 0.3), 'foco: ' + enFoco);

  console.log('\n── Quitar los ajustes ──');
  await page.locator('.tabbar__tab[data-tab="library"]').click();
  await page.waitForTimeout(800);
  await page.locator('.tile').nth(2).locator('.tile__more').click();
  await page.waitForSelector('.sheet-backdrop');
  await page.locator('.sheet .btn', { hasText: 'Quitar los ajustes' }).click();
  await page.waitForSelector('.sheet--dialog');
  await page.locator('.sheet--dialog .btn--primary').click();
  await page.waitForTimeout(1500);
  const limpia = await page.evaluate(async () => ({
    mini: await window.__miniatura(2),
    marca: !!document.querySelectorAll('.tile')[2].querySelector('.tile__badge--edit'),
  }));
  check('vuelve a ser el original, también en la cuadrícula',
    !limpia.marca && Math.abs(limpia.mini.brillo - original[2].brillo) < 4 && limpia.mini.h > limpia.mini.w,
    `brillo ${limpia.mini.brillo.toFixed(0)} (original ${original[2].brillo.toFixed(0)})`);
  await ctx.close();

  console.log('\n── En el iPhone no cambia nada ──');
  const movil = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p2 = await movil.newPage();
  p2.on('pageerror', (e) => errors.push('pageerror (móvil): ' + e.message));
  await p2.goto(BASE, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(1500);
  await p2.setInputFiles('input[type=file]', files.slice(0, 2));
  await p2.waitForFunction(() => document.querySelector('.busy').hidden, null, { timeout: 30_000 });
  await p2.locator('.tabbar__tab[data-tab="library"]').click();
  await p2.waitForTimeout(800);
  await p2.locator('.lib__baractions .btn', { hasText: 'Seleccionar' }).click();
  await p2.locator('.tile').first().click();
  await p2.waitForTimeout(300);
  const barra = await p2.evaluate(() => {
    const caja = (n) => n.getBoundingClientRect();
    const bar = caja(document.querySelector('.selbar'));
    const info = caja(document.querySelector('.selbar__info'));
    const cuenta = document.querySelector('.selbar__count');
    const botones = [...document.querySelectorAll('.selbar .btn')].map(caja);
    const solapa = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    return {
      dentro: botones.every((b) => b.left >= bar.left - 0.5 && b.right <= bar.right + 0.5),
      libre: botones.every((b) => !solapa(b, info)) && botones.every((b, i) => botones.every((c, j) => i === j || !solapa(b, c))),
      entero: cuenta.scrollWidth <= cuenta.clientWidth + 1 && info.right <= bar.right,
      ancho: Math.round(bar.width), alto: Math.round(bar.height), botones: botones.length,
    };
  });
  check('la barra de selección cabe con «Pegar ajustes»',
    barra.dentro && barra.libre && barra.entero && barra.botones === 3, `${barra.ancho}×${barra.alto} px`);
  const aviso = await p2.evaluate(() => {
    const t = document.querySelector('#toast')?.getBoundingClientRect();
    const bar = document.querySelector('.selbar').getBoundingClientRect();
    return !t || t.bottom <= bar.top + 1;
  });
  check('los avisos no tapan la barra de selección', aviso);
  await p2.waitForTimeout(2700);   // que se vaya el aviso de la importación
  await p2.screenshot({ path: SHOT + '/escritorio-movil-seleccion.png' });
  await p2.locator('.lib__baractions .btn', { hasText: 'Hecho' }).click();
  await p2.locator('.tile').first().click();
  await p2.waitForSelector('.viewer__media', { timeout: 20_000 });
  await p2.locator('.viewer__action', { hasText: 'Laboratorio' }).click();
  await p2.waitForFunction(() => !!window.__lab.views.lab.proxy, null, { timeout: 60_000 });
  await p2.waitForTimeout(600);
  const movilLab = await p2.evaluate(() => {
    const panel = document.querySelector('.panels').getBoundingClientRect();
    return {
      abajo: Math.round(panel.left) === 0 && Math.round(panel.width) === innerWidth,
      clip: [...document.querySelectorAll('.lab__clip')].every((b) => getComputedStyle(b).display === 'none'),
    };
  });
  check('los ajustes siguen abajo, a lo ancho', movilLab.abajo);
  check('sin los botones de copiar del Mac', movilLab.clip);
  await p2.locator('.iconbtn[aria-label="Presets"]').click();
  await p2.waitForSelector('.sheet-backdrop');
  check('copiar y pegar están en Presets',
    await p2.locator('.sheet .btn', { hasText: 'Copiar ajustes' }).count() === 1
      && await p2.locator('.sheet .btn', { hasText: 'Pegar ajustes' }).count() === 1);
  const hoja = await p2.evaluate(() => {
    const s = document.querySelector('.sheet');
    return { cabe: s.scrollWidth <= s.clientWidth + 1 && [...s.querySelectorAll('.btn')].every((b) => b.getBoundingClientRect().right <= innerWidth) };
  });
  check('y la hoja no se sale de la pantalla', hoja.cabe);
  await p2.screenshot({ path: SHOT + '/escritorio-movil-presets.png' });
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
