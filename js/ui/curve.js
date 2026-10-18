/**
 * curve.js — Editor de curvas de tono.
 *
 * Cuatro canales (maestra, R, G, B) con puntos de control arrastrables. La
 * interpolación es la misma spline monótona que usa el motor, así que lo que se
 * dibuja es exactamente lo que se aplica.
 *
 * Gestos: arrastrar mueve un punto · tocar en un hueco lo crea · doble toque
 * sobre un punto lo elimina (los extremos no se pueden borrar).
 */

import { el, haptic } from '../utils/dom.js';
import { monotoneSpline } from '../engine/colorscience.js';

const CHANNELS = [
  { key: 'master', label: 'RGB', color: '#f4f4f5' },
  { key: 'red', label: 'R', color: '#ff5f52' },
  { key: 'green', label: 'G', color: '#4ade80' },
  { key: 'blue', label: 'B', color: '#60a5fa' },
];

const HIT_RADIUS = 26;   // en píxeles CSS: generoso, es un objetivo táctil

export class CurveEditor {
  /**
   * @param {object} curves  referencia viva a params.curves
   * @param {(committed:boolean)=>void} onChange
   */
  constructor(curves, onChange) {
    this.curves = curves;
    this.onChange = onChange;
    this.channel = 'master';
    this.dragIndex = -1;
    this.histogram = null;

    this.canvas = el('canvas', { class: 'curve__canvas', 'aria-label': 'Editor de curvas' });
    this.ctx = this.canvas.getContext('2d');

    this.tabs = el('div', { class: 'curve__tabs' }, CHANNELS.map((c) =>
      el('button', {
        type: 'button',
        class: 'curve__tab' + (c.key === this.channel ? ' is-active' : ''),
        dataset: { channel: c.key },
        style: { '--tint': c.color },
        onclick: () => this.setChannel(c.key),
      }, c.label)));

    this.root = el('div', { class: 'curve' },
      this.tabs,
      el('div', { class: 'curve__stage' }, this.canvas),
      el('div', { class: 'curve__hint' },
        el('span', { text: 'Toca para añadir · doble toque para quitar' }),
        el('button', { type: 'button', class: 'linkbtn', text: 'Restablecer', onclick: () => this.reset() })));

    this._bindPointer();
    this._observe();
  }

  setChannel(key) {
    this.channel = key;
    for (const t of this.tabs.children) t.classList.toggle('is-active', t.dataset.channel === key);
    this.draw();
  }

  setHistogram(hist) {
    this.histogram = hist;
    this.draw();
  }

  get points() { return this.curves[this.channel]; }

  reset() {
    this.curves[this.channel] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    this.draw();
    this.onChange(true);
    haptic(12);
  }

  /* ─────────────────────────── Interacción ──────────────────────────── */

