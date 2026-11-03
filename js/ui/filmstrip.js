/**
 * filmstrip.js — La tira de fotos del laboratorio.
 *
 * Una fila de miniaturas de todas las fotos de la biblioteca, para pasar de una
 * a otra sin salir a la cuadrícula mientras se edita. Se enseña o se esconde
 * con un botón del laboratorio.
 *
 * Con cientos de fotos no se leen cientos de miniaturas de golpe: cada casilla
 * carga la suya cuando entra en la tira visible, y las que salen la sueltan.
 */

import { el, clear, debounce } from '../utils/dom.js';
import { library } from '../store/library.js';
import { hasEdits } from '../store/develop.js';

export class Filmstrip {
  /** @param {{onPick:(item:object)=>void}} hooks */
  constructor(hooks) {
    this.hooks = hooks;
    this.items = [];
    this.current = null;
    this.visible = false;
    this.urls = new Map();
    this.tiles = new Map();

    this.root = el('div', { class: 'tira', hidden: true, role: 'listbox', 'aria-label': 'Fotos de la biblioteca' });

    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = e.target.dataset.id;
        if (e.isIntersecting) this._loadThumb(id);
        else this._dropThumb(id);
      }
    }, { root: this.root, rootMargin: '0px 400px' });

    const refrescar = debounce(() => { if (this.visible) this.refresh(); }, 180);
    library.addEventListener('change', refrescar);
    library.addEventListener('thumb', (e) => {
      if (this.visible && this.urls.has(e.detail.id)) this._loadThumb(e.detail.id, true);
    });
  }

  async show(on) {
    this.visible = on;
    this.root.hidden = !on;
    if (on) { await this.refresh(); this._scrollToCurrent(false); } else this._dropAll();
  }

  /** Vuelve a leer la lista; las casillas que ya estaban se reutilizan. */
  async refresh() {
    const items = (await library.list()).filter((i) => i.kind === 'photo');
    this.items = items;
    const vivos = new Set(items.map((i) => i.id));
    for (const [id, tile] of this.tiles) {
      if (!vivos.has(id)) { this.io.unobserve(tile); this._dropThumb(id); this.tiles.delete(id); }
    }
    const nodos = items.map((item) => {
      let tile = this.tiles.get(item.id);
      if (!tile) {
        tile = el('button', {
          type: 'button', class: 'tira__item', role: 'option', dataset: { id: item.id },
          'aria-label': 'Abrir esta foto',
          onclick: () => { const it = this.items.find((i) => i.id === item.id); if (it) this.hooks.onPick(it); },
        }, el('img', { class: 'tira__img', alt: '', decoding: 'async' }), el('span', { class: 'tira__marca', 'aria-hidden': 'true' }));
        this.tiles.set(item.id, tile);
        this.io.observe(tile);
      }
      tile.classList.toggle('is-edited', hasEdits(item.params));
      tile.classList.toggle('is-current', item.id === this.current);
      tile.setAttribute('aria-selected', String(item.id === this.current));
      return tile;
    });
    // Guardar un ajuste también avisa de «cambio»: si la lista es la misma, sólo
    // se actualizan las marcas. Rehacerla entera devolvería la tira al principio
    // mientras se está mirando otra parte.
    const orden = items.map((i) => i.id).join(',');
    if (orden === this._orden) return;
    this._orden = orden;
    clear(this.root).append(...nodos);
    if (!items.length) this.root.append(el('p', { class: 'tira__vacia', text: 'No hay fotos en la biblioteca.' }));
    this._scrollToCurrent(false);
  }

  setCurrent(id) {
    this.current = id;
    for (const [tid, tile] of this.tiles) {
      tile.classList.toggle('is-current', tid === id);
      tile.setAttribute('aria-selected', String(tid === id));
    }
    this._scrollToCurrent(true);
  }

  /** La foto de al lado en el orden de la tira (el de la biblioteca). */
  neighbor(delta) {
    const i = this.items.findIndex((it) => it.id === this.current);
    if (i < 0) return null;
    return this.items[i + delta] || null;
  }

  async ensureItems() {
    if (!this.items.length) this.items = (await library.list()).filter((i) => i.kind === 'photo');
    return this.items;
  }

  _scrollToCurrent(suave) {
    if (!this.visible) return;
    const tile = this.tiles.get(this.current);
    tile?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: suave ? 'smooth' : 'auto' });
  }

  async _loadThumb(id, forzar = false) {
    if (this.urls.has(id) && !forzar) return;
    const blob = await library.getThumbBlob(id);
    const tile = this.tiles.get(id);
    if (!blob || !tile) return;
    const vieja = this.urls.get(id);
    const url = URL.createObjectURL(blob);
    this.urls.set(id, url);
    tile.querySelector('img').src = url;
    if (vieja) URL.revokeObjectURL(vieja);
  }

  _dropThumb(id) {
    const url = this.urls.get(id);
    if (!url) return;
    URL.revokeObjectURL(url);
    this.urls.delete(id);
    const img = this.tiles.get(id)?.querySelector('img');
    if (img) img.removeAttribute('src');
  }

  _dropAll() {
    for (const id of [...this.urls.keys()]) this._dropThumb(id);
  }
}
