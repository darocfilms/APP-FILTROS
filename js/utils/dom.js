/** dom.js — Ayudas mínimas para construir interfaz sin plantillas. */

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') setStyle(node, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

/**
 * Aplica estilos en línea. Las propiedades personalizadas necesitan
 * `setProperty`: `Object.assign` sobre un CSSStyleDeclaration las ignora en
 * silencio, y las muestras de color y los rellenos de los deslizadores
 * dependen de ellas.
 */
function setStyle(node, styles) {
  for (const [prop, value] of Object.entries(styles)) {
    if (value == null) continue;
    if (prop.startsWith('--')) node.style.setProperty(prop, String(value));
    else node.style[prop] = value;
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Ejecuta como máximo una vez por fotograma. */
export function rafThrottle(fn) {
  let pending = false;
  let lastArgs;
  return (...args) => {
    lastArgs = args;
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      fn(...lastArgs);
    });
  };
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Vibración breve. En iOS no hace nada (Safari no implementa la API), pero en
 * Android da el matiz táctil que se espera al tocar un control.
 *
 * Se comprueba la activación del usuario porque los navegadores rechazan la
 * llamada antes del primer gesto, y lo registran como error de consola.
 */
export function haptic(ms = 8) {
  try {
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    navigator.vibrate?.(ms);
  } catch { /* sin soporte */ }
}

let toastTimer = null;
export function toast(message, { error = false, ms = 2600 } = {}) {
  let node = document.getElementById('toast');
  if (!node) {
    node = el('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(node);
  }
  node.textContent = message;
  node.classList.toggle('is-error', error);
  node.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('is-visible'), ms);
}

/** Diálogo de confirmación propio: el `confirm()` nativo bloquea el hilo. */
export function confirmDialog(message, { confirmLabel = 'Aceptar', danger = false } = {}) {
  return new Promise((resolve) => {
    const close = (value) => { backdrop.remove(); resolve(value); };
    const backdrop = el('div', { class: 'sheet-backdrop', onclick: (e) => { if (e.target === backdrop) close(false); } },
      el('div', { class: 'sheet sheet--dialog', role: 'dialog', 'aria-modal': 'true' },
        el('p', { class: 'sheet__message', text: message }),
        el('div', { class: 'sheet__actions' },
          el('button', { class: 'btn', type: 'button', onclick: () => close(false) }, 'Cancelar'),
          el('button', { class: 'btn ' + (danger ? 'btn--danger' : 'btn--primary'), type: 'button', onclick: () => close(true) }, confirmLabel))));
    document.body.append(backdrop);
  });
}