  _bindPointer() {
    const c = this.canvas;
    let lastTap = 0;

    const toCurve = (ev) => {
      const r = c.getBoundingClientRect();
      return {
        x: Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)),
        y: Math.min(1, Math.max(0, 1 - (ev.clientY - r.top) / r.height)),
        rect: r,
      };
    };

    const nearest = (p, rect) => {
      const pts = this.points;
      let best = -1, bestD = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const dx = (pts[i].x - p.x) * rect.width;
        const dy = (pts[i].y - p.y) * rect.height;
        const d = Math.hypot(dx, dy);
        if (d < bestD) { bestD = d; best = i; }
      }
      return bestD <= HIT_RADIUS ? best : -1;
    };

    c.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      c.setPointerCapture(ev.pointerId);
      const p = toCurve(ev);
      const hit = nearest(p, p.rect);
      const now = performance.now();

      if (hit >= 0 && now - lastTap < 320) {
        // Doble toque: eliminar, salvo los extremos.
        if (hit > 0 && hit < this.points.length - 1) {
          this.points.splice(hit, 1);
          this.dragIndex = -1;
          this.draw();
          this.onChange(true);
          haptic(12);
          lastTap = 0;
          return;
        }
      }
      lastTap = now;

      if (hit >= 0) {
        this.dragIndex = hit;
      } else {
        this.points.push({ x: p.x, y: p.y });
        this.points.sort((a, b) => a.x - b.x);
        this.dragIndex = this.points.findIndex((q) => q.x === p.x && q.y === p.y);
        haptic();
      }
      this.draw();
      this.onChange(false);
    });

    c.addEventListener('pointermove', (ev) => {
      if (this.dragIndex < 0) return;
      ev.preventDefault();
      const p = toCurve(ev);
      const pts = this.points;
      const i = this.dragIndex;
      // Los extremos sólo se mueven en vertical: la curva debe cubrir [0,1].
      if (i === 0) pts[i].x = 0;
      else if (i === pts.length - 1) pts[i].x = 1;
      else {
        const lo = pts[i - 1].x + 0.02;
        const hi = pts[i + 1].x - 0.02;
        pts[i].x = Math.min(hi, Math.max(lo, p.x));
      }
      pts[i].y = p.y;
      this.draw();
      this.onChange(false);
    });

    const end = () => {
      if (this.dragIndex < 0) return;
      this.dragIndex = -1;
      this.onChange(true);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  _observe() {
    this._ro = new ResizeObserver(() => this.draw());
    this._ro.observe(this.canvas);
  }

  destroy() { this._ro?.disconnect(); }

  /* ──────────────────────────── Dibujado ────────────────────────────── */

  draw() {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = c.clientWidth || 280;
    const h = c.clientHeight || 280;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const X = (x) => x * w;
    const Y = (y) => (1 - y) * h;

    // Histograma de fondo, para saber dónde está la información.
    if (this.histogram) {
      const src = this.channel === 'master' ? this.histogram.l : this.histogram[this.channel[0]];
      if (src) {
        const max = Math.max(1, ...src);
        g.fillStyle = 'rgba(255,255,255,0.08)';
        g.beginPath();
        g.moveTo(0, h);
        for (let i = 0; i < src.length; i++) {
          g.lineTo(X(i / (src.length - 1)), Y((src[i] / max) * 0.85));
        }
        g.lineTo(w, h);
        g.closePath();
        g.fill();
      }
    }

    // Rejilla de tercios.
    g.strokeStyle = 'rgba(255,255,255,0.10)';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 1; i < 4; i++) {
      g.moveTo(X(i / 4), 0); g.lineTo(X(i / 4), h);
      g.moveTo(0, Y(i / 4)); g.lineTo(w, Y(i / 4));
    }
    g.stroke();

    // Diagonal de referencia.
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.setLineDash([3, 4]);
    g.beginPath(); g.moveTo(0, h); g.lineTo(w, 0); g.stroke();
    g.setLineDash([]);

    // Las tres curvas de canal, tenues, cuando no están activas.
    for (const ch of CHANNELS) {
      if (ch.key === this.channel) continue;
      const pts = this.curves[ch.key];
      if (pts.length === 2 && pts[0].y === 0 && pts[1].y === 1) continue;
      this._stroke(g, pts, ch.color, 1.2, 0.35, w, h);
    }

    const active = CHANNELS.find((x) => x.key === this.channel);
    this._stroke(g, this.points, active.color, 2.2, 1, w, h);

    // Puntos de control.
    for (const p of this.points) {
      g.beginPath();
      g.arc(X(p.x), Y(p.y), 6, 0, Math.PI * 2);
      g.fillStyle = active.color;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(0,0,0,0.55)';
      g.stroke();
    }
  }

  _stroke(g, pts, color, width, alpha, w, h) {
    const f = monotoneSpline(pts);
    g.globalAlpha = alpha;
    g.strokeStyle = color;
    g.lineWidth = width;
    g.lineJoin = 'round';
    g.beginPath();
    const steps = 96;
    for (let i = 0; i <= steps; i++) {
      const x = i / steps;
      const y = Math.min(1, Math.max(0, f(x)));
      const px = x * w, py = (1 - y) * h;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.stroke();
    g.globalAlpha = 1;
  }
}
