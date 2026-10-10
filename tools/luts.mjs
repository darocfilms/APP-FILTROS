#!/usr/bin/env node
/**
 * luts.mjs — Las emulsiones Kodak del laboratorio, como LUT.
 *
 *   node tools/luts.mjs        (necesita Playwright: npm install)
 *
 * Escribe en luts/ dos versiones de cada emulsión:
 *
 *   · Perfiles de Lightroom (.xmp). Se importan tal cual en Lightroom Classic o
 *     Lightroom, sin pasar por Photoshop, y salen en el navegador de perfiles
 *     con su deslizador de cantidad.
 *   · .cube de 33 puntos, el formato estándar: Photoshop, Premiere, DaVinci,
 *     Final Cut, CapCut…
 *
 * Los colores no se aproximan: salen del motor de la propia app. Cada punto de
 * la retícula se revela con el mismo shader que revela una foto en el
 * laboratorio —balance, acoplamiento entre capas, curva de cada canal, tono,
 * HSL, etalonaje, saturación, velado—, en coma flotante de 32 bits de punta a
 * punta: sin el tramado ni el redondeo a 8 bits de la salida normal. Lo que no
 * cabe en un LUT se queda fuera, porque no depende del color sino de la
 * posición o de los vecinos: el grano, la viñeta, la difusión y la claridad.
 *
 * Antes de escribir nada se comprueba (1) que la retícula sea exacta —con la
 * emulsión neutra tiene que salir la identidad— y (2) que aplicar el LUT a una
 * carta de color dé lo mismo que revelarla con la app entera. Y después, que
 * cada perfil de Lightroom se lea de vuelta a los mismos valores.
 *
 *   DETALLE=1     dice en qué color de la carta está la mayor diferencia
 *   LUT32_DIR=…   deja ahí también la retícula de 32 puntos de cada perfil en
 *                 .cube, para cotejar los .xmp con otro lector
 */
import pw from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const { chromium } = pw;
const ROOT = new URL('..', import.meta.url).pathname;
const OUT = path.join(ROOT, 'luts');
const PORT = 8094;

/** Las Kodak de la app que son negativo o cine. La Kodachrome es diapositiva. */
const GRUPOS = [
  {
    carpeta: 'Kodak cine',
    grupo: 'Laboratorio · Kodak cine',
    peliculas: [
      ['vision3_250d', 'Kodak Vision3 250D'],
      ['vision3_500t', 'Kodak Vision3 500T'],
      ['kodak2383', 'Kodak 2383 (copia de cine)'],
    ],
  },
  {
    carpeta: 'Kodak negativo',
    grupo: 'Laboratorio · Kodak negativo',
    peliculas: [
      ['portra400', 'Kodak Portra 400'],
      ['portra800', 'Kodak Portra 800'],
      ['gold200', 'Kodak Gold 200'],
      ['ektar100', 'Kodak Ektar 100'],
      ['trix400', 'Kodak Tri-X 400'],
    ],
  },
];

const CUBE_N = 33;   // el tamaño de .cube que todo programa entiende
const XMP_N = 32;    // el máximo de una tabla RGB de Camera Raw

/* ───────────────────────── El motor, en el navegador ───────────────────── */

/**
 * Revela una retícula N³ con el shader BASE de la app. Devuelve los valores en
 * orden .cube (el rojo varía más rápido), en sRGB codificado de 0 a 1.
 * Se ejecuta dentro de la página.
 */
