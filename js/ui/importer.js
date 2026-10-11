/**
 * importer.js — El menú de importación.
 *
 * Se eligen fotos sueltas, una carpeta o una tarjeta de memoria o disco
 * externo entero (o se sueltan encima), se ven en miniatura y se marca cuáles
 * entran en la biblioteca: una a una, todas o ninguna. Las que ya se importaron
 * antes salen avisadas y desmarcadas, para no duplicarlas al volver a meter la
 * misma tarjeta.
 *
 * En una tarjeta puede haber cientos de archivos: las miniaturas se hacen sólo
 * cuando su casilla está a la vista, de tres en tres, y de los RAW no se revela
 * nada: se usa la vista previa que llevan dentro.
 */

import { el, clear, toast, haptic } from '../utils/dom.js';
import { library, formatBytes } from '../store/library.js';
import { clasificar, miniaturaRapida } from '../store/preview.js';
import { importarArchivo, firmasImportadas, firma } from '../store/importar.js';
import { isIOS } from '../utils/share.js';

// Sin .heic a propósito: con «image/*» a secas, el iPhone convierte sus HEIC a
// JPEG al elegirlos, que se abren en cualquier navegador; pedir HEIC
// explícitamente hace que los entregue tal cual.
export const ACEPTA = 'image/*,video/*,.arw,.ARW,.sr2,.SR2,.srf,.SRF,image/x-sony-arw';
const A_LA_VEZ = 3;

const comparar = new Intl.Collator('es', { numeric: true, sensitivity: 'base' }).compare;

export class Importer {
  /** @param {object} app el armazón: setBusy, go, openInLab… */
  constructor(app) {
    this.app = app;
    this.cands = [];
    this.ignorados = 0;
    this.abierto = false;
    this.importando = false;
    this.cola = [];
    this.activas = 0;
    this.ultimo = -1;
    this._build();
  }

  /* ─────────────────────────────── Interfaz ──────────────────────────── */

