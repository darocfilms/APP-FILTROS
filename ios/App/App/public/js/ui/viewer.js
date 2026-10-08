/**
 * viewer.js — Visor a pantalla completa de la biblioteca.
 *
 * La cuadrícula sirve para encontrar; esto sirve para MIRAR. Por eso arranca
 * limpio: la foto sobre negro y nada más. Un toque saca los botones que hacen
 * falta —cerrar, editar, guardar, borrar— y otro los quita.
 *
 * Se carga un archivo cada vez y se suelta al pasar al siguiente: con doce
 * megapíxeles por imagen, mantener varios abiertos es la forma más rápida de
 * que Safari cierre la pestaña.
 */

import { el, clear, haptic } from '../utils/dom.js';
import { library } from '../store/library.js';

/**
 * La papelera va dibujada, no como carácter: el glifo de «borrar» de Unicode
 * sale como tres letras diminutas en las fuentes del sistema, y un icono que
 * hay que descifrar no es un icono.
 */
const PAPELERA = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" '
  + 'stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" '
  + 'aria-hidden="true" focusable="false">'
  + '<path d="M4 6.5h16M9.5 6.5V4.5h5v2M6.5 6.5l1 13h9l1-13M10.5 10v6M13.5 10v6"/></svg>';

export class Viewer {
  /**
   * @param {{onEdit:(item)=>void, onSave:(item)=>void, onDelete:(item)=>void}} hooks
   */
  constructor(hooks) {
    this.hooks = hooks;
    this.items = [];
    this.index = 0;
    this.url = null;
    this.chrome = true;

    this.stage = el('div', { class: 'viewer__stage' });
    this.caption = el('div', { class: 'viewer__caption' });
    this.counter = el('span', { class: 'viewer__counter' });

    this.top = el('div', { class: 'viewer__top' },
      el('button', {
        type: 'button', class: 'viewer__btn', 'aria-label': 'Cerrar',
        onclick: (e) => { e.stopPropagation(); this.close(); },
      }, '✕'),
      this.counter);

    // El pie va en dos filas: los datos arriba y los botones abajo. Con tres
    // acciones, repartirlos a los lados del texto los dejaba del ancho de un
    // dedo mal puesto.
    this.actions = el('div', { class: 'viewer__actions' },
      el('button', {
        type: 'button', class: 'viewer__action',
        onclick: (e) => { e.stopPropagation(); this.hooks.onEdit?.(this.current); },
      }, el('span', { class: 'viewer__icon', text: '◑' }), 'Laboratorio'),
      el('button', {
        type: 'button', class: 'viewer__action',
        onclick: (e) => { e.stopPropagation(); this.hooks.onSave?.(this.current); },
      }, el('span', { class: 'viewer__icon', text: '⤓' }), 'Guardar'),
      el('button', {
        type: 'button', class: 'viewer__action viewer__action--danger',
        onclick: (e) => { e.stopPropagation(); this.hooks.onDelete?.(this.current); },
      }, el('span', { class: 'viewer__icon', html: PAPELERA }), 'Borrar'));

    this.bottom = el('div', { class: 'viewer__bottom' }, this.caption, this.actions);

    this.root = el('div', {
      class: 'viewer', hidden: true, role: 'dialog', 'aria-modal': 'true',
      onclick: () => this.toggleChrome(),
    }, this.stage, this.top, this.bottom);

    this._bindSwipe();
  }

  get current() { return this.items[this.index] || null; }

  /**
   * @param {object[]} items lista visible, para poder pasar de una a otra
   * @param {number} index
   */
  async open(items, index) {
    this.items = items;
    this.index = Math.max(0, Math.min(index, items.length - 1));
    this.root.hidden = false;
    this.chrome = true;
    this.root.classList.remove('is-clean');
    document.body.classList.add('is-viewing');
    await this._load();
  }

  close() {
    this._release();
    this.root.hidden = true;
    document.body.classList.remove('is-viewing');
    haptic();
  }

  toggleChrome() {
    this.chrome = !this.chrome;
    this.root.classList.toggle('is-clean', !this.chrome);
  }

  /**
   * Quita del visor la foto que ya no existe y sigue con la siguiente; si era
   * la última, no queda nada que mirar y se cierra.
   */
  async dropCurrent() {
    this.items.splice(this.index, 1);
    if (!this.items.length) { this.close(); return; }
    if (this.index >= this.items.length) this.index = this.items.length - 1;
    await this._load();
  }

  async go(delta) {
    const next = this.index + delta;
    if (next < 0 || next >= this.items.length) return;
    this.index = next;
    haptic();
    await this._load();
  }

  _release() {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    clear(this.stage);
  }

  async _load() {
    const item = this.current;
    if (!item) return;
    this._release();
    this.stage.append(el('div', { class: 'viewer__loading' }, el('span', { class: 'spinner' })));

    const file = await library.getFile(item.id);
    // Puede haberse cambiado de foto mientras se leía la anterior.
    if (this.current !== item) return;
    clear(this.stage);

    if (!file) {
      this.stage.append(el('p', { class: 'viewer__missing', text: 'El archivo ya no está en la carpeta local.' }));
    } else {
      this.url = URL.createObjectURL(file);
      this.stage.append(item.kind === 'video'
        ? el('video', { class: 'viewer__media', src: this.url, controls: '', playsinline: '', autoplay: '' })
        : el('img', { class: 'viewer__media', src: this.url, alt: '', decoding: 'async' }));
    }

    const fecha = new Date(item.createdAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
    clear(this.caption).append(
      el('span', { class: 'viewer__dims', text: `${item.width}×${item.height}` }),
      el('span', { class: 'viewer__meta', text: (item.filmName ? item.filmName + ' · ' : '') + fecha }));
    this.counter.textContent = this.items.length > 1 ? `${this.index + 1} / ${this.items.length}` : '';
  }

  /** Deslizar en horizontal pasa de una foto a otra, como cualquier galería. */
  _bindSwipe() {
    let x0 = null, y0 = null;
    this.stage.addEventListener('pointerdown', (ev) => { x0 = ev.clientX; y0 = ev.clientY; });
    this.stage.addEventListener('pointerup', (ev) => {
      if (x0 === null) return;
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      x0 = null;
      // Sólo si el gesto es claramente horizontal: en vertical puede ser el
      // arrastre para cerrar, o simplemente un toque con la mano poco firme.
      if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.6) {
        ev.stopPropagation();
        this.go(dx < 0 ? 1 : -1);
      }
    });
  }
}
