/**
 * app.js — Armazón de la aplicación: pestañas, hojas modales, importación de
 * archivos y arranque.
 */

// El primero: si otra página (la app de Floot) carga estos módulos, prepara
// los workers antes de que nadie cree uno.
import { alojada } from './utils/alojada.js';
import { el, clear, toast, haptic } from './utils/dom.js';
import {
  saveFiles, canShareFiles, shareNow, downloadNow, uniqueNames, isIOS, isNativeApp, isMacApp,
} from './utils/share.js';
import { galeriaNativa, guardarEnGaleria, describirFalloGaleria } from './utils/galeria.js';
import { ajustes } from './store/ajustes.js';
import { library } from './store/library.js';
import { importarArchivo, refinarMiniaturas } from './store/importar.js';
import { archivosSoltados } from './store/preview.js';
import { Importer, ACEPTA } from './ui/importer.js';
import { Conmutador } from './ui/conmutador.js';
import { CameraView } from './views/camera.js';
import { LabView } from './views/lab.js';
import { LibraryView } from './views/library.js';

/** Tipo de un archivo abierto con la app de Mac, que llega sólo con su nombre. */
function tipoPorNombre(nombre) {
  const ext = (nombre.split('.').pop() || '').toLowerCase();
  return {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff',
    heic: 'image/heic', heif: 'image/heif', hif: 'image/heif', arw: 'image/x-sony-arw',
    mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4',
  }[ext] || '';
}

