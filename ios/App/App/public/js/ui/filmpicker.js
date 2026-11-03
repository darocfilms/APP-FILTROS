/**
 * filmpicker.js — Selector de emulsión: una fila de nombres.
 *
 * Sin recuadros encima del nombre. Las muestras de color no decían nada (dos
 * negativos Kodak salen casi iguales a 40 px) y las miniaturas reveladas
 * tapaban media pantalla de la foto justo mientras se elige, que es cuando
 * más hay que verla. Al tocar un nombre la emulsión se aplica a la imagen de
 * verdad, que enseña más que cualquier miniatura.
 *
 * Es el mismo componente en la cámara y en el laboratorio, como el selector
 * de modos de la Cámara del iPhone: el nombre activo en amarillo con un punto
 * debajo, y la familia (Negativo color, Cine…) en pequeño delante de su tramo.
 * En el escritorio, con columna propia, los grupos van uno debajo de otro.
 */

import { el, haptic } from '../utils/dom.js';
import { FILMS, filmsByKind, getFilm } from '../data/films.js';

export class FilmPicker {
  /**
   * @param {(filmId:string)=>void} onPick
   */
  constructor(onPick) {
    this.onPick = onPick;
    this.selected = null;
    this.botones = new Map();

    this.root = el('div', { class: 'filmpicker', role: 'listbox', 'aria-label': 'Emulsión' });
    for (const grupo of filmsByKind()) {
      this.root.append(el('div', { class: 'filmpicker__group', role: 'group', 'aria-label': grupo.kind },
        el('span', { class: 'filmpicker__kind', 'aria-hidden': 'true', text: grupo.kind }),
        grupo.items.map((f) => this._boton(f))));
    }
  }

  _boton(film) {
    const b = el('button', {
      type: 'button', class: 'filmname', role: 'option',
      dataset: { film: film.id }, 'aria-selected': 'false',
      title: [film.brand, film.iso ? 'ISO ' + film.iso : null].filter(Boolean).join(' · '),
      text: film.name,
      onclick: () => {
        if (film.id === this.selected) return;
        haptic();
        this.select(film.id);
        this.onPick(film.id);
      },
    });
    this.botones.set(film.id, b);
    return b;
  }

  /** Marca la emulsión activa y la trae a la vista si estaba fuera. */
  select(id) {
    this.selected = id;
    let activo = null;
    for (const [key, b] of this.botones) {
      const on = key === id;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
      if (on) activo = b;
    }
    if (activo) requestAnimationFrame(() => activo.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' }));
  }

  /** Descripción de la emulsión activa, para quien la quiera enseñar. */
  describe(id) {
    const f = getFilm(id);
    return { name: f.name, brand: f.brand, kind: f.kind, note: f.note, iso: f.iso };
  }

  /** Ya no hay miniaturas que revelar; se mantiene por compatibilidad. */
  setSource() {}

  destroy() {
    this.botones.clear();
  }
}

export { FILMS };
