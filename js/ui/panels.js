/**
 * panels.js — Construye el panel de ajustes del laboratorio a partir de la
 * tabla de params.js. Los paneles con interfaz propia (emulsión, HSL, curvas,
 * etalonaje, encuadre) se enchufan aquí por nombre.
 */

import { el, clear, haptic } from '../utils/dom.js';
import {
  PANELS, HSL_BANDS, ASPECTS, getPath, setPath, panelIsModified,
} from '../data/params.js';
import { makeSlider, makeSegmented, makeSwitch } from './controls.js';
import { CurveEditor } from './curve.js';

/** Dónde se guarda el reparto de pantalla que elige el usuario. */
const PANEL_HEIGHT_KEY = 'filtros.panelHeight.v1';
import { ColorWheel } from './wheel.js';
import { FilmPicker } from './filmpicker.js';

export class PanelStack {
  /**
   * @param {object} params
   * @param {(committed:boolean)=>void} onChange
   * @param {object} hooks  { onPickFilm, onGeometry }
   */
  constructor(params, onChange, hooks = {}) {
    this.params = params;
    this.onChange = onChange;
    this.hooks = hooks;
    this.active = 'film';
    this.sliders = new Map();
    this.bodies = new Map();

    this.collapsed = false;
    this.tabs = el('div', { class: 'panelbar', role: 'tablist', 'aria-label': 'Ajustes' });
    this.body = el('div', { class: 'panelbody' });
    this.grab = el('button', {
      type: 'button', class: 'panels__grab',
      'aria-label': 'Plegar los ajustes, o arrastrar para cambiar su altura',
    }, el('span', { class: 'panels__grabline' }));
    this.root = el('div', { class: 'panels' }, this.grab, this.body, this.tabs);

    this._buildTabs();
    this._bindGrab();
    this._restoreHeight();
    this.show('film');
  }

  _buildTabs() {
    for (const panel of PANELS) {
      const btn = el('button', {
        type: 'button',
        class: 'panelbar__tab',
        role: 'tab',
        dataset: { panel: panel.id },
        // Tocar la pestaña ya activa pliega el panel: así se llega a la imagen
        // completa sin buscar otro control.
        onclick: () => {
          haptic();
          if (this.collapsed) { this.hooks.onToggleCollapse?.(); this.show(panel.id); }
          else if (this.active === panel.id) this.hooks.onToggleCollapse?.();
          else this.show(panel.id);
        },
      },
        el('span', { class: 'panelbar__icon', dataset: { icon: panel.icon } }),
        el('span', { class: 'panelbar__label', text: panel.label }),
        el('span', { class: 'panelbar__dot' }));
      this.tabs.append(btn);
    }
  }

  /**
   * Tirador: toque para plegar, arrastre para repartir la pantalla.
   *
   * El reparto entre imagen y ajustes no lo puede acertar un número fijo —
   * depende de la foto, del panel abierto y de lo que se esté mirando. Se deja
   * en manos de quien edita, con el gesto que ya espera de una hoja de iOS.
   */
  _bindGrab() {
    const MIN = 96;
    let startY = 0, startH = 0, dragging = false, moved = false;

    const maxAllowed = () => Math.round(window.innerHeight * 0.62);

    this.grab.addEventListener('pointerdown', (ev) => {
      dragging = true;
      moved = false;
      startY = ev.clientY;
      startH = this.body.getBoundingClientRect().height;
      this.grab.setPointerCapture(ev.pointerId);
      this.root.classList.add('is-dragging');
    });

    this.grab.addEventListener('pointermove', (ev) => {
      if (!dragging) return;
      const dy = startY - ev.clientY;
      if (Math.abs(dy) > 4) moved = true;
      if (!moved) return;
      ev.preventDefault();
      if (this.collapsed && dy > 0) this.hooks.onToggleCollapse?.();
      const h = Math.min(maxAllowed(), Math.max(0, startH + dy));
      if (h < MIN / 2) {
        if (!this.collapsed) this.hooks.onToggleCollapse?.();
      } else {
        if (this.collapsed) this.hooks.onToggleCollapse?.();
        this.setHeight(Math.max(MIN, h));
      }
    });

    const end = () => {
      if (!dragging) return;
      dragging = false;
      this.root.classList.remove('is-dragging');
      // Sin arrastre, el gesto es un toque: plegar o desplegar.
      if (!moved) { haptic(); this.hooks.onToggleCollapse?.(); }
    };
    this.grab.addEventListener('pointerup', end);
    this.grab.addEventListener('pointercancel', end);
  }

