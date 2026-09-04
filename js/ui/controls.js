/**
 * controls.js — Controles del panel de ajustes.
 *
 * Los deslizadores se construyen sobre <input type="range"> a propósito: el
 * arrastre nativo en iOS es mejor que cualquier reimplementación con eventos de
 * puntero, y además se llevan gratis el foco, el teclado y VoiceOver. Lo único
 * que se sustituye es el aspecto, y se les añade doble toque para volver al
 * valor neutro.
 */

import { el, haptic } from '../utils/dom.js';
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
