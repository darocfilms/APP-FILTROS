#!/usr/bin/env node
/**
 * mac.mjs — La app de Mac (mac/), con Electron de verdad.
 *
 * Arranca la app con Playwright tal y como la arranca el Dock y comprueba lo
 * que sólo existe en ella: el protocolo laboratorio:// (con el tipo correcto
 * para el WebAssembly), los menús, los descodificadores de HEIF y RAW en sus
 * workers bajo ese protocolo, abrir archivos con la app («Abrir con», soltar en
 * el Dock), que guardar va directo a Imágenes › Laboratorio › Exportadas sin
 * pisar nada, y que la biblioteca sigue ahí al volver a abrir la app.
 *
 * Necesita `npm install` en mac/ (trae Electron). Sin él, la suite se omite
 * avisando. En Linux sin pantalla se vuelve a lanzar bajo xvfb-run.
 */
import pw from 'playwright';
import { spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const MAC = path.join(ROOT, 'mac');
const SHOT = process.env.SHOT_DIR || ROOT + 'test/capturas';
fs.mkdirSync(SHOT, { recursive: true });

let electronBin = null;
try { electronBin = createRequire(path.join(MAC, 'package.json'))('electron'); } catch { /* sin instalar */ }
if (!electronBin || !fs.existsSync(electronBin)) {
  console.log('\n  ⚠ Electron no está instalado en mac/: suite omitida. (cd mac && npm install)\n');
  process.exit(0);
}
// Sin pantalla (un servidor Linux), bajo una virtual.
if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.LAB_XVFB) {
  const r = spawnSync('xvfb-run', ['-a', process.execPath, process.argv[1]], { stdio: 'inherit', env: { ...process.env, LAB_XVFB: '1' } });
  process.exit(r.status ?? 1);
}

let failures = 0;
const errors = [];
const check = (n, ok, d = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + n + (d ? '  ' + d : ''));
  if (!ok) failures++;
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Espera a que `fn` (en la página) dé verdadero. No vale waitForFunction: la
 * app tiene una CSP sin 'unsafe-eval', y Playwright construye ahí la función
 * a partir de texto. page.evaluate va por el protocolo de depuración y sí pasa.
 */
async function hasta(page, fn, arg, ms = 30_000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await page.evaluate(fn, arg).catch(() => false)) return true;
    await esperar(250);
  }
  return false;
}

// La web que lleva dentro, recién construida.
execFileSync(process.execPath, [path.join(ROOT, 'build.mjs')], { stdio: 'ignore' });

console.log('\n── El servidor del protocolo, suelto ──');
const { responder, rutaDe, nombreLibre } = createRequire(import.meta.url)(path.join(MAC, 'servidor.js'));
const DIST = path.join(ROOT, 'dist');
const wasm = responder('laboratorio://app/js/vendor/libraw/libraw.wasm', DIST);
check('sirve el WebAssembly con su tipo', wasm.estado === 200 && wasm.tipo === 'application/wasm' && wasm.cuerpo.length > 1e6, wasm.tipo);
check('la raíz es index.html', /<title>/.test(String(responder('laboratorio://app/', DIST).cuerpo)));
check('lo que no existe da 404', responder('laboratorio://app/no-existe.js', DIST).estado === 404);
const fuera = ['laboratorio://app/../mac/main.js', 'laboratorio://app/..%2f..%2fmac%2fmain.js', 'laboratorio://app/%2e%2e/%2e%2e/etc/passwd']
  .map((u) => rutaDe(u, DIST)).every((r) => r === null || r.startsWith(DIST + path.sep));
check('nunca sale de la carpeta de la web', fuera);
const tmpNombres = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-nombres-'));
fs.writeFileSync(path.join(tmpNombres, 'foto.jpg'), 'x');
check('un nombre libre no pisa el que ya hay', path.basename(nombreLibre(tmpNombres, 'foto.jpg')) === 'foto 2.jpg');

const DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-datos-'));
const IMAGENES = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-imagenes-'));
const lanzar = () => pw._electron.launch({
  executablePath: electronBin,
  // En Linux sin GPU (la pantalla virtual) WebGL2 va por el renderizador
  // por software de Chromium, como en las demás suites; en un Mac, la GPU.
  args: [MAC, ...(process.platform === 'linux'
    ? ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])],
  env: { ...process.env, LABORATORIO_DATOS: DATOS, LABORATORIO_IMAGENES: IMAGENES },
});

let app = await lanzar();
try {
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.waitForSelector('.tabbar__tab', { timeout: 30_000 });
  await page.waitForTimeout(800);

  console.log('\n── Arranque ──');
  const arranque = await page.evaluate(async () => ({
    url: location.href,
    clases: document.documentElement.className,
    version: window.laboratorioMac?.version,
    sw: await navigator.serviceWorker?.getRegistrations?.().then((r) => r.length).catch(() => 0) ?? 0,
    pestañas: document.querySelectorAll('.tabbar__tab').length,
    arriba: getComputedStyle(document.documentElement).getPropertyValue('--arriba').trim(),
    seguro: window.isSecureContext,
  }));
  const tamaño = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  check('abre su propia ventana con la app de dentro', arranque.url === 'laboratorio://app/index.html' && arranque.pestañas === 3, arranque.url);
  check('ventana grande de Mac', tamaño.width >= 1200 && tamaño.height >= 800, `${tamaño.width}×${tamaño.height}`);
  check('la página sabe que está en la app de Mac', /\bapp-mac\b/.test(arranque.clases) && !!arranque.version, `Electron ${arranque.version}`);
  check('es un contexto seguro (cámara, sistema de archivos)', arranque.seguro);
  check('no registra service worker: los archivos ya van dentro', arranque.sw === 0);
  if (process.platform === 'darwin') {
    check('deja la franja de los semáforos libre', /app-mac--barra/.test(arranque.clases) && arranque.arriba === '34px', arranque.arriba);
  }

  console.log('\n── La barra de menús ──');
  const menu = await app.evaluate(({ Menu }) => {
    const m = Menu.getApplicationMenu();
    const ver = (id) => { const it = m.getMenuItemById(id); return it ? `${it.label}|${it.accelerator || ''}` : null; };
    return { arriba: m.items.map((i) => i.label), camara: ver('ver-camera'), lab: ver('ver-lab'), biblioteca: ver('ver-library'), importar: ver('importar'), exportar: ver('exportar') };
  });
  check('Archivo, Edición, Ver, Ventana y Ayuda', ['Archivo', 'Edición', 'Ver', 'Ventana', 'Ayuda'].every((n) => menu.arriba.includes(n)), menu.arriba.join(' · '));
  check('las secciones en ⌘1, ⌘2 y ⌘3', menu.camara === 'Cámara|CmdOrCtrl+1' && menu.lab === 'Laboratorio|CmdOrCtrl+2' && menu.biblioteca === 'Biblioteca|CmdOrCtrl+3',
    [menu.camara, menu.lab, menu.biblioteca].join(' · '));
  check('importar (⌘O) y exportar (⌘E)', /CmdOrCtrl\+O$/.test(menu.importar) && /CmdOrCtrl\+E$/.test(menu.exportar));
  const pulsar = (id) => app.evaluate(({ Menu }, i) => Menu.getApplicationMenu().getMenuItemById(i).click(), id);
  await pulsar('ver-library');
  await page.waitForTimeout(600);
  check('Ver › Biblioteca lleva a la biblioteca', await page.evaluate(() => window.__lab.current === 'library'));
  await pulsar('ver-carrusel');
  await hasta(page, () => document.querySelector('.carrusel')?.classList.contains('is-abierto'), null, 5000);
  check('Ver › Cambiar de sección abre el carrusel', await page.evaluate(() => document.querySelector('.carrusel').classList.contains('is-abierto')));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  await pulsar('importar');
  await page.waitForTimeout(500);
  check('Archivo › Importar abre el menú de importación', await page.evaluate(() => !document.querySelector('.imp').hidden));
  await page.evaluate(() => window.__lab.importer.cerrar());
  await page.waitForTimeout(300);

  console.log('\n── Abrir con Laboratorio (y soltar en el Dock) ──');
  const abrirCon = (ruta) => app.evaluate(({ app: a }, r) => a.emit('open-file', { preventDefault() {} }, r), ruta);
  const cuantas = () => page.evaluate(async () => (await (await import('./js/store/library.js')).library.list()).length);
  const antes = await cuantas();
  await abrirCon(path.join(ROOT, 'test/muestras/muestra-iphone.heic'));
  await hasta(page, async (n) => (await (await import('./js/store/library.js')).library.list()).length > n, antes, 60_000);
  await hasta(page, () => window.__lab.current === 'lab' && !!window.__lab.views.lab.proxy && document.querySelector('.busy').hidden, null, 60_000);
  const heic = await page.evaluate(async () => {
    const [ultimo] = await (await import('./js/store/library.js')).library.list();
    return { nombre: ultimo?.fuente?.nombre || ultimo?.name, w: ultimo?.width, h: ultimo?.height, seccion: window.__lab.current };
  });
  check('un HEIC abierto con la app entra en la biblioteca, descodificado con libheif', heic.w === 2400 && heic.h === 1800, JSON.stringify(heic));
  check('y se abre en el laboratorio', heic.seccion === 'lab', heic.seccion);
  const ARW = path.join(ROOT, 'test/capturas/muestra-sony-fx30.ARW');
  if (fs.existsSync(ARW)) {
    const n = await cuantas();
    await abrirCon(ARW);
    await hasta(page, async (k) => (await (await import('./js/store/library.js')).library.list()).length > k, n, 120_000);
    await hasta(page, async () => {
      const [ultimo] = await (await import('./js/store/library.js')).library.list();
      return window.__lab.views.lab.item?.id === ultimo?.id && !!window.__lab.views.lab.proxy && document.querySelector('.busy').hidden;
    }, null, 120_000);
    const raw = await page.evaluate(async () => {
      const [ultimo] = await (await import('./js/store/library.js')).library.list();
      return { raw: ultimo?.raw, w: ultimo?.width, h: ultimo?.height, lab: window.__lab.views.lab.item?.id === ultimo?.id };
    });
    check('un ARW de Sony también, revelado con LibRaw', raw.raw && raw.w === 6240 && raw.h === 4168 && raw.lab, JSON.stringify(raw));
  } else {
    console.log('  ⚠ sin muestra ARW en test/capturas: se omite el RAW (la descarga raw.mjs)');
  }
  await page.screenshot({ path: SHOT + '/mac-laboratorio.png' });

  console.log('\n── Guardar va a Imágenes › Laboratorio › Exportadas ──');
  await page.evaluate(async () => {
    const { saveFiles } = await import('./js/utils/share.js');
    const c = document.createElement('canvas'); c.width = 40; c.height = 30;
    c.getContext('2d').fillRect(0, 0, 40, 30);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg'));
    await saveFiles(blob, 'prueba.jpg');
    await new Promise((r) => setTimeout(r, 300));
    await saveFiles(blob, 'prueba.jpg');
  });
  const carpeta = path.join(IMAGENES, 'Laboratorio', 'Exportadas');
  for (let i = 0; i < 40 && !(fs.existsSync(path.join(carpeta, 'prueba 2.jpg'))); i++) await esperar(150);
  const guardadas = fs.existsSync(carpeta) ? fs.readdirSync(carpeta).sort() : [];
  check('sin diálogo, a la carpeta de Exportadas', guardadas.includes('prueba.jpg'), guardadas.join(', '));
  check('y la segunda no pisa la primera', guardadas.includes('prueba 2.jpg'), guardadas.join(', '));
  check('con los bytes de la foto', guardadas.includes('prueba.jpg') && fs.readFileSync(path.join(carpeta, 'prueba.jpg')).subarray(0, 2).toString('hex') === 'ffd8');

  const reales = errors.filter((x) => !/favicon|vibrate|Autofill|GPU stall/i.test(x));
  check('sin errores en la consola', reales.length === 0, reales.slice(0, 3).join(' | '));
} finally {
  await app.close();
}