async function revelarReticula({ filmId, N }) {
  const { Renderer } = await import('/js/engine/renderer.js');
  const { defaultParams, applyFilmLook } = await import('/js/data/params.js');
  const { getFilm } = await import('/js/data/films.js');

  if (!window.__lut) {
    const lienzo = document.createElement('canvas');
    lienzo.width = lienzo.height = 1;
    window.__lut = new Renderer(lienzo);
  }
  const r = window.__lut;
  const ctx = r.ctx;
  const gl = ctx.gl;
  if (!ctx.floatTargets) throw new Error('Sin EXT_color_buffer_float: no se puede leer en flotante');

  // Textura de 32 bits por canal y sin filtrar: cada píxel es un punto exacto
  // de la retícula, sin pasar por los 8 bits de una imagen normal.
  const W = N * N, H = N;
  const textura = (datos) => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, datos);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
    return { tex, width: W, height: H };
  };
  const entrada = new Float32Array(W * H * 4);
  for (let b = 0; b < N; b++) {
    for (let g = 0; g < N; g++) {
      for (let rr = 0; rr < N; rr++) {
        const i = (b * W + g * N + rr) * 4;   // x = r + g·N, y = b
        entrada[i] = rr / (N - 1);
        entrada[i + 1] = g / (N - 1);
        entrada[i + 2] = b / (N - 1);
        entrada[i + 3] = 1;
      }
    }
  }
  const src = textura(entrada);
  const dst = textura(null);

  const film = getFilm(filmId);
  const params = defaultParams();
  applyFilmLook(params, film);
  const u = r._baseUniforms(params, film);
  u.uSrc = src;
  u.uSrcLinear = 0;                         // como un JPEG: sRGB de 0 a 1
  u.uFlip = new Float32Array([1, 1]);       // fila y del framebuffer = fila y de los datos
  ctx.draw(r._prog().base, dst, u);

  gl.bindFramebuffer(gl.FRAMEBUFFER, ctx.fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst.tex, 0);
  const salida = new Float32Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, salida);
  gl.deleteTexture(src.tex);
  gl.deleteTexture(dst.tex);

  const lut = new Array(N * N * N * 3);
  for (let k = 0; k < N * N * N; k++) {
    lut[k * 3] = salida[k * 4];
    lut[k * 3 + 1] = salida[k * 4 + 1];
    lut[k * 3 + 2] = salida[k * 4 + 2];
  }
  return lut;
}

/**
 * Revela una carta de color con la app entera (sin grano, viñeta ni nada que
 * dependa de la posición) y la compara con el LUT aplicado por interpolación
 * trilineal, que es lo que hace Lightroom. Devuelve el error en niveles de 8
 * bits. Se ejecuta dentro de la página.
 */
async function compararConApp({ filmId, N, lut }) {
  const { Renderer } = await import('/js/engine/renderer.js');
  const { defaultParams, applyFilmLook } = await import('/js/data/params.js');
  const { getFilm } = await import('/js/data/films.js');

  // Carta: rampas de matiz a varias luminosidades, una rampa de grises y un
  // degradado de pieles. Cubre el cubo entero, no sólo la diagonal.
  const w = 360, h = 240;
  const carta = document.createElement('canvas');
  carta.width = w; carta.height = h;
  const g2 = carta.getContext('2d');
  for (let y = 0; y < 180; y++) {
    for (let x = 0; x < w; x++) {
      g2.fillStyle = `hsl(${x}, ${30 + (y % 60) * 1.15}%, ${8 + Math.floor(y / 60) * 30 + (y % 60) / 3}%)`;
      g2.fillRect(x, y, 1, 1);
    }
  }
  for (let x = 0; x < w; x++) {
    const v = Math.round((x / (w - 1)) * 255);
    g2.fillStyle = `rgb(${v},${v},${v})`; g2.fillRect(x, 180, 1, 30);
    g2.fillStyle = `hsl(24, ${35 + (x / w) * 25}%, ${20 + (x / w) * 65}%)`; g2.fillRect(x, 210, 1, 30);
  }
  const fuente = g2.getImageData(0, 0, w, h).data;

  const lienzo = document.createElement('canvas');
  const r = new Renderer(lienzo);
  const film = getFilm(filmId);
  const params = defaultParams();
  applyFilmLook(params, film);
  Object.assign(params.effects, { grain: 0, diffusion: 0, ca: 0 });
  params.vignette.amount = 0;
  Object.assign(params.detail, { clarity: 0, texture: 0, sharpen: 0, denoise: 0 });
  r.setSource(carta, w, h);
  r.render(params, { seed: 1 });
  const app = r.ctx.readPixels(null, 0, 0, w, h);   // de abajo arriba
  r.dispose({ release: true });

  const muestra = (x, y, z, c) => lut[((z * N + y) * N + x) * 3 + c];
  let max = 0, suma = 0, n = 0, donde = null;
  const errores = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const j = ((h - 1 - y) * w + x) * 4;
      const p = [0, 1, 2].map((c) => (fuente[i + c] / 255) * (N - 1));
      const lo = p.map((v) => Math.min(N - 2, Math.floor(v)));
      const t = p.map((v, c) => v - lo[c]);
      for (let c = 0; c < 3; c++) {
        let v = 0;
        for (let k = 0; k < 8; k++) {
          const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
          const wgt = (dx ? t[0] : 1 - t[0]) * (dy ? t[1] : 1 - t[1]) * (dz ? t[2] : 1 - t[2]);
          v += wgt * muestra(lo[0] + dx, lo[1] + dy, lo[2] + dz, c);
        }
        const e = Math.abs(Math.min(1, Math.max(0, v)) * 255 - app[j + c]);
        if (e > max) { max = e; donde = { x, y, c, rgb: [fuente[i], fuente[i + 1], fuente[i + 2]], app: [app[j], app[j + 1], app[j + 2]] }; }
        errores.push(e);
        suma += e; n++;
      }
    }
  }
  errores.sort((a, b) => a - b);
  return { max, media: suma / n, p99: errores[Math.floor(errores.length * 0.99)], p999: errores[Math.floor(errores.length * 0.999)], donde };
}

