/**
 * worker.js — libheif en su propio hilo (propio de esta app, no del paquete).
 *
 * Descodificar un HIF de 24 Mpx lleva un par de segundos de WebAssembly: en el
 * hilo de la página congelaría la interfaz. Aquí se descodifica, se reduce al
 * tamaño pedido y se devuelve en RGBA de 8 bits, que es lo que necesita un
 * ImageBitmap.
 *
 * Mensaje: { id, buffer, maxSize (0 = sin reducir), miniatura }
 * Respuesta: { id, width, height, data (ArrayBuffer RGBA), srcW, srcH, deMiniatura } | { id, error }
 */
/* global libheif */
// Cargado desde otra página (js/utils/alojada.js), este worker vive en un blob
// y las rutas relativas ya no apuntan a esta carpeta: `__BASE__` dice cuál es.
const BASE = self.__BASE__ || new URL('./', self.location.href).href;
importScripts(BASE + 'libheif.js');

let mod = null;
const listo = new Promise((resolve, reject) => {
  try {
    mod = libheif({ locateFile: (archivo) => BASE + archivo, onRuntimeInitialized: () => resolve() });
  } catch (err) {
    reject(err);
  }
});

/**
 * Busca la miniatura que el archivo lleva dentro y devuelve una copia en la que
 * el «elemento principal» (pitm) es ella. libheif no ofrece las miniaturas en
 * esta compilación, pero sí la imagen principal: cambiando ese número, la
 * miniatura de un HIF de 24 Mpx se descodifica en milisegundos. No se mueve
 * ningún byte: sólo se reescribe el identificador, que ocupa lo mismo.
 */
function conMiniaturaComoPrincipal(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tipo = (o) => String.fromCharCode(bytes[o + 4], bytes[o + 5], bytes[o + 6], bytes[o + 7]);
  const cajas = (ini, fin, cb) => {
    let o = ini;
    while (o + 8 <= fin) {
      let tam = dv.getUint32(o);
      let cab = 8;
      if (tam === 1) { tam = Number(dv.getBigUint64(o + 8)); cab = 16; } else if (tam === 0) tam = fin - o;
      if (tam < cab || o + tam > fin) return;
      if (cb(tipo(o), o + cab, o + tam) === false) return;
      o += tam;
    }
  };
  let pitm = null;
  let miniatura = null;
  cajas(0, bytes.length, (t, ini, fin) => {
    if (t !== 'meta') return true;
    cajas(ini + 4, fin, (t2, ini2, fin2) => {
      if (t2 === 'pitm') {
        const v = bytes[ini2];
        pitm = { off: ini2 + 4, v };
      } else if (t2 === 'iref') {
        const v = bytes[ini2];
        cajas(ini2 + 4, fin2, (t3, ini3) => {
          if (t3 === 'thmb' && miniatura === null) miniatura = v === 0 ? dv.getUint16(ini3) : dv.getUint32(ini3);
          return true;
        });
      }
      return true;
    });
    return false;
  });
  if (!pitm || miniatura === null) return null;
  const copia = bytes.slice();
  const dv2 = new DataView(copia.buffer);
  if (pitm.v === 0) {
    if (miniatura > 0xffff) return null;
    dv2.setUint16(pitm.off, miniatura);
  } else {
    dv2.setUint32(pitm.off, miniatura);
  }
  return copia;
}

/** Abre un HEIF y devuelve su imagen principal (o null), con su contexto para liberarlo. */
function abrir(bytes) {
  const ctx = mod.heif_context_alloc();
  const r = mod.heif_context_read_from_memory(ctx, bytes);
  if (r.code !== mod.heif_error_code.heif_error_Ok) {
    mod.heif_context_free(ctx);
    throw new Error(r.message || 'No es un HEIF válido');
  }
  const h = mod.heif_js_context_get_primary_image_handle(ctx);
  if (!h || h.code) {
    mod.heif_context_free(ctx);
    throw new Error('El HEIF no tiene imagen principal');
  }
  return { ctx, h, w: mod.heif_image_handle_get_width(h), hh: mod.heif_image_handle_get_height(h) };
}

function cerrar(a) {
  if (!a) return;
  try { mod.heif_image_handle_release(a.h); } catch { /* ya suelto */ }
  try { mod.heif_context_free(a.ctx); } catch { /* ya suelto */ }
}

async function rgba(a) {
  const img = await Promise.resolve(mod.heif_js_decode_image2(a.h, mod.heif_colorspace.heif_colorspace_RGB, mod.heif_chroma.heif_chroma_interleaved_RGBA));
  if (!img || img.code) throw new Error('libheif no pudo descodificar la imagen');
  try {
    const ch = img.channels.find((c) => c.id === mod.heif_channel.heif_channel_interleaved) || img.channels[0];
    const out = new Uint8ClampedArray(ch.width * ch.height * 4);
    if (ch.stride === ch.width * 4) out.set(ch.data.subarray(0, out.length));
    else for (let y = 0; y < ch.height; y++) out.set(ch.data.subarray(y * ch.stride, y * ch.stride + ch.width * 4), y * ch.width * 4);
    return { data: out, width: ch.width, height: ch.height };
  } finally {
    mod.heif_image_release(img.image);
  }
}

/** Reducción por promedio de área: cada píxel de salida es la media de los que cubre. */
function reducir(src, w, h, dw, dh) {
  const out = new Uint8ClampedArray(dw * dh * 4);
  const kx = w / dw, ky = h / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * ky), y1 = Math.max(y0 + 1, Math.floor((y + 1) * ky));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * kx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * kx));
      let r = 0, g = 0, b = 0, a = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * w + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) { r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; }
      }
      const n = (x1 - x0) * (y1 - y0);
      const o = (y * dw + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  return out;
}

self.onmessage = async ({ data: { id, buffer, maxSize, miniatura } }) => {
  let principal = null;
  let mini = null;
  try {
    await listo;
    const bytes = new Uint8Array(buffer);
    principal = abrir(bytes);
    const srcW = principal.w, srcH = principal.hh;
    let usar = principal;
    if (miniatura && maxSize) {
      const copia = conMiniaturaComoPrincipal(bytes);
      if (copia) {
        try {
          mini = abrir(copia);
          // Sólo si da para lo que se pide: una de 160 px no sirve para 480.
          if (Math.max(mini.w, mini.hh) >= Math.min(maxSize, Math.max(srcW, srcH)) * 0.6) usar = mini;
        } catch { mini = null; }
      }
    }
    let { data, width, height } = await rgba(usar);
    const k = maxSize ? Math.min(1, maxSize / Math.max(width, height)) : 1;
    if (k < 1) {
      const dw = Math.max(1, Math.round(width * k));
      const dh = Math.max(1, Math.round(height * k));
      data = reducir(data, width, height, dw, dh);
      width = dw; height = dh;
    }
    self.postMessage({ id, width, height, data: data.buffer, srcW, srcH, deMiniatura: usar === mini }, [data.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  } finally {
    cerrar(mini);
    cerrar(principal);
  }
};
