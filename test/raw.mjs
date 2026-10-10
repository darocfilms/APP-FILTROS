#!/usr/bin/env node
/**
 * raw.mjs — RAW de Sony: importar, revelar, conservar las altas luces, exportar.
 *
 * Usa un ARW real de una Sony FX30 (el de las pruebas de LibRaw-Wasm). Son
 * 31 MB, así que no va en el repositorio: se descarga la primera vez a
 * test/capturas/, que está ignorada. Sin red ni copia previa la suite se omite
 * avisando, en vez de fallar por algo que no es de la app.
 */
import pw from 'playwright';
const { chromium } = pw;
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SHOT = process.env.SHOT_DIR || ROOT + 'test/capturas';
fs.mkdirSync(SHOT, { recursive: true });
const ARW = path.join(SHOT, 'muestra-sony-fx30.ARW');
const FUENTE = 'https://raw.githubusercontent.com/ybouane/LibRaw-Wasm/main/example-sony.ARW';

if (!fs.existsSync(ARW)) {
  try {
    const r = await fetch(FUENTE);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    fs.writeFileSync(ARW, Buffer.from(await r.arrayBuffer()));
  } catch (err) {
    console.log(`\n  ⚠ Sin muestra ARW (${err.message}): suite omitida.`);
    console.log(`    Copia un .ARW de Sony en ${ARW} para ejecutarla sin red.\n`);
    process.exit(0);
  }
}