  /** Fija la altura máxima del cuerpo; los paneles cortos siguen siendo cortos. */
  setHeight(px, remember = true) {
    this.height = px;
    this.root.style.setProperty('--panel-h', Math.round(px) + 'px');
    if (remember) {
      try { localStorage.setItem(PANEL_HEIGHT_KEY, String(Math.round(px))); } catch { /* sin persistencia */ }
    }
  }

  /** Recupera el reparto que el usuario dejó la última vez. */
  _restoreHeight() {
    try {
      const saved = parseInt(localStorage.getItem(PANEL_HEIGHT_KEY) || '', 10);
      if (Number.isFinite(saved) && saved >= 96) {
        this.setHeight(Math.min(saved, Math.round(window.innerHeight * 0.62)), false);
      }
    } catch { /* sin persistencia */ }
  }

  /** Oculta el cuerpo dejando sólo la fila de pestañas. */
  setCollapsed(on) {
    this.collapsed = on;
    this.root.classList.toggle('is-collapsed', on);
    this.body.hidden = on;
    this.grab.setAttribute('aria-expanded', String(!on));
  }

  show(id) {
    this.active = id;
    for (const t of this.tabs.children) {
      const on = t.dataset.panel === id;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    }
    const panel = PANELS.find((p) => p.id === id);
    clear(this.body);
    this.body.append(this._buildPanel(panel));
    this.tabs.querySelector('.is-active')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    this.refreshBadges();
    this.hooks.onPanel?.(id);
  }

  _buildPanel(panel) {
    const wrap = el('div', { class: 'panel', dataset: { panel: panel.id } });

    if (panel.custom === 'filmPicker') wrap.append(this._filmPanel());
    if (panel.custom === 'hslPanel') wrap.append(this._hslPanel());
    if (panel.custom === 'curvePanel') wrap.append(this._curvePanel());
    if (panel.custom === 'gradePanel') wrap.append(this._gradePanel());
    if (panel.custom === 'geometryPanel') wrap.append(this._geometryPanel());

    for (const ctrl of panel.controls) {
      const slider = makeSlider(ctrl, getPath(this.params, ctrl.path), (v, committed) => {
        setPath(this.params, ctrl.path, v);
        this.onChange(committed);
        this.refreshBadges();
      });
      this.sliders.set(ctrl.path, slider);
      wrap.append(slider);
    }

    if (panel.custom === 'monoToggle') wrap.append(this._monoPanel());

    wrap.append(el('div', { class: 'panel__foot' },
      el('button', {
        type: 'button', class: 'linkbtn', text: 'Restablecer ' + panel.label.toLowerCase(),
        onclick: () => this.resetPanel(panel),
      })));

    return wrap;
  }

  /* ───────────────────────────── Emulsión ───────────────────────────── */

  _filmPanel() {
    this.filmPicker = new FilmPicker((id) => {
      this.hooks.onPickFilm?.(id);
      this._updateFilmNote(id);
      this.syncAll();
    });
    this.filmPicker.select(this.params.film.id);
    this.filmNote = el('p', { class: 'filmnote' });
    this._updateFilmNote(this.params.film.id);
    // La ficha va arriba: es lo que explica qué estás mirando, y enterrada bajo
    // seis filas de tarjetas no la lee nadie.
    return el('div', {}, this.filmNote, this.filmPicker.root);
  }

