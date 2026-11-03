/**
 * galeria.js — Guardar en la galería del teléfono sin pasar por ningún menú.
 *
 * Sólo se puede desde la app nativa: una página web no tiene permiso para
 * escribir en Fotos, y lo más cerca que llega Safari es la hoja de compartir
 * (donde hay que tocar «Guardar imagen»). La app lleva el plugin
 * @capacitor-community/media, que añade la foto a Fotos con el permiso de
 * «sólo añadir» de iOS: no ve la galería, sólo deja fotos en ella.
 *
 * El código de la app llega desde GitHub Pages, así que el plugin se busca en
 * el puente de Capacitor por su nombre, sin importar nada: si esta versión de
 * la app nativa aún no lo lleva, `galeriaNativa()` dice que no y se guarda
 * como antes.
 */

/** El plugin, tal como lo expone el puente de Capacitor, o null. */
function plugin() {
  const C = globalThis.Capacitor;
  try {
    if (!C?.isNativePlatform?.() || !C.isPluginAvailable?.('Media')) return null;
    // La app de Floot lo importa y lo deja en `__laboratorioMedia`; la de
    // Xcode lo trae el puente.
    return C.Plugins?.Media || globalThis.__laboratorioMedia || C.registerPlugin?.('Media') || null;
  } catch {
    return null;
  }
}

/** ¿Se puede guardar directo en Fotos (o en la galería de Android)? */
export function galeriaNativa() {
  return !!plugin();
}

function aDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('No se pudo leer el archivo'));
    r.readAsDataURL(blob);
  });
}

/** Android exige un álbum: el de la app, que se crea la primera vez. */
let albumAndroid = null;
async function album(M) {
  if (globalThis.Capacitor?.getPlatform?.() !== 'android') return undefined;
  if (albumAndroid) return albumAndroid;
  const buscar = async () => (await M.getAlbums()).albums?.find((a) => a.name === 'Laboratorio')?.identifier;
  albumAndroid = await buscar();
  if (!albumAndroid) {
    await M.createAlbum({ name: 'Laboratorio' });
    albumAndroid = await buscar();
  }
  return albumAndroid;
}

/**
 * Añade una foto o un vídeo a la galería.
 *
 * @param {Blob} blob
 * @returns {Promise<void>} rechaza si no hay plugin o el usuario no da permiso
 */
export async function guardarEnGaleria(blob) {
  const M = plugin();
  if (!M) throw new Error('La galería no está disponible');
  const opciones = { path: await aDataUrl(blob) };
  const id = await album(M);
  if (id) opciones.albumIdentifier = id;
  if ((blob.type || '').startsWith('video')) await M.saveVideo(opciones);
  else await M.savePhoto(opciones);
}

/** Texto honesto para un fallo: el permiso es lo que suele faltar. */
export function describirFalloGaleria(err) {
  const msg = String(err?.message || err || '');
  if (/not allowed|denied|permission|access/i.test(msg)) {
    return 'Laboratorio no tiene permiso para añadir a Fotos. Actívalo en Ajustes → Laboratorio → Fotos.';
  }
  return 'No se pudo guardar en Fotos: ' + msg;
}
