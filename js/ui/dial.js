/**
 * dial.js — Una regla horizontal que se arrastra con el dedo.
 *
 * Es el mando de la Cámara del iPhone para el zoom y la exposición: una cinta
 * con marcas y números que se desliza bajo una aguja fija en el centro. Se
 * entiende sin explicación —el número que queda bajo la aguja es el valor—, y
 * al soltar el dedo se ve dónde se ha quedado, al contrario que con un
 * deslizador vertical sin escala, que obligaba a adivinar.
 *
 * Las marcas grandes llevan su número y atraen un poco al pasar por ellas
 * (con un toque háptico), para que caer justo en 1×, 2× o en 0 EV no exija
 * pulso de cirujano. Tocar un número salta a él.
 *
 *   escala 'lin'  exposición: un diafragma mide lo mismo en toda la regla.
 *   escala 'log'  zoom: de 1× a 2× ocupa lo mismo que de 2× a 4×.
 */

import { el, haptic } from '../utils/dom.js';

const IMAN_PX = 7;            // radio de atracción de las marcas grandes
const TOQUE_PX = 6;           // por debajo de esto, soltar es un toque

/**
 * @param {object} o
 * @param {number} o.min
 * @param {number} o.max
 * @param {number} o.value
 * @param {'lin'|'log'} [o.escala]
 * @param {number} [o.px]       píxeles por unidad (por diafragma, o por cada ×2)
 * @param {number} [o.paso]     redondeo del valor (lineal)
 * @param {(min:number,max:number)=>{mayores:{v:number,texto:string}[], menores:number[]}} o.marcas
 * @param {(v:number)=>string} o.formato  texto para lectores de pantalla
 * @param {(v:number)=>void} o.alCambiar
 * @param {string} o.etiqueta
 */
export function dial(o) {
  const log = o.escala === 'log';
  const u = (v) => (log ? Math.log2(v) : v);
  const deU = (x) => (log ? 2 ** x : x);
  const px = o.px || 54;
  let min = o.min, max = o.max, valor = o.value;
  let mayores = [];

  const cinta = el('div', { class: 'dial__cinta' });
  const regla = el('div', { class: 'dial__regla' }, cinta, el('span', { class: 'dial__aguja', 'aria-hidden': 'true' }));
  const node = el('div', {
    class: 'dial', role: 'slider', tabindex: '0', 'aria-label': o.etiqueta,
  }, regla);

  const posDe = (v) => (u(v) - u(min)) * px;
  const valorEn = (pos) => deU(u(min) + pos / px);

  const redondear = (v) => {
    if (log) return Math.round(v * 10) / 10;
    const p = o.paso || 0.1;
    return Math.round(v / p) * p;
  };

  function construir() {
    cinta.textContent = '';
    const { mayores: m, menores } = o.marcas(min, max);
    mayores = m.filter((k) => k.v >= min - 1e-6 && k.v <= max + 1e-6);
    cinta.style.width = posDe(max) + 'px';
    for (const v of menores) {
      if (v < min - 1e-6 || v > max + 1e-6) continue;
      cinta.append(el('span', { class: 'dial__marca', style: { left: posDe(v) + 'px' } }));
    }
    for (const k of mayores) {
      cinta.append(el('span', {
        class: 'dial__marca dial__marca--mayor', style: { left: posDe(k.v) + 'px' }, dataset: { v: String(k.v) },
      }, el('span', { class: 'dial__num', text: k.texto })));
    }
  }

  function pintar() {
    cinta.style.transform = `translateX(${-posDe(valor)}px)`;
    node.setAttribute('aria-valuemin', String(min));
    node.setAttribute('aria-valuemax', String(max));
    node.setAttribute('aria-valuenow', String(Math.round(valor * 100) / 100));
    node.setAttribute('aria-valuetext', o.formato(valor));
    for (const n of cinta.querySelectorAll('.dial__marca--mayor')) {
      n.classList.toggle('is-cerca', Math.abs(posDe(+n.dataset.v) - posDe(valor)) < 1);
    }
  }

  /** Pone el valor; `avisar` lo comunica a quien escucha. */
  function poner(v, avisar = true) {
    const nuevo = Math.min(max, Math.max(min, v));
    if (Math.abs(nuevo - valor) < 1e-6) return;
    valor = nuevo;
    pintar();
    if (avisar) o.alCambiar(valor);
  }

  /* ── Arrastre ───────────────────────────────────────────────────────── */

  let arrastre = null;
  const empezar = (x) => {
    arrastre = { x0: x, pos0: posDe(valor), movido: 0, iman: null };
    node.classList.add('is-moviendo');
  };
  const mover = (x) => {
    if (!arrastre) return;
    const dx = x - arrastre.x0;
    arrastre.movido = Math.max(arrastre.movido, Math.abs(dx));
    // La cinta va con el dedo: arrastrar a la izquierda trae valores mayores.
    let pos = Math.min(posDe(max), Math.max(0, arrastre.pos0 - dx));
    const cerca = mayores.find((k) => Math.abs(posDe(k.v) - pos) < IMAN_PX);
    if (cerca) {
      pos = posDe(cerca.v);
      if (arrastre.iman !== cerca.v) haptic(6);
      arrastre.iman = cerca.v;
    } else {
      arrastre.iman = null;
    }
    poner(cerca ? cerca.v : redondear(valorEn(pos)));
  };
  const terminar = (objetivo) => {
    if (!arrastre) return;
    const toque = arrastre.movido < TOQUE_PX;
    arrastre = null;
    node.classList.remove('is-moviendo');
    // Un toque sobre un número salta a él.
    const marca = toque && objetivo?.closest?.('.dial__marca--mayor');
    if (marca) { haptic(); poner(+marca.dataset.v); }
  };

  regla.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    try { regla.setPointerCapture(ev.pointerId); } catch { /* sintético */ }
    empezar(ev.clientX);
    arrastre.objetivo = ev.target;
  });
  regla.addEventListener('pointermove', (ev) => { if (arrastre) mover(ev.clientX); });
  regla.addEventListener('pointerup', () => terminar(arrastre?.objetivo));
  regla.addEventListener('pointercancel', () => terminar(null));

  node.addEventListener('keydown', (ev) => {
    const paso = log ? 1.1 : (o.paso || 0.1);
    const sube = ev.key === 'ArrowRight' || ev.key === 'ArrowUp';
    const baja = ev.key === 'ArrowLeft' || ev.key === 'ArrowDown';
    if (!sube && !baja) return;
    ev.preventDefault();
    poner(redondear(log ? (sube ? valor * paso : valor / paso) : valor + (sube ? paso : -paso)));
  });

  construir();
  pintar();

  return {
    node,
    get value() { return valor; },
    /** Desde fuera (el pellizco, otro botón): mueve la regla sin avisar. */
    set(v) { poner(v, false); },
    setRange(a, b) {
      if (a === min && b === max) return;
      min = a; max = b;
      valor = Math.min(max, Math.max(min, valor));
      construir();
      pintar();
    },
    /** Para que otro elemento (los botones de zoom) arrastre la regla. */
    arrastre: { empezar, mover, terminar: () => terminar(null) },
  };
}

/** Número con coma decimal, sin el «,0» de sobra: 0,5 · 1 · 2,4. */
export function decimal(v, digitos = 1) {
  return v.toFixed(digitos).replace(/\.0+$/, '').replace('.', ',');
}
