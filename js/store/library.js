/**
 * library.js — Carpeta local del dispositivo.
 *
 * Por qué existe este módulo
 * --------------------------
 * Una foto de iPhone son 12 Mpx. Descodificada en memoria ocupa ~48 MB, y
 * Safari en iOS mata la pestaña mucho antes de lo que uno espera. Si además la
 * imagen viaja como blob de JavaScript entre pestañas de la aplicación, se
 * acumulan copias y la sesión se cae justo cuando ya has hecho el trabajo.
 *
 * La solución es no tener nunca el original en memoria:
 *
 *   · Los bytes se escriben en el sistema de archivos privado del origen
 *     (OPFS): una carpeta real en el dispositivo, persistente entre sesiones y
 *     que nunca pasa por el montón de JavaScript.
 *   · Los metadatos van en IndexedDB, que es transaccional y barato de leer.
 *   · El laboratorio trabaja con una copia reducida (proxy). El original sólo
 *     se vuelve a abrir en el momento de exportar, y se suelta acto seguido.
 *
 * Si OPFS no está disponible se guardan los blobs en IndexedDB. Funciona igual,
 * sólo que el navegador es menos generoso con la cuota.
 */

const DB_NAME = 'filtros-lab';
const DB_VERSION = 1;
const STORE_ITEMS = 'items';
const STORE_BLOBS = 'blobs';
const MEDIA_DIR = 'media';
const THUMB_DIR = 'thumbs';

/** Tamaño del lado mayor de las miniaturas de la galería. */
export const THUMB_SIZE = 480;
/**
 * Lado mayor del proxy de edición.
 *
 * Se ajusta a la pantalla en vez de fijar un número: en un panel de densidad 3×
 * un proxy de 1600 px se ve blando cuando la imagen ocupa toda la altura, y en
 * uno pequeño sobra resolución que sólo cuesta memoria. El techo de 2560 acota
 * el pico de memoria de vídeo, que es lo que tumba a Safari en iPhone.
 */
export const PROXY_SIZE = (() => {
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
  const side = Math.max(globalThis.screen?.width || 0, globalThis.screen?.height || 0, 800);
  return Math.round(Math.min(2560, Math.max(1600, side * dpr)));
})();

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ITEMS)) {
        db.createObjectStore(STORE_ITEMS, { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transacción cancelada'));
    result = fn(stores.map ? stores.map((s) => t.objectStore(s)) : t.objectStore(stores));
  });
}

function newId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

export function extensionFor(mime) {
  const map = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  };
  return map[String(mime).split(';')[0]] || 'bin';
}

class Library extends EventTarget {
  constructor() {
    super();
    this.db = null;
    this.root = null;
    this.mediaDir = null;
    this.thumbDir = null;
    this.mode = 'idb';
    this._ready = null;
  }

  init() {
    if (!this._ready) this._ready = this._init();
    return this._ready;
  }

  async _init() {
    this.db = await openDB();
    // Detección por intento: en iOS la versión no basta para saber si
    // createWritable existe de verdad.
    try {
      if (navigator.storage?.getDirectory) {
        this.root = await navigator.storage.getDirectory();
        this.mediaDir = await this.root.getDirectoryHandle(MEDIA_DIR, { create: true });
        this.thumbDir = await this.root.getDirectoryHandle(THUMB_DIR, { create: true });
        const probe = await this.mediaDir.getFileHandle('.probe', { create: true });
        const w = await probe.createWritable();
        await w.write(new Blob([new Uint8Array([1])]));
        await w.close();
        await this.mediaDir.removeEntry('.probe');
        this.mode = 'opfs';
      }
    } catch {
      this.mode = 'idb';
      this.mediaDir = this.thumbDir = null;
    }
    // Pide persistencia para que el sistema no borre la carpeta al necesitar
    // espacio. En iOS sólo se concede si la web está en la pantalla de inicio.
    try { await navigator.storage?.persist?.(); } catch { /* opcional */ }
    return this;
  }

  /* ─────────────────────────── Escritura ───────────────────────────── */

