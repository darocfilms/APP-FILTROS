/**
 * crop.js — Superposición de recorte sobre la previsualización.
 *
 * El rectángulo se guarda en coordenadas normalizadas del original (0..1) y
 * con la Y medida desde arriba, así que no depende de la resolución: el mismo
 * recorte vale para el proxy de edición y para la exportación a tamaño
 * completo.
 */

import { el, haptic } from '../utils/dom.js';
import { ASPECTS } from '../data/params.js';

const MIN_SIZE = 0.06;
const HANDLES = ['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e'];

export class CropOverlay {
  /**
   * @param {object} geometry  referencia viva a params.geometry
   * @param {(committed:boolean)=>void} onChange
   */
  constructor(geometry, onChange) {
    this.geometry = geometry;
    this.onChange = onChange;
    this.active = false;
    this.frame = { w: 1, h: 1 };   // tamaño del área de imagen en píxeles CSS

    this.rect = el('div', { class: 'crop__rect' },
      HANDLES.map((h) => el('span', { class: 'crop__handle crop__handle--' + h, dataset: { handle: h } })),
      el('span', { class: 'crop__thirds' }));

    this.root = el('div', { class: 'crop', hidden: true }, this.rect);
    this._bind();
  }

  get crop() {
    if (!this.geometry.crop) this.geometry.crop = { x: 0, y: 0, w: 1, h: 1 };
    return this.geometry.crop;
  }

  setActive(on) {
    this.active = on;
    this.root.hidden = !on;
    if (on) this.layout();
  }

  /** @param {{left:number,top:number,width:number,height:number}} box área visible de la imagen */
  setFrame(box) {
    this.frame = box;
    Object.assign(this.root.style, {
      left: box.left + 'px', top: box.top + 'px',
      width: box.width + 'px', height: box.height + 'px',
    });
    this.layout();
  }

  layout() {
    const c = this.crop;
    Object.assign(this.rect.style, {
      left: c.x * 100 + '%',
      top: c.y * 100 + '%',
      width: c.w * 100 + '%',
      height: c.h * 100 + '%',
    });
  }

  /**
   * Reajusta el rectángulo a una proporción, centrándolo y ocupando lo máximo
   * posible dentro de lo que ya estaba recortado.
   * @param {string} key clave de ASPECTS
   * @param {number} sourceAspect ancho/alto del original
   */
  applyAspect(key, sourceAspect) {
    const def = ASPECTS.find((a) => a.key === key);
    if (!def || def.ratio === null) return;                 // libre: no toca nada
    const target = def.ratio === 0 ? sourceAspect : def.ratio;

    // La proporción se expresa en píxeles, así que hay que pasar por el
    // aspecto del original para trabajar en coordenadas normalizadas.
    const c = this.crop;
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    let w = 1, h = 1;
    // w/h en normalizado, con w_px/h_px = target → (w·W)/(h·H) = target
    if (target >= sourceAspect) {
      w = 1;
      h = Math.min(1, sourceAspect / target);
    } else {
      h = 1;
      w = Math.min(1, target / sourceAspect);
    }
    const x = Math.min(Math.max(cx - w / 2, 0), 1 - w);
    const y = Math.min(Math.max(cy - h / 2, 0), 1 - h);
    Object.assign(c, { x, y, w, h });
    this.layout();
    this.onChange(true);
  }

  reset() {
    Object.assign(this.crop, { x: 0, y: 0, w: 1, h: 1 });
    this.layout();
  }

  /** Proporción fija activa, en unidades normalizadas, o null si es libre. */
  _lockedRatio(sourceAspect) {
    const def = ASPECTS.find((a) => a.key === this.geometry.aspect);
    if (!def || def.ratio === null) return null;
    const target = def.ratio === 0 ? sourceAspect : def.ratio;
    return target / sourceAspect;   // w_norm / h_norm
  }

  _bind() {
    let mode = null;
    let start = null;

    const pos = (ev) => ({
      x: (ev.clientX - this.root.getBoundingClientRect().left) / this.root.clientWidth,
      y: (ev.clientY - this.root.getBoundingClientRect().top) / this.root.clientHeight,
    });

    this.root.addEventListener('pointerdown', (ev) => {
      if (!this.active) return;
      ev.preventDefault();
      this.root.setPointerCapture(ev.pointerId);
      const handle = ev.target.dataset?.handle;
      mode = handle || 'move';
      start = { p: pos(ev), c: { ...this.crop } };
      this.rect.classList.add('is-dragging');
      haptic();
    });

    this.root.addEventListener('pointermove', (ev) => {
      if (!mode) return;
      ev.preventDefault();
      const p = pos(ev);
      const dx = p.x - start.p.x;
      const dy = p.y - start.p.y;
      const c = this.crop;
      const s = start.c;
      const ratio = this._lockedRatio(this.sourceAspect || 1);

      if (mode === 'move') {
        c.x = Math.min(Math.max(s.x + dx, 0), 1 - s.w);
        c.y = Math.min(Math.max(s.y + dy, 0), 1 - s.h);
      } else {
        let { x, y, w, h } = s;
        if (mode.includes('w')) { const nx = Math.min(s.x + dx, s.x + s.w - MIN_SIZE); x = Math.max(0, nx); w = s.x + s.w - x; }
        if (mode.includes('e')) { w = Math.min(1 - s.x, Math.max(MIN_SIZE, s.w + dx)); }
        if (mode.includes('n')) { const ny = Math.min(s.y + dy, s.y + s.h - MIN_SIZE); y = Math.max(0, ny); h = s.y + s.h - y; }
        if (mode.includes('s')) { h = Math.min(1 - s.y, Math.max(MIN_SIZE, s.h + dy)); }

        if (ratio) {
          // Con proporción bloqueada manda el eje que más se ha movido.
          if (Math.abs(dx) >= Math.abs(dy)) h = w / ratio; else w = h * ratio;
          if (mode.includes('n')) y = s.y + s.h - h;
          if (mode.includes('w')) x = s.x + s.w - w;
          // Reencaja si el ajuste se ha salido del original.
          if (x < 0) { w += x; h = w / ratio; x = 0; }
          if (y < 0) { h += y; w = h * ratio; y = 0; }
          if (x + w > 1) { w = 1 - x; h = w / ratio; }
          if (y + h > 1) { h = 1 - y; w = h * ratio; }
        }
        Object.assign(c, {
          x: Math.max(0, x), y: Math.max(0, y),
          w: Math.min(1 - Math.max(0, x), Math.max(MIN_SIZE, w)),
          h: Math.min(1 - Math.max(0, y), Math.max(MIN_SIZE, h)),
        });
      }
      this.layout();
      this.onChange(false);
    });

    const end = () => {
      if (!mode) return;
      mode = null;
      this.rect.classList.remove('is-dragging');
      this.onChange(true);
    };
    this.root.addEventListener('pointerup', end);
    this.root.addEventListener('pointercancel', end);
  }
}
