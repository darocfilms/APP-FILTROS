/**
 * importar.js — Meter archivos en la biblioteca.
 *
 * Cada archivo se copia a la biblioteca con su miniatura. Para que importar una
 * tarjeta con trescientos RAW no tarde diez minutos, la miniatura de un RAW sale
 * de la vista previa que lleva dentro, al momento; después, sin prisa y de uno
 * en uno, se rehace con el revelado de la app (`refinarMiniaturas`), que es lo
 * que se verá al abrirlo en el laboratorio.
 */

import { library, decodeScaled, makeThumb, videoPoster, THUMB_SIZE } from './library.js';
import { clasificar, vistaPreviaRaw, dibujarReducida } from './preview.js';

/**
 * @param {File} file
 * @param {{carpeta?:string|null, ruta?:string}} [opts] subcarpeta de destino y
 *        ruta de origen (para reconocer duplicados)
 */
export async function importarArchivo(file, { carpeta = null, ruta = '' } = {}) {
  const tipo = clasificar(file) || (file.type.startsWith('video') ? 'video' : 'foto');
  let width = 0, height = 0, durationMs = 0, thumbBlob = null;
  let provisional = false;

  if (tipo === 'video') {
    const url = URL.createObjectURL(file);
    try {
      const poster = await videoPoster(url);
      width = poster.width; height = poster.height;
      durationMs = (poster.duration || 0) * 1000;
      thumbBlob = poster.blob;
    } catch {
      // Un códec que el navegador no sabe previsualizar no debe impedir
      // guardar el archivo: entra sin miniatura y ya está.
    } finally {
      URL.revokeObjectURL(url);
    }
  } else {
    if (tipo === 'raw') {
      const prev = await vistaPreviaRaw(file);
      if (prev) {
        const bmp = await createImageBitmap(prev.blob);
        const derecha = dibujarReducida(bmp, Math.max(bmp.width, bmp.height), prev.orientacion);
        bmp.close?.();
        width = derecha.width; height = derecha.height;
        thumbBlob = await makeThumb(derecha);
        derecha.width = derecha.height = 0;
        provisional = true;
      }
    }
    if (!thumbBlob) {
      const { bitmap, sourceWidth, sourceHeight } = await decodeScaled(file, THUMB_SIZE);
      width = sourceWidth; height = sourceHeight;
      thumbBlob = await makeThumb(bitmap);
      bitmap.close?.();
    }
  }

  const item = await library.put(file, {
    kind: tipo === 'video' ? 'video' : 'photo',
    width, height, durationMs, origin: 'importado', carpeta,
    fuente: { nombre: file.name, tamano: file.size, fecha: file.lastModified || 0, ruta: ruta || file.name },
    // Hasta que se revele: miniatura de la cámara y tamaño de su vista previa.
    thumbProvisional: provisional,
    dimsAprox: provisional,
  });
  if (thumbBlob) await library.putThumb(item.id, thumbBlob);
  return item;
}

/** Firma para reconocer un archivo ya importado: nombre y tamaño. */
export const firma = (nombre, tamano) => `${nombre}|${tamano}`;

export async function firmasImportadas() {
  const set = new Set();
  for (const i of await library.list()) if (i.fuente) set.add(firma(i.fuente.nombre, i.fuente.tamano));
  return set;
}

let refinando = false;

/**
 * Rehace con LibRaw, de una en una, las miniaturas que salieron de la vista
 * previa de la cámara, y apunta el tamaño real del sensor. Se para mientras
 * `pausa()` diga que sí (en el laboratorio, la memoria es para la foto abierta).
 */
export async function refinarMiniaturas({ pausa = () => false } = {}) {
  if (refinando) return;
  refinando = true;
  const hechos = new Set();
  try {
    for (;;) {
      const item = (await library.list()).find((i) => i.thumbProvisional && !hechos.has(i.id));
      if (!item) break;
      if (pausa()) { await new Promise((r) => setTimeout(r, 3000)); continue; }
      hechos.add(item.id);
      try {
        const file = await library.getFile(item.id);
        if (!file) { await library.update(item.id, { thumbProvisional: false }, { silencioso: true }); continue; }
        const { bitmap, sourceWidth, sourceHeight } = await decodeScaled(file, THUMB_SIZE);
        let blob;
        try { blob = await makeThumb(bitmap); } finally { bitmap.close?.(); }
        // Si entretanto se editó, la miniatura buena es la del laboratorio.
        const ahora = await library.get(item.id);
        if (!ahora) continue;
        await library.update(item.id, {
          thumbProvisional: false, dimsAprox: false, width: sourceWidth, height: sourceHeight,
        }, { silencioso: true });
        if (!ahora.params) await library.putThumb(item.id, blob);
      } catch (err) {
        if (err?.code === 'permiso') break;   // sin acceso a la carpeta: otro día
        console.error(err);
        await library.update(item.id, { thumbProvisional: false }, { silencioso: true }).catch(() => {});
      }
    }
  } finally {
    refinando = false;
  }
}