  _updateFilmNote(id) {
    if (!this.filmNote) return;
    const d = this.filmPicker.describe(id);
    clear(this.filmNote).append(
      el('strong', { text: d.brand + ' ' + d.name }),
      el('span', { class: 'filmnote__kind', text: d.kind + (d.iso ? ' · ISO ' + d.iso : '') }),
      el('span', { class: 'filmnote__text', text: d.note }));
  }

  /* ──────────────────────────────── HSL ─────────────────────────────── */

  _hslPanel() {
    let band = 0;
    const wrap = el('div', { class: 'hsl' });
    const swatches = el('div', { class: 'hsl__bands' });
    const sliders = el('div', { class: 'hsl__sliders' });

    const rebuild = () => {
      clear(sliders);
      const defs = [
        { key: 'hue', label: 'Tono', min: -1, max: 1 },
        { key: 'sat', label: 'Saturación', min: -1, max: 1 },
        { key: 'lum', label: 'Luminancia', min: -1, max: 1 },
      ];
      for (const d of defs) {
        const ctrl = {
          path: `hsl.${d.key}.${band}`, label: d.label, min: d.min, max: d.max,
          def: 0, step: 0.01, center: 0, format: 'pct', unit: '',
        };
        sliders.append(makeSlider(ctrl, this.params.hsl[d.key][band], (v, committed) => {
          this.params.hsl[d.key][band] = v;
          this.onChange(committed);
          paintBands();
          this.refreshBadges();
        }));
      }
    };

    const paintBands = () => {
      for (const [i, node] of [...swatches.children].entries()) {
        const touched = ['hue', 'sat', 'lum'].some((k) => Math.abs(this.params.hsl[k][i]) > 1e-4);
        node.classList.toggle('is-modified', touched);
        node.classList.toggle('is-active', i === band);
      }
    };

    HSL_BANDS.forEach((b, i) => {
      swatches.append(el('button', {
        type: 'button',
        class: 'hsl__band',
        style: { '--hue': b.hue },
        title: b.label,
        'aria-label': b.label,
        onclick: () => { haptic(); band = i; rebuild(); paintBands(); },
      }));
    });

    rebuild();
    paintBands();
    wrap.append(swatches, sliders);
    return wrap;
  }

  /* ─────────────────────────────── Curvas ───────────────────────────── */

  _curvePanel() {
    this.curveEditor = new CurveEditor(this.params.curves, (committed) => {
      this.onChange(committed);
      this.refreshBadges();
    });
    if (this._lastHistogram) this.curveEditor.setHistogram(this._lastHistogram);
    return this.curveEditor.root;
  }

  setHistogram(hist) {
    this._lastHistogram = hist;
    this.curveEditor?.setHistogram(hist);
  }

  /* ────────────────────────────── Etalonaje ─────────────────────────── */

  _gradePanel() {
    const zones = [
      ['Sombras', this.params.grade.shadows],
      ['Medios', this.params.grade.mids],
      ['Altas luces', this.params.grade.highs],
    ];
    this.wheels = zones.map(([label, zone]) =>
      new ColorWheel(label, zone, (committed) => { this.onChange(committed); this.refreshBadges(); }));
    return el('div', { class: 'wheels' }, this.wheels.map((w) => w.root));
  }

  /* ─────────────────────────────── Mono ─────────────────────────────── */

  _monoPanel() {
    const wrap = el('div', { class: 'mono' });
    const toggle = makeSwitch('Blanco y negro', this.params.color.mono, (on) => {
      this.params.color.mono = on;
      mixWrap.hidden = !on;
      this.onChange(true);
      this.refreshBadges();
    });

    const mixWrap = el('div', { class: 'mono__mix', hidden: !this.params.color.mono });
    const names = ['Rojo', 'Verde', 'Azul'];
    names.forEach((n, i) => {
      const ctrl = {
        path: 'color.monoMix.' + i, label: 'Mezcla · ' + n, min: 0, max: 1,
        def: [0.299, 0.587, 0.114][i], step: 0.005, center: 0, format: 'pct', unit: '',
      };
      mixWrap.append(makeSlider(ctrl, this.params.color.monoMix[i], (v, committed) => {
        this.params.color.monoMix[i] = v;
        this.onChange(committed);
      }));
    });

    wrap.append(toggle, mixWrap);
    return wrap;
  }

