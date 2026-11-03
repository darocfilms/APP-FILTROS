/**
 * conmutador.js — Cámara, Laboratorio y Biblioteca: cambiar de una a otra con
 * el dedo.
 *
 * La barra de pestañas es una cápsula de cristal flotante, como la de Fotos en
 * iOS 26, con una «lente» que marca la sección abierta. Además de tocar cada
 * icono, la cápsula entiende dos gestos, y hay un tercero en cualquier sitio:
 *
 *  - Deslizar de lado sobre la cápsula: la lente sigue al dedo y la sección de
 *    al lado entra deslizándose. Al soltar, o con un golpe rápido, se queda en
 *    la que esté más cerca. Es el gesto de la barra de inicio del iPhone para
 *    cambiar de app, pero entre las tres secciones.
 *
 *  - Deslizar hacia arriba desde la cápsula: la pantalla encoge siguiendo al
 *    dedo hasta convertirse en una tarjeta, con las otras dos secciones a los
 *    lados, como el selector de apps del iPhone. Sin soltar, de lado se elige;
 *    al soltar el carrusel se queda abierto y un toque entra en la tarjeta.
 *
 *  - Dos dedos hacia arriba en cualquier parte abre el mismo carrusel. Es para
 *    cuando la cápsula queda lejos del pulgar, y no choca con nada: un dedo es
 *    de los deslizadores, el encuadre y el disparador, y el pellizco cambia la
 *    distancia entre los dedos, cosa que aquí no puede pasar.
 *
 * Las tarjetas son las vistas de verdad, encogidas con transform: la cámara
 * sigue viéndose en directo dentro de la suya.
 */

import { el, haptic } from '../utils/dom.js';
import { ICONO } from './iconos.js';

export const SECCIONES = [
  { id: 'camera', label: 'Cámara', icono: ICONO.camara },
  { id: 'lab', label: 'Laboratorio', icono: ICONO.laboratorio },
  { id: 'library', label: 'Biblioteca', icono: ICONO.biblioteca },
];
const ORDEN = SECCIONES.map((s) => s.id);
const ULTIMA = ORDEN.length - 1;

/** Píxeles de dedo antes de decidir qué gesto es: por debajo es un toque. */
const UMBRAL = 10;
/** Píxeles de subida para que la pantalla llegue a tarjeta. */
const SUBIDA = 240;
/** Hueco entre tarjetas, en píxeles de pantalla. */
const HUECO = 22;
/** Duración de los asentamientos; la misma que la transición en CSS. */
const ASENTAR_MS = 380;
/** Px/ms a partir de los que un golpe de dedo cuenta como «al siguiente». */
const GOLPE = 0.35;

const limitar = (v, a, b) => Math.min(b, Math.max(a, v));
const suave = (t) => 1 - (1 - t) ** 3;

/** Más allá de la primera y la última sección el dedo tira, pero cada vez menos. */
function goma(pos) {
  if (pos < 0) return -0.22 * (1 - 1 / (1 - pos * 3));
  if (pos > ULTIMA) return ULTIMA + 0.22 * (1 - 1 / (1 + (pos - ULTIMA) * 3));
  return pos;
}

/**
 * Dónde se queda al soltar, como al pasar páginas: sin golpe, en la más
 * cercana; con golpe, en la siguiente en la dirección del dedo, aunque no se
 * haya llegado a la mitad. Nunca más de una desde donde se empezó.
 * `sentido` es +1 si la posición crece al mover el dedo a la derecha.
 */
function destinoDe(pos, inicio, v, sentido) {
  const empuje = v * sentido;
  let d = Math.abs(v) < GOLPE ? Math.round(pos)
    : empuje > 0 ? Math.ceil(pos + 0.02) : Math.floor(pos - 0.02);
  d = limitar(d, inicio - 1, inicio + 1);
  return limitar(d, 0, ULTIMA);
}