/* ─────────────────────────── Formatos de salida ────────────────────────── */

function cube(nombre, N, lut) {
  const lineas = [
    `TITLE "${nombre}"`,
    '# Laboratorio (Daroc Films) — emulsión revelada con el motor de la app.',
    '# Entrada y salida en sRGB / Rec.709 de display, de 0 a 1. Sin grano ni viñeta.',
    `LUT_3D_SIZE ${N}`,
    'DOMAIN_MIN 0.0 0.0 0.0',
    'DOMAIN_MAX 1.0 1.0 1.0',
  ];
  for (let k = 0; k < N * N * N; k++) {
    lineas.push([0, 1, 2].map((c) => Math.min(1, Math.max(0, lut[k * 3 + c])).toFixed(6)).join(' '));
  }
  return lineas.join('\n') + '\n';
}

/**
 * Tabla RGB de Camera Raw, en el formato `dng_big_table` del DNG SDK:
 *
 *   u32 tipo (1 = tabla RGB) · u32 versión (1) · u32 dimensiones (3) ·
 *   u32 divisiones · N³ muestras de 3×u16 (rojo fuera, azul dentro) guardadas
 *   como diferencia con la identidad · u32 primarios · u32 gamma · u32 gama ·
 *   f64 cantidad mínima · f64 cantidad máxima
 *
 * todo en little-endian. Primarios 0 = sRGB, gamma 1 = sRGB y gama 0 = recortar
 * es lo mismo que pone Camera Raw al crear un perfil desde un .cube en sRGB.
 * La cantidad va de 0 a 2: el deslizador del perfil llega al 200 %.
 */
function tablaRGB(N, lut) {
  const identidad = Array.from({ length: N }, (_, i) => Math.floor((i * 0xffff + (N >> 1)) / (N - 1)));
  const buf = Buffer.alloc(16 + N * N * N * 6 + 12 + 16);
  let o = 0;
  for (const v of [1, 1, 3, N]) { buf.writeUInt32LE(v, o); o += 4; }
  for (let r = 0; r < N; r++) {
    for (let g = 0; g < N; g++) {
      for (let b = 0; b < N; b++) {
        const k = (b * N + g) * N + r;
        const nop = [identidad[r], identidad[g], identidad[b]];
        for (let c = 0; c < 3; c++) {
          const v = Math.round(Math.min(1, Math.max(0, lut[k * 3 + c])) * 0xffff);
          buf.writeUInt16LE((v - nop[c]) & 0xffff, o); o += 2;
        }
      }
    }
  }
  for (const v of [0, 1, 0]) { buf.writeUInt32LE(v, o); o += 4; }
  buf.writeDoubleLE(0, o); o += 8;
  buf.writeDoubleLE(2, o); o += 8;
  return buf;
}

