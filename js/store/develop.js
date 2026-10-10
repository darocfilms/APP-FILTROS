/**
 * develop.js — Revelar un elemento de la biblioteca con sus ajustes.
 *
 * Los ajustes del laboratorio no tocan el original: se guardan junto a él
 * (`item.params`) y se aplican al mirarlo. Todo lo que enseña o entrega una
 * foto editada fuera del laboratorio —la miniatura, el visor, «Guardar», pegar
 * ajustes en muchas a la vez— pasa por aquí, para que sea siempre el mismo
 * revelado y no tres parecidos.
 *
 * Y el portapapeles de ajustes: copiar el color de una foto y pegarlo en otras.
 */

import { library, decodeScaled, makeThumb, THUMB_SIZE } from './library.js';
import { Renderer, renderToBlob } from '../engine/renderer.js';
import { defaultParams, mergeParams, cloneParams } from '../data/params.js';
import { getFilm } from '../data/films.js';

/* ──────────────────────────── ¿Está editada? ───────────────────────────── */

const DEFECTO = JSON.stringify(defaultParams());

/**
 * ¿Cambian algo estos ajustes respecto al original? Mover un deslizador y
 * volverlo a su sitio deja `params` guardado, pero la foto no está editada.
 */
export function hasEdits(params) {
  if (!params) return false;
  return JSON.stringify(mergeParams(params)) !== DEFECTO;
}

/** ¿Lleva algo de color o de luz? El encuadre solo no es un «look» que copiar. */
export function hasColorEdits(params) {
  return !!params && hasEdits(colorPart(params));
}

/** Nombre corto de lo que lleva una foto editada, para enseñarlo. */
export function describeEdits(params) {
  if (!hasEdits(params)) return null;
  const film = getFilm(mergeParams(params).film.id);
  return film.neutral ? 'Editada' : film.name;
}

/* ───────────────────────────── Revelar ─────────────────────────────────── */

/**
 * Un contexto WebGL compartido para los revelados pequeños (miniaturas, visor).
 * Pegar ajustes en cien fotos son cien miniaturas seguidas, y crear un
 * contexto y compilar los shaders en cada una costaría más que revelarla. Se
 * suelta a los pocos segundos sin uso: en iPhone, un contexto vivo de más es
 * memoria de vídeo que le falta a la cámara o al laboratorio.
 */
let compartido = null;

function rendererCompartido() {
  if (compartido?.renderer.lost) soltarCompartido();
  if (!compartido) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    compartido = { canvas, renderer: new Renderer(canvas), timer: 0 };
  }
  clearTimeout(compartido.timer);
  compartido.timer = setTimeout(soltarCompartido, 4000);
  return compartido.renderer;
}

function soltarCompartido() {
  if (!compartido) return;
  clearTimeout(compartido.timer);
  try { compartido.renderer.dispose({ release: true }); } catch { /* ya perdido */ }
  compartido.canvas.width = compartido.canvas.height = 0;
  compartido = null;
}

/**
 * Revela el original de un elemento con unos ajustes.
 *
 * Se descodifica sólo al tamaño necesario, igual que al exportar desde el
 * laboratorio: una miniatura de 480 px no llega a construir nunca la imagen
 * de 24 Mpx, ni revela un RAW a resolución completa.
 *
 * @param {Blob|File} file
 * @param {object} params
 * @param {number} maxSize lado mayor del resultado (Infinity: el del original)
 */
export async function develop(file, params, maxSize = Infinity, { type = 'image/jpeg', quality = 0.92 } = {}) {
  const p = mergeParams(params);
  const crop = p.geometry.crop || { w: 1, h: 1 };
  const decodeMax = maxSize === Infinity ? 1e9 : Math.ceil(maxSize / Math.max(crop.w, crop.h, 1e-3));
  const dec = await decodeScaled(file, decodeMax);
  try {
    // A tamaño completo, contexto propio y de usar y tirar, como al exportar.
    const renderer = maxSize === Infinity ? null : rendererCompartido();
    return await renderToBlob(dec.bitmap, p, { type, quality, seed: 1, renderer });
  } finally {
    dec.bitmap.close?.();
  }
}

/**
 * Rehace la miniatura de la biblioteca: con los ajustes si los tiene, y del
 * original si no. Es lo que hace que la cuadrícula enseñe la foto como quedó.
 */