  /**
   * Guarda un archivo en la carpeta local.
   * @param {Blob} blob
   * @param {object} meta { kind, width, height, filmId, params, appliedParams, durationMs }
   * @returns {Promise<object>} el registro creado
   */
  async put(blob, meta = {}) {
    await this.init();
    const id = newId();
    const ext = extensionFor(blob.type);
    const name = `${id}.${ext}`;
    const item = {
      id,
      name,
      kind: meta.kind || (blob.type.startsWith('video') ? 'video' : 'photo'),
      mime: blob.type,
      size: blob.size,
      width: meta.width || 0,
      height: meta.height || 0,
      durationMs: meta.durationMs || 0,
      filmId: meta.filmId || null,
      filmName: meta.filmName || null,
      // `params` es el estado de edición que se recupera al reabrir el archivo.
      // `appliedParams` es el registro de cómo se reveló un archivo que ya sale
      // procesado: sirve de referencia, pero no se vuelve a aplicar.
      params: meta.params || null,
      appliedParams: meta.appliedParams || null,
      origin: meta.origin || 'camara',
      createdAt: Date.now(),
      storage: this.mode,
    };

    if (this.mode === 'opfs') {
      const handle = await this.mediaDir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    } else {
      await tx(this.db, STORE_BLOBS, 'readwrite', (store) => store.put(blob, name));
    }
    await tx(this.db, STORE_ITEMS, 'readwrite', (store) => store.put(item));
    this._emit('change');
    return item;
  }

  /** Guarda la miniatura asociada a un elemento. */
  async putThumb(id, blob) {
    await this.init();
    const name = `${id}.jpg`;
    if (this.mode === 'opfs') {
      const handle = await this.thumbDir.getFileHandle(name, { create: true });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
    } else {
      await tx(this.db, STORE_BLOBS, 'readwrite', (store) => store.put(blob, 'thumb:' + name));
    }
  }

  /** Actualiza los metadatos de un elemento sin tocar los bytes. */
  async update(id, patch) {
    await this.init();
    const item = await this.get(id);
    if (!item) return null;
    const next = { ...item, ...patch, id };
    await tx(this.db, STORE_ITEMS, 'readwrite', (store) => store.put(next));
    this._emit('change');
    return next;
  }

  /* ─────────────────────────── Lectura ─────────────────────────────── */

