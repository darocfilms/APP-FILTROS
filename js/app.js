/**
 * app.js — Armazón de la aplicación: pestañas, hojas modales, importación de
 * archivos y arranque.
 */

import { el, clear, toast, haptic } from './utils/dom.js';
import { library, makeThumb, videoPoster, decodeScaled, THUMB_SIZE } from './store/library.js';
import { CameraView } from './views/camera.js';
import { LabView } from './views/lab.js';
import { LibraryView } from './views/library.js';

const TABS = [
  { id: 'camera', label: 'Cámara', icon: '◉' },
  { id: 'lab', label: 'Laboratorio', icon: '◑' },
  { id: 'library', label: 'Biblioteca', icon: '▦' },
];

class App {
  constructor() {
    this.current = null;
    this.views = {};
    this.mount = document.getElementById('app');
  }

  async start() {
    if (!this._checkSupport()) return;

    await library.init();

    this.views.camera = new CameraView(this);
    this.views.lab = new LabView(this);
    this.views.library = new LibraryView(this);

    this.stack = el('main', { class: 'stack' },
      this.views.camera.root, this.views.lab.root, this.views.library.root);

    this.tabbar = el('nav', { class: 'tabbar', role: 'tablist', 'aria-label': 'Secciones' },
      TABS.map((t) => el('button', {
        type: 'button', class: 'tabbar__tab', role: 'tab', dataset: { tab: t.id },
        onclick: () => this.go(t.id),
      },
        el('span', { class: 'tabbar__icon', text: t.icon }),
        el('span', { class: 'tabbar__label', text: t.label }))));

    this.busy = el('div', { class: 'busy', hidden: true, 'aria-live': 'polite' },
      el('div', { class: 'busy__box' },
        el('span', { class: 'spinner', 'aria-hidden': 'true' }),
        el('span', { class: 'busy__text' })));

    this.fileInput = el('input', {
      type: 'file', accept: 'image/*,video/*', multiple: true,
      class: 'visually-hidden', 'aria-hidden': 'true', tabindex: -1,
    });
    this.fileInput.addEventListener('change', () => this._handleFiles([...this.fileInput.files]));

    clear(this.mount).append(this.stack, this.tabbar, this.busy, this.fileInput);

    // Volver a la cámara al reactivar la pestaña; soltarla al ocultarla, para
    // no dejar el indicador de cámara encendido en segundo plano.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.views.camera.deactivate();
      else if (this.current === 'camera') this.views.camera.activate();
    });

    window.addEventListener('resize', () => this.views.lab._layout?.());

    // Arrastrar y soltar en escritorio: cómodo para probar sin cámara.
    document.addEventListener('dragover', (e) => { e.preventDefault(); });
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = [...(e.dataTransfer?.files || [])];
      if (files.length) this._handleFiles(files);
    });

    const items = await library.list();
    this.go(items.length && !navigator.mediaDevices ? 'library' : 'camera');
    this._registerServiceWorker();
  }

  _checkSupport() {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (gl) return true;
    document.getElementById('app').append(
      el('div', { class: 'fatal' },
        el('h1', { text: 'Este navegador no admite WebGL2' }),
        el('p', { text: 'Todo el procesado de color se hace en la GPU y hace falta WebGL2. En iPhone se necesita iOS 15 o posterior con Safari.' })));
    return false;
  }

  /* ────────────────────────────── Navegación ─────────────────────────── */

  go(id) {
    if (this.current === id) return;
    if (this.current) this.views[this.current]?.deactivate?.();
    this.current = id;
    for (const v of Object.values(this.views)) v.root.classList.remove('is-active');
    this.views[id].root.classList.add('is-active');
    for (const t of this.tabbar.children) {
      const on = t.dataset.tab === id;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    }
    this.views[id].activate?.();
    haptic();
  }

  openInLab(item) {
    this.go('lab');
    this.views.lab.open(item);
  }

  notifyCapture(item) {
    this._lastCapture = item;
    if (this.current === 'library') this.views.library.render();
  }

  /* ──────────────────────────── Estado ocupado ───────────────────────── */

  setBusy(on, text = 'Trabajando…') {
    this.busy.hidden = !on;
    this.busy.querySelector('.busy__text').textContent = text;
  }

  /* ───────────────────────────── Hoja modal ──────────────────────────── */

  /**
   * Hoja inferior al estilo de iOS.
   * @returns {{close:()=>void, node:HTMLElement}}
   */
  sheet(title, content) {
    const close = () => {
      backdrop.classList.remove('is-open');
      setTimeout(() => backdrop.remove(), 220);
    };
    const panel = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      el('div', { class: 'sheet__grab' }),
      el('h3', { class: 'sheet__title', text: title }),
      ...content);
    const backdrop = el('div', {
      class: 'sheet-backdrop',
      onclick: (e) => { if (e.target === backdrop) close(); },
    }, panel);
    document.body.append(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('is-open'));
    return { close, node: panel };
  }

  /* ──────────────────────── Importación de archivos ──────────────────── */

  pickFile() {
    this.fileInput.value = '';
    this.fileInput.click();
  }

  /**
   * Los archivos importados se escriben en la carpeta local ANTES de abrirse.
   * Así el original nunca se queda flotando como blob en memoria: el
   * laboratorio lo vuelve a leer del disco, ya reducido a proxy.
   */
  async _handleFiles(files) {
    if (!files.length) return;
    this.setBusy(true, files.length > 1 ? `Importando ${files.length} archivos…` : 'Importando…');
    let first = null;
    let failed = 0;

    for (const file of files) {
      try {
        const isVideo = file.type.startsWith('video');
        let width = 0, height = 0, durationMs = 0, thumbBlob = null;

        if (isVideo) {
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
          const { bitmap, sourceWidth, sourceHeight } = await decodeScaled(file, THUMB_SIZE);
          width = sourceWidth; height = sourceHeight;
          thumbBlob = await makeThumb(bitmap);
          bitmap.close?.();
        }

        const item = await library.put(file, {
          kind: isVideo ? 'video' : 'photo', width, height, durationMs, origin: 'importado',
        });
        if (thumbBlob) await library.putThumb(item.id, thumbBlob);
        if (!first) first = item;
      } catch (err) {
        console.error(err);
        failed++;
      }
    }

    this.setBusy(false);
    if (failed) toast(`${failed} archivo${failed === 1 ? '' : 's'} no se pudo importar`, { error: true });
    if (first) {
      toast(files.length > 1 ? `${files.length - failed} archivos en la carpeta local` : 'Importado');
      if (files.length === 1) this.openInLab(first);
      else this.go('library');
    }
  }

  /* ───────────────────────────── Sin conexión ────────────────────────── */

  async _registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    try {
      await navigator.serviceWorker.register('./sw.js', { scope: './' });
    } catch {
      // Sin service worker la aplicación funciona igual, sólo que no sin red.
    }
  }
}

const app = new App();
app.start().catch((err) => {
  console.error(err);
  document.getElementById('app').append(
    el('div', { class: 'fatal' },
      el('h1', { text: 'No se pudo arrancar' }),
      el('p', { text: String(err?.message || err) })));
});

// Útil para depurar desde la consola de Safari conectada por cable.
window.__lab = app;
