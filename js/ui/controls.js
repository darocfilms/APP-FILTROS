/**
 * controls.js — Controles del panel de ajustes.
 *
 * Los deslizadores se construyen sobre <input type="range"> a propósito: el
 * arrastre nativo en iOS es mejor que cualquier reimplementación con eventos de
 * puntero, y además se llevan gratis el foco, el teclado y VoiceOver. Lo único
 * que se sustituye es el aspecto, y se les añade doble toque para volver al
 * valor neutro.
 */

import { el, haptic, setStyle } from '../utils/dom.js';
import { formatValue } from '../data/params.js';

/**
 * @param {object} ctrl   definición del control (ver params.js)
 * @param {number} value  valor actual
 * @param {(v:number, committed:boolean)=>void} onChange
 */
export function makeSlider(ctrl, value, onChange) {
  const input = el('input', {
    type: 'range',
    class: 'slider__input',
    min: ctrl.min,
    max: ctrl.max,
    step: ctrl.step,
    value,
    'aria-label': ctrl.label,
  });

  const readout = el('span', { class: 'slider__value', text: formatValue(ctrl, value) });
  const label = el('span', { class: 'slider__label', text: ctrl.label });
  const track = el('div', { class: 'slider__track' }, input);

  const root = el('div', { class: 'slider', dataset: { path: ctrl.path } },
    el('div', { class: 'slider__head' }, label, readout), track);

  // Relleno desde el punto neutro: se ve de un vistazo cuánto te has movido.
  const paint = (v) => {
    const span = ctrl.max - ctrl.min;
    const pos = (v - ctrl.min) / span;
    const origin = (ctrl.center - ctrl.min) / span;
    root.style.setProperty('--pos', pos);
    root.style.setProperty('--origin', origin);
    root.classList.toggle('is-modified', Math.abs(v - ctrl.def) > 1e-6);
    readout.textContent = formatValue(ctrl, v);
  };
  paint(value);

  const emit = (committed) => {
    const v = parseFloat(input.value);
    paint(v);
    onChange(v, committed);
  };
  input.addEventListener('input', () => emit(false));
  input.addEventListener('change', () => emit(true));

  // Doble toque en la etiqueta → valor neutro. Es más fiable que hacerlo sobre
  // el propio deslizador, donde el primer toque ya mueve el valor.
  const reset = () => {
    input.value = ctrl.def;
    paint(ctrl.def);
    onChange(ctrl.def, true);
    haptic(12);
  };
  root.querySelector('.slider__head').addEventListener('dblclick', reset);
  label.addEventListener('click', (e) => { if (e.detail === 2) reset(); });

  root.setValue = (v) => { input.value = v; paint(v); };
  return root;
}

/**
 * Envuelve un deslizador suelto con la misma vía visible que los del panel.
 *
 * Sin la línea, el pulgar flota sobre el fondo y no se ve por dónde puede
 * moverse ni dónde está el valor neutro. La vía y el relleno desde el origen lo
 * dicen de un vistazo.
 *
 * @param {HTMLInputElement} input
 * @param {{center?:number}} [opts] valor neutro desde el que se rellena
 */
export function rangeTrack(input, { center = null } = {}) {
  const min = parseFloat(input.min);
  const max = parseFloat(input.max);
  const origin = center === null ? min : center;
  const span = (max - min) || 1;

  const tick = el('span', { class: 'slider__tick', 'aria-hidden': 'true' });
  const wrap = el('div', { class: 'slider__track' }, tick, input);

  const paint = () => {
    const v = parseFloat(input.value);
    wrap.style.setProperty('--pos', (v - min) / span);
    wrap.style.setProperty('--origin', (origin - min) / span);
  };
  input.addEventListener('input', paint);
  paint();
  wrap.refresh = paint;
  // La marca del neutro sólo tiene sentido si no coincide con un extremo.
  tick.hidden = origin <= min + 1e-9 || origin >= max - 1e-9;
  return wrap;
}

export function makeSegmented(options, value, onChange, { label } = {}) {
  const buttons = options.map((opt) =>
    el('button', {
      type: 'button',
      class: 'seg__item' + (opt.value === value ? ' is-active' : ''),
      dataset: { value: opt.value },
      onclick: () => {
        for (const b of root.querySelectorAll('.seg__item')) b.classList.remove('is-active');
        const btn = root.querySelector(`[data-value="${CSS.escape(String(opt.value))}"]`);
        btn?.classList.add('is-active');
        haptic();
        onChange(opt.value);
      },
    }, opt.label));

  const root = el('div', { class: 'seg', role: 'tablist', 'aria-label': label || '' }, buttons);
  root.setValue = (v) => {
    for (const b of root.querySelectorAll('.seg__item')) {
      b.classList.toggle('is-active', b.dataset.value === String(v));
    }
  };
  return root;
}

export function makeSwitch(labelText, value, onChange) {
  const input = el('input', { type: 'checkbox', class: 'switch__input', checked: value });
  input.addEventListener('change', () => { haptic(); onChange(input.checked); });
  const root = el('label', { class: 'switch' },
    el('span', { class: 'switch__label', text: labelText }),
    input,
    el('span', { class: 'switch__track', 'aria-hidden': 'true' }, el('span', { class: 'switch__knob' })));
  root.setValue = (v) => { input.checked = v; };
  return root;
}

