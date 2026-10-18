/**
 * viewer.js — Visor a pantalla completa de la biblioteca.
 *
 * La cuadrícula sirve para encontrar; esto sirve para MIRAR. Es el visor de
 * Fotos: la foto sobre negro, arriba la fecha y un botón redondo para volver,
 * y abajo una barra de cristal con guardar, editar y borrar. Un toque quita
 * todo y otro lo devuelve; deslizar de lado pasa de foto y hacia abajo cierra.
 *
 * Se carga un archivo cada vez y se suelta al pasar al siguiente: con doce
 * megapíxeles por imagen, mantener varios abiertos es la forma más rápida de
 * que Safari cierre la pestaña.
 */

import { el, clear, haptic } from '../utils/dom.js';
import { library, decodeScaled } from '../store/library.js';
import { isRawFile } from '../store/raw.js';
import { esHeif } from '../store/heif.js';
import { hasEdits, describeEdits, develop } from '../store/develop.js';
import { ICONO } from './iconos.js';


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
        type: 'button', class: 'viewer__btn glass', 'aria-label': 'Cerrar', html: ICONO.volver,
        onclick: (e) => { e.stopPropagation(); this.close(); },
      }),
      this.caption,
      this.counter);

    // Iconos con su nombre en texto oculto. En el documento va primero
    // Laboratorio (el botón principal), y en pantalla en medio, como «Editar»
    // en Fotos: guardar a la izquierda y borrar a la derecha.
    const accion = (nombre, icono, fn, extra = '') => el('button', {
      type: 'button', class: 'viewer__action' + extra, title: nombre,
      onclick: (e) => { e.stopPropagation(); fn(this.current); },
    }, el('span', { class: 'viewer__icon', html: icono }), el('span', { class: 'visually-hidden', text: nombre }));
    this.actions = el('div', { class: 'viewer__actions', role: 'toolbar', 'aria-label': 'Acciones de la foto' },
      accion('Laboratorio', ICONO.editar, (it) => this.hooks.onEdit?.(it), ' viewer__action--editar'),
      accion('Guardar', ICONO.compartir, (it) => this.hooks.onSave?.(it), ' viewer__action--guardar'),
      accion('Borrar', ICONO.eliminar, (it) => this.hooks.onDelete?.(it), ' viewer__action--danger'));

    this.bottom = el('div', { class: 'viewer__bottom' }, this.actions);

    this.root = el('div', {
      class: 'viewer', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Visor',
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
    this.hooks.onClose?.();
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

    // Los ajustes se leen del almacén, no de la lista con la que se abrió el
    // visor: pueden haber cambiado en el laboratorio desde entonces.
    const fresco = await library.get(item.id);
    if (fresco) Object.assign(item, fresco);
    let file = null;
    let sinPermiso = null;
    try {
      file = await library.getFile(item.id);
    } catch (err) {
      sinPermiso = err?.message || String(err);   // carpeta de Imágenes sin acceso
    }
    const lado = Math.round(Math.max(innerWidth, innerHeight) * Math.min(devicePixelRatio || 1, 3));
    const editada = item.kind === 'photo' && hasEdits(item.params);
    let vista = file;
    if (file && editada) {
      // Con ajustes se enseña revelada, al tamaño de la pantalla: es la misma
      // foto que sale al guardarla, no el original sin tocar.
      try {
        ({ blob: vista } = await develop(file, item.params, lado));
      } catch (err) {
        console.error(err);
        vista = null;
      }
    } else if (file && (item.raw || isRawFile(file) || esHeif(file))) {
      // Un RAW no lo sabe pintar un <img>: se revela en neutro al tamaño de la
      // pantalla, que es lo que se va a ver, y se enseña como JPEG.
      try {
        const { bitmap } = await decodeScaled(file, lado);
        // Un RAW se revela en neutro; un HEIF (que Chrome no sabe enseñar en
        // un <img>) ya viene descodificado y sólo se dibuja.
        const lienzo = bitmap.toCanvas ? bitmap.toCanvas() : Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
        if (!bitmap.toCanvas) lienzo.getContext('2d').drawImage(bitmap, 0, 0);
        bitmap.close();
        vista = await new Promise((r) => lienzo.toBlob(r, 'image/jpeg', 0.92));
        lienzo.width = lienzo.height = 0;
      } catch (err) {
        console.error(err);
        vista = null;
      }
    }
    // Puede haberse cambiado de foto mientras se leía la anterior.
    if (this.current !== item) return;
    clear(this.stage);

    if (sinPermiso) {
      this.stage.append(el('p', { class: 'viewer__missing', text: sinPermiso }));
    } else if (!file) {
      this.stage.append(el('p', { class: 'viewer__missing', text: 'El archivo ya no está en la carpeta local.' }));
    } else if (!vista) {
      this.stage.append(el('p', { class: 'viewer__missing', text: editada ? 'No se ha podido revelar esta foto.' : 'No se ha podido revelar este RAW.' }));
    } else {
      this.url = URL.createObjectURL(vista);
      this.stage.append(item.kind === 'video'
        ? el('video', { class: 'viewer__media', src: this.url, controls: '', playsinline: '', autoplay: '' })
        // Sin arrastre nativo: con ratón, arrastrar la imagen la «cogía» y el
        // gesto de cerrar deslizando hacia abajo no llegaba a soltarse.
        : el('img', { class: 'viewer__media', src: this.url, alt: '', decoding: 'async', draggable: 'false' }));
    }

    // Arriba, como en Fotos: la fecha («Hoy», «Ayer» o el día) y debajo la
    // hora con lo que la distingue (RAW, la emulsión o los ajustes).
    const cuando = new Date(item.createdAt);
    const dias = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(cuando).setHours(0, 0, 0, 0)) / 864e5);
    const dia = dias === 0 ? 'Hoy' : dias === 1 ? 'Ayer'
      : cuando.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: cuando.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
    const hora = cuando.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const look = editada ? describeEdits(item.params) : item.filmName;
    clear(this.caption).append(
      el('span', { class: 'viewer__dims', text: dia }),
      el('span', { class: 'viewer__meta', text: [hora, item.raw ? 'RAW' : `${item.width}×${item.height}`, look].filter(Boolean).join(' · ') }));
    this.counter.textContent = this.items.length > 1 ? `${this.index + 1} / ${this.items.length}` : '';
  }

  /**
   * Deslizar en horizontal pasa de una foto a otra, como cualquier galería, y
   * hacia abajo cierra el visor, como en Fotos.
   */
  _bindSwipe() {
    let x0 = null, y0 = null;
    this.stage.addEventListener('pointerdown', (ev) => { x0 = ev.clientX; y0 = ev.clientY; });
    this.stage.addEventListener('pointerup', (ev) => {
      if (x0 === null) return;
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      x0 = null;
      // Sólo si el gesto es claramente de un lado: con la mano poco firme un
      // toque se mueve unos píxeles y no debe cambiar nada.
      if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.6) {
        ev.stopPropagation();
        this._swallowClick();
        this.go(dx < 0 ? 1 : -1);
      } else if (dy > 90 && dy > Math.abs(dx) * 1.4) {
        ev.stopPropagation();
        this._swallowClick();
        this.close();
      }
    });
  }

  /** El click que sigue a un deslizamiento no es un toque: no cambia los mandos. */
  _swallowClick() {
    const tragar = (e) => { e.stopPropagation(); e.preventDefault(); };
    this.root.addEventListener('click', tragar, { capture: true, once: true });
    setTimeout(() => this.root.removeEventListener('click', tragar, { capture: true }), 400);
  }
}