  _build() {
    const oculto = { class: 'visually-hidden', tabindex: -1, 'aria-hidden': 'true' };
    this.inputArchivos = el('input', { type: 'file', multiple: true, accept: ACEPTA, ...oculto });
    this.inputCarpeta = el('input', { type: 'file', ...oculto });
    // Elige una carpeta entera, con todo lo que tenga dentro: una de Imágenes,
    // la tarjeta de la cámara o un disco externo (en el Mac salen en la barra
    // lateral del selector, bajo Ubicaciones).
    this.inputCarpeta.setAttribute('webkitdirectory', '');
    this.inputCarpeta.multiple = true;
    for (const input of [this.inputArchivos, this.inputCarpeta]) {
      input.addEventListener('change', () => {
        const lista = [...input.files].map((file) => ({ file, ruta: file.webkitRelativePath || file.name }));
        input.value = '';
        if (lista.length) this.añadir(lista);
      });
    }

    const conCarpeta = !isIOS;
    const fuentes = () => el('div', { class: 'imp__fuentes' },
      el('button', { type: 'button', class: 'btn', onclick: () => this.inputArchivos.click() }, 'Fotos y vídeos…'),
      conCarpeta ? el('button', { type: 'button', class: 'btn', onclick: () => this.inputCarpeta.click() }, 'Carpeta o disco…') : null);

    this.resumen = el('span', { class: 'imp__resumen' });
    this.grid = el('div', { class: 'imp__grid', role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': 'Archivos para importar' });
    this.vacio = el('div', { class: 'imp__vacio' },
      el('p', { class: 'imp__vaciotit', text: conCarpeta ? 'Elige fotos, una carpeta o una tarjeta o disco externo' : 'Elige las fotos y vídeos que quieras importar' }),
      conCarpeta ? el('p', { class: 'muted', text: 'También puedes soltarlos aquí. Las carpetas se recorren enteras, con sus subcarpetas: sirve para la tarjeta de la cámara tal cual.' }) : null,
      fuentes());
    this.destino = el('div', { class: 'imp__destino' });
    this.btnImportar = el('button', { type: 'button', class: 'btn btn--primary', onclick: () => this.importar() }, 'Importar');
    this.relleno = el('span', { class: 'imp__relleno' });
    this.progTexto = el('span', { class: 'imp__progtexto' });
    this.progreso = el('div', { class: 'imp__progreso', hidden: true },
      el('div', { class: 'imp__barra' }, this.relleno),
      this.progTexto,
      el('button', { type: 'button', class: 'btn', onclick: () => { this.cancelar = true; } }, 'Detener'));

    this.root = el('div', { class: 'imp', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Importar' },
      el('div', { class: 'imp__panel' },
        el('header', { class: 'imp__bar' },
          el('h2', { class: 'imp__titulo', text: 'Importar' }),
          this.fuentesBar = fuentes(),
          el('button', { type: 'button', class: 'iconbtn imp__cerrar', 'aria-label': 'Cerrar', onclick: () => this.cerrar() }, '✕')),
        this.tools = el('div', { class: 'imp__tools' },
          this.resumen,
          el('div', { class: 'imp__selbtns' },
            el('button', { type: 'button', class: 'btn btn--ghost', onclick: () => this.seleccionar(true) }, 'Seleccionar todas'),
            el('button', { type: 'button', class: 'btn btn--ghost', onclick: () => this.seleccionar(false) }, 'Ninguna'))),
        this.grid,
        this.vacio,
        el('footer', { class: 'imp__pie' },
          this.destino,
          el('div', { class: 'imp__acciones' },
            el('button', { type: 'button', class: 'btn', onclick: () => this.cerrar() }, 'Cancelar'),
            this.btnImportar)),
        this.progreso),
      this.inputArchivos, this.inputCarpeta);
    document.body.append(this.root);

    this.io = new IntersectionObserver((entradas) => {
      for (const e of entradas) {
        const c = this.cands[Number(e.target.dataset.i)];
        if (!c) continue;
        if (e.isIntersecting) this._pedirMiniatura(c);
        else if (c.enCola) { this.cola = this.cola.filter((x) => x !== c); c.enCola = false; }
      }
    }, { root: this.grid, rootMargin: '200px 0px' });

    // En el documento y no en el menú: después de elegir con el selector del
    // sistema el foco no vuelve dentro, y Esc tiene que cerrar igual.
    document.addEventListener('keydown', (e) => {
      if (!this.abierto || document.querySelector('.sheet-backdrop')) return;
      if (e.key === 'Escape' && !this.importando) { e.preventDefault(); this.cerrar(); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && !e.target.closest('input')) {
        e.preventDefault();
        this.seleccionar(true);
      }
    });
  }

  /* ──────────────────────────── Abrir y añadir ───────────────────────── */

  /** Abre el menú, vacío o con unos archivos ya elegidos. */
  async abrir(lista = []) {
    if (!this.abierto) {
      this.abierto = true;
      this.root.hidden = false;
      document.body.classList.add('is-importing');
      this._pintar();
      this._pintarDestino();
    }
    if (lista.length) await this.añadir(lista);
  }

  /** Añade archivos (de un selector o de lo soltado), sin repetir los que ya estaban. */
  async añadir(lista) {
    if (!this.abierto) return this.abrir(lista);
    const ya = await firmasImportadas();
    const vistos = new Set(this.cands.map((c) => c.ruta + '|' + c.file.size));
    let nuevos = 0;
    for (const { file, ruta } of lista) {
      const tipo = clasificar(file);
      if (!tipo) { if (!file.name.startsWith('.')) this.ignorados++; continue; }
      const clave = ruta + '|' + file.size;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      const dup = ya.has(firma(file.name, file.size));
      const corte = ruta.lastIndexOf('/');
      this.cands.push({ file, ruta, dir: corte > 0 ? ruta.slice(0, corte) : '', tipo, dup, sel: !dup });
      nuevos++;
    }
    // Por carpeta y, dentro, por nombre con los números en orden (DSC9 antes que DSC10).
    this.cands.sort((a, b) => comparar(a.dir, b.dir) || comparar(a.file.name, b.file.name));
    this.cands.forEach((c, i) => { c.i = i; });
    if (!nuevos && lista.length) toast(this.ignorados ? 'No hay fotos ni vídeos que importar ahí' : 'Ya estaban en la lista');
    this._pintar();
    this._pintarDestino();
  }

  cerrar() {
    if (this.importando) return;
    if (this.subcarpeta) delete this.subcarpeta.dataset.editada;
    this.abierto = false;
    this.root.hidden = true;
    document.body.classList.remove('is-importing');
    this.io.disconnect();
    for (const c of this.cands) if (c.url) URL.revokeObjectURL(c.url);
    this.cands = [];
    this.cola = [];
    this.ignorados = 0;
    this.ultimo = -1;
    clear(this.grid);
  }

  /* ─────────────────────────────── Cuadrícula ────────────────────────── */

  _pintar() {
    const hay = this.cands.length > 0;
    this.grid.hidden = !hay;
    this.tools.hidden = !hay;
    this.fuentesBar.hidden = !hay;
    this.vacio.hidden = hay;
    this.io.disconnect();
    clear(this.grid);
    const variasCarpetas = new Set(this.cands.map((c) => c.dir)).size > 1;
    let dir = null;
    const frag = document.createDocumentFragment();
    for (const c of this.cands) {
      if (variasCarpetas && c.dir !== dir) {
        dir = c.dir;
        const delGrupo = this.cands.filter((x) => x.dir === dir);
        frag.append(el('div', { class: 'imp__grupo' },
          el('span', { class: 'imp__grupotit', text: dir || 'Sueltas' }),
          el('button', {
            type: 'button', class: 'linkbtn',
            onclick: () => { const todas = delGrupo.every((x) => x.sel); for (const x of delGrupo) this._marcar(x, !todas); this._pintarResumen(); },
          }, `${delGrupo.length} · marcar o desmarcar`)));
      }
      c.tile ||= this._tile(c);
      c.tile.dataset.i = c.i;   // al añadir más archivos cambia el orden
      frag.append(c.tile);
    }
    this.grid.append(frag);
    for (const c of this.cands) this.io.observe(c.tile);
    this._pintarResumen();
  }

  _tile(c) {
    const badge = (t, extra = '') => el('span', { class: 'imp__badge' + extra, text: t });
    const tile = el('button', {
      type: 'button', class: 'imp__item' + (c.sel ? ' is-selected' : ''), role: 'option',
      'aria-selected': String(c.sel), title: c.ruta, dataset: { i: c.i },
      onclick: (e) => this._clic(c, e),
    },
      el('span', { class: 'imp__mini' },
        c.tipo === 'video' ? el('span', { class: 'imp__icono', text: '▶' }) : el('img', { alt: '', decoding: 'async' })),
      el('span', { class: 'imp__check', 'aria-hidden': 'true' }),
      el('span', { class: 'imp__badges' },
        c.tipo === 'raw' ? badge('RAW') : c.tipo === 'video' ? badge('Vídeo') : null,
        c.dup ? badge('Ya importada', ' imp__badge--dup') : null),
      el('span', { class: 'imp__nombre', text: c.file.name }));
    return tile;
  }

  /** Clic marca o desmarca; con Mayúsculas, todo el tramo desde el anterior. */
  _clic(c, e) {
    haptic();
    const i = this.cands.indexOf(c);
    if (e.shiftKey && this.ultimo >= 0 && this.ultimo !== i) {
      const valor = !c.sel;
      const [a, b] = [Math.min(i, this.ultimo), Math.max(i, this.ultimo)];
      for (let k = a; k <= b; k++) this._marcar(this.cands[k], valor);
    } else {
      this._marcar(c, !c.sel);
    }
    this.ultimo = i;
    this._pintarResumen();
  }

  _marcar(c, valor) {
    c.sel = valor;
    c.tile?.classList.toggle('is-selected', valor);
    c.tile?.setAttribute('aria-selected', String(valor));
  }

  seleccionar(valor) {
    for (const c of this.cands) this._marcar(c, valor);
    haptic();
    this._pintarResumen();
  }

  _pintarResumen() {
    const sel = this.cands.filter((c) => c.sel);
    const bytes = sel.reduce((n, c) => n + c.file.size, 0);
    const dups = this.cands.filter((c) => c.dup).length;
    this.resumen.textContent = `${sel.length} de ${this.cands.length} seleccionadas · ${formatBytes(bytes)}`
      + (dups ? ` · ${dups} ya importada${dups === 1 ? '' : 's'}` : '')
      + (this.ignorados === 1 ? ' · 1 archivo que no es foto ni vídeo'
        : this.ignorados ? ` · ${this.ignorados} archivos que no son fotos ni vídeos` : '');
    this.btnImportar.textContent = sel.length ? `Importar ${sel.length}` : 'Importar';
    this.btnImportar.disabled = !sel.length || this.importando;
  }

  /* ─────────────────────────────── Miniaturas ────────────────────────── */

  _pedirMiniatura(c) {
    if (c.url || c.enCola || c.hecha || c.tipo === 'video') return;
    c.enCola = true;
    this.cola.push(c);
    this._bombear();
  }

  _bombear() {
    while (this.activas < A_LA_VEZ && this.cola.length) {
      const c = this.cola.shift();
      c.enCola = false;
      c.hecha = true;
      this.activas++;
      miniaturaRapida(c.file, c.tipo)
        .then((lienzo) => (lienzo ? new Promise((r) => lienzo.toBlob((b) => { lienzo.width = lienzo.height = 0; r(b); }, 'image/jpeg', 0.8)) : null))
        .then((blob) => {
          if (!this.abierto || !this.cands.includes(c)) return;
          if (blob) {
            c.url = URL.createObjectURL(blob);
            c.tile.querySelector('img').src = c.url;
          } else {
            c.tile.querySelector('.imp__mini').replaceChildren(el('span', { class: 'imp__icono', text: c.file.name.split('.').pop().toUpperCase() }));
          }
        })
        .catch(() => {
          c.tile?.querySelector('.imp__mini')?.replaceChildren(el('span', { class: 'imp__icono', text: c.file.name.split('.').pop().toUpperCase() }));
        })
        .finally(() => { this.activas--; this._bombear(); });
    }
  }

  /* ─────────────────────────────── Destino ───────────────────────────── */

  /** Nombre de la subcarpeta que se propone: la fecha y la carpeta de origen. */
  _subPorDefecto() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const fecha = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const raices = new Set(this.cands.map((c) => c.ruta.split('/')[0]).filter((r, _, a) => a.length && r));
    const origen = raices.size === 1 && this.cands.some((c) => c.ruta.includes('/')) ? [...raices][0] : 'Importadas';
    return `${fecha} ${origen}`;
  }

  async _pintarDestino() {
    const estado = await library.estadoCarpeta();
    // Lo que se haya escrito a mano en el nombre de la carpeta no se pisa.
    const escrita = this.subcarpeta?.dataset.editada ? this.subcarpeta.value : null;
    this.subcarpeta = null;
    if (estado === 'lista' || estado === 'permiso') {
      this.subcarpeta = el('input', {
        type: 'text', class: 'field imp__sub', value: escrita ?? this._subPorDefecto(), maxlength: 80,
        'aria-label': 'Carpeta donde se guardan',
      });
      if (escrita !== null) this.subcarpeta.dataset.editada = '1';
      this.subcarpeta.addEventListener('input', () => { this.subcarpeta.dataset.editada = '1'; });
      clear(this.destino).append(el('span', { class: 'imp__destinotxt', text: `Se guardan en ${library.nombreCarpeta()} ›` }), this.subcarpeta);
    } else if (estado === 'ninguna') {
      clear(this.destino).append(
        el('span', { class: 'imp__destinotxt', text: 'Se guardan en la biblioteca de este navegador.' }),
        el('button', {
          type: 'button', class: 'linkbtn',
          onclick: async () => { await this.app.views.library.elegirCarpeta(); this._pintarDestino(); },
        }, 'Guardarlas en Imágenes…'));
    } else {
      clear(this.destino).append(el('span', { class: 'imp__destinotxt', text: 'Se guardan en la biblioteca de la app.' }));
    }
  }

  /* ─────────────────────────────── Importar ──────────────────────────── */

  async importar() {
    const elegidos = this.cands.filter((c) => c.sel);
    if (!elegidos.length || this.importando) return;
    // Si la carpeta pide permiso, este toque es el momento de pedirlo.
    if (await library.estadoCarpeta() === 'permiso') await library.pedirPermisoCarpeta();
    const carpeta = this.subcarpeta?.value.trim() || null;

    this.importando = true;
    this.cancelar = false;
    this.progreso.hidden = false;
    this.root.classList.add('is-busy');
    this._pintarResumen();
    let hechas = 0;
    let fallos = 0;
    let heic = 0;
    let primero = null;
    try {
      await library.enLote(async () => {
        for (const [n, c] of elegidos.entries()) {
          if (this.cancelar) break;
          this.progTexto.textContent = `Importando ${n + 1} de ${elegidos.length} · ${c.file.name}`;
          try {
            const item = await importarArchivo(c.file, { carpeta, ruta: c.ruta });
            primero ||= item;
            hechas++;
          } catch (err) {
            console.error(err);
            fallos++;
            if (/\.hei[cf]$/i.test(c.file.name)) heic++;
          }
          this.relleno.style.width = `${((n + 1) / elegidos.length) * 100}%`;
        }
      });
    } finally {
      this.importando = false;
      this.progreso.hidden = true;
      this.relleno.style.width = '0';
      this.root.classList.remove('is-busy');
    }
    if (heic) {
      // Chrome no lee HEIC (el formato de las fotos del iPhone); Safari, sí.
      toast(`${heic} foto${heic === 1 ? '' : 's'} HEIC no se pudo abrir: este navegador no lee HEIC. En Safari sí, o expórtalas como JPEG.`
        + (fallos > heic ? ` Y ${fallos - heic} archivo${fallos - heic === 1 ? '' : 's'} más no se pudo importar.` : ''), { error: true, ms: 7000 });
    } else if (fallos) toast(`${fallos} archivo${fallos === 1 ? '' : 's'} no se pudo importar`, { error: true });
    else if (this.cancelar && hechas < elegidos.length) toast(`Detenido: ${hechas} de ${elegidos.length} importadas`);
    else toast(hechas === 1 ? 'Importada' : `${hechas} archivos en la biblioteca`);
    this.cerrar();
    this.app.importados?.(hechas, primero);
  }
}
