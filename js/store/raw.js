/**
 * raw.js — RAW de Sony (ARW) revelados con LibRaw en WebAssembly.
 *
 * Un RAW no es una foto más: son los datos del sensor, lineales y con 14 bits
 * por canal. Convertirlo a un JPEG de 8 bits al abrirlo tiraría justo lo que lo
 * hace valer la pena —las altas luces que la cámara captó por encima del
 * blanco y la gradación en las sombras—, así que aquí se convierte a luz
 * lineal en coma flotante de media precisión y el motor la revela tal cual
 * (ver `uploadLinear` en glcore.js y `uSrcLinear` en el shader).
 *
 * El decodificador es LibRaw, en su compilación SIN hilos (js/vendor/libraw).
 * La compilación con hilos necesita memoria compartida, que Safari sólo da a
 * las páginas con aislamiento de origen cruzado: GitHub Pages no deja poner
 * esas cabeceras, y la app nativa tampoco las tiene. Sin hilos funciona en
 * cualquier sitio, en su propio worker para no congelar la interfaz.
 */

import LibRaw from '../vendor/libraw/index.js';

export const RAW_MIME = 'image/x-sony-arw';
const EXTENSION = /\.(arw|sr2|srf)$/i;
const TIPO = /^image\/x-sony-(arw|sr2|srf)$/i;

/** ¿Es un RAW de Sony? Por el nombre o por el tipo: iOS suele mandarlo sin tipo. */
export function isRawFile(file) {
  if (!file) return false;
  return EXTENSION.test(file.name || '') || TIPO.test(file.type || '');
}

/** Extensión con la que se guarda en la carpeta local: la suya, en minúsculas. */
export function rawExtension(file) {
  return ((file?.name || '').match(EXTENSION)?.[1]
    || (file?.type || '').match(TIPO)?.[1]
    || 'arw').toLowerCase();
}

/**
 * Exposición que se suma al abrir, en diafragmas: ninguna.
 *
 * El RAW abre con la luz que registró el sensor, con su saturación en el
 * blanco. Se probó a igualarlo con el JPEG que la cámara guarda dentro del
 * ARW, y no sirve de referencia: lleva el estilo de imagen de la cámara. En la
 * FX30 de las pruebas, ese JPEG salía 0,7 EV más oscuro que la propia luz del
 * sensor; igualarlo habría sido copiar un look, no medir nada.
 */
export const BASELINE_EV = 0;

/**
 * Por encima de estos megapíxeles el RAW se revela a media resolución también
 * al exportar. Una A7 IV (33 Mpx) entra entera; una A7R V (61 Mpx) saldría a
 * 15 Mpx, porque entera serían más de 300 MB de luz en coma flotante entre la
 * memoria del worker y la de la GPU, y Safari en iPhone cierra la pestaña.
 */
export const MAX_FULL_PIXELS = 36e6;

const AJUSTES = {
  outputBps: 16,       // 16 bits: el sentido de abrir un RAW
  outputColor: 1,      // primarios sRGB, los del resto del motor
  useCameraWb: true,   // el balance que eligió la cámara; la temperatura se ajusta después
  noAutoBright: true,  // sin autoexposición: la luz que hubo
  gamm: [1, 1],        // lineal: la curva la pone la emulsión, no LibRaw
  highlight: 0,        // donde el sensor saturó, blanco neutro
  userQual: 3,         // AHD, el reparto de color más limpio de LibRaw
};

/* ───────────────────────── Media precisión ─────────────────────────────── */

const F32 = new Float32Array(1);
const U32 = new Uint32Array(F32.buffer);

/** Float32 → bits de un float16, redondeando al más cercano. */
function toHalf(v) {
  F32[0] = v;
  const x = U32[0];
  const signo = (x >>> 16) & 0x8000;
  const exp = ((x >>> 23) & 0xff) - 112;   // 127 − 15
  const mant = x & 0x7fffff;
  if (exp <= 0) {
    if (exp < -10) return signo;            // por debajo del menor subnormal
    return signo | (((mant | 0x800000) >> (1 - exp)) + 0x1000 >> 13);
  }
  if (exp >= 31) return signo | 0x7c00;      // fuera de rango: infinito
  // Suma y no OR: si el redondeo desborda la mantisa, sube el exponente.
  return signo | ((exp << 10) + ((mant + 0x1000) >> 13));
}

