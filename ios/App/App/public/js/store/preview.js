/**
 * preview.js — Lo que hace falta para ver archivos ANTES de importarlos.
 *
 * Una tarjeta de memoria puede traer cientos de fotos y unos cuantos archivos
 * que no lo son (las copias ocultas «._» que deja el Mac en los discos FAT, los
 * .XML de los vídeos de Sony, los .THM…). Aquí se decide qué se puede importar
 * y se sacan miniaturas rápidas: de un RAW no se revela nada, se usa la vista
 * previa en JPEG que la cámara guarda dentro del propio archivo.
 */

import { isRawFile } from './raw.js';

const FOTO = /\.(jpe?g|png|webp|heic|heif|avif|gif)$/i;
const VIDEO = /\.(mp4|m4v|mov|webm)$/i;

/** 'foto' | 'raw' | 'video' | null (no se importa). */
export function clasificar(file) {
  const nombre = file.name || '';
  // Ocultos: «._DSC0001.ARW» del Mac en discos FAT, .DS_Store, etc.
  if (nombre.startsWith('.')) return null;
  if (isRawFile(file)) return 'raw';
  if (file.type.startsWith('video/') || VIDEO.test(nombre)) return 'video';
  if ((file.type.startsWith('image/') && !/tiff/.test(file.type)) || FOTO.test(nombre)) return 'foto';
  return null;
}

/**
 * La vista previa JPEG que un RAW lleva dentro (en un ARW de Sony, 1616×1080).
 *
 * Un ARW es un TIFF: se recorren sus directorios (IFD0, los siguientes y los
 * SubIFD) buscando las etiquetas de JPEG incrustado, y se queda la mayor. Sólo
 * se leen unos pocos KB de cabecera y el trozo del JPEG; nunca el archivo entero.
 *
 * @returns {Promise<{blob:Blob, orientacion:number}|null>}
 */
export async function vistaPreviaRaw(file) {
  const leer = async (off, len) => new DataView(await file.slice(off, off + len).arrayBuffer());
  try {
    const cab = await leer(0, 8);
    const orden = cab.getUint16(0);
    const le = orden === 0x4949;
    if (!le && orden !== 0x4d4d) return null;
    if (cab.getUint16(2, le) !== 42) return null;

    const cola = [cab.getUint32(4, le)];
    const vistos = new Set();
    const candidatos = [];
    let orientacion = 1;
    while (cola.length && vistos.size < 24) {
      const off = cola.shift();
      if (!off || vistos.has(off) || off + 2 > file.size) continue;
      const primero = vistos.size === 0;
      vistos.add(off);
      const n = (await leer(off, 2)).getUint16(0, le);
      if (!n || n > 1000) continue;
      const dv = await leer(off + 2, n * 12 + 4);
      if (dv.byteLength < n * 12 + 4) continue;
      let jOff = 0, jLen = 0;
      for (let i = 0; i < n; i++) {
        const b = i * 12;
        const tag = dv.getUint16(b, le);
        const tipo = dv.getUint16(b + 2, le);
        const cuenta = dv.getUint32(b + 4, le);
        const valor = tipo === 3 && cuenta === 1 ? dv.getUint16(b + 8, le) : dv.getUint32(b + 8, le);
        if (tag === 0x0201) jOff = valor;
        else if (tag === 0x0202) jLen = valor;
        else if (tag === 0x0112 && primero) orientacion = valor;
        else if (tag === 0x014a) {
          if (cuenta === 1) cola.push(valor);
          else if (cuenta < 16) {
            const lista = await leer(valor, cuenta * 4);
            for (let k = 0; k < cuenta; k++) cola.push(lista.getUint32(k * 4, le));
          }
        }
      }
      if (jOff && jLen && jOff + jLen <= file.size) candidatos.push([jOff, jLen]);
      cola.push(dv.getUint32(n * 12, le));   // siguiente IFD
    }
    candidatos.sort((a, b) => b[1] - a[1]);
    for (const [o, l] of candidatos) {
      if ((await leer(o, 2)).getUint16(0) !== 0xffd8) continue;   // tiene que empezar como un JPEG
      return { blob: file.slice(o, o + l, 'image/jpeg'), orientacion };
    }
  } catch { /* archivo raro o truncado: sin vista previa */ }
  return null;
}

/**
 * Dibuja una imagen reducida y derecha. La orientación EXIF de la vista previa
 * de un RAW va en la cabecera del RAW, no en el JPEG, así que se aplica aquí.
 */
export function dibujarReducida(fuente, lado, orientacion = 1) {
  const w = fuente.width, h = fuente.height;
  const gira = orientacion >= 5 && orientacion <= 8;
  const k = Math.min(1, lado / Math.max(w, h));
  const dw = Math.max(1, Math.round(w * k));
  const dh = Math.max(1, Math.round(h * k));
  const c = document.createElement('canvas');
  c.width = gira ? dh : dw;
  c.height = gira ? dw : dh;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  // 3 = 180°, 6 = 90° horario, 8 = 90° antihorario (los espejos no se dan en cámaras).
  if (orientacion === 3) { g.translate(dw, dh); g.rotate(Math.PI); }
  else if (orientacion === 6) { g.translate(dh, 0); g.rotate(Math.PI / 2); }
  else if (orientacion === 8) { g.translate(0, dw); g.rotate(-Math.PI / 2); }
  g.drawImage(fuente, 0, 0, dw, dh);
  return c;
}

/**
 * Miniatura rápida para el menú de importación: un lienzo pequeño y las
 * dimensiones que se conozcan. De un RAW, su vista previa; de un vídeo, nada
 * (se enseña su icono: abrir cientos de vídeos para sacar un fotograma no
 * compensa en una tarjeta de memoria).
 */
export async function miniaturaRapida(file, tipo, lado = 220) {
  if (tipo === 'video') return null;
  let fuente = file, orientacion = 1;
  if (tipo === 'raw') {
    const prev = await vistaPreviaRaw(file);
    if (!prev) return null;
    fuente = prev.blob;
    orientacion = prev.orientacion;
  }
  const bmp = await createImageBitmap(fuente);
  try {
    return dibujarReducida(bmp, lado, orientacion);
  } finally {
    bmp.close?.();
  }
}

/**
 * Los archivos de lo que se suelta en la ventana, entrando en las carpetas.
 * Hay que pedir las entradas DURANTE el evento: después ya no valen.
 *
 * @returns {Promise<{file:File, ruta:string}[]>}
 */
export function archivosSoltados(dataTransfer) {
  const entradas = [...(dataTransfer?.items || [])]
    .filter((it) => it.kind === 'file')
    .map((it) => it.webkitGetAsEntry?.())
    .filter(Boolean);
  if (!entradas.length) {
    return Promise.resolve([...(dataTransfer?.files || [])].map((file) => ({ file, ruta: file.name })));
  }
  const out = [];
  const recorrer = async (entrada, base) => {
    if (entrada.isFile) {
      const file = await new Promise((res, rej) => entrada.file(res, rej));
      out.push({ file, ruta: base + file.name });
    } else if (entrada.isDirectory) {
      const lector = entrada.createReader();
      // readEntries entrega por tandas (100 en Chrome): se pide hasta que no quede nada.
      for (;;) {
        const tanda = await new Promise((res, rej) => lector.readEntries(res, rej));
        if (!tanda.length) break;
        for (const e of tanda) await recorrer(e, base + entrada.name + '/');
      }
    }
  };
  return (async () => {
    for (const e of entradas) await recorrer(e, '');
    return out;
  })();
}