/** Alfabeto base 85 de Adobe: sin comillas, & ni <, para ir dentro de un atributo XML. */
const B85 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?`\'|()[]{}@%$#';

/** Cuatro bytes → cinco cifras, la menos significativa primero; el resto, bytes+1 cifras. */
function base85(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 4) {
    const n = Math.min(4, bytes.length - i);
    let x = 0;
    for (let k = 0; k < 4; k++) x += (i + k < bytes.length ? bytes[i + k] : 0) * 2 ** (8 * k);
    for (let d = 0; d < (n === 4 ? 5 : n + 1); d++) { s += B85[x % 85]; x = Math.floor(x / 85); }
  }
  return s;
}

function desdeBase85(s) {
  const out = [];
  let fase = 0, x = 0;
  for (const ch of s) {
    const d = B85.indexOf(ch);
    if (d < 0) continue;
    x += d * 85 ** fase;
    if (++fase === 5) { for (let k = 0; k < 4; k++) out.push(Math.floor(x / 2 ** (8 * k)) & 0xff); fase = 0; x = 0; }
  }
  for (let k = 0; k < fase - 1; k++) out.push(Math.floor(x / 2 ** (8 * k)) & 0xff);
  return Buffer.from(out);
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/**
 * Perfil creativo de Lightroom con la tabla dentro. La huella (`crs:RGBTable`)
 * es el MD5 de la tabla sin comprimir, en hexadecimal mayúsculo, igual que la
 * calcula el DNG SDK; el UUID se deriva del nombre para que volver a generar
 * los perfiles los sustituya al importarlos en vez de duplicarlos.
 */
function perfilXMP({ id, nombre, grupo, N, lut }) {
  const tabla = tablaRGB(N, lut);
  const huella = crypto.createHash('md5').update(tabla).digest('hex').toUpperCase();
  const tamano = Buffer.alloc(4);
  tamano.writeUInt32LE(tabla.length);
  const codificada = base85(Buffer.concat([tamano, zlib.deflateSync(tabla, { level: 9 })]));
  const uuid = crypto.createHash('md5').update('laboratorio-daroc-lut:' + id).digest('hex').toUpperCase();
  const alt = (tag, texto) => `   <crs:${tag}>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${esc(texto)}</rdf:li>
    </rdf:Alt>
   </crs:${tag}>`;
  return {
    huella,
    xmp: `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0-c000 1.000000, 0000/00/00-00:00:00        ">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
   crs:PresetType="Look"
   crs:Cluster=""
   crs:UUID="${uuid}"
   crs:SupportsAmount="True"
   crs:SupportsColor="True"
   crs:SupportsMonochrome="True"
   crs:SupportsHighDynamicRange="True"
   crs:SupportsNormalDynamicRange="True"
   crs:SupportsSceneReferred="True"
   crs:SupportsOutputReferred="True"
   crs:RequiresRGBTables="False"
   crs:CameraModelRestriction=""
   crs:Copyright="Daroc Films"
   crs:ContactInfo=""
   crs:Version="14.3"
   crs:ProcessVersion="11.0"
   crs:ConvertToGrayscale="False"
   crs:RGBTable="${huella}"
   crs:Table_${huella}="${codificada}"
   crs:HasSettings="True">
${alt('Name', nombre)}
${alt('ShortName', '')}
${alt('SortName', '')}
${alt('Group', grupo)}
${alt('Description', 'Emulsión del Laboratorio de Daroc Films, revelada con el motor de la app. Sin grano ni viñeta.')}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
`,
  };
}

/** Lee de vuelta un perfil como lo leería Camera Raw, y devuelve sus muestras en orden .cube. */
function leerPerfil(xmp) {
  const huella = xmp.match(/crs:RGBTable="([0-9A-F]{32})"/)[1];
  const texto = xmp.match(new RegExp(`crs:Table_${huella}="([^"]+)"`))[1];
  const bin = desdeBase85(texto);
  const tabla = zlib.inflateSync(bin.subarray(4));
  if (tabla.length !== bin.readUInt32LE(0)) throw new Error('tamaño declarado distinto del real');
  if (crypto.createHash('md5').update(tabla).digest('hex').toUpperCase() !== huella) throw new Error('la huella no cuadra');
  const [tipo, version, dims, N] = [0, 4, 8, 12].map((o) => tabla.readUInt32LE(o));
  if (tipo !== 1 || version !== 1 || dims !== 3) throw new Error('cabecera inesperada');
  const identidad = Array.from({ length: N }, (_, i) => Math.floor((i * 0xffff + (N >> 1)) / (N - 1)));
  const lut = new Array(N * N * N * 3);
  let o = 16;
  for (let r = 0; r < N; r++) {
    for (let g = 0; g < N; g++) {
      for (let b = 0; b < N; b++) {
        const k = (b * N + g) * N + r;
        const nop = [identidad[r], identidad[g], identidad[b]];
        for (let c = 0; c < 3; c++) { lut[k * 3 + c] = ((tabla.readUInt16LE(o) + nop[c]) & 0xffff) / 0xffff; o += 2; }
      }
    }
  }
  return { N, lut };
}

