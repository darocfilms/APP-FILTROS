/**
 * filmpicker.js — Selector de emulsión con previsualización real.
 *
 * Cada tarjeta muestra la imagen actual revelada con esa emulsión, no una
 * muestra genérica: elegir película deja de ser adivinar. Las miniaturas se
 * generan con un único renderer diminuto y bajo IntersectionObserver, así que
 * sólo se calcula lo que está en pantalla.
 */

import { el, haptic } from '../utils/dom.js';
import { FILMS, filmsByKind, getFilm } from '../data/films.js';
import { defaultParams, applyFilmLook } from '../data/params.js';
import { Renderer } from '../engine/renderer.js';

const PREVIEW_SIZE = 132;

export class FilmPicker {
  /**
   * @param {(filmId:string)=>void} onPick
   */
  constructor(onPick) {
    this.onPick = onPick;
    this.selected = 'neutral';
    this.cards = new Map();
    this.source = null;
    this._renderer = null;
    this._canvas = null;
    this._queue = [];
    this._working = false;

    this.root = el('div', { class: 'filmpicker' });
    this._build();

    this._io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) this._enqueue(e.target.dataset.film);
      }
    }, { root: this.root, rootMargin: '160px' });

    for (const card of this.cards.values()) this._io.observe(card.node);
  }

  _build() {
    for (const group of filmsByKind()) {
      const items = group.items.map((f) => this._card(f));
      this.root.append(
        el('div', { class: 'filmpicker__group' },
          el('h4', { class: 'filmpicker__kind', text: group.kind }),
          el('div', { class: 'filmpicker__row' }, items)));
    }
  }

  _card(film) {
    const canvas = el('canvas', { class: 'filmcard__thumb', width: PREVIEW_SIZE, height: PREVIEW_SIZE });
    const g = canvas.getContext('2d');
    // Muestra de color mientras llega la previsualización real.
    const grad = g.createLinearGradient(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
    grad.addColorStop(0, film.swatch[0]);
    grad.addColorStop(1, film.swatch[1]);
    g.fillStyle = grad;
    g.fillRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);

    const node = el('button', {
      type: 'button',
      class: 'filmcard' + (film.id === this.selected ? ' is-active' : ''),
      dataset: { film: film.id },
      'aria-pressed': film.id === this.selected,
      onclick: () => { haptic(); this.select(film.id); this.onPick(film.id); },
    },
      el('div', { class: 'filmcard__frame' }, canvas),
      el('span', { class: 'filmcard__name', text: film.name }),
      el('span', { class: 'filmcard__meta', text: film.iso ? 'ISO ' + film.iso : film.brand }));

    this.cards.set(film.id, { node, canvas, film, rendered: false });
    return node;
  }

  select(id) {
    this.selected = id;
    for (const [key, c] of this.cards) {
      const on = key === id;
      c.node.classList.toggle('is-active', on);
      c.node.setAttribute('aria-pressed', String(on));
      if (on) c.node.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }
  }

  /** Descripción de la emulsión activa, para el pie del panel. */
  describe(id) {
    const f = getFilm(id);
    return { name: f.name, brand: f.brand, kind: f.kind, note: f.note, iso: f.iso };
  }

  /**
   * Fija la imagen sobre la que se calculan las previsualizaciones.
   * @param {ImageBitmap|HTMLCanvasElement|HTMLVideoElement} source
   */
  setSource(source) {
    this.source = source;
    for (const c of this.cards.values()) c.rendered = false;
    this._queue = [];
    // Vuelve a encolar lo que esté visible.
    for (const c of this.cards.values()) {
      const r = c.node.getBoundingClientRect();
      const p = this.root.getBoundingClientRect();
      if (r.right > p.left - 160 && r.left < p.right + 160) this._enqueue(c.film.id);
    }
  }

  _enqueue(id) {
    const card = this.cards.get(id);
    if (!card || card.rendered || !this.source) return;
    if (!this._queue.includes(id)) this._queue.push(id);
    this._pump();
  }

  async _pump() {
    if (this._working) return;
    this._working = true;
    try {
      while (this._queue.length && this.source) {
        const id = this._queue.shift();
        await this._renderCard(id);
        // Cede el hilo para que el desplazamiento no se note pesado.
        await new Promise((r) => requestAnimationFrame(r));
      }
    } finally {
      this._working = false;
    }
  }

  async _renderCard(id) {
    const card = this.cards.get(id);
    if (!card || card.rendered || !this.source) return;
    try {
      if (!this._renderer) {
        this._canvas = document.createElement('canvas');
        this._renderer = new Renderer(this._canvas);
      }
      const src = this.source;
      const sw = src.width || src.videoWidth;
      const sh = src.height || src.videoHeight;
      if (!sw || !sh) return;

      // Recorte cuadrado central: todas las tarjetas comparables.
      const side = Math.min(sw, sh);
      const params = applyFilmLook(defaultParams(), card.film);
      params.geometry.crop = {
        x: (sw - side) / 2 / sw,
        y: (sh - side) / 2 / sh,
        w: side / sw,
        h: side / sh,
      };
      // El grano no se lee a este tamaño y sólo añade ruido visual.
      params.effects.grain = 0;

      this._renderer.setSource(src, sw, sh);
      this._renderer.render(params, { seed: 3 });

      const g = card.canvas.getContext('2d');
      g.drawImage(this._canvas, 0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
      card.rendered = true;
    } catch {
      // Si el contexto se pierde, la tarjeta se queda con su muestra de color.
    }
  }

  destroy() {
    this._io?.disconnect();
    this._renderer?.dispose();
    this._renderer = null;
    if (this._canvas) this._canvas.width = this._canvas.height = 0;
  }
}

export { FILMS };
