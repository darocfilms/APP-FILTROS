/**
 * preload.js — Lo poco que la página sabe de la app de Mac.
 *
 * Corre aislado y sin Node (contextIsolation y sandbox): sólo marca el
 * documento y expone dos cosas a la página, con contextBridge.
 *
 *  - Clases en <html>: «app-mac» (dentro de la app de escritorio) y
 *    «app-mac--barra» en el Mac, donde los semáforos van sobre la página y
 *    hay que dejarles su franja (styles/app.css, --arriba).
 *  - window.laboratorioMac: la versión, y `alAbrirArchivos(cb)` para recibir
 *    las fotos abiertas con la app («Abrir con», soltarlas en el Dock).
 */

const { contextBridge, ipcRenderer } = require('electron');

const marcar = () => {
  const raiz = document.documentElement;
  if (!raiz) return false;
  raiz.classList.add('app-mac');
  if (process.platform === 'darwin') raiz.classList.add('app-mac--barra');
  return true;
};
if (!marcar()) window.addEventListener('DOMContentLoaded', marcar, { once: true });

contextBridge.exposeInMainWorld('laboratorioMac', {
  version: process.versions.electron,
  plataforma: process.platform,
  /** `cb([{ nombre, datos: Uint8Array }])` por cada lote de archivos abiertos. */
  alAbrirArchivos(cb) {
    ipcRenderer.on('abrir-archivos', (_e, archivos) => cb(archivos));
    // Hasta ahora no se mandan: los que llegaron al arrancar esperaban.
    ipcRenderer.send('lista');
  },
});
