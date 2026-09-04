/**
 * library.js (vista) — La carpeta local del dispositivo, vista por dentro.
 *
 * Muestra sólo miniaturas: los originales no se cargan hasta que se abren en el
 * laboratorio o se exportan. Con doscientas fotos de 12 Mpx guardadas, la
 * cuadrícula sigue siendo ligera.
 */

import { el, clear, toast, haptic, confirmDialog } from '../utils/dom.js';
import { library, formatBytes } from '../store/library.js';
import { saveFile, timestampName } from '../utils/share.js';
import { getFilm } from '../data/films.js';

export class LibraryView {
  constructor(app) {
    this.app = app;
    this.items = [];
    this.urls = new Map();
    this.filter = 'all';

    this.grid = el('div', { class: 'gallery' });
    this.empty = el('div', { class: 'gallery__empty' },
      el('p', { text: 'Todavía no hay nada guardado.' }),
      el('p', { class: 'muted', text: 'Lo que captures con la cámara o importes desde el dispositivo se guardará aquí, en una carpeta local que sobrevive al cierre del navegador.' }),
      el('div', { class: 'gallery__emptyactions' },
        el('button', { type: 'button', class: 'btn btn--primary', text: 'Abrir la cámara', onclick: () => this.app.go('camera') }),
        el('button', { type: 'button', class: 'btn', text: 'Importar archivos', onclick: () => this.app.pickFile() })));

    this.usageBar = el('div', { class: 'usage__fill' });
    this.usageText = el('span', { class: 'usage__text' });
    this.storageNote = el('span', { class: 'usage__mode' });

    this.filterRow = el('div', { class: 'chiprow chiprow--filters' },
      ...[['all', 'Todo'], ['photo', 'Fotos'], ['video', 'Vídeos']].map(([k, label]) =>
        el('button', {
          type: 'button', class: 'chip' + (k === this.filter ? ' is-active' : ''),
          dataset: { value: k },
          onclick: () => { this.filter = k; this._paintFilters(); this.render(); haptic(); },
        }, label)));

    this.root = el('section', { class: 'view view--library', id: 'view-library' },
      el('header', { class: 'lib__bar' },
        el('h2', { class: 'lib__title', text: 'Biblioteca' }),
        el('button', { type: 'button', class: 'btn btn--ghost', text: 'Importar', onclick: () => this.app.pickFile() })),
      el('div', { class: 'usage' },
        el('div', { class: 'usage__track' }, this.usageBar),
        el('div', { class: 'usage__row' }, this.usageText, this.storageNote)),
      this.filterRow,
      this.grid,
      this.empty,
      el('div', { class: 'lib__foot' },
        el('button', {
          type: 'button', class: 'linkbtn linkbtn--danger', text: 'Vaciar la carpeta local',
          onclick: () => this._clearAll(),
        })));

    library.addEventListener('change', () => { if (this.app.current === 'library') this.render(); });
  }

  _paintFilters() {
    for (const b of this.filterRow.children) b.classList.toggle('is-active', b.dataset.value === this.filter);
  }

  async activate() { await this.render(); }

  deactivate() { this._releaseUrls(); }

  _releaseUrls() {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }

  async render() {
    this.items = await library.list();
    const shown = this.items.filter((i) => this.filter === 'all' || i.kind === this.filter);

    this.empty.hidden = this.items.length > 0;
    this.grid.hidden = this.items.length === 0;
    this.filterRow.hidden = this.items.length === 0;

    // Los object URL del repintado anterior se sueltan aquí: sin esto cada
    // recarga de la cuadrícula dejaría una copia viva de cada miniatura.
    this._releaseUrls();
    clear(this.grid);
    // Las miniaturas se leen en paralelo; en serie, una biblioteca grande
    // tardaría un segundo largo en aparecer.
    const tiles = await Promise.all(shown.map((item) => this._tile(item)));
    this.grid.append(...tiles);

    const u = await library.usage();
    const pct = u.quota ? Math.min(100, (u.used / u.quota) * 100) : 0;
    this.usageBar.style.width = pct + '%';
    this.usageText.textContent = u.quota
      ? `${u.count} archivo${u.count === 1 ? '' : 's'} · ${formatBytes(u.own)} de ${formatBytes(u.quota)} disponibles`
      : `${u.count} archivo${u.count === 1 ? '' : 's'} · ${formatBytes(u.own)}`;
    this.storageNote.textContent = u.mode === 'opfs'
      ? 'Carpeta local del dispositivo'
      : 'Almacenamiento del navegador';
  }

