/**
 * wheel.js — Rueda de etalonaje de tres vías.
 *
 * El disco fija matiz (ángulo) y saturación (radio); el deslizador de debajo
 * ajusta la luminancia de esa zona. Es el control clásico de sombras / medios /
 * altas luces de cualquier sala de etalonaje.
 */

import { el, haptic } from '../utils/dom.js';

export class ColorWheel {
  /**
   * @param {string} label
   * @param {{h:number,s:number,l:number}} zone  referencia viva
   * @param {(committed:boolean)=>void} onChange
   */
  constructor(label, zone, onChange) {
    this.zone = zone;
    this.onChange = onChange;

    this.canvas = el('canvas', { class: 'wheel__disc', width: 200, height: 200, 'aria-label': label });
    this.lum = el('input', {
      type: 'range', class: 'wheel__lum', min: -0.25, max: 0.25, step: 0.002,
      value: zone.l, 'aria-label': label + ': luminancia',
    });
    this.lum.addEventListener('input', () => { this.zone.l = parseFloat(this.lum.value); this._paintLum(); this.onChange(false); });
    this.lum.addEventListener('change', () => this.onChange(true));

    this.root = el('div', { class: 'wheel' },
      el('div', { class: 'wheel__stage' }, this.canvas),
      el('span', { class: 'wheel__label', text: label }),
      this.lum);

    this.root.addEventListener('dblclick', () => this.reset());
    this._bind();
    this.draw();
    this._paintLum();
  }

  reset() {
    this.zone.h = 0; this.zone.s = 0; this.zone.l = 0;
    this.lum.value = 0;
    this.draw();
    this._paintLum();
    this.onChange(true);
    haptic(12);
  }

  _paintLum() {
    this.root.style.setProperty('--lum-pos', (this.zone.l + 0.25) / 0.5);
    this.root.classList.toggle('is-modified', this.zone.s > 1e-4 || Math.abs(this.zone.l) > 1e-4);
  }

  _bind() {
    const c = this.canvas;
    const apply = (ev) => {
      const r = c.getBoundingClientRect();
      const x = (ev.clientX - r.left) / r.width * 2 - 1;
      const y = (ev.clientY - r.top) / r.height * 2 - 1;
      const dist = Math.min(1, Math.hypot(x, y));
      this.zone.s = dist * 0.5;                       // el radio no llega a saturar del todo
      this.zone.h = (Math.atan2(-y, x) * 180) / Math.PI;
      this.draw();
      this._paintLum();
    };
    c.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      c.setPointerCapture(ev.pointerId);
      this._dragging = true;
      apply(ev);
      this.onChange(false);
    });
    c.addEventListener('pointermove', (ev) => {
      if (!this._dragging) return;
      ev.preventDefault();
      apply(ev);
      this.onChange(false);
    });
    const end = () => { if (this._dragging) { this._dragging = false; this.onChange(true); } };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  draw() {
    const c = this.canvas;
    const g = c.getContext('2d');
    const size = c.width;
    const R = size / 2;
    g.clearRect(0, 0, size, size);

    // Disco de matiz y saturación, dibujado por sectores.
    // Los ángulos van negados porque en canvas la Y crece hacia abajo y aquí
    // interesa el sentido antihorario de una rueda de color. El barrido va del
    // ángulo menor al mayor (−a1 → −a0) para pintar sólo ese sector: al revés,
    // cada uno daría casi la vuelta completa y el último taparía a los demás.
    const steps = 90;
    const overlap = Math.PI * 2 / steps * 0.6;   // solapa para que no se vean costuras
    for (let i = 0; i < steps; i++) {
      const a0 = (i / steps) * Math.PI * 2;
      const a1 = ((i + 1) / steps) * Math.PI * 2 + overlap;
      const hue = Math.round((i / steps) * 360);
      const grad = g.createRadialGradient(R, R, 0, R, R, R - 2);
      grad.addColorStop(0, 'hsl(' + hue + ', 0%, 62%)');
      grad.addColorStop(1, 'hsl(' + hue + ', 78%, 58%)');
      g.beginPath();
      g.moveTo(R, R);
      g.arc(R, R, R - 2, -a1, -a0);
      g.closePath();
      g.fillStyle = grad;
      g.fill();
    }

    g.beginPath();
    g.arc(R, R, R - 1.5, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(255,255,255,0.16)';
    g.lineWidth = 1.5;
    g.stroke();

    // Puck.
    const rad = (this.zone.s / 0.5) * (R - 8);
    const ang = (this.zone.h * Math.PI) / 180;
    const px = R + Math.cos(ang) * rad;
    const py = R - Math.sin(ang) * rad;
    g.beginPath();
    g.arc(px, py, 9, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.stroke();
  }
}
