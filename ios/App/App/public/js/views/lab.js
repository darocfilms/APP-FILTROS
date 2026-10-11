/**
 * lab.js — Laboratorio de edición.
 *
 * Trabaja siempre sobre un proxy reducido: es lo que mantiene la respuesta
 * inmediata al mover un deslizador y lo que evita que Safari en iPhone se caiga
 * al abrir una foto de 12 Mpx. El original sólo se vuelve a leer de la carpeta
 * local en el momento de exportar, y se descarta en cuanto termina.
 */

import { el, toast, haptic, debounce, rafThrottle, ESCRITORIO, isTyping, esEscritorio } from '../utils/dom.js';
import { Renderer, renderToBlob } from '../engine/renderer.js';
import { defaultParams, applyFilmLook, cloneParams, mergeParams } from '../data/params.js';
import { getFilm } from '../data/films.js';
import { library, decodeScaled, makeThumb, PROXY_SIZE, formatBytes } from '../store/library.js';
import { PanelStack } from '../ui/panels.js';
import { CropOverlay } from '../ui/crop.js';
import { Histogram } from '../ui/histogram.js';
import { Filmstrip } from '../ui/filmstrip.js';
import { timestampName, isIOS } from '../utils/share.js';
import { isRawFile } from '../store/raw.js';
import { copySettings, copiedSettings, describeEdits, colorPart, EVENTO_PORTAPAPELES } from '../store/develop.js';

const PRESET_KEY = 'filtros.presets.v1';
const TIRA_KEY = 'lab.tira.v1';

/** Icono de la tira: tres fotogramas en fila, como un trozo de película. */
const TIRA_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" '
  + 'stroke-width="1.8" stroke-linejoin="round" aria-hidden="true" focusable="false">'
  + '<rect x="2.5" y="6" width="5.5" height="12" rx="1"/><rect x="9.25" y="6" width="5.5" height="12" rx="1"/>'
  + '<rect x="16" y="6" width="5.5" height="12" rx="1"/></svg>';
const HISTORY_MAX = 60;

const EXPORT_SIZES = [
  { key: 'full', label: 'Original', max: Infinity },
  { key: '4k', label: '4K', max: 3840 },
  { key: '2k', label: '2K', max: 2560 },
  { key: 'hd', label: '1080', max: 1920 },
  { key: 'web', label: 'Web', max: 1280 },
];

const EXPORT_FORMATS = [
  { key: 'image/jpeg', label: 'JPEG', ext: 'jpg', quality: true },
  { key: 'image/png', label: 'PNG', ext: 'png', quality: false },
  { key: 'image/webp', label: 'WebP', ext: 'webp', quality: true },
];

export class LabView {
  constructor(app) {
    this.app = app;
    this.params = defaultParams();
    this.item = null;
    this.proxy = null;
    this.renderer = null;
    this.history = [];
    this.historyAt = -1;
    this.comparing = false;
    /** Antes/después fijado con el botón, frente al de mantener pulsado. */
    this.compareLocked = false;
    this.collapsed = false;
    this.exportOpts = { size: 'full', format: 'image/jpeg', quality: 0.95 };

    this.canvas = el('canvas', { class: 'lab__canvas' });
    this.histogram = new Histogram();
    this.crop = new CropOverlay(this.params.geometry, (committed) => this._changed(committed));

    this.root = this._build();
    this._requestRender = rafThrottle(() => this._render());
    this._pushHistoryDebounced = debounce(() => this._pushHistory(), 260);
    this._updateHistogram = debounce(() => this._computeHistogram(), 220);
    this._persistParams = debounce(() => this._persistNow(), 700);
    this._thumb = debounce(() => this._snapshotThumb(), 1200);
    document.addEventListener('keydown', (e) => this._onKey(e));
    globalThis.addEventListener?.(EVENTO_PORTAPAPELES, () => { this.pasteBtn.disabled = !copiedSettings(); });
  }

  /* ─────────────────────────────── Interfaz ──────────────────────────── */