let MEDIA_A_FLOAT = null;
/** Tabla de los 65 536 float16 posibles a float32. */
function halfLUT() {
  if (MEDIA_A_FLOAT) return MEDIA_A_FLOAT;
  const t = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const s = h & 0x8000 ? -1 : 1;
    const e = (h >> 10) & 0x1f;
    const m = h & 0x3ff;
    t[h] = e === 0 ? s * m * 2 ** -24
      : e === 31 ? (m ? NaN : s * Infinity)
        : s * (1 + m / 1024) * 2 ** (e - 15);
  }
  return (MEDIA_A_FLOAT = t);
}

/**
 * Reduce una imagen RGB intercalada por promedio de áreas. `tabla` traduce
 * cada valor de origen a float (enteros de 16 bits o float16, según el caso),
 * así que la misma función sirve para los dos formatos sin copias intermedias.
 */
function reducir(src, sw, sh, dw, dh, tabla) {
  const acc = new Float32Array(dw * dh * 3);
  const cuenta = new Uint32Array(dw * dh);
  const columna = new Uint32Array(sw);
  for (let x = 0; x < sw; x++) columna[x] = Math.min(dw - 1, (x * dw / sw) | 0);
  for (let y = 0; y < sh; y++) {
    const fila = Math.min(dh - 1, (y * dh / sh) | 0) * dw;
    for (let x = 0, i = y * sw * 3; x < sw; x++, i += 3) {
      const o = fila + columna[x];
      const k = o * 3;
      acc[k] += tabla[src[i]];
      acc[k + 1] += tabla[src[i + 1]];
      acc[k + 2] += tabla[src[i + 2]];
      cuenta[o]++;
    }
  }
  for (let o = 0, k = 0; o < cuenta.length; o++, k += 3) {
    const inv = 1 / cuenta[o];
    acc[k] *= inv; acc[k + 1] *= inv; acc[k + 2] *= inv;
  }
  return acc;
}

/* ─────────────── Vista previa de 8 bits (miniaturas, visor) ─────────────── */

// Lo mismo que hace el shader sin emulsión con una fuente lineal: hombro suave
// por encima de 0,8 y codificación sRGB. Así la miniatura de la biblioteca es
// la misma imagen que se abre en el laboratorio, no otra.
const HOMBRO = 0.8;
const PASOS = 4096;          // muestras por unidad de luz lineal
const TOPE = 4;              // hasta 4× el blanco; abierto en neutro, un RAW no pasa de 1
let A_SRGB8 = null;
function srgb8LUT() {
  if (A_SRGB8) return A_SRGB8;
  const t = new Uint8Array(PASOS * TOPE + 1);
  for (let i = 0; i < t.length; i++) {
    let x = i / PASOS;
    if (x > HOMBRO) x = HOMBRO + (x - HOMBRO) / (1 + (x - HOMBRO) / (1 - HOMBRO));
    const s = x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;
    t[i] = Math.max(0, Math.min(255, Math.round(s * 255)));
  }
  return (A_SRGB8 = t);
}

/* ─────────────────────────── Imagen lineal ─────────────────────────────── */

/**
 * Luz lineal en float16, tres canales intercalados. El motor la reconoce por
 * `linear` y la sube a una textura de coma flotante (Renderer.setSource).
 */
export class LinearImage {
  constructor(width, height, data, info = {}) {
    this.linear = true;
    this.width = width;
    this.height = height;
    this.data = data;
    this.info = info;
  }

  /** Suelta los datos: una imagen de 26 Mpx son 150 MB. */
  close() { this.data = null; }

  /** Copia reducida en el mismo formato, para cuando no cabe en una textura. */
  resized(w, h) {
    const f = reducir(this.data, this.width, this.height, w, h, halfLUT());
    const data = new Uint16Array(f.length);
    for (let i = 0; i < f.length; i++) data[i] = toHalf(f[i]);
    return new LinearImage(w, h, data, this.info);
  }

