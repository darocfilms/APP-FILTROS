/** histogram.js — Histograma RGB superpuesto sobre la previsualización. */

import { el } from '../utils/dom.js';

export class Histogram {
  constructor() {
    this.canvas = el('canvas', { class: 'histogram__canvas', width: 256, height: 96 });
    this.root = el('div', { class: 'histogram', 'aria-hidden': 'true' }, this.canvas);
  }

  update(hist) {
    const g = this.canvas.getContext('2d');
    const w = this.canvas.width, h = this.canvas.height;
    g.clearRect(0, 0, w, h);
    if (!hist) return;

    const max = Math.max(1, ...hist.r, ...hist.g, ...hist.b);
    const channels = [
      [hist.r, 'rgba(255,80,70,0.72)'],
      [hist.g, 'rgba(74,222,128,0.72)'],
      [hist.b, 'rgba(96,165,250,0.72)'],
    ];
    g.globalCompositeOperation = 'lighter';
    for (const [data, color] of channels) {
      g.beginPath();
      g.moveTo(0, h);
      for (let i = 0; i < data.length; i++) {
        g.lineTo((i / (data.length - 1)) * w, h - (data[i] / max) * h * 0.94);
      }
      g.lineTo(w, h);
      g.closePath();
      g.fillStyle = color;
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  }
}