const server = spawn('node', [ROOT + 'serve.mjs', '--port=8085'], { cwd: ROOT, stdio: 'ignore' });
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
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto('http://localhost:8085', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

console.log('\n── Reconocer un RAW de Sony ──');
const detecta = await page.evaluate(async () => {
  const { isRawFile, rawExtension } = await import('./js/store/raw.js');
  const f = (n, t = '') => new File([new Uint8Array(4)], n, { type: t });
  return {
    mayusculas: isRawFile(f('DSC01234.ARW')),
    minusculas: isRawFile(f('dsc01234.arw')),
    sinNombrePeroConTipo: isRawFile(f('x', 'image/x-sony-arw')),
    jpeg: isRawFile(f('foto.jpg', 'image/jpeg')),
    nombreQueContiene: isRawFile(f('arw-notas.txt')),
    extension: rawExtension(f('DSC01234.ARW')),
  };
});
check('reconoce .ARW y .arw', detecta.mayusculas && detecta.minusculas);
check('y por el tipo aunque no haya nombre', detecta.sinNombrePeroConTipo);
check('no confunde un JPEG ni un nombre que sólo contiene «arw»',
  !detecta.jpeg && !detecta.nombreQueContiene);
check('se guardaría como .arw', detecta.extension === 'arw', detecta.extension);

console.log('\n── La conversión a media precisión es exacta ──');
// Las 63 488 combinaciones finitas de un float16: ida y vuelta sin perder un bit.
const media = await page.evaluate(async () => {
  const { _interno } = await import('./js/store/raw.js');
  const { toHalf, halfLUT } = _interno;
  const lut = halfLUT();
  let malas = 0, primera = null;
  for (let h = 0; h < 65536; h++) {
    const e = (h >> 10) & 0x1f;
    if (e === 31) continue;                    // infinitos y NaN
    if (h === 0x8000) continue;                // −0 vuelve como +0 o −0: da igual
    if (toHalf(lut[h]) !== h) { malas++; primera ??= h; }
  }
  return { malas, primera, uno: toHalf(1), max: toHalf(65504), diminuto: toHalf(1e-9) };
});
check('ida y vuelta exacta en todos los float16 finitos', media.malas === 0,
  media.malas ? media.malas + ' fallan, la primera 0x' + media.primera.toString(16) : '');
check('1,0 es 0x3C00 y el máximo 0x7BFF', media.uno === 0x3c00 && media.max === 0x7bff);

console.log('\n── Importar el ARW ──');
await page.setInputFiles('input[type=file]', ARW);
await page.waitForFunction(() => window.__lab?.views?.lab?.renderer?.srcLinear === true,
  null, { timeout: 120_000 });
await page.waitForTimeout(1500);
const item = await page.evaluate(async () => {
  const { library } = await import('./js/store/library.js');
  const it = (await library.list())[0];
  const thumb = await library.getThumbBlob(it.id);
  return { ...it, thumb: thumb?.size || 0, params: undefined, appliedParams: undefined };
});
check('entra en la biblioteca marcado como RAW', item.raw === true);
check('guardado como .arw, no como .bin', /\.arw$/.test(item.name), item.name);
check('con su tipo aunque el navegador no lo diera', item.mime === 'image/x-sony-arw', item.mime);
check('con las dimensiones del sensor', item.width === 6240 && item.height === 4168, item.width + '×' + item.height);
check('y con miniatura', item.thumb > 2000, item.thumb + ' bytes');

console.log('\n── Se revela como luz, no como JPEG ──');
const lab = await page.evaluate(() => {
  const v = window.__lab.views.lab;
  return {
    titulo: v.title.textContent,
    subtitulo: v.subtitle.textContent,
    lineal: v.renderer.srcLinear,
    texturaLineal: !!v.renderer.srcTex?.linear,
    proxy: v.proxy.width + '×' + v.proxy.height,
    proxyLineal: !!v.proxy.linear,
    flotante: v.renderer.ctx.floatTargets,
  };
});
check('el laboratorio lo dice: RAW y la cámara', lab.titulo === 'RAW' && /ILME-FX30/.test(lab.subtitulo), lab.subtitulo);
check('la fuente es lineal en una textura flotante', lab.lineal && lab.texturaLineal && lab.proxyLineal);
check('a tamaño de edición, no de sensor', /^\d+×\d+$/.test(lab.proxy) && parseInt(lab.proxy, 10) <= 2560, lab.proxy);
check('el dispositivo puede dibujar en flotante', lab.flotante === true);

/**
 * Pinta el laboratorio con unos ajustes y mide el lienzo a resolución real.
 *
 * Además de la mediana y lo quemado, cuenta cuántos colores distintos quedan
 * en las sombras al levantarlas: es donde se ve la profundidad de bits. Las
 * sombras se eligen una vez, en el revelado neutro, y luego se miran SIEMPRE
 * los mismos píxeles, venga la imagen como RAW o como 8 bits.
 */
const medir = (ajustes) => page.evaluate(async (a) => {
  const v = window.__lab.views.lab;
  const { defaultParams } = await import('./js/data/params.js');
  const pintar = (ev, fuente8) => {
    const p = defaultParams();
    p.light.exposure = ev;
    if (a.rotate) p.geometry.rotate = a.rotate;
    if (a.film) p.film.id = a.film;
    if (fuente8) {
      // La misma imagen como un JPEG de 8 bits: su revelado neutro en un canvas.
      const c = v.proxy.toCanvas();
      v.renderer.setSource(c, c.width, c.height);
    } else {
      v.renderer.setSource(v.proxy, v.proxy.width, v.proxy.height);
    }
    v.renderer.render(p, { seed: 1, bypass: !!a.antes });
    const cv = v.renderer.canvas;
    const o = document.createElement('canvas');
    o.width = cv.width; o.height = cv.height;
    const g = o.getContext('2d');
    g.drawImage(cv, 0, 0);
    return g.getImageData(0, 0, o.width, o.height).data;
  };
  // Máscara de sombras (el 10 % más oscuro del neutro), una por encuadre.
  window.__sombras ??= {};
  const clave = String(a.rotate || 0);
  if (!window.__sombras[clave]) {
    const d = pintar(0, false);
    const Y = new Float32Array(d.length / 4);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) Y[j] = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const corte = Float32Array.from(Y).sort()[Math.floor(Y.length * 0.1)];
    window.__sombras[clave] = Y.map((y) => (y <= corte ? 1 : 0));
  }
  const mascara = window.__sombras[clave];

  const d = pintar(a.ev ?? 0, !!a.fuente8);
  const Y = [];
  let quemados = 0;
  const niveles = new Set();
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    if (j % 7 === 0) Y.push(y);
    if (d[i] >= 255 || d[i + 1] >= 255 || d[i + 2] >= 255) quemados++;
    if (mascara[j]) niveles.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  }
  Y.sort((x, y) => x - y);
  return {
    mediana: +Y[Y.length >> 1].toFixed(1),
    maximo: +Y[Y.length - 1].toFixed(1),
    quemado: +(quemados / (d.length / 4) * 100).toFixed(2),
    nivelesSombra: niveles.size,
  };
}, ajustes);

const neutro = await medir({});
check('abre con medios sanos, ni negro ni lavado', neutro.mediana > 60 && neutro.mediana < 170, JSON.stringify(neutro));
check('y la saturación del sensor no llega a quemar en blanco', neutro.quemado < 0.5, neutro.quemado + ' % con algún canal en 255');
await page.screenshot({ path: SHOT + '/raw-laboratorio.png' });

console.log('\n── Lo que un RAW tiene y un JPEG no ──');
/* El argumento entero de abrir un RAW, medido contra la misma imagen metida
   como JPEG de 8 bits (su propio revelado neutro dibujado en un canvas). */
const raw15 = await medir({ ev: 1.5 });
const jpg15 = await medir({ ev: 1.5, fuente8: true });
check('+1,5 EV: el 8 bits quema las luces, el RAW las curva hacia el blanco',
  jpg15.quemado > 1 && raw15.quemado < jpg15.quemado / 4,
  `quemado: RAW ${raw15.quemado} % · 8 bits ${jpg15.quemado} %`);
