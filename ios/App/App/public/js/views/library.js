/**
 * library.js (vista) — La carpeta local del dispositivo, vista por dentro.
 *
 * Muestra sólo miniaturas: los originales no se cargan hasta que se abren en el
 * laboratorio o se exportan. Con doscientas fotos de 12 Mpx guardadas, la
 * cuadrícula sigue siendo ligera.
 */

import { el, clear, toast, haptic, confirmDialog, isTyping } from '../utils/dom.js';
import { library, formatBytes } from '../store/library.js';
import { timestampName } from '../utils/share.js';
import { getFilm } from '../data/films.js';
import { Viewer } from '../ui/viewer.js';
import {
  hasEdits, hasColorEdits, describeEdits, fileForSaving,
  copySettings, copiedSettings, pasteInto, clearEdits, EVENTO_PORTAPAPELES,
} from '../store/develop.js';

export class LibraryView {
  constructor(app) {
    this.app = app;
    this.items = [];
    this.urls = new Map();
    this.filter = 'all';
    /** Selección múltiple: vacía significa modo normal. */
    this.selection = new Set();
    this.selecting = false;

    this.grid = el('div', { class: 'gallery' });
    this.empty = el('div', { class: 'gallery__empty' },
      el('p', { text: 'Todavía no hay nada guardado.' }),
      el('p', { class: 'muted', text: 'Lo que captures con la cámara o importes desde el dispositivo se guardará aquí, en una carpeta local que sobrevive al cierre del navegador.' }),
      el('div', { class: 'gallery__emptyactions' },
        el('button', { type: 'button', class: 'btn btn--primary', text: 'Abrir la cámara', onclick: () => this.app.go('camera') }),
        el('button', { type: 'button', class: 'btn', text: 'Importar fotos o carpetas', onclick: () => this.app.openImporter() })));

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
        el('div', { class: 'lib__baractions' },
          this.selectBtn = el('button', {
            type: 'button', class: 'btn btn--ghost', text: 'Seleccionar',
            onclick: () => this.setSelecting(!this.selecting),
          }),
          el('button', { type: 'button', class: 'btn btn--ghost', text: 'Importar', onclick: () => this.app.openImporter() }))),
      // Fotos guardadas en una carpeta de Imágenes cuyo permiso caducó: sin
      // él no se pueden abrir, y el navegador sólo lo vuelve a dar tras un toque.
      this.avisoCarpeta = el('div', { class: 'lib__aviso', hidden: true },
        this.avisoTexto = el('span'),
        el('button', {
          type: 'button', class: 'btn btn--primary', text: 'Dar acceso',
          onclick: async () => { if (await library.pedirPermisoCarpeta()) { toast('Acceso concedido'); this.render(); } },
        })),
      el('div', { class: 'usage' },
        el('div', { class: 'usage__track' }, this.usageBar),
        el('div', { class: 'usage__row' }, this.usageText, this.storageNote)),
      this.filterRow,
      this.grid,
      this.empty,
      this.selectionBar = this._buildSelectionBar(),
      el('div', { class: 'lib__foot' },
        el('button', {
          type: 'button', class: 'linkbtn linkbtn--danger', text: 'Vaciar la carpeta local',
          onclick: () => this._clearAll(),
        })));

    this.viewer = new Viewer({
      onEdit: (item) => { this.viewer.close(); this.app.openInLab(item); },
      onSave: (item) => { this.viewer.close(); this._download(item); },
      onDelete: (item) => this._deleteFromViewer(item),
    });
    // Va al body, no dentro de la vista: es una capa modal a pantalla completa,
    // y colgando de una vista con scroll acababa por debajo de la barra de
    // pestañas, que le comía los botones de abajo.
    document.body.append(this.viewer.root);

    // Durante un lote (pegar ajustes en cien fotos) cada foto avisa de su
    // cambio, y repintar la cuadrícula entera cien veces la haría ir a tirones:
    // se repinta una vez al final, y mientras tanto cambian sólo las casillas.
    library.addEventListener('change', () => {
      if (this.app.current === 'library' && !this._lote) this.render();
    });
    library.addEventListener('thumb', (e) => this._refreshThumb(e.detail.id));
    library.addEventListener('carpeta', () => { if (this.app.current === 'library') this.render(); });
    globalThis.addEventListener?.(EVENTO_PORTAPAPELES, () => this._paintSelection());
    document.addEventListener('keydown', (e) => this._onKey(e));
  }

  /**
   * Atajos de teclado del Mac en la selección: ⌘A todo, ⌘C copia los ajustes
   * de la única foto elegida y ⌘V los pega en todas las elegidas.
   */
  _onKey(e) {
    if (this.app.current !== 'library' || !this.selecting) return;
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    if (isTyping(e.target)) return;
    if (document.querySelector('.sheet-backdrop') || !this.viewer.root.hidden) return;
    const k = e.key.toLowerCase();
    if (k === 'a') { e.preventDefault(); this.selectAllShown(); }
    else if (k === 'c' && this.selection.size === 1) {
      e.preventDefault();
      this._copy(this.items.find((i) => i.id === [...this.selection][0]));
    } else if (k === 'v' && this.selection.size) { e.preventDefault(); this._pasteSelection(); }
  }

  /* ───────────────────────── Selección múltiple ─────────────────────── */

  _buildSelectionBar() {
    this.selCount = el('span', { class: 'selbar__count' });
    return el('div', { class: 'selbar', hidden: true, role: 'toolbar', 'aria-label': 'Acciones sobre la selección' },
      el('div', { class: 'selbar__info' },
        this.selCount,
        el('button', {
          type: 'button', class: 'linkbtn', text: 'Todo',
          onclick: () => this.selectAllShown(),
        }),
        el('button', {
          type: 'button', class: 'linkbtn', text: 'Ninguno',
          onclick: () => { this.selection.clear(); this._paintSelection(); },
        })),
      el('div', { class: 'selbar__actions' },
        el('button', {
          type: 'button', class: 'btn btn--primary', text: 'Guardar',
          onclick: () => this._saveSelection(),
        }),
        this.pasteBtn = el('button', {
          type: 'button', class: 'btn', text: 'Pegar ajustes',
          title: 'Pega en las fotos elegidas los ajustes de color copiados',
          onclick: () => this._pasteSelection(),
        }),
        el('button', {
          type: 'button', class: 'btn btn--danger', text: 'Eliminar',
          onclick: () => this._deleteSelection(),
        })));
  }

  setSelecting(on) {
    this.selecting = on;
    if (!on) this.selection.clear();
    this.selectBtn.textContent = on ? 'Hecho' : 'Seleccionar';
    this.selectBtn.classList.toggle('is-active', on);
    this.root.classList.toggle('is-selecting', on);
    haptic();
    this._paintSelection();
  }

  toggleSelected(id) {
    if (this.selection.has(id)) this.selection.delete(id);
    else this.selection.add(id);
    haptic();
    this._paintSelection();
  }

  selectAllShown() {
    for (const it of this._shown()) this.selection.add(it.id);
    haptic();
    this._paintSelection();
  }

  _shown() {
    return this.items.filter((i) => this.filter === 'all' || i.kind === this.filter);
  }

  _paintSelection() {
    const n = this.selection.size;
    this.selectionBar.hidden = !this.selecting;
    this.selCount.textContent = n === 0 ? 'Nada seleccionado'
      : n === 1 ? '1 seleccionado' : `${n} seleccionados`;
    for (const btn of this.selectionBar.querySelectorAll('.btn')) btn.disabled = n === 0;
    // Sin nada copiado, pegar no puede hacer nada: se ve, pero apagado.
    if (!copiedSettings()) this.pasteBtn.disabled = true;
    for (const tile of this.grid.children) {
      const on = this.selection.has(tile.dataset.id);
      tile.classList.toggle('is-selected', on);
      tile.setAttribute('aria-pressed', String(on));
    }
  }

  /**
   * Prepara los archivos elegidos y los ofrece al sistema.
   *
   * Leer del disco va antes del toque que abre la hoja de compartir, así que se
   * hace aquí y la hoja siguiente pide un toque nuevo: si se encadenaran, la
   * activación habría caducado y en iPhone no se guardaría nada.
   */
  async _saveSelection() {
    const ids = [...this.selection];
    if (!ids.length) return;
    this.app.setBusy(true, ids.length > 1 ? `Preparando ${ids.length} archivos…` : 'Preparando…');
    const blobs = [];
    const names = [];
    let missing = 0;
    try {
      for (const [n, id] of ids.entries()) {
        // Del almacén y no de la cuadrícula: los ajustes pueden haber cambiado
        // en el laboratorio después del último repintado.
        const item = await library.get(id);
        if (item && hasEdits(item.params) && item.kind === 'photo') {
          this.app.setBusy(true, ids.length > 1 ? `Revelando ${n + 1} de ${ids.length}…` : 'Revelando a resolución completa…');
        }
        const out = item ? await fileForSaving(item) : null;
        if (!out) { missing++; continue; }
        blobs.push(out.blob);
        names.push(this._fileName(item, out, ids.length > 1 ? blobs.length - 1 : null));
      }
    } catch (err) {
      toast('No se pudo preparar: ' + (err?.message || err), { error: true });
      return;
    } finally {
      this.app.setBusy(false);
    }
    if (missing) toast(`${missing} archivo(s) ya no están en la carpeta local`, { error: true });
    if (!blobs.length) return;
    this.app.presentSave(blobs, names, {
      title: blobs.length > 1 ? `${blobs.length} archivos` : names[0],
      detail: blobs.length > 1 ? `${blobs.length} archivos` : null,
    });
  }

  /**
   * Borrado desde el visor: la foto se está mirando a pantalla completa, así
   * que al confirmarla desaparece y el visor sigue con la siguiente en vez de
   * cerrarse y devolver a la cuadrícula.
   */
  async _deleteFromViewer(item) {
    if (!item) return;
    const ok = await confirmDialog(
      item.kind === 'video'
        ? '¿Eliminar este vídeo de la carpeta local? No se puede deshacer.'
        : '¿Eliminar esta foto de la carpeta local? No se puede deshacer.',
      { confirmLabel: 'Eliminar', danger: true });
    if (!ok) return;
    await library.remove(item.id);
    this.selection.delete(item.id);
    toast('Eliminado');
    await this.viewer.dropCurrent();
    await this.render();
  }

  async _deleteSelection() {
    const ids = [...this.selection];
    if (!ids.length) return;
    const ok = await confirmDialog(
      ids.length === 1
        ? '¿Eliminar este archivo de la carpeta local? No se puede deshacer.'
        : `¿Eliminar ${ids.length} archivos de la carpeta local? No se puede deshacer.`,
      { confirmLabel: 'Eliminar', danger: true });
    if (!ok) return;
    this.app.setBusy(true, 'Eliminando…');
    try {
      for (const id of ids) await library.remove(id);
      this.selection.clear();
      toast(ids.length === 1 ? 'Eliminado' : `${ids.length} eliminados`);
      await this.render();
    } finally {
      this.app.setBusy(false);
    }
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

  /**
   * Repinta la cuadrícula. Las pasadas van de una en una: al volver del
   * laboratorio llegan casi a la vez la de entrar en la vista y la del aviso
   * de que se guardaron los ajustes, y dos pasadas solapadas añadían cada una
   * sus casillas a la misma cuadrícula. Si se pide otra mientras tanto, se hace
   * una más al terminar, con lo último.
   */
  render() {
    if (this._pintando) { this._otraVez = true; return this._pintando; }
    this._pintando = (async () => {
      try {
        do { this._otraVez = false; await this._paint(); } while (this._otraVez);
      } finally {
        this._pintando = null;
      }
    })();
    return this._pintando;
  }

  async _paint() {
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
    await this._pintarAlmacen(u);

    // La selección puede haber quedado con elementos ya borrados.
    for (const id of [...this.selection]) {
      if (!this.items.some((i) => i.id === id)) this.selection.delete(id);
    }
    this._paintSelection();
  }

  /**
   * Dónde se guardan los originales. En el ordenador, con Chrome o Edge, se
   * ofrece llevarlos a una carpeta de Imágenes; si ya están allí, se dice cuál,
   * y si el permiso caducó, se pide de nuevo.
   */
  async _pintarAlmacen(u) {
    const estado = await library.estadoCarpeta();
    const nombre = library.nombreCarpeta();
    this.avisoCarpeta.hidden = estado !== 'permiso';
    if (estado === 'permiso') {
      this.avisoTexto.textContent = `Las fotos están en «${nombre}». Para abrirlas en esta sesión, da acceso otra vez a esa carpeta.`;
    }
    if (estado === 'lista' || estado === 'permiso') {
      clear(this.storageNote).append(el('span', { text: `En ${nombre}` }));
    } else if (estado === 'ninguna') {
      clear(this.storageNote).append(
        el('span', { text: u.mode === 'opfs' ? 'Carpeta local del navegador · ' : 'Almacenamiento del navegador · ' }),
        el('button', { type: 'button', class: 'linkbtn', onclick: () => this.elegirCarpeta() }, 'Guardar en Imágenes…'));
    } else {
      this.storageNote.textContent = u.mode === 'opfs' ? 'Carpeta local del dispositivo' : 'Almacenamiento del navegador';
    }
  }

  /**
   * Lleva la biblioteca a una carpeta de verdad: se elige Imágenes (o la que
   * se quiera), dentro se crea «Laboratorio» y cada importación va a su
   * subcarpeta. Resuelve cuando la hoja se cierra.
   */
  elegirCarpeta() {
    return new Promise((resolve) => {
      const sheet = this.app.sheet('Guardar en una carpeta', [
        el('p', { class: 'sheet__message' },
          'Las fotos que importes, captures o reveles se guardarán como archivos normales en una carpeta de tu ordenador, ',
          'visible en el Finder. Elige ', el('strong', { text: 'Imágenes' }), ' (o la que prefieras): dentro se crea ',
          el('strong', { text: 'Laboratorio' }), ', con una carpeta por cada importación.'),
        el('p', { class: 'sheet__hint', text: 'Las miniaturas y los ajustes siguen guardados en la app. El navegador te pedirá permiso para usar esa carpeta.' }),
        el('div', { class: 'sheet__actions' },
          el('button', { type: 'button', class: 'btn', text: 'Ahora no', onclick: () => { sheet.close(); resolve(false); } }),
          el('button', {
            type: 'button', class: 'btn btn--primary', text: 'Elegir carpeta…',
            onclick: async () => {
              try {
                const nombre = await library.elegirCarpeta();
                sheet.close();
                toast(`Se guardarán en ${nombre}`);
                await this._ofrecerMover();
                this.render();
                resolve(true);
              } catch (err) {
                if (err?.name === 'AbortError') return;   // cerró el selector sin elegir
                toast(err?.message || String(err), { error: true });
              }
            },
          })),
      ]);
    });
  }

  /** Si había fotos guardadas en el navegador, ofrece pasarlas también a la carpeta. */
  async _ofrecerMover() {
    const privadas = (await library.list()).filter((i) => i.storage !== 'carpeta').length;
    if (!privadas) return;
    const ok = await confirmDialog(
      `Ya hay ${privadas} archivo${privadas === 1 ? '' : 's'} guardado${privadas === 1 ? '' : 's'} en el navegador. ¿Pasarlos también a «${library.nombreCarpeta()}»?`,
      { confirmLabel: 'Pasarlos' });
    if (!ok) return;
    this.app.setBusy(true, 'Pasando a la carpeta…');
    try {
      const n = await library.moverACarpeta((h, t) => this.app.setBusy(true, `Pasando a la carpeta… ${h} de ${t}`));
      toast(`${n} archivo${n === 1 ? '' : 's'} en ${library.nombreCarpeta()}`);
    } catch (err) {
      toast('No se pudieron pasar: ' + (err?.message || err), { error: true });
    } finally {
      this.app.setBusy(false);
    }
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
    // Lo editado en el laboratorio manda sobre la emulsión con la que se hizo:
    // es lo que enseña la miniatura y lo que se guardará.
    const editada = describeEdits(item.params);
    const badges = el('div', { class: 'tile__badges' },
      item.kind === 'video' ? el('span', { class: 'tile__badge', text: this._duration(item.durationMs) }) : null,
      editada ? el('span', { class: 'tile__badge tile__badge--film tile__badge--edit', text: editada })
        : film && film.id !== 'neutral' ? el('span', { class: 'tile__badge tile__badge--film', text: film.name }) : null);

    return el('button', {
      type: 'button', class: 'tile', dataset: { id: item.id },
      onclick: () => {
        if (this.selecting) this.toggleSelected(item.id);
        else this._openItem(item);
      },
      // Mantener pulsado entra en selección múltiple con ese elemento ya
      // marcado, que es como se espera en cualquier galería.
      oncontextmenu: (e) => {
        e.preventDefault();
        if (!this.selecting) { this.setSelecting(true); this.toggleSelected(item.id); }
        else this._actions(item);
      },
    }, img, badges,
      el('span', { class: 'tile__check', 'aria-hidden': 'true' }),
      el('span', { class: 'tile__info' }, item.dimsAprox ? 'RAW' : `${item.width}×${item.height}`),
      el('span', {
        class: 'tile__more', 'aria-label': 'Opciones',
        onclick: (e) => { e.stopPropagation(); this._actions(item); },
      }, '⋯'));
  }

  /** Cambia la imagen de una casilla sin repintar la cuadrícula. */
  async _refreshThumb(id) {
    if (this.app.current !== 'library') return;
    // A media pasada la casilla puede no existir todavía, o estar a punto de
    // sustituirse por una con la miniatura vieja: otra pasada al terminar.
    if (this._pintando) { this._otraVez = true; return; }
    const tile = [...this.grid.children].find((t) => t.dataset.id === id);
    if (!tile) return;
    const blob = await library.getThumbBlob(id);
    if (!blob || !tile.isConnected) return;
    const old = this.urls.get(id);
    const url = URL.createObjectURL(blob);
    this.urls.set(id, url);
    tile.querySelector('.tile__img').src = url;
    if (old) URL.revokeObjectURL(old);
  }

  _duration(ms) {
    const s = Math.round((ms || 0) / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  /**
   * Tocar una miniatura abre el visor, no el laboratorio.
   *
   * Casi siempre lo que se quiere es MIRAR la foto; editarla es una decisión
   * posterior, y desde el visor está a un botón. Mandar directo al laboratorio
   * obligaba a cargar el proxy y montar los paneles para algo que a menudo era
   * sólo un vistazo.
   */
  _openItem(item) {
    haptic();
    const visibles = this._shown();
    this.viewer.open(visibles, visibles.findIndex((i) => i.id === item.id));
  }

  _actions(item) {
    haptic();
    const film = item.filmId ? getFilm(item.filmId) : null;
    const foto = item.kind === 'photo';
    const editada = foto && hasEdits(item.params);
    const copiado = foto ? copiedSettings() : null;
    const when = new Date(item.createdAt).toLocaleString('es-ES', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    const sheet = this.app.sheet(item.kind === 'video' ? 'Vídeo' : 'Foto', [
      el('dl', { class: 'meta' },
        this._metaRow('Dimensiones', item.dimsAprox ? 'RAW (se mide al abrirlo)' : `${item.width}×${item.height}`),
        item.storage === 'carpeta' ? this._metaRow('Archivo', `${library.nombreCarpeta()} › ${item.ruta.replace('/', ' › ')}`) : null,
        item.fuente?.ruta && item.fuente.ruta !== item.fuente.nombre ? this._metaRow('Origen del archivo', item.fuente.ruta) : null,
        this._metaRow('Tamaño', formatBytes(item.size)),
        this._metaRow('Emulsión', film ? `${film.brand} ${film.name}` : '—'),
        foto ? this._metaRow('Ajustes', describeEdits(item.params) || 'Ninguno') : null,
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
          type: 'button', class: 'btn', text: editada ? 'Guardar con los ajustes' : 'Guardar en el dispositivo',
          onclick: async () => {
            sheet.close();
            await this._download(item);
          },
        }),
        editada ? el('button', {
          type: 'button', class: 'btn', text: 'Guardar el original',
          onclick: async () => {
            sheet.close();
            await this._download(item, { original: true });
          },
        }) : null,
        foto ? el('div', { class: 'sheet__actions sheet__actions--pair' },
          el('button', {
            type: 'button', class: 'btn', text: 'Copiar ajustes',
            disabled: !hasColorEdits(item.params),
            onclick: () => { sheet.close(); this._copy(item); },
          }),
          el('button', {
            type: 'button', class: 'btn', text: 'Pegar ajustes',
            disabled: !copiado,
            onclick: () => { sheet.close(); this._paste([item], copiado); },
          })) : null,
        editada ? el('button', {
          type: 'button', class: 'btn', text: 'Quitar los ajustes',
          onclick: async () => {
            sheet.close();
            if (!await confirmDialog('¿Quitar los ajustes de esta foto? Vuelve a ser el original.', { confirmLabel: 'Quitar' })) return;
            await clearEdits(item);
            toast('Ajustes quitados');
          },
        }) : null,
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

  /**
   * Guarda un elemento fuera de la app. Una foto con ajustes sale revelada con
   * ellos, a resolución completa: lo que se ve en la biblioteca es lo que se
   * guarda. `original` saca el archivo tal como entró.
   */
  async _download(item, { original = false } = {}) {
    this.app.setBusy(true, 'Preparando el archivo…');
    try {
      item = (await library.get(item.id)) || item;
      if (!original && item.kind === 'photo' && hasEdits(item.params)) {
        this.app.setBusy(true, 'Revelando a resolución completa…');
      }
      const out = await fileForSaving(item, { original });
      if (!out) throw new Error('El archivo ya no está en la carpeta local');
      this.app.presentSave([out.blob], [this._fileName(item, out)], {
        detail: `${out.width || item.width}×${out.height || item.height}` + (out.edited ? ' · con los ajustes' : ''),
      });
    } catch (err) {
      toast('No se pudo guardar: ' + (err?.message || err), { error: true });
    } finally {
      this.app.setBusy(false);
    }
  }

  _fileName(item, out, index = null) {
    const nombre = out.edited ? describeEdits(item.params) : item.filmName;
    return timestampName(item.kind === 'video' ? 'video' : 'foto', out.ext, nombre, index);
  }

  /* ─────────────────────── Copiar y pegar ajustes ────────────────────── */

  _copy(item) {
    if (!item || !hasColorEdits(item.params)) return toast('Esta foto no tiene ajustes de color que copiar');
    copySettings(item.params);
    haptic();
    toast(`Ajustes copiados · ${describeEdits(item.params)}`);
  }

  _pasteSelection() {
    const items = [...this.selection].map((id) => this.items.find((i) => i.id === id)).filter(Boolean);
    return this._paste(items, copiedSettings());
  }

  /**
   * Pega los ajustes copiados en varias fotos. Sustituye el color que tuvieran
   * y respeta el encuadre de cada una. No hay deshacer fuera del laboratorio,
   * así que se pregunta antes si va a tocar más de una foto o a pisar una
   * edición.
   */
  async _paste(items, copiado) {
    if (!copiado) return toast('Copia antes los ajustes de una foto, aquí o en el laboratorio');
    const fotos = items.filter((i) => i.kind === 'photo');
    if (!fotos.length) return toast('Los ajustes sólo se pegan en fotos');
    const pisa = fotos.filter((i) => hasColorEdits(i.params)).length;
    const look = describeEdits(copiado.params) || 'sin ajustes';
    if (fotos.length > 1 || pisa) {
      const que = fotos.length === 1 ? 'esta foto' : `${fotos.length} fotos`;
      const aviso = pisa === 0 ? ''
        : fotos.length === 1 ? ' Sus ajustes de color se sustituyen.'
          : pisa === 1 ? ' Una ya tiene ajustes de color: se sustituyen.'
            : ` ${pisa} ya tienen ajustes de color: se sustituyen.`;
      const videos = items.length - fotos.length;
      const ok = await confirmDialog(
        `¿Pegar los ajustes «${look}» en ${que}?${aviso} El encuadre de cada una se respeta.`
          + (videos ? ` Los vídeos (${videos}) se saltan.` : ''),
        { confirmLabel: 'Pegar' });
      if (!ok) return;
    }
    this._lote = true;
    this.app.setBusy(true, fotos.length > 1 ? `Pegando ajustes… 0 de ${fotos.length}` : 'Pegando ajustes…');
    try {
      const { hechas } = await pasteInto(fotos, copiado.params, (n, total) => {
        if (total > 1) this.app.setBusy(true, `Pegando ajustes… ${n} de ${total}`);
      });
      toast(hechas === 1 ? `Ajustes pegados · ${look}` : `Ajustes pegados en ${hechas} fotos · ${look}`);
    } catch (err) {
      console.error(err);
      toast('No se pudieron pegar: ' + (err?.message || err), { error: true });
    } finally {
      this._lote = false;
      this.app.setBusy(false);
      await this.render();
    }
  }

  async _clearAll() {
    if (!this.items.length) return toast('La carpeta ya está vacía');
    const enCarpeta = this.items.filter((i) => i.storage === 'carpeta').length;
    const ok = await confirmDialog(
      `¿Eliminar los ${this.items.length} archivos de la biblioteca? No se puede deshacer.`
        + (enCarpeta ? ` Se borran también sus copias de «${library.nombreCarpeta()}» (sólo las que hizo la app; lo demás de esa carpeta no se toca).` : ''),
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