  async get(id) {
    await this.init();
    return new Promise((resolve, reject) => {
      const req = this.db.transaction(STORE_ITEMS).objectStore(STORE_ITEMS).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  /** Listado ordenado de más reciente a más antiguo. */
  async list() {
    await this.init();
    const items = await new Promise((resolve, reject) => {
      const req = this.db.transaction(STORE_ITEMS).objectStore(STORE_ITEMS).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    return items.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Devuelve el archivo original como File. En OPFS esto es un descriptor
   * respaldado por disco: no carga los bytes en memoria hasta que se leen.
   */
  async getFile(id) {
    await this.init();
    const item = await this.get(id);
    if (!item) return null;
    if (item.storage === 'opfs' && this.mediaDir) {
      try {
        const handle = await this.mediaDir.getFileHandle(item.name);
        return await handle.getFile();
      } catch {
        return null;
      }
    }
    const blob = await new Promise((resolve, reject) => {
      const req = this.db.transaction(STORE_BLOBS).objectStore(STORE_BLOBS).get(item.name);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    return blob ? new File([blob], item.name, { type: item.mime }) : null;
  }

  async getThumbBlob(id) {
    await this.init();
    const name = `${id}.jpg`;
    // Se mira en los dos sitios: una biblioteca puede tener elementos de antes
    // de que OPFS estuviera disponible, o al revés.
    if (this.thumbDir) {
      try {
        const handle = await this.thumbDir.getFileHandle(name);
        return await handle.getFile();
      } catch { /* no está en la carpeta; se prueba en IndexedDB */ }
    }
    return new Promise((resolve) => {
      const req = this.db.transaction(STORE_BLOBS).objectStore(STORE_BLOBS).get('thumb:' + name);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  /* ─────────────────────────── Borrado ─────────────────────────────── */

  async remove(id) {
    await this.init();
    const item = await this.get(id);
    if (!item) return;
    if (item.storage === 'opfs' && this.mediaDir) {
      await this.mediaDir.removeEntry(item.name).catch(() => {});
      await this.thumbDir.removeEntry(`${id}.jpg`).catch(() => {});
    } else {
      await tx(this.db, STORE_BLOBS, 'readwrite', (store) => {
        store.delete(item.name);
        store.delete('thumb:' + `${id}.jpg`);
      });
    }
    await tx(this.db, STORE_ITEMS, 'readwrite', (store) => store.delete(id));
    this._emit('change');
  }

  async clear() {
    await this.init();
    const items = await this.list();
    for (const it of items) await this.remove(it.id);
  }

  /* ─────────────────────────── Espacio ─────────────────────────────── */

  async usage() {
    await this.init();
    let used = 0;
    let quota = 0;
    try {
      const est = await navigator.storage?.estimate?.();
      used = est?.usage || 0;
      quota = est?.quota || 0;
    } catch { /* la estimación no siempre está disponible */ }
    const items = await this.list();
    const own = items.reduce((n, i) => n + (i.size || 0), 0);
    return { used, quota, own, count: items.length, mode: this.mode };
  }

  _emit(type) { this.dispatchEvent(new Event(type)); }
}

export const library = new Library();

/* ───────────────────────── Utilidades de imagen ──────────────────────────── */

/**
 * Descodifica un archivo a un tamaño máximo. `createImageBitmap` con
 * `resize*` deja el reescalado en manos del descodificador nativo, así que la
 * imagen a resolución completa nunca llega a existir en memoria: es lo que
 * permite abrir una foto de 48 Mpx en un iPhone sin que se caiga la pestaña.
 *
 * @param {Blob|File} file
 * @param {number} maxSize lado mayor del resultado
 */
export async function decodeScaled(file, maxSize) {
  const probe = await createImageBitmap(file);
  const { width, height } = probe;
  if (Math.max(width, height) <= maxSize) {
    return { bitmap: probe, sourceWidth: width, sourceHeight: height, scaled: false };
  }
  probe.close?.();
  const k = maxSize / Math.max(width, height);
  const bitmap = await createImageBitmap(file, {
    resizeWidth: Math.max(1, Math.round(width * k)),
    resizeHeight: Math.max(1, Math.round(height * k)),
    resizeQuality: 'high',
  });
  return { bitmap, sourceWidth: width, sourceHeight: height, scaled: true };
}

/** Miniatura JPEG a partir de cualquier fuente dibujable. */
export async function makeThumb(source, size = THUMB_SIZE) {
  const w = source.width || source.videoWidth;
  const h = source.height || source.videoHeight;
  const k = Math.min(1, size / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
  canvas.width = canvas.height = 0;
  return blob;
}

/** Primer fotograma de un vídeo, para la miniatura de la galería. */
export function videoPoster(url, seekTo = 0.1) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.playsInline = true;

    let timer = null;
    const done = (fn, value) => {
      clearTimeout(timer);
      v.onerror = v.onloadeddata = v.onseeked = null;
      v.src = '';
      fn(value);
    };
    timer = setTimeout(() => done(reject, new Error('Tiempo agotado al leer el vídeo')), 8000);

    v.onerror = () => done(reject, new Error('No se pudo leer el vídeo'));
    v.onloadeddata = () => { v.currentTime = Math.min(seekTo, (v.duration || 1) * 0.1); };
    v.onseeked = async () => {
      try {
        const blob = await makeThumb(v);
        const info = { blob, width: v.videoWidth, height: v.videoHeight, duration: v.duration };
        done(resolve, info);
      } catch (e) {
        done(reject, e);
      }
    };
    v.src = url;
  });
}

export function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / 1024 ** i).toFixed(i === 0 ? 0 : 1) + ' ' + u[i];
}