const raw3 = await medir({ ev: 3 });
const jpg3 = await medir({ ev: 3, fuente8: true });
// Más del doble: con la misma imagen, la única diferencia es la profundidad.
check('+3 EV en las sombras: el RAW tiene más del doble de tonos que el 8 bits',
  raw3.nivelesSombra > jpg3.nivelesSombra * 2,
  `colores distintos en las sombras: RAW ${raw3.nivelesSombra} · 8 bits ${jpg3.nivelesSombra}`);
const rawMenos = await medir({ ev: -1.5 });
check('−1,5 EV oscurece sin dejar nada quemado', rawMenos.mediana < neutro.mediana && rawMenos.quemado === 0,
  JSON.stringify(rawMenos));

console.log('\n── Girar no cuesta nada ──');
/* El pase de geometría escribe en un intermedio. Si fuera de 8 bits, la luz
   lineal se cuantizaría ahí a 256 niveles —en lineal, que es lo peor para las
   sombras— y además se recortaría en 1. Las dos cosas se medirían aquí. */
const girado3 = await medir({ ev: 3, rotate: 90 });
check('girado 90° y a +3 EV, las sombras conservan sus tonos',
  girado3.nivelesSombra > raw3.nivelesSombra * 0.7,
  `${girado3.nivelesSombra} girado · ${raw3.nivelesSombra} sin girar`);
const girado15 = await medir({ ev: 1.5, rotate: 90 });
check('y a +1,5 EV no quema más que sin girar',
  Math.abs(girado15.quemado - raw15.quemado) < 0.5 + raw15.quemado * 0.3,
  `${girado15.quemado} % girado · ${raw15.quemado} % sin girar`);

console.log('\n── Con emulsión ──');
const copia = await medir({ film: 'kodak2383' });
check('con la copia de cine 2383 revela normal', copia.mediana > 40 && copia.mediana < 190, JSON.stringify(copia));

console.log('\n── Antes / después ──');
// El «antes» de un RAW no puede ser la luz lineal en bruto (saldría oscura):
// tiene que ser su revelado neutro.
const antes = await medir({ antes: true, ev: 2 });
check('el «antes» es el revelado neutro, no la luz lineal en bruto',
  Math.abs(antes.mediana - neutro.mediana) < 4, `antes ${antes.mediana} · neutro ${neutro.mediana}`);

console.log('\n── Las miniaturas del selector de emulsión ──');
await page.waitForTimeout(2000);
const tarjetas = await page.evaluate(() => {
  const fp = window.__lab.views.lab.panels.filmPicker;
  return [...fp.cards.values()].filter((c) => c.rendered).length;
});
check('se revelan a partir del RAW', tarjetas > 0, tarjetas + ' tarjetas');

console.log('\n── Exportar a resolución completa ──');
// El mismo camino que el botón Exportar a «Original», sin la hoja de compartir.
const exportado = await page.evaluate(async () => {
  const { library, decodeScaled } = await import('./js/store/library.js');
  const { renderToBlob } = await import('./js/engine/renderer.js');
  const v = window.__lab.views.lab;
  const file = await library.getFile(v.item.id);
  const t0 = performance.now();
  const dec = await decodeScaled(file, 1e9);
  const tDec = performance.now() - t0;
  const { blob, width, height } = await renderToBlob(dec.bitmap, v.params, { type: 'image/jpeg', quality: 0.9 });
  dec.bitmap.close();
  const bm = await createImageBitmap(blob);
  return { width, height, jpg: bm.width + '×' + bm.height, kb: Math.round(blob.size / 1024),
           revelado: Math.round(tDec) + ' ms', lineal: dec.raw === true };
}).catch((e) => ({ error: e.message }));
check('sale a la resolución del sensor', exportado.width === 6240 && exportado.height === 4168
  && exportado.jpg === '6240×4168', JSON.stringify(exportado));

console.log('\n── El visor de la biblioteca lo enseña ──');
await page.locator('.tabbar__tab[data-tab="library"]').click();
await page.waitForTimeout(800);
await page.locator('.tile').first().click();
await page.waitForFunction(() => document.querySelector('.viewer__media')?.naturalWidth > 0, null, { timeout: 60_000 })
  .catch(() => {});
const visor = await page.evaluate(() => ({
  img: document.querySelector('.viewer__media')?.naturalWidth || 0,
  meta: document.querySelector('.viewer__meta')?.textContent || '',
  falla: !!document.querySelector('.viewer__missing'),
}));
check('un <img> no sabe pintar un ARW: el visor lo revela', visor.img > 500 && !visor.falla, visor.img + ' px');
check('y lo marca como RAW', /RAW/.test(visor.meta), visor.meta);
await page.screenshot({ path: SHOT + '/raw-visor.png' });

console.log('\n── Errores de consola ──');
const reales = errors.filter((e) => !/favicon|vibrate/i.test(e));
check('sin errores', reales.length === 0, reales.slice(0, 3).join(' | '));

console.log('\nResultado: ' + (failures ? failures + ' fallo(s)' : 'todo correcto'));
await browser.close();
server.kill();
process.exit(failures ? 1 : 0);