/** Velocidad en px/ms a partir de los últimos puntos del dedo. */
function velocidad(puntos) {
  if (puntos.length < 2) return { x: 0, y: 0 };
  const a = puntos[0], b = puntos[puntos.length - 1];
  const dt = Math.max(1, b.t - a.t);
  return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
}

export class Conmutador {
  constructor(app) {
    this.app = app;
    this.abierto = false;
    this.pos = 0;

    this.lente = el('span', { class: 'tabbar__lente', 'aria-hidden': 'true' });
    this.tabs = SECCIONES.map((s) => el('button', {
      type: 'button', class: 'tabbar__tab', role: 'tab',
      dataset: { tab: s.id }, 'aria-label': s.label,
      onclick: () => this.app.go(s.id),
    },
      el('span', { class: 'tabbar__icon', html: s.icono }),
      el('span', { class: 'tabbar__label', text: s.label })));
    this.root = el('nav', { class: 'tabbar', role: 'tablist', 'aria-label': 'Secciones' }, this.lente, ...this.tabs);

    this.tarjetas = SECCIONES.map((s, k) => el('button', {
      type: 'button', class: 'carrusel__tarjeta', dataset: { tab: s.id },
      'aria-label': 'Abrir ' + s.label,
      onclick: (e) => { if (!this._tragar(e)) this.elegir(k); },
    }, el('span', { class: 'carrusel__titulo' },
      el('span', { class: 'carrusel__icono', html: s.icono }),
      el('span', { text: s.label }))));
    this.capa = el('div', {
      class: 'carrusel', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Cambiar de sección',
    }, el('p', { class: 'carrusel__pista', text: 'Desliza para elegir · toca para entrar' }), ...this.tarjetas);

    this._bindCapsula();
    this._bindCarrusel();
    this._bindDosDedos();
    document.addEventListener('keydown', (e) => {
      if (this.abierto && e.key === 'Escape') { e.preventDefault(); this.elegir(this.i); }
    });
    window.addEventListener('resize', () => { if (this.abierto) this._pintar(); });
  }

  /** Pinta la cápsula para la sección abierta. La llama App.go. */
  marcar(id) {
    const k = ORDEN.indexOf(id);
    this.root.style.setProperty('--pos', String(k));
    this.root.dataset.vista = id;
    for (const t of this.tabs) {
      const on = t.dataset.tab === id;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    }
  }

  /** Tras un arrastre llega un click que no es un toque: se descarta. */
  _tragar(e) {
    if (!this._trago) return false;
    this._trago = false;
    e?.preventDefault?.();
    e?.stopPropagation?.();
    return true;
  }

  /* ───────────────────────────── La cápsula ──────────────────────────── */