/* ──────────────────────────────── Marcha ───────────────────────────────── */

const server = spawn('node', [path.join(ROOT, 'serve.mjs'), `--port=${PORT}`], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
let fallos = 0;
try {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });

  // La retícula tiene que ser exacta: con la emulsión neutra, la identidad.
  const neutra = await page.evaluate(revelarReticula, { filmId: 'neutral', N: 17 });
  let errId = 0;
  for (let k = 0; k < 17 ** 3; k++) {
    const rgb = [k % 17, Math.floor(k / 17) % 17, Math.floor(k / 289)].map((v) => v / 16);
    for (let c = 0; c < 3; c++) errId = Math.max(errId, Math.abs(neutra[k * 3 + c] - rgb[c]));
  }
  console.log(`retícula neutra: error máximo ${errId.toExponential(1)} (tiene que ser la identidad)`);
  if (errId > 1e-4) throw new Error('la retícula no es exacta');

  // Sólo lo generado: el LEEME de la carpeta se queda.
  for (const dir of ['lightroom', 'cube']) fs.rmSync(path.join(OUT, dir), { recursive: true, force: true });
  for (const { carpeta, grupo, peliculas } of GRUPOS) {
    for (const dir of ['lightroom', 'cube']) fs.mkdirSync(path.join(OUT, dir, carpeta), { recursive: true });
    for (const [id, nombre] of peliculas) {
      const lut33 = await page.evaluate(revelarReticula, { filmId: id, N: CUBE_N });
      const lut32 = await page.evaluate(revelarReticula, { filmId: id, N: XMP_N });

      const { xmp, huella } = perfilXMP({ id, nombre, grupo, N: XMP_N, lut: lut32 });
      const leido = leerPerfil(xmp);
      let errXmp = 0;
      for (let k = 0; k < lut32.length; k++) errXmp = Math.max(errXmp, Math.abs(leido.lut[k] - Math.min(1, Math.max(0, lut32[k]))));

      const vs33 = await page.evaluate(compararConApp, { filmId: id, N: CUBE_N, lut: lut33 });
      const vs32 = await page.evaluate(compararConApp, { filmId: id, N: XMP_N, lut: leido.lut });

      // La app tiene tramado de ±0,5 niveles, así que la media no baja de un
      // cuarto. Los picos están en los verdes y azules casi neón de la carta,
      // donde la matriz de la emulsión saca el color de la gama y el recorte
      // hace una esquina que ningún LUT de 32 o 33 puntos sigue del todo; en
      // una foto real no aparecen. Por eso se mira el percentil 99, y el pico
      // se enseña para que se vea, no se esconde.
      const bien = (v) => v.media < 0.6 && v.p99 < 3.5 && v.max < 12;
      const ok = errXmp <= 1 / 65535 && bien(vs33) && bien(vs32);
      if (!ok) fallos++;
      if (process.env.DETALLE) console.log(JSON.stringify({ donde33: vs33.donde, donde32: vs32.donde }));
      const cifras = (v) => `media ${v.media.toFixed(2)} · p99 ${v.p99.toFixed(1)} · pico ${v.max.toFixed(1)}`;
      console.log(`${ok ? '✓' : '✗'} ${nombre.padEnd(27)} .cube ${cifras(vs33)}   Lightroom ${cifras(vs32)}`);

      const archivo = nombre.replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
      fs.writeFileSync(path.join(OUT, 'cube', carpeta, archivo + '.cube'), cube(nombre, CUBE_N, lut33));
      fs.writeFileSync(path.join(OUT, 'lightroom', carpeta, archivo + '.xmp'), xmp);
      // Para cotejar los perfiles con otro lector: la misma retícula de 32 puntos en .cube.
      if (process.env.LUT32_DIR) fs.writeFileSync(path.join(process.env.LUT32_DIR, id + '.cube'), cube(nombre, XMP_N, lut32));
    }
  }
} catch (err) {
  console.error(err);
  fallos++;
} finally {
  await browser.close();
  server.kill();
}
console.log(fallos ? `\n${fallos} fallo(s)` : `\nLUT escritos en ${path.relative(ROOT, OUT)}/`);
process.exit(fallos ? 1 : 0);
