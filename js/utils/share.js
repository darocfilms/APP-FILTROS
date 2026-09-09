/**
 * share.js — Sacar un archivo de la aplicación.
 *
 * En iOS esto tiene tres trampas, y las tres hacían que guardar fallara:
 *
 *  1. `navigator.share` exige activación del usuario, y esa activación caduca.
 *     Si entre el toque y la llamada hay un revelado de doce megapíxeles, para
 *     cuando se llama ya no vale: Safari responde NotAllowedError. Por eso
 *     `shareNow` sólo puede llamarse DESDE el manejador del toque, y el trabajo
 *     pesado va antes, en otra interacción.
 *
 *  2. El atributo `download` de un enlace existe en Safari pero se ignora
 *     cuando el destino es un blob. La descarga clásica no es una reserva
 *     válida en iPhone: hay que ofrecer la imagen para mantener pulsado.
 *
 *  3. Compartir varios archivos a la vez sólo funciona si el sistema lo admite
 *     para ese conjunto concreto; `canShare` hay que consultarlo con los
 *     archivos reales, no en abstracto.
 */

import { el, toast } from './dom.js';

export const isIOS = /iP(hone|ad|od)/.test(navigator.platform)
  || (navigator.userAgent.includes('Mac') && 'ontouchend' in document);

export function canShareFiles(files) {
  const list = Array.isArray(files) ? files : [files];
  try {
    return !!(navigator.canShare && navigator.share && navigator.canShare({ files: list }));
  } catch {
    return false;
  }
}

/**
 * Abre la hoja de compartir del sistema.
 *
 * IMPORTANTE: llámese de forma síncrona dentro del manejador de un toque. Todo
 * lo que haya que preparar (leer del disco, revelar, codificar) debe estar ya
 * hecho antes, o la activación habrá caducado.
 *
 * @param {File[]} files
 * @returns {Promise<'shared'|'cancelled'|'unavailable'>}
 */
export async function shareNow(files, title) {
  if (!canShareFiles(files)) return 'unavailable';
  try {
    await navigator.share({ files, title });
    return 'shared';
  } catch (err) {
    if (err && err.name === 'AbortError') return 'cancelled';
    return 'unavailable';
  }
}

/** Descarga clásica. Sirve en escritorio; en iPhone Safari la ignora. */
export function downloadNow(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.append(a);
    a.click();
    a.remove();
    return true;
  } catch {
    return false;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/**
 * Última reserva en iPhone: mostrar la imagen a tamaño completo para guardarla
 * con el gesto que el sistema sí admite siempre. Feo, pero funciona cuando todo
 * lo demás no, y es preferible a un mensaje de error sin salida.
 */
export function showLongPressSave(blob, filename) {
  const url = URL.createObjectURL(blob);
  const close = () => { overlay.remove(); URL.revokeObjectURL(url); };
  const isVideo = blob.type.startsWith('video');
  const media = isVideo
    ? el('video', { class: 'longpress__media', src: url, controls: '', playsinline: '' })
    : el('img', { class: 'longpress__media', src: url, alt: filename });

  const overlay = el('div', {
    class: 'longpress', role: 'dialog', 'aria-modal': 'true',
    onclick: (e) => { if (e.target === overlay) close(); },
  },
    el('div', { class: 'longpress__box' },
      el('p', { class: 'longpress__hint' },
        isVideo
          ? 'Mantén pulsado el vídeo y elige «Guardar en Fotos».'
          : 'Mantén pulsada la imagen y elige «Añadir a Fotos».'),
      media,
      el('button', { type: 'button', class: 'btn', text: 'Cerrar', onclick: close })));

  document.body.append(overlay);
  return overlay;
}

/**
 * Guarda uno o varios archivos ya preparados.
 *
 * Debe invocarse desde el manejador de un toque. Devuelve qué ocurrió para que
 * quien llama pueda decir algo honesto en lugar de suponer que fue bien.
 *
 * @param {Blob[]|Blob} blobs
 * @param {string[]|string} names
 * @returns {Promise<'shared'|'cancelled'|'downloaded'|'longpress'>}
 */
export async function saveFiles(blobs, names, { title } = {}) {
  const list = Array.isArray(blobs) ? blobs : [blobs];
  const labels = uniqueNames(Array.isArray(names) ? names : [names]);
  const files = list.map((b, i) => new File([b], labels[i] || labels[0], { type: b.type }));

  const shared = await shareNow(files, title || (files.length > 1 ? `${files.length} archivos` : files[0].name));
  if (shared === 'shared' || shared === 'cancelled') return shared;

  // Sin hoja de compartir: en escritorio vale la descarga; en iPhone no.
  if (!isIOS) {
    let ok = true;
    for (const [i, b] of list.entries()) ok = downloadNow(b, labels[i] || labels[0]) && ok;
    if (ok) return 'downloaded';
  }

  if (list.length === 1) {
    showLongPressSave(list[0], labels[0]);
    return 'longpress';
  }
  // Varios archivos sin hoja de compartir: se descargan uno a uno.
  for (const [i, b] of list.entries()) downloadNow(b, labels[i] || labels[0]);
  toast('Se han preparado ' + list.length + ' archivos');
  return 'downloaded';
}

/**
 * Nombre de archivo con marca de tiempo local.
 *
 * La marca llega al segundo, así que preparar varios archivos de golpe los
 * bautizaba a todos igual y el sistema recibía un lote de nombres repetidos.
 * `index` los distingue cuando hay más de uno.
 */
export function timestampName(prefix, ext, filmName, index = null) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const slug = filmName ? '-' + filmName.toLowerCase().replace(/[^a-z0-9]+/g, '') : '';
  const n = index === null ? '' : '-' + String(index + 1).padStart(2, '0');
  return `${prefix}-${stamp}${n}${slug}.${ext}`;
}

/** Asegura que ningún nombre se repite dentro de un mismo lote. */
export function uniqueNames(names) {
  const seen = new Map();
  return names.map((name) => {
    const count = seen.get(name) || 0;
    seen.set(name, count + 1);
    if (count === 0) return name;
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    return `${base}-${count + 1}${ext}`;
  });
}