  _bindCapsula() {
    const r = this.root;
    let g = null;

    r.addEventListener('pointerdown', (e) => {
      this._trago = false;
      if (e.button > 0 || this.abierto || this._ocupado) return;
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, modo: null, pts: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }] };
    });

    r.addEventListener('pointermove', (e) => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      g.pts.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
      if (g.pts.length > 5) g.pts.shift();
      if (!g.modo) {
        if (Math.hypot(dx, dy) < UMBRAL) return;
        g.modo = -dy > Math.abs(dx) ? 'subir' : Math.abs(dx) >= Math.abs(dy) ? 'pasar' : null;
        if (!g.modo) { g = null; return; }
        try { r.setPointerCapture(e.pointerId); } catch { /* el puntero ya se fue */ }
        this._trago = true;
        if (g.modo === 'pasar') this._empezarPaso();
        else this._empezarCarrusel();
      }
      e.preventDefault();
      if (g.modo === 'pasar') this._paso(dx);
      else this._subida(dx, dy);
    });

    const fin = (e) => {
      if (!g || e.pointerId !== g.id) return;
      const { modo, pts } = g;
      g = null;
      if (modo === 'pasar') this._soltarPaso(velocidad(pts).x);
      else if (modo === 'subir') this._soltarSubida(velocidad(pts));
    };
    r.addEventListener('pointerup', fin);
    r.addEventListener('pointercancel', fin);
    // En fase de captura: el click de después de un arrastre no llega al botón.
    r.addEventListener('click', (e) => this._tragar(e), true);
  }

  /* ─────────────────── De lado: la sección de al lado ────────────────── */

  /** Las vistas que no están abiertas se preparan para verse como tarjeta. */
  _prepararVecinas() {
    for (const id of ORDEN) if (id !== this.app.current) this.app.views[id].prepararTarjeta?.();
  }

  _empezarPaso() {
    this._prepararVecinas();
    this.i = ORDEN.indexOf(this.app.current);
    this.pos = this.i;
    this._entero = this.i;
    const t = this.tabs[0].getBoundingClientRect();
    const hueco = parseFloat(getComputedStyle(this.root).columnGap) || 0;
    this.pasoLente = t.width + hueco;
    this.root.classList.add('is-arrastrando');
    this.app.stack.classList.add('is-pasando');
    haptic();
  }

  _paso(dx) {
    this.pos = goma(this.i + dx / this.pasoLente);
    this.root.style.setProperty('--pos', this.pos.toFixed(3));
    this._pintarPaso(this.pos, 1);
    const cerca = limitar(Math.round(this.pos), 0, ULTIMA);
    if (cerca !== this._entero) { this._entero = cerca; haptic(6); }
  }

  /** Cada vista a su sitio: la de enfrente entera, las vecinas entrando por los lados. */
  _pintarPaso(pos, alcance) {
    ORDEN.forEach((id, k) => {
      const v = this.app.views[id].root;
      const d = k - pos;
      if (Math.abs(d) > alcance) { this._soltarVista(v); return; }
      const a = Math.min(1, Math.abs(d));
      v.style.display = 'flex';
      v.style.transform = `translate3d(${(d * 100).toFixed(3)}%, 0, 0) scale(${(1 - a * 0.08).toFixed(4)})`;
      v.style.borderRadius = `${Math.round(Math.min(1, a * 5) * 34)}px`;
    });
  }

  _soltarPaso(vx) {
    // Un golpe rápido cuenta aunque el dedo no haya llegado a la mitad.
    const destino = destinoDe(this.pos, this.i, vx, +1);
    this._asentar(() => {
      this.root.style.setProperty('--pos', String(destino));
      this._pintarPaso(destino, 1);
    }, () => {
      this.root.classList.remove('is-arrastrando');
      this._ir(destino);
    });
  }

  /* ───────────────────── Hacia arriba: el carrusel ───────────────────── */

  /** Abre el carrusel sin dedo de por medio (dos dedos, o desde código). */
  abrir() {
    if (this.abierto || this._ocupado) return;
    this._empezarCarrusel();
    this._asentar(() => {
      this.u = 1;
      this.s = this.escala;
      this._pintar();
    }, () => this._quedarAbierto());
  }

  _empezarCarrusel() {
    this._prepararVecinas();
    this.i = ORDEN.indexOf(this.app.current);
    this.pos = this.i;
    this.u = 0;
    this.crudo = 0;
    this.s = 1;
    const W = window.innerWidth;
    // En el teléfono, tarjetas de dos tercios de pantalla; en el Mac, de unos
    // 300 px de ancho, para que quepan las tres a la vista.
    this.escala = limitar(250 / W, 0.26, 0.62);
    this.app.stack.classList.add('is-carrusel');
    document.body.classList.add('is-conmutando');
    this.capa.hidden = false;
    this.root.classList.add('is-arrastrando');
    haptic();
    this._pintar();
  }

  _subida(dx, dy) {
    // Lo que ha subido el dedo, y suavizado para que la tarjeta encoja deprisa
    // al principio y frene al final, como el selector de apps.
    this.crudo = limitar(-dy / SUBIDA, 0, 1);
    const u = suave(this.crudo);
    this.u = u;
    this.s = 1 - (1 - this.escala) * u;
    // De lado, las tarjetas siguen al dedo, pero sólo cuando ya son tarjetas:
    // en el primer tramo de la subida un dedo que tiembla no cambia nada.
    const paso = window.innerWidth * this.s + HUECO;
    this.pos = goma(this.i - (dx / paso) * u);
    this._pintar();
  }

  _soltarSubida(v) {
    // Se abre si el dedo subió de verdad (un tercio del recorrido) o con un
    // golpe rápido hacia arriba; si no, vuelve a donde estaba.
    if (this.crudo > 0.3 || v.y < -0.6) {
      const destino = limitar(Math.round(this.pos), 0, ULTIMA);
      this._asentar(() => {
        this.u = 1;
        this.s = this.escala;
        this.pos = destino;
        this._pintar();
      }, () => this._quedarAbierto());
    } else {
      this.elegir(this.i);
    }
  }

  _quedarAbierto() {
    this.abierto = true;
    this.capa.classList.add('is-abierto');
    this.root.classList.remove('is-arrastrando');
    this.tarjetas[limitar(Math.round(this.pos), 0, ULTIMA)]?.focus({ preventScroll: true });
  }

  /** Entra en la tarjeta `k`: crece hasta llenar la pantalla. */
  elegir(k) {
    k = limitar(k, 0, ULTIMA);
    this.abierto = false;
    this.capa.classList.remove('is-abierto');
    this._asentar(() => {
      this.u = 0;
      this.s = 1;
      this.pos = k;
      this.root.style.setProperty('--pos', String(k));
      this._pintar();
    }, () => {
      this.root.classList.remove('is-arrastrando');
      this._ir(k);
    });
  }

  /** Las tres vistas como tarjetas, y sus títulos encima. */
  _pintar() {
    const W = window.innerWidth, H = window.innerHeight;
    const { s, u } = this;
    const paso = W * s + HUECO * u;
    const sube = -H * 0.03 * u;
    ORDEN.forEach((id, k) => {
      const v = this.app.views[id].root;
      const tx = (k - this.pos) * paso;
      // Fuera de la pantalla no hace falta pintarla.
      if (Math.abs(tx) - (W * s) / 2 > W / 2 + 4) { this._soltarVista(v); this.tarjetas[k].style.opacity = '0'; return; }
      v.style.display = 'flex';
      v.style.transform = `translate3d(${tx.toFixed(2)}px, ${sube.toFixed(2)}px, 0) scale(${s.toFixed(4)})`;
      // El radio va antes de escalar: dividido para que en pantalla mida 36 px.
      v.style.borderRadius = `${((36 * u) / s).toFixed(1)}px`;
      const t = this.tarjetas[k];
      const w = W * s, h = H * s;
      t.style.left = `${(W - w) / 2 + tx}px`;
      t.style.top = `${(H - h) / 2 + sube}px`;
      t.style.width = `${w}px`;
      t.style.height = `${h}px`;
      t.style.opacity = String(u);
      t.classList.toggle('is-centro', Math.abs(k - this.pos) < 0.5);
    });
    this.capa.style.setProperty('--u', u.toFixed(3));
    this.root.style.setProperty('--pos', limitar(this.pos, 0, ULTIMA).toFixed(3));
  }

  _bindCarrusel() {
    let g = null;
    this.capa.addEventListener('pointerdown', (e) => {
      this._trago = false;
      if (!this.abierto || e.button > 0) return;
      g = { id: e.pointerId, x: e.clientX, pos: this.pos, movido: false, pts: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }] };
    });
    this.capa.addEventListener('pointermove', (e) => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x;
      g.pts.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
      if (g.pts.length > 5) g.pts.shift();
      if (!g.movido) {
        if (Math.abs(dx) < UMBRAL) return;
        g.movido = true;
        this._trago = true;
        try { this.capa.setPointerCapture(e.pointerId); } catch { /* sin captura también sirve */ }
        this.app.stack.classList.remove('is-asentando');
        this.capa.classList.remove('is-asentando');
      }
      this.pos = goma(g.pos - dx / (window.innerWidth * this.s + HUECO));
      this._pintar();
    });
    const fin = (e) => {
      if (!g || e.pointerId !== g.id) return;
      const { movido, pts, pos: desde } = g;
      g = null;
      if (movido) {
        // Aquí las tarjetas siguen al dedo: a la derecha, la posición baja.
        const destino = destinoDe(this.pos, Math.round(desde), velocidad(pts).x, -1);
        if (destino !== Math.round(this.pos)) haptic(6);
        this._asentar(() => { this.pos = destino; this._pintar(); }, () => {
          this.tarjetas[destino]?.focus({ preventScroll: true });
        });
      } else if (!e.target.closest?.('.carrusel__tarjeta')) {
        // Un toque fuera de las tarjetas: se vuelve a donde se estaba.
        this.elegir(this.i);
      }
    };
    this.capa.addEventListener('pointerup', fin);
    this.capa.addEventListener('pointercancel', fin);
  }

  /* ────────────────── Dos dedos hacia arriba, en cualquier sitio ─────── */

  _bindDosDedos() {
    let ini = null;
    const medir = (ts) => ({
      x: (ts[0].clientX + ts[1].clientX) / 2,
      y: (ts[0].clientY + ts[1].clientY) / 2,
      d: Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY),
    });
    document.addEventListener('touchstart', (e) => {
      ini = e.touches.length === 2 && this._sePuedeAbrir() ? medir(e.touches) : null;
    }, { passive: true, capture: true });
    document.addEventListener('touchmove', (e) => {
      if (!ini || e.touches.length !== 2) return;
      const m = medir(e.touches);
      const dx = m.x - ini.x, dy = m.y - ini.y;
      // Los dos dedos suben juntos y sin separarse: si la distancia cambia
      // es un pellizco (zoom de la cámara o de la foto), no este gesto.
      if (dy < -64 && Math.abs(dx) < -dy * 0.6 && Math.abs(m.d / ini.d - 1) < 0.14) {
        ini = null;
        this.abrir();
      }
    }, { passive: true, capture: true });
    const fin = () => { ini = null; };
    document.addEventListener('touchend', fin, { passive: true, capture: true });
    document.addEventListener('touchcancel', fin, { passive: true, capture: true });
  }

  _sePuedeAbrir() {
    if (this.abierto || this._ocupado || !this.app.current) return false;
    // Encima hay algo modal: el visor, una hoja o el menú de importación.
    if (document.body.classList.contains('is-viewing')) return false;
    return !document.querySelector('.sheet-backdrop, .imp:not([hidden]), .busy:not([hidden])');
  }

  /* ───────────────────────────── Comunes ─────────────────────────────── */

  /**
   * Anima de donde esté a lo que pinte `pintar`, y después llama a `luego`.
   * Mientras dura no se admite otro gesto.
   */
  _asentar(pintar, luego) {
    this._ocupado = true;
    this.app.stack.classList.add('is-asentando');
    this.capa.classList.add('is-asentando');
    this.root.classList.add('is-asentando');
    // Un fotograma para que el navegador vea el punto de partida.
    requestAnimationFrame(() => {
      pintar();
      clearTimeout(this._reloj);
      this._reloj = setTimeout(() => {
        this.app.stack.classList.remove('is-asentando');
        this.capa.classList.remove('is-asentando');
        this.root.classList.remove('is-asentando');
        this._ocupado = false;
        luego?.();
      }, ASENTAR_MS);
    });
  }

  /** Termina el gesto en la sección `k` y deja todo como estaba. */
  _ir(k) {
    this.app.go(ORDEN[k]);
    for (const id of ORDEN) {
      this._soltarVista(this.app.views[id].root);
      if (id !== ORDEN[k]) this.app.views[id].soltarTarjeta?.();
    }
    this.app.stack.classList.remove('is-carrusel', 'is-pasando');
    document.body.classList.remove('is-conmutando');
    this.capa.hidden = true;
    this.capa.classList.remove('is-abierto');
    this.marcar(ORDEN[k]);
  }

  _soltarVista(v) {
    v.style.removeProperty('display');
    v.style.removeProperty('transform');
    v.style.removeProperty('border-radius');
  }
}
