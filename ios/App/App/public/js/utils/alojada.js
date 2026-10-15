/**
 * alojada.js — Laboratorio cargado desde otra página (la app de Floot).
 *
 * La app nativa que publica Floot es una página suya que importa estos mismos
 * módulos desde GitHub Pages. Casi todo funciona igual, salvo dos cosas que el
 * navegador sólo permite en el origen de la propia página:
 *
 *  - Un worker no puede crearse con la URL de otro origen. Los descodificadores
 *    de RAW (LibRaw) y HEIF (libheif) se crean así, y fallarían. Aquí se
 *    envuelve `Worker` para que, cuando la URL sea de fuera, cree un worker de
 *    blob que a su vez importe el script verdadero (un blob sí es del origen de
 *    la página). Los módulos importados conservan su URL real, así que cada uno
 *    sigue encontrando su .wasm al lado.
 *
 *  - El service worker no puede registrarse: lo comprueba app.js con `alojada`.
 *
 * Este módulo debe importarse el primero, antes de que nadie cree un worker.
 */

/** ¿Nos ha importado una página de otro origen? */
export const alojada = new URL(import.meta.url).origin !== location.origin;

/**
 * Para un worker clásico de blob, `importScripts` relativo ya no apunta a su
 * carpeta. El worker de libheif mira `self.__BASE__` para saber dónde está.
 */
function envoltorio(url, tipo) {
  const href = JSON.stringify(url.href);
  const codigo = tipo === 'module'
    ? `import ${href};`
    : `self.__BASE__ = ${JSON.stringify(new URL('./', url).href)};\nimportScripts(${href});`;
  return URL.createObjectURL(new Blob([codigo], { type: 'text/javascript' }));
}

if (alojada && typeof Worker === 'function' && !Worker.__cruzado) {
  const Nativo = Worker;
  class WorkerCruzado extends Nativo {
    constructor(url, opts) {
      let destino = url;
      try {
        const u = new URL(String(url), location.href);
        if (/^https?:$/.test(u.protocol) && u.origin !== location.origin) {
          destino = envoltorio(u, opts?.type);
        }
      } catch { /* una URL que no se entiende: que decida el navegador */ }
      super(destino, opts);
    }
  }
  WorkerCruzado.__cruzado = true;
  globalThis.Worker = WorkerCruzado;
}