  /* ────────────────────────────── Encuadre ──────────────────────────── */

  _geometryPanel() {
    const g = this.params.geometry;
    const aspects = makeSegmented(
      ASPECTS.map((a) => ({ value: a.key, label: a.label })),
      g.aspect,
      (v) => { g.aspect = v; this.hooks.onGeometry?.('aspect', v); this.refreshBadges(); },
      { label: 'Proporción' });

    const actions = el('div', { class: 'geo__actions' },
      el('button', { type: 'button', class: 'btn btn--ghost', onclick: () => this._rotate(-90) }, '⟲ 90°'),
      el('button', { type: 'button', class: 'btn btn--ghost', onclick: () => this._rotate(90) }, '⟳ 90°'),
      el('button', {
        type: 'button', class: 'btn btn--ghost' + (g.flipH ? ' is-active' : ''),
        onclick: (e) => { g.flipH = !g.flipH; e.currentTarget.classList.toggle('is-active', g.flipH); this._geo(); },
      }, '⇋ Espejo'),
      el('button', {
        type: 'button', class: 'btn btn--ghost' + (g.flipV ? ' is-active' : ''),
        onclick: (e) => { g.flipV = !g.flipV; e.currentTarget.classList.toggle('is-active', g.flipV); this._geo(); },
      }, '⇵ Voltear'));

    return el('div', { class: 'geo' },
      el('h4', { class: 'panel__subtitle', text: 'Proporción' }), aspects,
      el('h4', { class: 'panel__subtitle', text: 'Transformar' }), actions);
  }

  _rotate(delta) {
    const g = this.params.geometry;
    g.rotate = (((g.rotate + delta) % 360) + 360) % 360;
    this._geo();
  }

  _geo() {
    haptic();
    this.hooks.onGeometry?.('transform');
    this.onChange(true);
    this.refreshBadges();
  }

  /* ─────────────────────────── Sincronización ───────────────────────── */

  resetPanel(panel) {
    if (panel.id === 'film') {
      this.hooks.onPickFilm?.('neutral');
      this.filmPicker?.select('neutral');
      this._updateFilmNote('neutral');
    } else if (panel.id === 'hsl') {
      for (const k of ['hue', 'sat', 'lum']) this.params.hsl[k].fill(0);
    } else if (panel.id === 'curves') {
      for (const k of Object.keys(this.params.curves)) {
        this.params.curves[k] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
      }
    } else if (panel.id === 'grade') {
      for (const z of ['shadows', 'mids', 'highs']) Object.assign(this.params.grade[z], { h: 0, s: 0, l: 0 });
      this.params.grade.balance = 0;
    } else if (panel.id === 'geometry') {
      Object.assign(this.params.geometry, {
        rotate: 0, straighten: 0, flipH: false, flipV: false, aspect: 'free',
        crop: { x: 0, y: 0, w: 1, h: 1 },
      });
      this.hooks.onGeometry?.('reset');
    } else if (panel.id === 'color') {
      this.params.color.mono = false;
      this.params.color.monoMix = [0.299, 0.587, 0.114];
    }
    for (const ctrl of panel.controls) setPath(this.params, ctrl.path, ctrl.def);
    haptic(12);
    this.onChange(true);
    this.show(panel.id);
  }

  /** Vuelve a pintar el panel visible desde el estado (tras cargar un preset). */
  syncAll() {
    this.show(this.active);
  }

  refreshBadges() {
    for (const t of this.tabs.children) {
      const panel = PANELS.find((p) => p.id === t.dataset.panel);
      t.classList.toggle('is-modified', panelIsModified(panel, this.params));
    }
  }

  destroy() {
    this.curveEditor?.destroy();
    this.filmPicker?.destroy();
  }
}
