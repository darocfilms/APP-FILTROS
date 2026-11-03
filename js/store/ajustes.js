/**
 * ajustes.js — Las preferencias de la app, con sus valores de fábrica.
 *
 * Pocas y con un valor por defecto que sirva sin tocar nada:
 *
 *   guardarEnGaleria  «Guardar» va directo a la galería con un toque, sin
 *                     menús, y cada foto de la cámara se copia también allí
 *                     (donde se puede: en la app nativa). Activado de fábrica.
 *   formato           Cómo dispara la cámara: 'jpeg' (calidad máxima, con la
 *                     emulsión revelada) o 'raw' (sin pérdida y con la
 *                     emulsión como ajuste editable).
 *
 * Se guardan en localStorage: son del dispositivo, no de la biblioteca. Quien
 * quiera enterarse de un cambio escucha `EVENTO_AJUSTES` en window.
 */

const CLAVE = 'lab.ajustes.v1';
export const EVENTO_AJUSTES = 'lab:ajustes';

export const DE_FABRICA = Object.freeze({
  guardarEnGaleria: true,
  formato: 'jpeg',
});

const VALIDOS = {
  guardarEnGaleria: (v) => typeof v === 'boolean',
  formato: (v) => v === 'jpeg' || v === 'raw',
};

function leer() {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE) || '{}');
    const out = { ...DE_FABRICA };
    for (const [k, ok] of Object.entries(VALIDOS)) if (ok(guardado[k])) out[k] = guardado[k];
    return out;
  } catch {
    return { ...DE_FABRICA };
  }
}

let actuales = leer();

export const ajustes = {
  get(clave) { return actuales[clave]; },
  todos() { return { ...actuales }; },
  set(clave, valor) {
    if (!VALIDOS[clave]?.(valor) || actuales[clave] === valor) return;
    actuales = { ...actuales, [clave]: valor };
    try { localStorage.setItem(CLAVE, JSON.stringify(actuales)); } catch { /* modo privado: vale esta sesión */ }
    window.dispatchEvent(new CustomEvent(EVENTO_AJUSTES, { detail: { clave, valor } }));
  },
  /** Vuelve a leerlos (las pruebas los cambian por debajo). */
  recargar() { actuales = leer(); },
};