  /** Lienzo de 8 bits con el revelado neutro, para miniaturas y el visor. */
  toCanvas(maxSide = Infinity) {
    const k = Math.min(1, maxSide / Math.max(this.width, this.height));
    const w = Math.max(1, Math.round(this.width * k));
    const h = Math.max(1, Math.round(this.height * k));
    const reducida = w === this.width && h === this.height
      ? null
      : reducir(this.data, this.width, this.height, w, h, halfLUT());
    const lut = halfLUT();
    const enc = srgb8LUT();
    const lim = enc.length - 1;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(w, h);
    const px = img.data;
    const leer = reducida ? (i) => reducida[i] : (i) => lut[this.data[i]];
    for (let p = 0, i = 0, j = 0, n = w * h; p < n; p++, i += 3, j += 4) {
      px[j] = enc[Math.min(lim, (leer(i) * PASOS) | 0)];
      px[j + 1] = enc[Math.min(lim, (leer(i + 1) * PASOS) | 0)];
      px[j + 2] = enc[Math.min(lim, (leer(i + 2) * PASOS) | 0)];
      px[j + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }
}

/* ─────────────────────────── Decodificación ─────────────────────────────── */

/**
 * Abre un RAW al tamaño necesario y nada más.
 *
 * LibRaw sabe revelar a media resolución sin interpolar —agrupando cada
 * cuadrado de cuatro fotositos—, que es cuatro veces más rápido y ocupa la
 * cuarta parte. Se usa siempre que la mitad ya alcance para lo que se pide:
 * para editar en pantalla sobra, y la resolución completa sólo se revela al
 * exportar a tamaño original.
 *
 * Devuelve la misma forma que `decodeScaled`, con la imagen lineal en
 * `bitmap`, para que quien llama no tenga que distinguir un RAW de un JPEG.
 *
 * @param {Blob|File} file
 * @param {number} maxSize lado mayor del resultado
 */
export async function decodeRaw(file, maxSize = Infinity) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let raw = new LibRaw();
  let img;
  let meta;
  try {
    // La primera pasada a media resolución es rápida y ya da el tamaño del
    // sensor, que es lo que decide si hace falta la completa. (`open` se queda
    // con el búfer: va una copia por si hay que volver a abrir.)
    await raw.open(bytes.slice(), { ...AJUSTES, halfSize: true });
    meta = await raw.metadata();
    const largo = Math.max(meta.width, meta.height);
    const mitadBasta = largo / 2 >= maxSize || meta.width * meta.height > MAX_FULL_PIXELS;
    if (!mitadBasta) {
      raw.dispose();
      raw = new LibRaw();
      await raw.open(bytes, { ...AJUSTES, halfSize: false });
    }
    img = await raw.imageData();
  } finally {
    // El worker y su memoria se sueltan ANTES de convertir: así no conviven
    // la copia de LibRaw y la nuestra, que en un iPhone es la diferencia.
    raw.dispose();
  }
  if (!img?.data?.length) {
    throw new Error('LibRaw no ha podido revelar este RAW (¿cámara o compresión no compatibles?)');
  }

  // LibRaw ya entrega la imagen girada según la cámara; el tamaño del sensor
  // viene sin girar, así que se intercambia para las tomas en vertical.
  const gira = (meta.flip & 4) !== 0;
  const fullW = gira ? meta.height : meta.width;
  const fullH = gira ? meta.width : meta.height;

  const sw = img.width;
  const sh = img.height;
  const k = Math.min(1, maxSize / Math.max(sw, sh));
  const dw = Math.max(1, Math.round(sw * k));
  const dh = Math.max(1, Math.round(sh * k));
  const escala = 2 ** BASELINE_EV / 65535;

  let data;
  if (dw === sw && dh === sh) {
    // Mismo tamaño: se convierte en el sitio con una tabla de 65 536 entradas,
    // sin reservar otros 150 MB para la copia.
    const tabla = new Uint16Array(65536);
    for (let i = 0; i < 65536; i++) tabla[i] = toHalf(i * escala);
    data = img.data;
    for (let i = 0; i < data.length; i++) data[i] = tabla[data[i]];
  } else {
    const tabla = new Float32Array(65536);
    for (let i = 0; i < 65536; i++) tabla[i] = i * escala;
    const f = reducir(img.data, sw, sh, dw, dh, tabla);
    data = new Uint16Array(f.length);
    for (let i = 0; i < f.length; i++) data[i] = toHalf(f[i]);
  }

  const info = {
    camara: [meta.camera_make, meta.camera_model].filter(Boolean).join(' '),
    iso: meta.iso_speed || null,
    obturacion: meta.shutter || null,
    diafragma: meta.aperture || null,
    focal: meta.focal_len || null,
  };
  return {
    bitmap: new LinearImage(dw, dh, data, info),
    sourceWidth: fullW,
    sourceHeight: fullH,
    scaled: dw < fullW,
    raw: true,
  };
}

// Para las pruebas: la conversión a media precisión tiene que ser exacta.
export const _interno = { toHalf, halfLUT };