function formatSize(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / 1024 ** i).toFixed(i === 0 ? 0 : 1) + ' ' + u[i];
}


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

    // La cápsula de las secciones y sus gestos (deslizar de lado, hacia
    // arriba o con dos dedos): js/ui/conmutador.js.
    this.conmutador = new Conmutador(this);
    this.tabbar = this.conmutador.root;

    this.busy = el('div', { class: 'busy', hidden: true, 'aria-live': 'polite' },
      el('div', { class: 'busy__box' },
        el('span', { class: 'spinner', 'aria-hidden': 'true' }),
        el('span', { class: 'busy__text' })));

    this.fileInput = el('input', {
      // Las extensiones de RAW de Sony van aparte: no son `image/*` para el
      // sistema, y sin ellas el selector del iPhone no deja elegir un ARW
      // desde Archivos.
      type: 'file', accept: ACEPTA, multiple: true,
      class: 'visually-hidden', 'aria-hidden': 'true', tabindex: -1,
    });
    this.fileInput.addEventListener('change', () => this._handleFiles([...this.fileInput.files]));

    clear(this.mount).append(this.stack, this.tabbar, this.conmutador.capa, this.busy, this.fileInput);
    this.importer = new Importer(this);

    // Volver a la cámara al reactivar la pestaña; soltarla al ocultarla, para
    // no dejar el indicador de cámara encendido en segundo plano.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.views.camera.deactivate();
      else if (this.current === 'camera') this.views.camera.activate();
    });

    window.addEventListener('resize', () => this.views.lab._layout?.());

    // Arrastrar y soltar en el ordenador: fotos sueltas o carpetas enteras.
    document.addEventListener('dragover', (e) => {
      e.preventDefault();
      document.body.classList.add('is-dropping');
    });
    document.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget) document.body.classList.remove('is-dropping');
    });
    document.addEventListener('drop', async (e) => {
      e.preventDefault();
      document.body.classList.remove('is-dropping');
      const carpetas = [...(e.dataTransfer?.items || [])].some((it) => it.webkitGetAsEntry?.()?.isDirectory);
      const lista = await archivosSoltados(e.dataTransfer);
      if (!lista.length) return;
      // Una sola foto se abre directamente, como siempre; varias o una
      // carpeta van al menú de importación para elegir.
      if (lista.length === 1 && !carpetas && !this.importer.abierto) this._handleFiles([lista[0].file]);
      else this.importer.abrir(lista);
    });

    // La app de Mac (mac/): su barra de menús manda órdenes, y las fotos
    // abiertas con ella («Abrir con», soltarlas en el Dock) llegan aquí.
    window.__labMenu = (accion) => this._accionMenu(accion);
    globalThis.laboratorioMac?.alAbrirArchivos?.((lista) => {
      this._handleFiles(lista.map(({ nombre, datos }) => new File([datos], nombre, { type: tipoPorNombre(nombre) })));
    });

    const items = await library.list();
    this.go(items.length && !navigator.mediaDevices ? 'library' : 'camera');
    this._registerServiceWorker();
    // Miniaturas de RAW que quedaron a medias en otra sesión.
    if (items.some((i) => i.thumbProvisional)) setTimeout(() => this.refinar(), 4000);
  }

  /** Rehace en segundo plano las miniaturas de RAW, fuera del laboratorio y la cámara. */
  refinar() {
    refinarMiniaturas({ pausa: () => document.hidden || this.current === 'lab' || this.current === 'camera' });
  }

  /** Órdenes de la barra de menús de la app de Mac. */
  _accionMenu(accion) {
    if (accion === 'camera' || accion === 'lab' || accion === 'library') this.go(accion);
    else if (accion === 'carrusel') this.conmutador.abrir();
    else if (accion === 'importar' || accion === 'importar-carpeta') {
      // Llega como gesto del usuario (main.js), así que el selector se puede
      // abrir directamente, sin pasar por el botón del menú de importación.
      this.importer.abrir();
      (accion === 'importar' ? this.importer.inputArchivos : this.importer.inputCarpeta).click();
    } else if (accion === 'exportar') {
      if (this.current === 'lab' && this.views.lab.item) this.views.lab._openExport();
      else toast('Abre una foto en el laboratorio para exportarla');
    } else if (accion === 'ajustes') {
      this.abrirAjustes();
    }
  }

  /** El menú de importación: elegir fotos, carpetas o discos, y cuáles entran. */
  openImporter() {
    this.importer.abrir();
  }

  /** Lo que hace la app después de importar desde el menú. */
  importados(n, primero) {
    if (!n) return;
    this.refinar();
    if (n === 1 && primero?.kind === 'photo' && this.current === 'lab') this.openInLab(primero);
    else if (this.current !== 'library') this.go('library');
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
    this.conmutador.marcar(id);
    this.views[id].activate?.();
    haptic();
  }

  openInLab(item) {
    this.go('lab');
    this.views.lab.open(item);
  }

  notifyCapture(item) {
    this._lastCapture = item;
    this.views.camera.pintarUltima?.();
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
    // Un toque en el fondo cierra la hoja, pero no en el primer instante: el
    // click que sigue a la pulsación que la abrió (mantener pulsada una foto)
    // caería justo ahí.
    const abierta = performance.now();
    const backdrop = el('div', {
      class: 'sheet-backdrop',
      onclick: (e) => { if (e.target === backdrop && performance.now() - abierta > 450) close(); },
    }, panel);
    document.body.append(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('is-open'));
    return { close, node: panel };
  }

  /* ─────────────────────────── Guardar fuera ─────────────────────────── */

  /** Adónde va lo que se guarda en un toque, dicho como lo entiende quien lo usa. */
  get destinoGuardar() {
    if (galeriaNativa()) return 'Fotos';
    if (isMacApp()) return 'Imágenes › Laboratorio';
    if (isIOS) return 'Fotos (con la hoja de iOS)';
    return 'Descargas';
  }

  /**
   * Guardar en un toque: sin hojas ni menús propios, directo a la galería.
   *
   *  - App nativa: a Fotos con el plugin de la galería. Ni hoja del sistema.
   *  - App de Mac: a Imágenes › Laboratorio › Exportadas (main.js avisa).
   *  - Navegador de ordenador: descarga directa.
   *  - Safari en iPhone: la web no puede escribir en Fotos; lo más directo
   *    es abrir la hoja de iOS en el acto, donde «Guardar imagen» es un
   *    toque. Sólo se puede mientras dure la activación del toque que lo
   *    pidió: si preparar el archivo la ha agotado, queda la hoja de
   *    siempre (`presentSave`), que pide un toque más.
   *
   * Con «Guardar directamente en la galería» apagado en Ajustes, se usa la
   * hoja de siempre, que deja elegir qué hacer con el archivo.
   *
   * @param {Blob[]} blobs
   * @param {string[]} names
   * @param {{title?:string, detail?:string}} [meta]
   * @returns {Promise<string>} qué ha pasado: 'galeria', 'downloaded', 'shared', 'cancelled', 'hoja' o 'error'
   */
  async guardar(blobs, names, meta = {}) {
    const list = Array.isArray(blobs) ? blobs : [blobs];
    const labels = uniqueNames(Array.isArray(names) ? names : [names]);
    const n = list.length;
    const varias = n > 1;
    if (!ajustes.get('guardarEnGaleria')) { this.presentSave(list, labels, meta); return 'hoja'; }

    if (galeriaNativa()) {
      try {
        if (varias) this.setBusy(true, `Guardando ${n} en Fotos…`);
        for (const b of list) await guardarEnGaleria(b);
        toast(varias ? `${n} guardadas en Fotos` : 'Guardada en Fotos');
        haptic(12);
        return 'galeria';
      } catch (err) {
        toast(describirFalloGaleria(err), { error: true, ms: 5200 });
        return 'error';
      } finally {
        if (varias) this.setBusy(false);
      }
    }

    if (isMacApp() || !isIOS) {
      for (const [i, b] of list.entries()) downloadNow(b, labels[i]);
      toast(isMacApp()
        ? (varias ? `${n} guardadas en Imágenes › Laboratorio` : 'Guardada en Imágenes › Laboratorio')
        : (varias ? `${n} descargadas` : 'Descargada'));
      return 'downloaded';
    }

    // Safari en iPhone. `userActivation` dice si el toque sigue valiendo; sin
    // él (iOS antiguo) no hay forma de saberlo y se prueba igualmente.
    const vigente = navigator.userActivation ? navigator.userActivation.isActive : true;
    const files = list.map((b, i) => new File([b], labels[i], { type: b.type }));
    if (vigente && canShareFiles(files)) {
      const r = await shareNow(files, meta.title || (varias ? `${n} archivos` : labels[0]));
      if (r === 'shared') { toast(varias ? `${n} guardadas` : 'Guardada'); return r; }
      if (r === 'cancelled') return r;
    }
    this.presentSave(list, labels, meta);
    return 'hoja';
  }

  /* ─────────────────────────────── Ajustes ───────────────────────────── */

  /**
   * La hoja de Ajustes: guardar directo en la galería (de fábrica, sí) y el
   * formato de la cámara. Se abre con la rueda de la biblioteca o con ⌘, en
   * la app de Mac.
   */
  abrirAjustes() {
    const nativa = galeriaNativa();
    const detalleGaleria = nativa
      ? 'Cada foto o vídeo que hagas se copia en Fotos, y «Guardar» la manda allí con un toque, sin menús.'
      : isMacApp()
      ? '«Guardar» deja la foto en Imágenes › Laboratorio › Exportadas con un toque, sin preguntar.'
      : isIOS
      ? '«Guardar» abre en el acto la hoja de iOS: toca «Guardar imagen». Safari no deja que una web escriba en Fotos por su cuenta; la app de Laboratorio, sí.'
      : '«Guardar» descarga la foto con un toque, sin preguntar.';

    const interruptor = (clave, titulo, detalle) => {
      const input = el('input', {
        type: 'checkbox', role: 'switch', class: 'interruptor__input', dataset: { ajuste: clave },
        checked: ajustes.get(clave),
      });
      input.addEventListener('change', () => { ajustes.set(clave, input.checked); haptic(); });
      return el('label', { class: 'ajuste' },
        el('span', { class: 'ajuste__texto' },
          el('span', { class: 'ajuste__titulo', text: titulo }),
          el('span', { class: 'ajuste__detalle', text: detalle })),
        el('span', { class: 'interruptor' }, input, el('span', { class: 'interruptor__pista', 'aria-hidden': 'true' })));
    };

    const detalleFormato = el('span', { class: 'ajuste__detalle' });
    const seg = el('div', { class: 'ajuste__seg', role: 'radiogroup', 'aria-label': 'Formato de la cámara' });
    const pintarFormato = () => {
      const f = ajustes.get('formato');
      for (const b of seg.children) {
        b.classList.toggle('is-active', b.dataset.formato === f);
        b.setAttribute('aria-checked', String(b.dataset.formato === f));
      }
      detalleFormato.textContent = f === 'raw'
        ? 'Sin pérdida y sin hornear: la emulsión, la exposición y el encuadre quedan como ajustes que se cambian en el laboratorio.'
        : 'Calidad máxima (100 %), con la emulsión revelada en la foto. Ocupa menos que el RAW.';
    };
    for (const [k, t] of [['jpeg', 'JPEG'], ['raw', 'RAW']]) {
      seg.append(el('button', {
        type: 'button', role: 'radio', class: 'ajuste__opcion', dataset: { formato: k }, text: t,
        onclick: () => { ajustes.set('formato', k); pintarFormato(); haptic(); },
      }));
    }
    pintarFormato();

    const hoja = this.sheet('Ajustes', [
      el('div', { class: 'ajustes' },
        interruptor('guardarEnGaleria', 'Guardar directamente en la galería', detalleGaleria),
        el('div', { class: 'ajuste ajuste--seg' },
          el('span', { class: 'ajuste__texto' },
            el('span', { class: 'ajuste__titulo', text: 'Formato de la cámara' }),
            detalleFormato),
          seg)),
      el('p', { class: 'sheet__hint', text: 'La cámara arranca siempre en la calidad máxima: el sensor completo, sin recortar.' }),
      el('div', { class: 'sheet__actions' },
        el('button', { type: 'button', class: 'btn btn--primary', text: 'Hecho', onclick: () => hoja.close() })),
    ]);
    hoja.node.classList.add('sheet--ajustes');
    return hoja;
  }

  /**
   * Presenta archivos YA preparados para sacarlos del dispositivo.
   *
   * Existe como paso aparte por una razón de peso: `navigator.share` exige
   * activación del usuario y esa activación caduca. Si se revela una foto de
   * doce megapíxeles entre el toque y la llamada, Safari en iPhone la rechaza
   * y guardar simplemente no ocurre. Aquí el trabajo pesado ya está hecho, así
   * que el botón de esta hoja llama a compartir de forma inmediata y la
   * activación sigue viva.
   *
   * @param {Blob[]} blobs
   * @param {string[]} names
   * @param {{title?:string, detail?:string}} [meta]
   */
  presentSave(blobs, names, meta = {}) {
    const list = Array.isArray(blobs) ? blobs : [blobs];
    const labels = Array.isArray(names) ? names : [names];
    const total = list.reduce((n, b) => n + b.size, 0);
    const many = list.length > 1;
    const puedeCompartir = canShareFiles(list.map((b, i) => new File([b], labels[i], { type: b.type })));

    const run = async () => {
      sheet.close();
      const result = await saveFiles(list, labels, { title: meta.title });
      if (result === 'shared') toast(many ? `${list.length} archivos compartidos` : 'Guardado');
      else if (result === 'downloaded') toast(many ? `${list.length} descargas` : 'Descargado');
      // 'longpress' abre su propia ventana y 'cancelled' no necesita aviso.
    };

    const sheet = this.sheet(many ? `${list.length} archivos listos` : 'Listo para guardar', [
      el('p', { class: 'sheet__hint' },
        (meta.detail ? meta.detail + ' · ' : '') + formatSize(total)),
      el('div', { class: 'sheet__actions sheet__actions--stack' },
        el('button', {
          type: 'button', class: 'btn btn--primary',
          text: puedeCompartir
            ? (isIOS ? 'Guardar en Fotos o Archivos' : 'Compartir')
            : 'Descargar',
          onclick: run,
        }),
        el('button', { type: 'button', class: 'btn', text: 'Cancelar', onclick: () => sheet.close() })),
      isIOS && !puedeCompartir
        ? el('p', { class: 'sheet__hint', text: 'Este navegador no ofrece la hoja del sistema: se mostrará la imagen para guardarla manteniéndola pulsada.' })
        : null,
    ]);
  }

  /* ──────────────────────── Importación de archivos ──────────────────── */

  pickFile() {
    this.fileInput.value = '';
    this.fileInput.click();
  }

  /**
   * Lo elegido con el selector rápido. Una sola foto se importa y se abre en el
   * laboratorio sin más pasos; varias van al menú de importación, para elegir.
   *
   * Los archivos se escriben en la biblioteca ANTES de abrirse: así el original
   * nunca se queda flotando como blob en memoria, y el laboratorio lo vuelve a
   * leer del disco, ya reducido a proxy.
   */
  async _handleFiles(files) {
    if (!files.length) return;
    if (files.length > 1) {
      this.importer.abrir(files.map((file) => ({ file, ruta: file.name })));
      return;
    }
    this.setBusy(true, 'Importando…');
    try {
      const item = await importarArchivo(files[0]);
      toast('Importado');
      this.refinar();
      this.openInLab(item);
    } catch (err) {
      console.error(err);
      toast('No se pudo importar: ' + (err?.message || err), { error: true });
    } finally {
      this.setBusy(false);
    }
  }

  /* ───────────────────────────── Sin conexión ────────────────────────── */

  async _registerServiceWorker() {
    // En la app nativa los archivos ya van dentro del paquete: no hay red de la
    // que protegerse, y el esquema propio de la app no admite service workers.
    if (isNativeApp() || isMacApp()) return;
    // Cargada desde otra página (la app de Floot), el service worker sería de
    // ese otro sitio: ni se puede registrar ni le corresponde a Laboratorio.
    if (alojada) return;
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