export async function refreshThumb(item, params = item.params) {
  const file = await library.getFile(item.id);
  if (!file) return false;
  let blob;
  if (hasEdits(params)) {
    ({ blob } = await develop(file, params, THUMB_SIZE, { quality: 0.82 }));
  } else {
    const { bitmap } = await decodeScaled(file, THUMB_SIZE);
    blob = await makeThumb(bitmap);
    bitmap.close?.();
  }
  await library.putThumb(item.id, blob);
  return true;
}

/**
 * Lo que se entrega al guardar: la foto revelada con sus ajustes, a resolución
 * completa, o el original tal cual si no tiene ninguno. Lo que se ve en la
 * biblioteca es lo que se guarda. `original` pide el archivo tal como entró.
 *
 * @returns {Promise<{blob:Blob, ext:string, edited:boolean, width?:number, height?:number}|null>}
 */
export async function fileForSaving(item, { original = false } = {}) {
  const file = await library.getFile(item.id);
  if (!file) return null;
  if (original || item.kind !== 'photo' || !hasEdits(item.params)) {
    return { blob: file, ext: item.name.split('.').pop() || 'jpg', edited: false };
  }
  const { blob, width, height } = await develop(file, item.params, Infinity, { quality: 0.95 });
  return { blob, ext: 'jpg', edited: true, width, height };
}

/* ─────────────────────────── Portapapeles ──────────────────────────────── */

const CLAVE = 'lab.portapapeles.v1';
export const EVENTO_PORTAPAPELES = 'lab:portapapeles';

/**
 * La parte de los ajustes que viaja de una foto a otra: todo menos el
 * encuadre. El recorte y el giro son de cada foto; el color, la luz, la
 * emulsión, el grano y la viñeta son el «look», que es lo que se quiere llevar.
 */
export function colorPart(params) {
  const p = cloneParams(mergeParams(params));
  delete p.geometry;
  return p;
}

/** Copia los ajustes de color. `origen` es el nombre que se enseña al pegar. */
export function copySettings(params, origen = '') {
  const datos = { params: colorPart(params), origen, at: Date.now() };
  try { localStorage.setItem(CLAVE, JSON.stringify(datos)); } catch { /* sin persistencia */ }
  copiado = datos;
  globalThis.dispatchEvent?.(new CustomEvent(EVENTO_PORTAPAPELES, { detail: datos }));
  return datos;
}

let copiado = null;
/** Lo último que se copió, sobreviva o no a una recarga. */
export function copiedSettings() {
  if (copiado) return copiado;
  try {
    const d = JSON.parse(localStorage.getItem(CLAVE) || 'null');
    if (d?.params) copiado = d;
  } catch { /* sin persistencia */ }
  return copiado;
}

/** Ajustes resultantes de pegar sobre otros: color nuevo, encuadre propio. */
export function pasteOnto(target, color) {
  const out = mergeParams(color);
  out.geometry = cloneParams(mergeParams(target).geometry);
  return out;
}

/**
 * Pega unos ajustes de color en varios elementos de la biblioteca. Los vídeos
 * se saltan: su revelado va en tiempo real y no se guarda como ajustes.
 *
 * @param {object[]} items
 * @param {object} color ajustes sin encuadre (de `copiedSettings().params`)
 * @param {(hechos:number,total:number)=>void} [alAvanzar]
 * @returns {Promise<{hechas:number, saltadas:number}>}
 */
export async function pasteInto(items, color, alAvanzar) {
  const fotos = items.filter((i) => i.kind === 'photo');
  let hechas = 0;
  for (const item of fotos) {
    const params = pasteOnto(item.params, color);
    await library.update(item.id, { params });
    // Los ajustes ya están pegados; si una miniatura no se puede rehacer (un
    // archivo dañado), que no pare las demás.
    await refreshThumb({ ...item, params }, params).catch((err) => console.error(err));
    hechas++;
    alAvanzar?.(hechas, fotos.length);
  }
  return { hechas, saltadas: items.length - fotos.length };
}

/** Quita los ajustes: la foto vuelve a ser el original, también en la cuadrícula. */
export async function clearEdits(item) {
  await library.update(item.id, { params: null });
  await refreshThumb({ ...item, params: null }, null);
}
