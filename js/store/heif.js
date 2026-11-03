/**
 * heif.js — HEIF: los HEIC del iPhone y los HIF de las Sony (y Fujifilm).
 *
 * Son imágenes HEVC dentro de un contenedor HEIF. Safari las abre por su
 * cuenta (al menos las del iPhone); Chrome y Firefox no abren ninguna. Así que
 * primero se le pregunta al navegador y, si no sabe, se descodifican con
 * libheif en un worker (js/vendor/libheif). Los HIF de Sony son de 10 bits y
 * 4:2:2; salen a 8 bits, que es lo que trabaja el revelado de una foto normal.
 *
 * Para miniaturas no hace falta descodificar 24 Mpx: casi todos los HEIF
 * llevan dentro una pequeña, y se usa ésa.
 */

/** ¿Es un HEIF? Por la extensión o el tipo: un .HIF suele llegar sin tipo. */
export function esHeif(file) {
  return /\.(heic|heif|hif)$/i.test(file?.name || '') || /^image\/hei[cf]/i.test(file?.type || '');
}

let worker = null;
let siguiente = 1;
let reposo = 0;
const pendientes = new Map();

function trabajador() {
  clearTimeout(reposo);
  if (!worker) {
    worker = new Worker(new URL('../vendor/libheif/worker.js', import.meta.url));
    worker.onmessage = ({ data }) => {
      const p = pendientes.get(data.id);
      if (!p) return;
      pendientes.delete(data.id);
      if (data.error) p.reject(new Error(data.error));
      else p.resolve(data);
      dormir();
    };
    worker.onerror = (e) => {
      const err = new Error('El descodificador HEIF falló: ' + (e.message || 'error del worker'));
      for (const p of pendientes.values()) p.reject(err);
      pendientes.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

/**
 * Sin trabajo un rato, el worker se cierra: libheif se queda con la memoria
 * de la foto más grande que haya abierto, y en un iPhone eso pesa.
 */
function dormir() {
  clearTimeout(reposo);
  if (pendientes.size) return;
  reposo = setTimeout(() => { worker?.terminate(); worker = null; }, 12_000);
}

function pedir(msg, transfer) {
  const id = siguiente++;
  return new Promise((resolve, reject) => {
    pendientes.set(id, { resolve, reject });
    trabajador().postMessage({ id, ...msg }, transfer);
  });
}

/** Descodifica con libheif, reducido a `maxSize` dentro del worker. */
export async function descodificarHeif(file, maxSize = Infinity, { miniatura = false } = {}) {
  const buffer = await file.arrayBuffer();
  const r = await pedir({ buffer, maxSize: Number.isFinite(maxSize) && maxSize < 1e8 ? Math.round(maxSize) : 0, miniatura }, [buffer]);
  const bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height));
  return { bitmap, sourceWidth: r.srcW, sourceHeight: r.srcH, scaled: r.width < r.srcW, deMiniatura: r.deMiniatura };
}

/**
 * Abre un HEIF al tamaño pedido: con el navegador si sabe (Safari), y si no,
 * con libheif. `miniatura` deja usar la que trae dentro cuando basta.
 */
export async function abrirHeif(file, maxSize = Infinity, opts = {}) {
  let nativa = null;
  try {
    nativa = await createImageBitmap(file);
  } catch {
    return descodificarHeif(file, maxSize, opts);
  }
  const { width, height } = nativa;
  if (Math.max(width, height) <= maxSize) return { bitmap: nativa, sourceWidth: width, sourceHeight: height, scaled: false };
  nativa.close?.();
  const k = maxSize / Math.max(width, height);
  const bitmap = await createImageBitmap(file, {
    resizeWidth: Math.max(1, Math.round(width * k)),
    resizeHeight: Math.max(1, Math.round(height * k)),
    resizeQuality: 'high',
  });
  return { bitmap, sourceWidth: width, sourceHeight: height, scaled: true };
}