  _build() {
    this.title = el('span', { class: 'lab__title', text: 'Laboratorio' });
    this.subtitle = el('span', { class: 'lab__subtitle' });

    this.undoBtn = this._iconBtn('↺', 'Deshacer', () => this.undo());
    this.redoBtn = this._iconBtn('↻', 'Rehacer', () => this.redo());
    this.compareBtn = this._iconBtn('◐', 'Ver el antes', () => this.toggleCompare());
    this.histBtn = this._iconBtn('▟', 'Histograma', (e) => {
      const on = this.histogram.root.classList.toggle('is-visible');
      e.currentTarget.classList.toggle('is-active', on);
      this._render();
      if (on) this._computeHistogram();
    });

    this.stage = el('div', { class: 'lab__stage' },
      el('div', { class: 'lab__frame' },
        this.canvas,
        this.compareTag = el('span', { class: 'lab__comparetag', text: 'ANTES', hidden: true }),
        this.zoomTag = el('div', { class: 'lab__zoomtag', hidden: true }),
        this.crop.root, this.histogram.root),
      el('div', { class: 'lab__empty' },
        el('p', { text: 'Abre una foto de la biblioteca o importa una del dispositivo.' }),
        el('div', { class: 'lab__emptyactions' },
          el('button', { type: 'button', class: 'btn btn--primary', text: 'Importar archivo', onclick: () => this.app.pickFile() }),
          el('button', { type: 'button', class: 'btn', text: 'Ir a la biblioteca', onclick: () => this.app.go('library') }))));

    this.strip = new Filmstrip({ onPick: (item) => { if (item.id !== this.item?.id) this.open(item); } });
    this.stage.append(this.strip.root);

    this.panels = new PanelStack(this.params, (committed) => this._changed(committed), {
      onPickFilm: (id) => this._pickFilm(id),
      onGeometry: (what, value) => this._geometryChanged(what, value),
      onPanel: (id) => {
        this.setCropActive(id === 'geometry' && !this.collapsed);
        // Curvas dibuja el histograma de fondo, así que al abrirlo hay que
        // volver a renderizar para que exista la reducción que lo alimenta.
        if (id === 'curves') { this._render(); this._computeHistogram(); }
      },
      onToggleCollapse: () => this.toggleCollapsed(),
    });

    this._bindPointer();

    const root = el('section', { class: 'view view--lab', id: 'view-lab' },
      this.stage,
      el('header', { class: 'lab__bar' },
        el('div', { class: 'lab__id' }, this.title, this.subtitle),
        el('div', { class: 'lab__actions' },
          this.undoBtn, this.redoBtn, this.compareBtn, this.histBtn,
          this.stripBtn = this._iconBtn(el('span', { class: 'iconbtn__svg', html: TIRA_SVG }), 'Tira de fotos', () => this.toggleStrip()),
          this._iconBtn('⤓', 'Presets', () => this._openPresets()),
          // En el Mac sobra sitio en la barra: copiar y pegar a la vista. En el
          // teléfono no caben, y están dentro de Presets.
          el('button', {
            type: 'button', class: 'btn btn--ghost lab__clip', text: 'Copiar',
            title: 'Copiar los ajustes de color (⌘C)', onclick: () => this.copyAdjustments(),
          }),
          this.pasteBtn = el('button', {
            type: 'button', class: 'btn btn--ghost lab__clip', text: 'Pegar',
            title: 'Pegar los ajustes copiados (⌘V)', disabled: !copiedSettings(),
            onclick: () => this.pasteAdjustments(),
          }),
          el('button', {
            type: 'button', class: 'btn btn--primary lab__export',
            onclick: () => this._openExport(),
          }, 'Exportar'))),
      this.panels.root);

    // El hueco de la imagen se calcula con el alto real de los ajustes: al
    // cambiar de panel (una rueda de color ocupa más que cuatro deslizadores)
    // la imagen se reajusta en lugar de quedarse con un margen fijo de más.
    this._panelsRO = new ResizeObserver(([entry]) => {
      root.style.setProperty('--lab-panels', Math.round(entry.contentRect.height) + 'px');
    });
    this._panelsRO.observe(this.panels.root);

    // El hueco de la imagen ya no depende del alto de los paneles —la imagen se
    // queda quieta y ellos flotan encima—, pero sigue cambiando al girar el
    // teléfono o al abrir el recorte, así que se observa igual.
    this._frameRO = new ResizeObserver(() => this._layout());
    this._frameRO.observe(this.stage.querySelector('.lab__frame'));

    // Al agrandar la ventana del Mac por encima del corte, una columna que se
    // dejó plegada en el diseño de teléfono aparecería vacía: se despliega.
    // La tira, como se dejó la última vez; la primera, abierta en el Mac (sobra
    // sitio) y cerrada en el teléfono.
    let tira = null;
    try { tira = localStorage.getItem(TIRA_KEY); } catch { /* sin almacenamiento */ }
    queueMicrotask(() => this.toggleStrip(tira === null ? esEscritorio() : tira === '1', false));

    this._escritorio = globalThis.matchMedia?.(ESCRITORIO);
    this._escritorio?.addEventListener?.('change', (e) => { if (e.matches) this.toggleCollapsed(false); });
    return root;
  }

  /**
   * Pliega el cuerpo de ajustes dejando sólo la fila de pestañas.
   *
   * La imagen es el objeto de trabajo, así que tiene que poder ocupar la
   * pantalla entera de un toque. Plegado no se pierde el sitio: las pestañas
   * siguen visibles y tocar cualquiera vuelve a abrir su panel.
   */
  toggleCollapsed(force) {
    const next = force ?? !this.collapsed;
    if (next === this.collapsed) return;
    this.collapsed = next;
    this.root.classList.toggle('is-collapsed', this.collapsed);
    this.panels.setCollapsed(this.collapsed);
    if (this.collapsed) this.setCropActive(false);
    else if (this.panels.active === 'geometry') this.setCropActive(true);
    // No hace falta recolocar a mano: el observador del hueco lo hace en cada
    // paso de la transición.
  }

  _iconBtn(glyph, label, onClick) {
    return el('button', {
      type: 'button', class: 'iconbtn', 'aria-label': label, title: label,
      onclick: (e) => { haptic(); onClick(e); },
    }, glyph);
  }

  /**
   * Gestos sobre la foto.
   *
   * Antes/después: dos gestos para lo mismo, porque sirven para cosas
   * distintas. Mantener pulsada la imagen da un vistazo rápido mientras se
   * mueve un deslizador, y el botón lo deja fijo para compararlo con calma.
   * Mantener pulsado espera un instante antes de enseñar el original: un clic
   * o el doble clic que amplía no deben hacerlo parpadear.
   *
   * Lupa: doble clic (o doble toque) amplía al 100 % justo donde se pulsó y
   * otro vuelve a encajar. Ampliada, arrastrar o deslizar con dos dedos en el
   * trackpad mueve la foto.
   */
  _bindPointer() {
    const c = this.canvas;
    let drag = null;
    let hold = 0;
    let toque = { t: 0, x: 0, y: 0 };

    c.addEventListener('pointerdown', (e) => {
      this._ultimoPuntero = e.pointerType;
      if (!this.proxy || this.crop.active || drag) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, movido: false };
      if (this.zoom) {
        drag.panX = this.zoom.x;
        drag.panY = this.zoom.y;
        c.setPointerCapture?.(e.pointerId);
        c.classList.add('is-grabbing');
        return;
      }
      clearTimeout(hold);
      hold = setTimeout(() => { if (drag && !drag.movido && !this.zoom) this._setComparing(true); }, 180);
    });