console.log('\n── Al volver a abrir la app ──');
app = await lanzar();
try {
  const page = await app.firstWindow();
  await page.waitForSelector('.tabbar__tab', { timeout: 30_000 });
  await page.waitForTimeout(800);
  const n = await page.evaluate(async () => (await (await import('./js/store/library.js')).library.list()).length);
  check('la biblioteca sigue ahí', n >= 1, n + ' elementos');
} finally {
  await app.close();
}

/* La app empaquetada busca la web en Resources/web, no en la dist/ del
   repositorio. En un Mac la empaqueta GitHub Actions; aquí se empaqueta para
   este sistema con la misma configuración y se comprueba que arranca. */
console.log('\n── Empaquetada ──');
const SALIDA = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-paquete-'));
const plataforma = process.platform === 'darwin' ? '--mac' : process.platform === 'win32' ? '--win' : '--linux';
const builder = path.join(MAC, 'node_modules', '.bin', 'electron-builder');
let empaquetada = null;
if (fs.existsSync(builder)) {
  const r = spawnSync(builder, [plataforma, '--dir', '--publish', 'never', `-c.directories.output=${SALIDA}`],
    { cwd: MAC, encoding: 'utf8', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
  const buscar = (dir) => {
    for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, n.name);
      if (n.isDirectory() && n.name.endsWith('.app')) return path.join(p, 'Contents', 'MacOS', 'Laboratorio');
      if (n.isDirectory()) { const x = buscar(p); if (x) return x; }
      else if (/^(laboratorio-mac|Laboratorio)(\.exe)?$/i.test(n.name)) return p;
    }
    return null;
  };
  empaquetada = r.status === 0 ? buscar(SALIDA) : null;
  check('se empaqueta con la configuración de mac/package.json', !!empaquetada, r.status === 0 ? empaquetada : (r.stderr || r.stdout).slice(-300));
  const web = empaquetada && [path.join(path.dirname(empaquetada), 'resources', 'web'), path.join(path.dirname(empaquetada), '..', 'Resources', 'web')].find((d) => fs.existsSync(d));
  check('con la web dentro (Resources/web)', !!web && fs.existsSync(path.join(web, 'js', 'vendor', 'libraw', 'libraw.wasm')), web || '');
}
if (empaquetada) {
  const paquete = await pw._electron.launch({
    executablePath: empaquetada,
    args: process.platform === 'linux' ? ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
    env: { ...process.env, LABORATORIO_DATOS: fs.mkdtempSync(path.join(os.tmpdir(), 'lab-datos2-')), LABORATORIO_IMAGENES: IMAGENES },
  });
  try {
    const page = await paquete.firstWindow();
    await page.waitForSelector('.tabbar__tab', { timeout: 30_000 }).catch(() => {});
    const r = await page.evaluate(() => ({ url: location.href, pestañas: document.querySelectorAll('.tabbar__tab').length }));
    check('y la app empaquetada arranca con ella', r.url === 'laboratorio://app/index.html' && r.pestañas === 3, JSON.stringify(r));
  } finally {
    await paquete.close();
  }
} else if (!fs.existsSync(builder)) {
  console.log('  ⚠ sin electron-builder en mac/: se omite');
}
fs.rmSync(SALIDA, { recursive: true, force: true });

console.log(failures ? `\n${failures} comprobaciones fallidas\n` : '\nTodo en orden\n');
process.exit(failures ? 1 : 0);