  async _tile(item) {
    const img = el('img', { class: 'tile__img', alt: '', loading: 'lazy', decoding: 'async' });
    const thumb = await library.getThumbBlob(item.id);
    if (thumb) {
      const url = URL.createObjectURL(thumb);
      this.urls.set(item.id, url);
      img.src = url;
    }

    const film = item.filmId ? getFilm(item.filmId) : null;
    const badges = el('div', { class: 'tile__badges' },
      item.kind === 'video' ? el('span', { class: 'tile__badge', text: this._duration(item.durationMs) }) : null,
      film && film.id !== 'neutral' ? el('span', { class: 'tile__badge tile__badge--film', text: film.name }) : null);

    return el('button', {
      type: 'button', class: 'tile', dataset: { id: item.id },
      onclick: () => this._openItem(item),
      oncontextmenu: (e) => { e.preventDefault(); this._actions(item); },
    }, img, badges,
      el('span', { class: 'tile__info' }, `${item.width}×${item.height}`),
      el('span', {
        class: 'tile__more', 'aria-label': 'Opciones',
        onclick: (e) => { e.stopPropagation(); this._actions(item); },
      }, '⋯'));
  }

  _duration(ms) {
    const s = Math.round((ms || 0) / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  _openItem(item) {
    haptic();
    this.app.openInLab(item);
  }

  _actions(item) {
    haptic();
    const film = item.filmId ? getFilm(item.filmId) : null;
    const when = new Date(item.createdAt).toLocaleString('es-ES', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    const sheet = this.app.sheet(item.kind === 'video' ? 'Vídeo' : 'Foto', [
      el('dl', { class: 'meta' },
        this._metaRow('Dimensiones', `${item.width}×${item.height}`),
        this._metaRow('Tamaño', formatBytes(item.size)),
        this._metaRow('Emulsión', film ? `${film.brand} ${film.name}` : '—'),
        this._metaRow('Origen', item.origin === 'camara' ? 'Cámara' : item.origin === 'importado' ? 'Importado' : 'Laboratorio'),
        this._metaRow('Fecha', when),
        item.kind === 'video' ? this._metaRow('Duración', this._duration(item.durationMs)) : null),
      el('div', { class: 'sheet__actions sheet__actions--stack' },
        el('button', {
          type: 'button', class: 'btn btn--primary',
          text: item.kind === 'video' ? 'Revelar en el laboratorio' : 'Abrir en el laboratorio',
          onclick: () => { sheet.close(); this.app.openInLab(item); },
        }),
        el('button', {
          type: 'button', class: 'btn', text: 'Guardar en el dispositivo',
          onclick: async () => {
            sheet.close();
            await this._download(item);
          },
        }),
        el('button', {
          type: 'button', class: 'btn btn--danger', text: 'Eliminar',
          onclick: async () => {
            sheet.close();
            if (await confirmDialog('¿Eliminar este archivo de la carpeta local? No se puede deshacer.', { confirmLabel: 'Eliminar', danger: true })) {
              await library.remove(item.id);
              toast('Eliminado');
              this.render();
            }
          },
        })),
    ]);
  }

  _metaRow(label, value) {
    if (value == null) return null;
    return el('div', { class: 'meta__row' }, el('dt', { text: label }), el('dd', { text: value }));
  }

  async _download(item) {
    this.app.setBusy(true, 'Preparando el archivo…');
    try {
      const file = await library.getFile(item.id);
      if (!file) throw new Error('El archivo ya no está en la carpeta local');
      const ext = (item.name.split('.').pop() || 'jpg');
      const name = timestampName(item.kind === 'video' ? 'video' : 'foto', ext, item.filmName);
      const result = await saveFile(file, name);
      if (result === 'downloaded') toast('Descargado');
    } catch (err) {
      toast('No se pudo guardar: ' + (err?.message || err), { error: true });
    } finally {
      this.app.setBusy(false);
    }
  }

  async _clearAll() {
    if (!this.items.length) return toast('La carpeta ya está vacía');
    const ok = await confirmDialog(
      `¿Eliminar los ${this.items.length} archivos de la carpeta local? No se puede deshacer.`,
      { confirmLabel: 'Vaciar', danger: true });
    if (!ok) return;
    this.app.setBusy(true, 'Vaciando…');
    try {
      await library.clear();
      toast('Carpeta vacía');
      await this.render();
    } finally {
      this.app.setBusy(false);
    }
  }
}
