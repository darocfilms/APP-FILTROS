/**
 * iconos.js — Los iconos de la interfaz, al estilo de los de Fotos del iPhone.
 *
 * Trazos redondeados de 1,8 px en una caja de 24, con `currentColor`: toman el
 * color del botón que los lleva, así que el mismo icono sirve en blanco, en el
 * azul de la biblioteca o en el amarillo del laboratorio. No son los símbolos de
 * Apple —esos no se pueden usar fuera de sus plataformas—, sino dibujos propios
 * con el mismo lenguaje.
 */

const svg = (cuerpo, { relleno = false, grosor = 1.8 } = {}) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" fill="${relleno ? 'currentColor' : 'none'}" stroke="${relleno ? 'none' : 'currentColor'}" stroke-width="${grosor}" stroke-linecap="round" stroke-linejoin="round">${cuerpo}</svg>`;

export const ICONO = {
  camara: svg('<path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>'),
  laboratorio: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>'),
  biblioteca: svg('<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>'),

  volver: svg('<path d="M15 5l-7 7 7 7"/>', { grosor: 2.4 }),
  cerrar: svg('<path d="M6 6l12 12M18 6L6 18"/>', { grosor: 2.2 }),
  mas: svg('<circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/>', { relleno: true }),
  anadir: svg('<path d="M12 5v14M5 12h14"/>', { grosor: 2.2 }),
  hecho: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', { grosor: 2.6 }),

  compartir: svg('<path d="M12 3.5v11M8 7.5l4-4 4 4"/><path d="M8 10.5H6.5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1H16"/>'),
  info: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r="0.4" fill="currentColor"/>'),
  editar: svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>'),
  eliminar: svg('<path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13a1 1 0 0 0 1 .9h7a1 1 0 0 0 1-.9l1-13"/>'),
  copiar: svg('<rect x="8" y="8" width="11.5" height="11.5" rx="2.2"/><path d="M5.5 15.5H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9.5a1 1 0 0 1 1 1v.5"/>'),
  pegar: svg('<rect x="5" y="4.5" width="14" height="16" rx="2.2"/><path d="M9 4.5V3.5h6v1M9 11h6M9 15h4"/>'),

  deshacer: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>', { grosor: 2 }),
  rehacer: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>', { grosor: 2 }),
  comparar: svg('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M12 5v14"/><path d="M12 5h6a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 18 19h-6z" fill="currentColor" stroke="none"/>', { grosor: 1.9 }),
  histograma: svg('<path d="M3.5 19.5h17"/><path d="M5 19.5v-4M8.5 19.5v-9M12 19.5V6M15.5 19.5v-7M19 19.5v-3"/>'),
  tira: svg('<rect x="3" y="7" width="5" height="10" rx="1.2"/><rect x="9.5" y="7" width="5" height="10" rx="1.2"/><rect x="16" y="7" width="5" height="10" rx="1.2"/>'),
  girarCamara: svg('<path d="M19.5 10A7.5 7.5 0 0 0 6 7.5L4.5 9"/><path d="M4.5 5v4h4"/><path d="M4.5 14A7.5 7.5 0 0 0 18 16.5l1.5-1.5"/><path d="M19.5 19v-4h-4"/>'),
  presets: svg('<path d="M6 4.5h12a1 1 0 0 1 1 1v15l-7-4-7 4v-15a1 1 0 0 1 1-1z"/>'),
};
