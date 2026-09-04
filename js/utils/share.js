/**
 * share.js — Sacar un archivo de la aplicación.
 *
 * En iOS esto no es trivial: Safari ignora el atributo `download` de los
 * enlaces cuando el href es un blob, así que la descarga clásica no sirve. Lo
 * que sí funciona es la hoja de compartir del sistema, que además ofrece
 * "Guardar imagen" y "Guardar en Archivos", que es lo que la gente quiere.
 *
 * Orden de intentos: compartir del sistema → descarga clásica → abrir en una
 * pestaña nueva para guardar a mano.
 */

import { toast } from './dom.js';

export function canShareFiles(file) {
  try {
    return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
  } catch {
    return false;
  }
}

export const isIOS = /iP(hone|ad|od)/.test(navigator.platform)
  || (navigator.userAgent.includes('Mac') && 'ontouchend' in document);

/**
 * @param {Blob} blob
 * @param {string} filename
 * @param {{title?:string, preferShare?:boolean}} [opts]
 * @returns {Promise<'shared'|'downloaded'|'opened'|'cancelled'>}
 */
export async function saveFile(blob, filename, opts = {}) {
  const file = new File([blob], filename, { type: blob.type });
  const preferShare = opts.preferShare ?? isIOS;

  if (preferShare && canShareFiles(file)) {
    try {
      await navigator.share({ files: [file], title: opts.title || filename });
      return 'shared';
    } catch (err) {
      // El usuario cerró la hoja: no es un error que haya que reportar.
      if (err && err.name === 'AbortError') return 'cancelled';
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    if ('download' in a) {
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.append(a);
      a.click();
      a.remove();
      return 'downloaded';
    }
    window.open(url, '_blank');
    toast('Mantén pulsada la imagen para guardarla');
    return 'opened';
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/** Nombre de archivo con marca de tiempo local. */
export function timestampName(prefix, ext, filmName) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const slug = filmName ? '-' + filmName.toLowerCase().replace(/[^a-z0-9]+/g, '') : '';
  return `${prefix}-${stamp}${slug}.${ext}`;
}
