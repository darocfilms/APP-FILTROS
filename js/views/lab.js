/**
 * lab.js — Laboratorio de edición.
 *
 * Trabaja siempre sobre un proxy reducido: es lo que mantiene la respuesta
 * inmediata al mover un deslizador y lo que evita que Safari en iPhone se caiga
 * al abrir una foto de 12 Mpx. El original sólo se vuelve a leer de la carpeta
 * local en el momento de exportar, y se descarta en cuanto termina.
 */

import { el, toast, haptic, debounce, rafThrottle } from '../utils/dom.js';
import { Renderer, renderToBlob } from '../engine/renderer.js';
import { defaultParams, applyFilmLook, cloneParams } from '../data/params.js';
import { getFilm } from '../data/films.js';
import { library, decodeScaled, makeThumb, PROXY_SIZE, formatBytes } from '../store/library.js';
import { PanelStack } from '../ui/panels.js';
import { CropOverlay } from '../ui/crop.js';
import { Histogram } from '../ui/histogram.js';
import { saveFile, timestampName } from '../utils/share.js';

const PRESET_KEY = 'filtros.presets.v1';
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
    this.collapsed = false;
    this.exportOpts = { size: 'full', format: 'image/jpeg', quality: 0.95 };

    this.canvas = el('canvas', { class: 'lab__canvas' });
    this.histogram = new Histogram();
    this.crop = new CropOverlay(this.params.geometry, (committed) => this._changed(committed));

    this.root = this._build();
    this._requestRender = rafThrottle(() => this._render());
    this._pushHistoryDebounced = debounce(() => this._pushHistory(), 260);
    this._updateHistogram = debounce(() => this._computeHistogram(), 220);
  }

  /* ─────────────────────────────── Interfaz ──────────────────────────── */

  _build() {
    this.title = el('span', { class: 'lab__title', text: 'Laboratorio' });
    this.subtitle = el('span', { class: 'lab__subtitle' });

    this.undoBtn = this._iconBtn('↺', 'Deshacer', () => this.undo());
    this.redoBtn = this._iconBtn('↻', 'Rehacer', () => this.redo());
    this.histBtn = this._iconBtn('▟', 'Histograma', (e) => {
      const on = this.histogram.root.classList.toggle('is-visible');
      e.currentTarget.classList.toggle('is-active', on);
      this._render();
      if (on) this._computeHistogram();
    });

    this.stage = el('div', { class: 'lab__stage' },
      el('div', { class: 'lab__frame' }, this.canvas, this.crop.root, this.histogram.root),
      el('div', { class: 'lab__empty' },
        el('p', { text: 'Abre una foto de la biblioteca o importa una del dispositivo.' }),
        el('div', { class: 'lab__emptyactions' },
          el('button', { type: 'button', class: 'btn btn--primary', text: 'Importar archivo', onclick: () => this.app.pickFile() }),
          el('button', { type: 'button', class: 'btn', text: 'Ir a la biblioteca', onclick: () => this.app.go('library') }))));

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

    this._bindCompare();

    const root = el('section', { class: 'view view--lab', id: 'view-lab' },
      this.stage,
      el('header', { class: 'lab__bar' },
        el('div', { class: 'lab__id' }, this.title, this.subtitle),
        el('div', { class: 'lab__actions' },
          this.undoBtn, this.redoBtn, this.histBtn,
          this._iconBtn('⤓', 'Presets', () => this._openPresets()),
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

    // Y el lienzo se recoloca observando el HUECO, no los paneles: el hueco
    // cambia de tamaño con una transición, así que medirlo una sola vez al
    // soltar el panel daba un tamaño intermedio y la imagen se quedaba
    // encogida. Observándolo, cada paso de la animación recoloca.
    this._frameRO = new ResizeObserver(() => this._layout());
    this._frameRO.observe(this.stage.querySelector('.lab__frame'));
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

  /** Mantener pulsada la imagen muestra el original sin revelar. */
  _bindCompare() {
    const on = () => { if (this.proxy && !this.crop.active) { this.comparing = true; this._render(); } };
    const off = () => { if (this.comparing) { this.comparing = false; this._render(); } };
    this.canvas.addEventListener('pointerdown', on);
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) this.canvas.addEventListener(ev, off);
  }

  /* ──────────────────────────── Carga de imagen ──────────────────────── */

  async activate() {
    this._layout();
    if (this.proxy) this._requestRender();
  }

  deactivate() {
    this.comparing = false;
  }

  /**
   * Abre un elemento de la carpeta local.
   * @param {object} item registro de la biblioteca
   */
  async open(item) {
    if (item.kind === 'video') return this._openVideo(item);

    this.app.setBusy(true, 'Abriendo…');
    try {
      const file = await library.getFile(item.id);
      if (!file) throw new Error('El archivo ya no está en la carpeta local');

      const { bitmap, sourceWidth, sourceHeight, scaled } = await decodeScaled(file, PROXY_SIZE);
      this.proxy?.close?.();
      this.proxy = bitmap;
      this.item = item;
      this.sourceWidth = sourceWidth;
      this.sourceHeight = sourceHeight;

      // Ajustes previos del elemento, si los tenía; si no, se parte de cero.
      this.params = item.params ? this._mergeParams(item.params) : defaultParams();
      this.crop.geometry = this.params.geometry;
      this.crop.sourceAspect = sourceWidth / sourceHeight;
      this.panels.params = this.params;
      this.panels.syncAll();
      this.panels.filmPicker?.setSource(bitmap);

      this.history = [];
      this.historyAt = -1;
      this._pushHistory();

      this.title.textContent = item.kind === 'photo' ? 'Foto' : 'Vídeo';
      this.subtitle.textContent = `${sourceWidth}×${sourceHeight} · ${formatBytes(item.size)}`
        + (scaled ? ` · proxy ${bitmap.width}×${bitmap.height}` : '');

      this._ensureRenderer();
      this.renderer.setSource(bitmap, bitmap.width, bitmap.height);
      this.root.classList.add('has-image');
      this._layout();
      this._render();
      this._computeHistogram();
    } catch (err) {
      console.error(err);
      toast('No se pudo abrir: ' + (err?.message || err), { error: true });
    } finally {
      this.app.setBusy(false);
    }
  }

  /**
   * Combina unos ajustes guardados con el modelo actual.
   *
   * Los presets y los archivos de sesiones anteriores pueden venir de una
   * versión con menos campos, así que se parte siempre de los valores por
   * defecto y encima se aplica lo guardado. La copia es profunda: si no lo
   * fuera, editar una curva mutaría el preset del que salió.
   */
  _mergeParams(saved) {
    const merge = (dst, src) => {
      for (const [k, v] of Object.entries(src || {})) {
        if (Array.isArray(v)) {
          dst[k] = v.map((x) => (x && typeof x === 'object' ? { ...x } : x));
        } else if (v && typeof v === 'object') {
          dst[k] = merge(dst[k] && typeof dst[k] === 'object' ? dst[k] : {}, v);
        } else {
          dst[k] = v;
        }
      }
      return dst;
    };
    return merge(defaultParams(), saved);
  }

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
          // El proxy sigue en memoria, así que basta con volver a subirlo.
          if (!this.proxy) return;
          this.renderer.setSource(this.proxy, this.proxy.width, this.proxy.height);
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
  }

  undo() { this._restore(this.historyAt - 1); }
  redo() { this._restore(this.historyAt + 1); }

  _refreshHistoryButtons() {
    this.undoBtn.disabled = this.historyAt <= 0;
    this.redoBtn.disabled = this.historyAt >= this.history.length - 1;
  }

  /** Los ajustes viven con el archivo: al reabrirlo sigue como se dejó. */
  _persistParams = debounce(() => {
    if (this.item) library.update(this.item.id, { params: cloneParams(this.params) }).catch(() => {});
  }, 700);

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
    const sheet = this.app.sheet('Presets', [
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

  _applyPreset(preset) {
    const geometry = this.params.geometry;      // el encuadre es de la foto, no del look
    const merged = this._mergeParams(preset.params);
    merged.geometry = geometry;
    for (const k of Object.keys(merged)) this.params[k] = merged[k];
    this.panels.params = this.params;
    this.panels.syncAll();
    this.panels.filmPicker?.select(this.params.film.id);
    this._changed(true);
    toast('Preset aplicado');
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
        const result = await saveFile(blob, filename, { title: 'Exportar de Laboratorio' });
        if (result !== 'cancelled') {
          toast(`${width}×${height} · ${formatBytes(blob.size)}`
            + (scaled ? ' · reducido al máximo que admite el dispositivo' : ''));
        }
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
    this.crop.setActive(on && !!this.proxy);
    this._layout();
  }
}