    c.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 6) drag.movido = true;
      if (this.zoom && drag.panX !== undefined) {
        this.zoom.x = drag.panX + dx;
        this.zoom.y = drag.panY + dy;
        this._placeZoom();
      }
    });

    const soltar = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const movido = drag.movido;
      drag = null;
      clearTimeout(hold);
      c.classList.remove('is-grabbing');
      if (!this.compareLocked) this._setComparing(false);
      // Doble toque: en el móvil no hay doble clic fiable, se cuenta a mano.
      if (e.type === 'pointerup' && e.pointerType === 'touch' && !movido) {
        if (e.timeStamp - toque.t < 320 && Math.hypot(e.clientX - toque.x, e.clientY - toque.y) < 32) {
          toque.t = 0;
          this.toggleZoom(e.clientX, e.clientY);
        } else {
          toque = { t: e.timeStamp, x: e.clientX, y: e.clientY };
        }
      }
    };
    c.addEventListener('pointerup', soltar);
    c.addEventListener('pointercancel', soltar);
    c.addEventListener('pointerleave', (e) => { if (!this.zoom) soltar(e); });

    c.addEventListener('dblclick', (e) => {
      if (this._ultimoPuntero === 'touch') return;   // ya lo cuenta el doble toque
      e.preventDefault();
      this.toggleZoom(e.clientX, e.clientY);
    });

    // Dos dedos en el trackpad (o la rueda) mueven la foto ampliada.
    this.stage.querySelector('.lab__frame').addEventListener('wheel', (e) => {
      if (!this.zoom) return;
      e.preventDefault();
      this.zoom.x -= e.deltaX;
      this.zoom.y -= e.deltaY;
      this._placeZoom();
    }, { passive: false });
  }

  /* ─────────────────────────────── Lupa ──────────────────────────────── */

  /**
   * ¿Se puede cargar la foto entera para ampliarla? En el ordenador sí: es lo
   * que deja ver el detalle de verdad, píxel a píxel. En el teléfono una foto
   * de 24 Mpx entera es la forma más rápida de que Safari cierre la pestaña, así
   * que allí la lupa amplía el proxy, que ya tiene la resolución de la pantalla.
   */
  _lupaCompleta() {
    if (isIOS || /Android/i.test(navigator.userAgent)) return false;
    return !navigator.deviceMemory || navigator.deviceMemory >= 4;
  }

  /** Lado mayor con el que se carga la foto entera: hasta 36 Mpx y lo que admita la GPU. */
  _ladoCompleto() {
    const w = this.sourceWidth || this.proxy.width;
    const h = this.sourceHeight || this.proxy.height;
    const k = Math.min(1, Math.sqrt(36e6 / (w * h)));
    return Math.min(this.renderer.maxTexture, Math.floor(Math.max(w, h) * k));
  }

  /**
   * Tamaño en pantalla de la foto ampliada. Al 100 % un píxel de la foto es un
   * píxel de la pantalla (no un punto CSS: en una pantalla Retina son dos).
   * Si la foto es tan pequeña que eso apenas amplía, se dobla lo encajado.
   */
  _zoomSize() {
    const dpr = globalThis.devicePixelRatio || 1;
    const fuente = this._fuente || this.proxy;
    const ladoActual = Math.max(fuente.width, fuente.height);
    const ladoMeta = this.zoom?.lado || ladoActual;
    const k = ladoMeta / ladoActual;
    let w = (this.canvas.width * k) / dpr;
    let h = (this.canvas.height * k) / dpr;
    const encajada = this.zoom?.encajada;
    if (encajada && w < encajada.w * 1.6) {
      w = encajada.w * 2;
      h = encajada.h * 2;
    }
    return { w, h };
  }

  /** Dobla o deshace la lupa. `x, y` es el punto de la pantalla que se quiere mirar. */
  async toggleZoom(x, y) {
    if (this.zoom) { this._exitZoom(); return; }
    if (!this.proxy || this.crop.active) return;
    const frame = this.stage.querySelector('.lab__frame').getBoundingClientRect();
    const rect = this.canvas.getBoundingClientRect();
    if (x === undefined) { x = rect.left + rect.width / 2; y = rect.top + rect.height / 2; }
    const completa = this._lupaCompleta();
    this.zoom = {
      // Punto de la foto (0–1) bajo el puntero, y dónde está en el hueco.
      u: Math.min(1, Math.max(0, (x - rect.left) / rect.width)),
      v: Math.min(1, Math.max(0, (y - rect.top) / rect.height)),
      px: x - frame.left,
      py: y - frame.top,
      x: 0, y: 0,
      encajada: { w: rect.width, h: rect.height },
      lado: completa ? this._ladoCompleto() : null,
      cargando: completa && this._fuente !== this._full?.bitmap,
    };
    this.root.classList.add('is-zoomed');
    haptic();
    this._placeZoom(true);
    this._pintarZoomTag();
    if (completa) await this._cargarCompleta();
  }

  /** Carga la foto entera (una vez por foto) y la pone en el motor. */
  async _cargarCompleta() {
    const item = this.item;
    try {
      if (this._full?.id !== item.id) {
        this._soltarCompleta();
        const file = await library.getFile(item.id);
        if (!file) throw new Error('El archivo ya no está en la biblioteca');
        const { bitmap } = await decodeScaled(file, this._ladoCompleto());
        if (this.item !== item) { bitmap.close?.(); return; }
        this._full = { id: item.id, bitmap };
      }
      if (!this.zoom || this.item !== item) return;
      // El centro de lo que se está mirando se conserva al cambiar de fuente.
      const frame = this.stage.querySelector('.lab__frame').getBoundingClientRect();
      const antes = this._zoomSize();
      const cu = (frame.width / 2 - this.zoom.x) / antes.w;
      const cv = (frame.height / 2 - this.zoom.y) / antes.h;
      this._usarFuente(this._full.bitmap);
      this.zoom.lado = Math.max(this._full.bitmap.width, this._full.bitmap.height);
      this._render();
      const ahora = this._zoomSize();
      this.zoom.x = frame.width / 2 - cu * ahora.w;
      this.zoom.y = frame.height / 2 - cv * ahora.h;
    } catch (err) {
      console.error(err);
      toast('No se pudo cargar a resolución completa: se amplía la vista previa', { error: true });
      if (this.zoom) this.zoom.lado = null;
    } finally {
      if (this.zoom && this.item === item) {
        this.zoom.cargando = false;
        this._placeZoom();
        this._pintarZoomTag();
      }
    }
  }

  _usarFuente(bitmap) {
    if (this._fuente === bitmap) return;
    this._fuente = bitmap;
    this.renderer.setSource(bitmap, bitmap.width, bitmap.height);
  }

  /** Coloca la foto ampliada, sin dejar hueco vacío por ningún lado. */
  _placeZoom(inicial = false) {
    const z = this.zoom;
    if (!z) return;
    const box = this.stage.querySelector('.lab__frame').getBoundingClientRect();
    const { w, h } = this._zoomSize();
    if (inicial) {
      z.x = z.px - z.u * w;
      z.y = z.py - z.v * h;
    }
    z.x = w > box.width ? Math.min(0, Math.max(box.width - w, z.x)) : (box.width - w) / 2;
    z.y = h > box.height ? Math.min(0, Math.max(box.height - h, z.y)) : (box.height - h) / 2;
    Object.assign(this.canvas.style, { width: w + 'px', height: h + 'px', left: z.x + 'px', top: z.y + 'px' });
  }

  _pintarZoomTag() {
    const z = this.zoom;
    this.zoomTag.hidden = !z;
    if (!z) return;
    const dpr = globalThis.devicePixelRatio || 1;
    const fuente = this._fuente || this.proxy;
    // Porcentaje respecto del original: lo que un fotógrafo entiende por 100 %.
    const pct = Math.round(((this._zoomSize().w * dpr) / this.canvas.width)
      * (Math.max(fuente.width, fuente.height) / Math.max(this.sourceWidth || fuente.width, this.sourceHeight || fuente.height)) * 100);
    const tocar = this._ultimoPuntero === 'touch' ? 'Doble toque' : 'Doble clic';
    this.zoomTag.replaceChildren(...[
      z.cargando ? el('span', { class: 'spinner', 'aria-hidden': 'true' }) : null,
      el('b', { text: z.cargando ? 'Cargando el original…' : `${pct} %` }),
      el('span', { text: `${tocar} para encajar` }),
    ].filter(Boolean));
  }

  _exitZoom() {
    if (!this.zoom) return;
    this.zoom = null;
    this.root.classList.remove('is-zoomed');
    this.canvas.classList.remove('is-grabbing');
    this._pintarZoomTag();
    // Fuera de la lupa se vuelve al proxy: mover un deslizador sobre la foto
    // entera iría a tirones. La entera se guarda por si se vuelve a ampliar.
    if (this.proxy) this._usarFuente(this.proxy);
    this._lastCanvasSize = null;
    this._render();
    this._layout();
  }

  _soltarCompleta() {
    if (this._full && this._fuente === this._full.bitmap && this.proxy) this._usarFuente(this.proxy);
    this._full?.bitmap.close?.();
    this._full = null;
  }

  toggleCompare() {
    if (!this.proxy) return;
    this.compareLocked = !this.compareLocked;
    this.compareBtn.classList.toggle('is-active', this.compareLocked);
    this.compareBtn.setAttribute('aria-pressed', String(this.compareLocked));
    this._setComparing(this.compareLocked);
    haptic();
  }

  _setComparing(on) {
    if (this.comparing === on) return;
    this.comparing = on;
    this.compareTag.hidden = !on;
    this._render();
  }

  /* ──────────────────────────── Carga de imagen ──────────────────────── */

  async activate() {
    this._layout();
    if (this.proxy) this._requestRender();
    await this._syncFromLibrary();
  }

  deactivate() {
    this.comparing = false;
    this._exitZoom();
    this._soltarCompleta();
    // Lo que estuviera esperando se hace ya: al ir a la biblioteca, la foto
    // tiene que aparecer allí con lo último que se tocó.
    this._persistParams.flush();
    this._thumb.flush();
  }

  /**
   * Si los ajustes de la foto abierta cambiaron fuera —se pegaron otros desde
   * la biblioteca, o se quitaron—, el laboratorio los recoge al volver. Sin
   * esto, el siguiente toque en un deslizador guardaría encima los de antes.
   */
  async _syncFromLibrary() {
    const item = this.item;
    if (!item || !this.proxy) return;
    const fresh = await library.get(item.id).catch(() => null);
    if (!fresh || this.item !== item) return;
    this.item = fresh;
    const guardados = mergeParams(fresh.params);
    if (JSON.stringify(guardados) === this._persisted) return;
    for (const k of Object.keys(guardados)) this.params[k] = guardados[k];
    this.crop.geometry = this.params.geometry;
    this.panels.params = this.params;
    this.panels.syncAll();
    this.panels.filmPicker?.select(this.params.film.id);
    this._persisted = JSON.stringify(guardados);
    this._pushHistory();
    this._render();
  }

  /**
   * Abre un elemento de la carpeta local.
   * @param {object} item registro de la biblioteca
   */
  async open(item) {
    if (item.kind === 'video') return this._openVideo(item);

    // La foto que se deja se guarda tal como quedó, miniatura incluida, antes
    // de que el lienzo pase a la siguiente.
    this._persistParams.flush();
    this._thumb.flush();
    this._exitZoom();
    this._soltarCompleta();

    this.app.setBusy(true, item.raw ? 'Revelando el RAW…' : 'Abriendo…');
    try {
      // Del almacén: si se le pegaron ajustes en la biblioteca, son esos.
      item = (await library.get(item.id)) || item;
      const file = await library.getFile(item.id);
      if (!file) throw new Error('El archivo ya no está en la carpeta local');
      if (!item.raw && isRawFile(file)) this.app.setBusy(true, 'Revelando el RAW…');

      const { bitmap, sourceWidth, sourceHeight, scaled } = await decodeScaled(file, PROXY_SIZE);
      // De un RAW recién importado sólo se sabía el tamaño de su vista previa:
      // al revelarlo se sabe el del sensor, y se apunta.
      if (item.dimsAprox || item.width !== sourceWidth || item.height !== sourceHeight) {
        library.update(item.id, { width: sourceWidth, height: sourceHeight, dimsAprox: false }, { silencioso: true }).catch(() => {});
        item = { ...item, width: sourceWidth, height: sourceHeight, dimsAprox: false };
      }
      this.proxy?.close?.();
      this.proxy = bitmap;
      this.item = item;
      this.sourceWidth = sourceWidth;
      this.sourceHeight = sourceHeight;

      // Ajustes previos del elemento, si los tenía; si no, se parte de cero.
      this.params = item.params ? this._mergeParams(item.params) : defaultParams();
      this._persisted = JSON.stringify(mergeParams(item.params));
      this.crop.geometry = this.params.geometry;
      this.crop.sourceAspect = sourceWidth / sourceHeight;
      this.panels.params = this.params;
      this.panels.syncAll();
      this.panels.filmPicker?.setSource(bitmap);

      this.history = [];
      this.historyAt = -1;
      this._pushHistory();

      // Un RAW se dice como tal, con la cámara: es lo que explica por qué abre
      // más plano que el JPEG de la cámara y por qué aguanta más ajuste.
      const esRaw = !!bitmap.linear;
      this.title.textContent = esRaw ? 'RAW' : item.kind === 'photo' ? 'Foto' : 'Vídeo';
      this.subtitle.textContent = (esRaw && bitmap.info?.camara ? bitmap.info.camara + ' · ' : '')
        + `${sourceWidth}×${sourceHeight} · ${formatBytes(item.size)}`
        + (scaled ? ` · proxy ${bitmap.width}×${bitmap.height}` : '');

      this._ensureRenderer();
      this._fuente = null;
      this._usarFuente(bitmap);
      this.root.classList.add('has-image');
      this._layout();
      this._render();
      this._computeHistogram();
      this.strip.setCurrent(item.id);
    } catch (err) {
      console.error(err);
      toast('No se pudo abrir: ' + (err?.message || err), { error: true });
    } finally {
      this.app.setBusy(false);
    }
  }

  /** Enseña o esconde la tira de fotos. */
  async toggleStrip(force, recordar = true) {
    const on = force ?? !this.strip.visible;
    this.root.classList.toggle('has-strip', on);
    this.stripBtn.classList.toggle('is-active', on);
    this.stripBtn.setAttribute('aria-pressed', String(on));
    if (recordar) { try { localStorage.setItem(TIRA_KEY, on ? '1' : '0'); } catch { /* sin almacenamiento */ } }
    if (this.item) this.strip.current = this.item.id;
    await this.strip.show(on);
  }

  /** La foto anterior o siguiente de la biblioteca (← →). */
  async openNeighbor(delta) {
    if (!this.item) return;
    // Con la tira escondida su lista puede estar vieja: se vuelve a leer.
    if (!this.strip.visible) this.strip.items = (await library.list()).filter((i) => i.kind === 'photo');
    this.strip.current = this.item.id;
    const next = this.strip.neighbor(delta);
    if (next) await this.open(next);
  }

  /**
   * Combina unos ajustes guardados con el modelo actual.
   *
   * Los presets y los archivos de sesiones anteriores pueden venir de una
   * versión con menos campos, así que se parte siempre de los valores por
   * defecto y encima se aplica lo guardado. La copia es profunda: si no lo
   * fuera, editar una curva mutaría el preset del que salió.
   */
  _mergeParams(saved) { return mergeParams(saved); }

  async _openVideo(item) {
    this.app.go('lab');
    const sheet = this.app.sheet('Revelar vídeo', [
      el('p', { class: 'sheet__message' },
        'El vídeo se procesa en tiempo real: se reproduce entero aplicando la emulsión y se graba el resultado. ',
        'Dura lo mismo que el clip. Mantén la pantalla encendida.'),
      el('div', { class: 'sheet__actions' },
        el('button', { type: 'button', class: 'btn', text: 'Cancelar', onclick: () => sheet.close() }),
        el('button', {
          type: 'button', class: 'btn btn--primary', text: 'Revelar y guardar',
          onclick: () => { sheet.close(); this._developVideo(item); },
        })),
    ]);
  }

  _ensureRenderer() {
    if (this.renderer) return;
    try {
      this.renderer = new Renderer(this.canvas, {
        onRestored: () => {
          // La fuente sigue en memoria, así que basta con volver a subirla.
          const fuente = this._fuente || this.proxy;
          if (!fuente) return;
          this.renderer.setSource(fuente, fuente.width, fuente.height);
          this._render();
        },
      });
    } catch (err) {
      toast('Este navegador no admite WebGL2', { error: true });
      throw err;
    }
  }

  /* ─────────────────────────────── Render ────────────────────────────── */

  _changed(committed) {
    this._requestRender();
    if (committed) {
      this._pushHistoryDebounced();
      this._persistParams();
      this._thumb();
    }
    this._updateHistogram();
  }

  _render() {
    if (!this.renderer || !this.proxy) return;
    try {
      // Con el recorte abierto se dibuja el fotograma entero: el rectángulo se
      // arrastra sobre la imagen completa, no sobre lo que ya estaba recortado.
      let params = this.params;
      if (this.crop.active) {
        params = { ...this.params, geometry: { ...this.params.geometry, crop: { x: 0, y: 0, w: 1, h: 1 } } };
      }
      this.renderer.render(params, {
        bypass: this.comparing,
        seed: 1,
        histogram: this._wantsHistogram(),
      });
    } catch (err) {
      console.error(err);
    }
    // Recolocar sólo cuando cambia el tamaño del lienzo: medir el DOM en cada
    // fotograma haría que arrastrar un deslizador fuera a tirones.
    const size = this.canvas.width + 'x' + this.canvas.height;
    if (size !== this._lastCanvasSize) {
      this._lastCanvasSize = size;
      this._layout();
    }
  }

  /** El histograma cuesta un pase extra: sólo se calcula si se va a mirar. */
  _wantsHistogram() {
    return this.histogram.root.classList.contains('is-visible') || this.panels.active === 'curves';
  }

  /** Encaja el lienzo dentro del área disponible y coloca el recorte encima. */
  _layout() {
    // Los paneles se construyen antes de que exista `root`, y al montarse ya
    // avisan del panel activo: hasta que el armazón esté en pie, no hay nada
    // que colocar.
    if (!this.root) return;
    const frame = this.root.querySelector('.lab__frame');
    if (!frame || !this.canvas.width) return;
    const box = frame.getBoundingClientRect();
    if (!box.width || !box.height) return;
    if (this.zoom) { this._placeZoom(); return; }

    const aspect = this.canvas.width / this.canvas.height;
    const k = Math.min(box.width / aspect, box.height);
    const w = k * aspect;
    const h = k;
    Object.assign(this.canvas.style, {
      width: w + 'px', height: h + 'px',
      left: (box.width - w) / 2 + 'px', top: (box.height - h) / 2 + 'px',
    });
    if (this.crop.active) {
      this.crop.setFrame({ left: (box.width - w) / 2, top: (box.height - h) / 2, width: w, height: h });
    }
  }

  _computeHistogram() {
    if (!this.renderer || !this.proxy || !this._wantsHistogram()) return;
    try {
      const h = this.renderer.histogram(64);
      if (h) {
        this.histogram.update(h);
        this.panels.setHistogram(h);
      }
    } catch { /* la lectura puede fallar si se pierde el contexto */ }
  }

  /* ──────────────────────────── Interacciones ────────────────────────── */

  _pickFilm(id) {
    const keep = {
      exposure: this.params.light.exposure,
      geometry: this.params.geometry,
      curves: this.params.curves,
      hsl: this.params.hsl,
      detail: this.params.detail,
    };
    applyFilmLook(this.params, getFilm(id));
    this.params.light.exposure = keep.exposure;
    this.params.geometry = keep.geometry;
    this.params.curves = keep.curves;
    this.params.hsl = keep.hsl;
    this.params.detail = keep.detail;
    this._changed(true);
  }

  _geometryChanged(what, value) {
    const quarter = ((((this.params.geometry.rotate || 0) / 90) % 4) + 4) % 4;
    const rw = quarter % 2 === 0 ? (this.sourceWidth || 1) : (this.sourceHeight || 1);
    const rh = quarter % 2 === 0 ? (this.sourceHeight || 1) : (this.sourceWidth || 1);
    this.crop.sourceAspect = rw / rh;
    if (what === 'aspect') this.crop.applyAspect(value, rw / rh);
    else if (what === 'reset') this.crop.reset();
    this._changed(true);
  }

  /* ───────────────────────────── Historial ───────────────────────────── */

  _pushHistory() {
    const snap = JSON.stringify(this.params);
    if (this.history[this.historyAt] === snap) return;
    this.history = this.history.slice(0, this.historyAt + 1);
    this.history.push(snap);
    if (this.history.length > HISTORY_MAX) this.history.shift();
    this.historyAt = this.history.length - 1;
    this._refreshHistoryButtons();
  }

  _restore(index) {
    if (index < 0 || index >= this.history.length) return;
    this.historyAt = index;
    const restored = JSON.parse(this.history[index]);
    // Se conserva la identidad del objeto: los paneles guardan referencias vivas.
    for (const k of Object.keys(restored)) this.params[k] = restored[k];
    this.crop.geometry = this.params.geometry;
    this.panels.params = this.params;
    this.panels.syncAll();
    this._refreshHistoryButtons();
    this._render();
    this._persistParams();
    this._thumb();
  }

  undo() { this._restore(this.historyAt - 1); }
  redo() { this._restore(this.historyAt + 1); }

  _refreshHistoryButtons() {
    this.undoBtn.disabled = this.historyAt <= 0;
    this.redoBtn.disabled = this.historyAt >= this.history.length - 1;
  }

  /** Los ajustes viven con el archivo: al reabrirlo sigue como se dejó. */
  _persistNow() {
    if (!this.item) return;
    const params = cloneParams(this.params);
    this._persisted = JSON.stringify(mergeParams(params));
    library.update(this.item.id, { params }).catch(() => {});
  }

  /**
   * La miniatura de la biblioteca sale del propio lienzo, que ya tiene la foto
   * revelada con los ajustes: descodificar otra vez el original para eso sería
   * trabajo repetido. Si en ese momento se mira el antes o el recorte está
   * abierto, se dibuja un instante el resultado final y se vuelve a lo de antes.
   */
  _snapshotThumb() {
    if (!this.item || !this.proxy || !this.renderer || this.renderer.lost) return;
    const id = this.item.id;
    try {
      this.renderer.render(this.params, { seed: 1, histogram: this._wantsHistogram() });
      // makeThumb copia el lienzo antes de su primera espera, así que ya se
      // puede volver a dibujar lo que se estaba viendo.
      const thumb = makeThumb(this.canvas);
      if (this.comparing || this.crop.active) this._render();
      // Si la foto se borró de la biblioteca mientras seguía abierta aquí, su
      // miniatura no tiene a quién pertenecer.
      thumb.then(async (blob) => { if (blob && await library.get(id)) await library.putThumb(id, blob); })
        .catch(() => {});
    } catch (err) {
      console.error(err);
    }
  }

  /* ─────────────────────────── Copiar y pegar ────────────────────────── */

  /** Copia el color de esta foto (no el encuadre) para pegarlo en otras. */
  copyAdjustments() {
    if (!this.proxy) return toast('Abre una foto primero');
    copySettings(this.params);
    haptic();
    const look = describeEdits(colorPart(this.params));
    toast(look ? `Ajustes copiados · ${look}` : 'Ajustes copiados · sin color: el original');
  }

  pasteAdjustments() {
    if (!this.proxy) return toast('Abre una foto primero');
    const copiado = copiedSettings();
    if (!copiado) return toast('Todavía no has copiado ningún ajuste');
    // Igual que un preset: se queda el encuadre de esta foto y se puede deshacer.
    this._applyPreset({ params: copiado.params }, 'Ajustes pegados');
  }

  /**
   * Teclado del Mac: ⌘Z, ⇧⌘Z, ⌘C y ⌘V como en cualquier editor; Z amplía o
   * encaja (como en Lightroom), Esc sale de la lupa, y ← → pasan de foto.
   */
  _onKey(e) {
    if (this.app.current !== 'lab' || !this.proxy) return;
    if (document.querySelector('.sheet-backdrop')) return;
    if (!e.metaKey && !e.ctrlKey && !e.altKey) {
      // Las flechas también mueven un deslizador con el foco: ahí son suyas.
      if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
      const tecla = e.key.toLowerCase();
      if (tecla === 'z' && !e.shiftKey) { e.preventDefault(); this.toggleZoom(); }
      else if (tecla === 'escape' && this.zoom) { e.preventDefault(); this._exitZoom(); }
      else if (tecla === 'arrowright' || tecla === 'arrowleft') {
        e.preventDefault();
        this.openNeighbor(tecla === 'arrowright' ? 1 : -1);
      }
      return;
    }
    if (e.altKey) return;
    if (isTyping(e.target)) return;
    if (String(globalThis.getSelection?.() || '')) return;
    const k = e.key.toLowerCase();
    if (k === 'z') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); }
    else if (k === 'y') { e.preventDefault(); this.redo(); }
    else if (k === 'c') { e.preventDefault(); this.copyAdjustments(); }
    else if (k === 'v') { e.preventDefault(); this.pasteAdjustments(); }
  }

  /* ───────────────────────────── Presets ─────────────────────────────── */

  _loadPresets() {
    try { return JSON.parse(localStorage.getItem(PRESET_KEY) || '[]'); } catch { return []; }
  }

  _savePresets(list) {
    try { localStorage.setItem(PRESET_KEY, JSON.stringify(list)); } catch { toast('No se pudo guardar el preset', { error: true }); }
  }

  _openPresets() {
    const list = this._loadPresets();
    const rows = list.length
      ? list.map((p, i) => el('div', { class: 'presetrow' },
        el('button', {
          type: 'button', class: 'presetrow__apply', text: p.name,
          onclick: () => { sheet.close(); this._applyPreset(p); },
        }),
        el('button', {
          type: 'button', class: 'presetrow__del', 'aria-label': 'Eliminar', text: '✕',
          onclick: async (e) => {
            e.stopPropagation();
            const next = this._loadPresets().filter((_, j) => j !== i);
            this._savePresets(next);
            sheet.close();
            this._openPresets();
          },
        })))
      : [el('p', { class: 'sheet__message', text: 'Todavía no has guardado ningún preset.' })];

    const nameInput = el('input', { type: 'text', class: 'field', placeholder: 'Nombre del preset', maxlength: 40 });
    const copiado = copiedSettings();
    const sheet = this.app.sheet('Presets', [
      el('h4', { class: 'sheet__subtitle', text: 'Copiar y pegar' }),
      el('div', { class: 'sheet__actions sheet__actions--pair' },
        el('button', {
          type: 'button', class: 'btn', text: 'Copiar ajustes',
          onclick: () => { sheet.close(); this.copyAdjustments(); },
        }),
        el('button', {
          type: 'button', class: 'btn', text: 'Pegar ajustes', disabled: !copiado,
          onclick: () => { sheet.close(); this.pasteAdjustments(); },
        })),
      el('p', {
        class: 'sheet__hint',
        text: (copiado ? `Copiado: ${describeEdits(copiado.params) || 'sin ajustes de color'}. ` : 'Copia el color de esta foto para llevarlo a otras. ')
          + 'Para pegarlo en muchas a la vez: Biblioteca → Seleccionar.',
      }),
      el('h4', { class: 'sheet__subtitle', text: 'Presets' }),
      el('div', { class: 'presetlist' }, rows),
      el('div', { class: 'sheet__row' },
        nameInput,
        el('button', {
          type: 'button', class: 'btn btn--primary', text: 'Guardar actual',
          onclick: () => {
            const name = nameInput.value.trim() || ('Preset ' + (list.length + 1));
            this._savePresets([...list, { name, params: cloneParams(this.params) }]);
            sheet.close();
            toast('Preset «' + name + '» guardado');
          },
        })),
    ]);
  }

  _applyPreset(preset, aviso = 'Preset aplicado') {
    const geometry = this.params.geometry;      // el encuadre es de la foto, no del look
    const merged = this._mergeParams(preset.params);
    merged.geometry = geometry;
    for (const k of Object.keys(merged)) this.params[k] = merged[k];
    this.panels.params = this.params;
    this.panels.syncAll();
    this.panels.filmPicker?.select(this.params.film.id);
    this._changed(true);
    toast(aviso);
  }

  /* ───────────────────────────── Exportación ─────────────────────────── */

  _openExport() {
    if (!this.item || !this.proxy) return toast('Abre una foto primero');

    const out = { ...this.exportOpts };
    const sizeRow = el('div', { class: 'chiprow' });
    const fmtRow = el('div', { class: 'chiprow' });
    const info = el('p', { class: 'sheet__hint' });

    const refresh = () => {
      const fmt = EXPORT_FORMATS.find((f) => f.key === out.format);
      qualityWrap.hidden = !fmt.quality;
      const { width, height } = this._exportDimensions(out.size);
      info.textContent = `${width}×${height} px · ${fmt.label}`
        + (fmt.quality ? ` · calidad ${Math.round(out.quality * 100)}%` : '')
        + (out.size === 'full' && this.sourceWidth ? ' · resolución original' : '');
      for (const b of sizeRow.children) b.classList.toggle('is-active', b.dataset.value === out.size);
      for (const b of fmtRow.children) b.classList.toggle('is-active', b.dataset.value === out.format);
    };

    for (const s of EXPORT_SIZES) {
      const { width, height } = this._exportDimensions(s.key);
      if (s.key !== 'full' && Math.max(width, height) >= Math.max(this.sourceWidth, this.sourceHeight)) continue;
      sizeRow.append(el('button', {
        type: 'button', class: 'chip', dataset: { value: s.key }, text: s.label,
        onclick: () => { out.size = s.key; refresh(); },
      }));
    }
    for (const f of EXPORT_FORMATS) {
      fmtRow.append(el('button', {
        type: 'button', class: 'chip', dataset: { value: f.key }, text: f.label,
        onclick: () => { out.format = f.key; refresh(); },
      }));
    }

    const quality = el('input', { type: 'range', min: 0.5, max: 1, step: 0.01, value: out.quality, class: 'slider__input' });
    quality.addEventListener('input', () => { out.quality = parseFloat(quality.value); refresh(); });
    const qualityWrap = el('div', { class: 'sheet__field' }, el('label', { text: 'Calidad' }), quality);

    const sheet = this.app.sheet('Exportar', [
      el('h4', { class: 'sheet__subtitle', text: 'Tamaño' }), sizeRow,
      el('h4', { class: 'sheet__subtitle', text: 'Formato' }), fmtRow,
      qualityWrap,
      info,
      el('div', { class: 'sheet__actions sheet__actions--stack' },
        el('button', {
          type: 'button', class: 'btn btn--primary', text: 'Guardar en el dispositivo',
          onclick: () => { this.exportOpts = out; sheet.close(); this._export(out, 'share'); },
        }),
        el('button', {
          type: 'button', class: 'btn', text: 'Guardar en la biblioteca',
          onclick: () => { this.exportOpts = out; sheet.close(); this._export(out, 'library'); },
        })),
    ]);
    refresh();
  }

  _exportDimensions(sizeKey) {
    const def = EXPORT_SIZES.find((s) => s.key === sizeKey) || EXPORT_SIZES[0];
    const crop = this.params.geometry.crop || { w: 1, h: 1 };
    // El recorte se mide sobre el marco ya girado, igual que en el renderer.
    const quarter = ((((this.params.geometry.rotate || 0) / 90) % 4) + 4) % 4;
    const srcW = this.sourceWidth || this.canvas.width;
    const srcH = this.sourceHeight || this.canvas.height;
    const rw = quarter % 2 === 0 ? srcW : srcH;
    const rh = quarter % 2 === 0 ? srcH : srcW;
    const w = Math.round(rw * crop.w);
    const h = Math.round(rh * crop.h);
    const k = Math.min(1, def.max / Math.max(w, h));
    return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
  }

  async _export(out, destination) {
    this.app.setBusy(true, 'Revelando a resolución completa…');
    let bitmap = null;
    try {
      const def = EXPORT_SIZES.find((s) => s.key === out.size);
      const file = await library.getFile(this.item.id);
      if (!file) throw new Error('El archivo original ya no está en la carpeta local');

      // El original se descodifica al tamaño necesario y nada más: si se pide
      // 2K no se llega a construir nunca la imagen de 12 Mpx en memoria.
      const crop = this.params.geometry.crop || { w: 1, h: 1 };
      const decodeMax = def.max === Infinity
        ? Infinity
        : Math.ceil(def.max / Math.max(crop.w, crop.h));
      const decoded = await decodeScaled(file, decodeMax === Infinity ? 1e9 : decodeMax);
      bitmap = decoded.bitmap;

      const { blob, width, height, scaled } = await renderToBlob(bitmap, this.params, {
        type: out.format,
        quality: out.quality,
        seed: 1,
      });

      const film = getFilm(this.params.film.id);
      const ext = EXPORT_FORMATS.find((f) => f.key === out.format).ext;
      const filename = timestampName('lab', ext, film.name);

      if (destination === 'library') {
        const item = await library.put(blob, {
          kind: 'photo', width, height, filmId: film.id, filmName: film.name,
          params: null, appliedParams: cloneParams(this.params), origin: 'laboratorio',
        });
        const thumbSrc = await createImageBitmap(blob, { resizeWidth: 480, resizeQuality: 'medium' }).catch(() => null);
        if (thumbSrc) { await library.putThumb(item.id, await makeThumb(thumbSrc)); thumbSrc.close?.(); }
        toast(`Guardado en la biblioteca · ${width}×${height} · ${formatBytes(blob.size)}`);
        this.app.notifyCapture(item);
      } else {
        // No se comparte aquí: el revelado que acaba de terminar ha consumido
        // el tiempo de activación del toque. La hoja siguiente vuelve a pedir
        // un toque, y desde ahí sí se puede abrir la del sistema.
        this.app.presentSave([blob], [filename], {
          title: 'Exportar de Laboratorio',
          detail: `${width}×${height}`
            + (scaled ? ' · reducido al máximo que admite el dispositivo' : ''),
        });
      }
    } catch (err) {
      console.error(err);
      toast('No se pudo exportar: ' + (err?.message || err), { error: true });
    } finally {
      bitmap?.close?.();
      this.app.setBusy(false);
    }
  }

  /* ────────────────────── Revelado de vídeo (tiempo real) ────────────── */

  async _developVideo(item) {
    const file = await library.getFile(item.id);
    if (!file) return toast('El vídeo ya no está en la carpeta local', { error: true });

    const url = URL.createObjectURL(file);
    const video = el('video', { playsinline: '', muted: '' });
    video.muted = true;
    video.src = url;

    const canvas = document.createElement('canvas');
    let renderer = null;
    let recorder = null;

    const cleanup = () => {
      try { renderer?.dispose(); } catch { /* ya liberado */ }
      canvas.width = canvas.height = 0;
      video.src = '';
      URL.revokeObjectURL(url);
      this.app.setBusy(false);
    };

    try {
      await new Promise((res, rej) => {
        video.onloadedmetadata = res;
        video.onerror = () => rej(new Error('No se pudo leer el vídeo'));
        setTimeout(() => rej(new Error('Tiempo agotado al abrir el vídeo')), 10_000);
      });

      const w = video.videoWidth, h = video.videoHeight;
      canvas.width = w;
      canvas.height = h;
      renderer = new Renderer(canvas);

      const params = cloneParams(this.params);
      params.geometry = { rotate: 0, straighten: 0, flipH: false, flipV: false, aspect: 'free' };

      const mime = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
        .find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } });
      if (!mime) throw new Error('Este navegador no permite grabar vídeo');

      const stream = canvas.captureStream(30);
      const chunks = [];
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 14_000_000 });
      recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };

      const done = new Promise((res) => { recorder.onstop = res; });
      recorder.start(1000);

      const total = video.duration || 1;
      this.app.setBusy(true, 'Revelando vídeo… 0%');
      let frame = 0;
      const step = () => {
        if (video.ended || video.paused) return;
        renderer.setSource(video, w, h);
        renderer.render(params, { seed: (frame++ / 3) | 0 });
        this.app.setBusy(true, `Revelando vídeo… ${Math.min(99, Math.round((video.currentTime / total) * 100))}%`);
        if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(step);
        else requestAnimationFrame(step);
      };

      await video.play();
      step();
      await new Promise((res) => { video.onended = res; });
      recorder.stop();
      await done;

      const blob = new Blob(chunks, { type: mime.split(';')[0] });
      const film = getFilm(params.film.id);
      const saved = await library.put(blob, {
        kind: 'video', width: w, height: h, durationMs: total * 1000,
        filmId: film.id, filmName: film.name,
        params: null, appliedParams: params, origin: 'laboratorio',
      });
      await library.putThumb(saved.id, await makeThumb(canvas));
      toast(`Vídeo revelado · ${w}×${h} · ${formatBytes(blob.size)}`);
      this.app.notifyCapture(saved);
    } catch (err) {
      console.error(err);
      toast('No se pudo revelar el vídeo: ' + (err?.message || err), { error: true });
    } finally {
      cleanup();
    }
  }

  /* ───────────────────────────── Encuadre ────────────────────────────── */

  setCropActive(on) {
    if (on) this._exitZoom();
    this.crop.setActive(on && !!this.proxy);
    this._layout();
  }
}