export function makeButton(text, onClick, { variant = '', icon = null } = {}) {
  return el('button', {
    type: 'button',
    class: 'btn ' + (variant ? 'btn--' + variant : ''),
    onclick: (e) => { haptic(); onClick(e); },
  }, icon, text);
}

/**
 * Barra vertical delgada para el visor de la cámara.
 *
 * No es un `input[type=range]` girado: rotar un control nativo deja el área
 * táctil peleada con lo que se ve, y aquí el dedo llega de lado, con el pulgar,
 * sobre una imagen en movimiento. Se dibuja una línea fina —lo justo para no
 * tapar el encuadre— dentro de una caja ancha que sí se puede tocar: lo
 * delgado es la línea, no el objetivo.
 *
 * La escala puede ser logarítmica, que es como se percibe el zoom: de 1× a 2×
 * se nota lo mismo que de 5× a 10×, y en lineal el primer tramo quedaría
 * aplastado contra el extremo.
 *
 * @param {object} opts
 * @param {number} opts.min  extremo inferior de la barra
 * @param {number} opts.max  extremo superior
 * @param {number} opts.value valor inicial
 * @param {string} opts.label nombre para lectores de pantalla
 * @param {(v:number)=>string} opts.format texto de la burbuja
 * @param {(v:number)=>void} opts.onInput
 * @param {'lineal'|'log'} [opts.scale]
 * @param {number|null} [opts.origin] valor neutro: de ahí arranca el relleno
 * @param {number} [opts.step] redondeo del valor
 */
export function verticalRail({
  min, max, value, label, format, onInput,
  scale = 'lineal', origin = null, step = 0,
}) {
  // `min` y `max` se reasignan desde `setRange`, así que no pueden ser const.
  const aT = (v) => {
    const c = Math.min(max, Math.max(min, v));
    return scale === 'log'
      ? Math.log(c / min) / Math.log(max / min)
      : (c - min) / (max - min);
  };
  const aValor = (t) => {
    const c = Math.min(1, Math.max(0, t));
    const v = scale === 'log' ? min * Math.pow(max / min, c) : min + c * (max - min);
    return step > 0 ? Math.round(v / step) * step : v;
  };

  const fill = el('div', { class: 'rail__fill' });
  const thumb = el('div', { class: 'rail__thumb' });
  const tick = el('div', { class: 'rail__tick', hidden: origin == null });
  const track = el('div', { class: 'rail__track' }, tick, fill, thumb);
  const bubble = el('div', { class: 'rail__value' });

  const root = el('div', {
    class: 'rail', role: 'slider', tabindex: '0',
    'aria-label': label,
    'aria-valuemin': String(min), 'aria-valuemax': String(max),
  }, track, bubble);

  let actual = value;

  const pintar = () => {
    const t = aT(actual);
    const o = origin == null ? 0 : aT(origin);
    setStyle(root, { '--pos': t.toFixed(4), '--origin': o.toFixed(4) });
    bubble.textContent = format(actual);
    root.setAttribute('aria-valuenow', String(+actual.toFixed(3)));
    root.setAttribute('aria-valuetext', bubble.textContent);
  };

  /** Fija el valor sin avisar: para reflejar cambios de fuera (el pellizco). */
  const set = (v) => { actual = Math.min(max, Math.max(min, v)); pintar(); };

  const desdeY = (clientY) => {
    const r = track.getBoundingClientRect();
    if (!r.height) return actual;
    // Arriba es más: es lo que espera la mano en una barra vertical.
    return aValor(1 - (clientY - r.top) / r.height);
  };

  let arrastrando = false;
  const mover = (clientY, conTacto) => {
    const v = desdeY(clientY);
    if (Math.abs(v - actual) < 1e-6) return;
    actual = v;
    pintar();
    if (conTacto) haptic(4);
    onInput(actual);
  };

  root.addEventListener('pointerdown', (ev) => {
    // El visor escucha el pellizco y el toque que esconde los mandos: ninguno
    // de los dos debe dispararse porque se haya tocado la barra.
    ev.stopPropagation();
    ev.preventDefault();
    arrastrando = true;
    root.classList.add('is-active');
    root.setPointerCapture(ev.pointerId);
    mover(ev.clientY, true);
  });
  root.addEventListener('pointermove', (ev) => {
    if (!arrastrando) return;
    ev.stopPropagation();
    mover(ev.clientY, false);
  });
  const soltar = (ev) => {
    if (!arrastrando) return;
    arrastrando = false;
    root.classList.remove('is-active');
    try { root.releasePointerCapture(ev.pointerId); } catch { /* ya se soltó */ }
  };
  root.addEventListener('pointerup', soltar);
  root.addEventListener('pointercancel', soltar);

  root.addEventListener('keydown', (ev) => {
    const paso = (max - min) / 40;
    if (ev.key === 'ArrowUp') set(actual + paso);
    else if (ev.key === 'ArrowDown') set(actual - paso);
    else return;
    ev.preventDefault();
    onInput(actual);
  });

  /**
   * Cambia los extremos ya montado. El techo del zoom no se sabe hasta que la
   * cámara está abierta, y hasta entonces la barra trabaja con uno de reserva.
   */
  const setRange = (nuevoMin, nuevoMax) => {
    if (nuevoMin === min && nuevoMax === max) return;
    min = nuevoMin;
    max = nuevoMax;
    root.setAttribute('aria-valuemin', String(min));
    root.setAttribute('aria-valuemax', String(max));
    set(actual);
  };

  pintar();
  return { node: root, set, setRange, get value() { return actual; } };
}
