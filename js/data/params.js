/**
 * params.js — Modelo de parámetros del laboratorio.
 *
 * Un único sitio define, para cada control: su rango, su valor neutro, cómo se
 * muestra y a qué ruta del objeto de ajustes corresponde. La interfaz se genera
 * a partir de esta tabla, así que añadir un parámetro es añadir una fila.
 */

export const HSL_BANDS = [
  { key: 'red', label: 'Rojos', hue: 0 },
  { key: 'orange', label: 'Naranjas', hue: 30 },
  { key: 'yellow', label: 'Amarillos', hue: 60 },
  { key: 'green', label: 'Verdes', hue: 120 },
  { key: 'aqua', label: 'Cianes', hue: 180 },
  { key: 'blue', label: 'Azules', hue: 240 },
  { key: 'purple', label: 'Púrpuras', hue: 280 },
  { key: 'magenta', label: 'Magentas', hue: 320 },
];

export const ASPECTS = [
  { key: 'free', label: 'Libre', ratio: null },
  { key: 'orig', label: 'Original', ratio: 0 },
  { key: '1:1', label: '1:1', ratio: 1 },
  { key: '4:5', label: '4:5', ratio: 4 / 5 },
  { key: '3:4', label: '3:4', ratio: 3 / 4 },
  { key: '2:3', label: '2:3', ratio: 2 / 3 },
  { key: '9:16', label: '9:16', ratio: 9 / 16 },
  { key: '16:9', label: '16:9', ratio: 16 / 9 },
  { key: '3:2', label: '3:2', ratio: 3 / 2 },
  { key: '2.39:1', label: '2.39:1', ratio: 2.39 },
];

/** Estado inicial completo. Todo valor neutro deja la imagen intacta. */
export function defaultParams() {
  return {
    film: { id: 'neutral', strength: 1 },

    light: {
      exposure: 0,      // diafragmas
      contrast: 0,
      highlights: 0,
      shadows: 0,
      whites: 0,
      blacks: 0,
      matteLow: 0,      // negro levantado
      matteHigh: 1,     // blanco rebajado
    },

    color: {
      temp: 6500,       // kelvin
      tint: 0,
      vibrance: 0,
      saturation: 0,
      hueShift: 0,
      mono: false,
      monoMix: [0.299, 0.587, 0.114],
    },

    hsl: {
      hue: new Array(8).fill(0),
      sat: new Array(8).fill(0),
      lum: new Array(8).fill(0),
    },

    curves: {
      master: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      red: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      green: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      blue: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    },

    grade: {
      shadows: { h: 0, s: 0, l: 0 },
      mids: { h: 0, s: 0, l: 0 },
      highs: { h: 0, s: 0, l: 0 },
      balance: 0,
    },

    detail: { clarity: 0, texture: 0, sharpen: 0, denoise: 0 },

    effects: {
      grain: 0, grainSize: 1, grainRough: 0.5, grainChroma: 0.2,
      halation: 0, haloThresh: 0.72, haloTint: [1.0, 0.32, 0.16],
      bloom: 0, bloomThresh: 0.8, diffusion: 0, ca: 0,
    },

    vignette: { amount: 0, mid: 0.62, feather: 0.35, round: 1 },

    geometry: {
      rotate: 0, straighten: 0, flipH: false, flipV: false, aspect: 'free',
      // Recorte en coordenadas normalizadas del marco YA GIRADO, con la Y desde
      // arriba. Al no depender de la resolución, el mismo rectángulo sirve para
      // el proxy de edición y para la exportación a tamaño completo.
      crop: { x: 0, y: 0, w: 1, h: 1 },
    },
  };
}

/* ────────────────────────── Definición de la interfaz ────────────────────── */

const s = (path, label, min, max, def, opts = {}) => ({
  kind: 'slider', path, label, min, max, def,
  step: opts.step ?? 0.01,
  unit: opts.unit ?? '',
  format: opts.format,
  center: opts.center ?? (min < 0 && max > 0 ? 0 : min),
});

export const PANELS = [
  {
    id: 'film',
    label: 'Película',
    icon: 'film',
    custom: 'filmPicker',
    controls: [
      s('film.strength', 'Intensidad', 0, 1, 1, { format: 'pct' }),
    ],
  },
  {
    id: 'light',
    label: 'Luz',
    icon: 'sun',
    controls: [
      s('light.exposure', 'Exposición', -4, 4, 0, { step: 0.01, unit: ' EV' }),
      s('light.contrast', 'Contraste', -1, 1, 0, { format: 'pct' }),
      s('light.highlights', 'Altas luces', -1, 1, 0, { format: 'pct' }),
      s('light.shadows', 'Sombras', -1, 1, 0, { format: 'pct' }),
      s('light.whites', 'Blancos', -1, 1, 0, { format: 'pct' }),
      s('light.blacks', 'Negros', -1, 1, 0, { format: 'pct' }),
      s('light.matteLow', 'Velo en negros', 0, 0.3, 0, { format: 'pct' }),
      s('light.matteHigh', 'Techo de blancos', 0.7, 1, 1, { format: 'pct' }),
    ],
  },
  {
    id: 'color',
    label: 'Color',
    icon: 'droplet',
    controls: [
      s('color.temp', 'Temperatura', 2000, 12000, 6500, { step: 10, unit: ' K', center: 6500 }),
      s('color.tint', 'Matiz', -100, 100, 0, { step: 1 }),
      s('color.vibrance', 'Intensidad', -1, 1, 0, { format: 'pct' }),
      s('color.saturation', 'Saturación', -1, 1, 0, { format: 'pct' }),
      s('color.hueShift', 'Rotación de tono', -180, 180, 0, { step: 1, unit: '°' }),
    ],
    custom: 'monoToggle',
  },
  { id: 'hsl', label: 'HSL', icon: 'palette', custom: 'hslPanel', controls: [] },
  { id: 'curves', label: 'Curvas', icon: 'curve', custom: 'curvePanel', controls: [] },
  {
    id: 'grade',
    label: 'Etalonaje',
    icon: 'wheel',
    custom: 'gradePanel',
    controls: [
      s('grade.balance', 'Equilibrio', -1, 1, 0, { format: 'pct' }),
    ],
  },
  {
    id: 'detail',
    label: 'Detalle',
    icon: 'focus',
    controls: [
      s('detail.clarity', 'Claridad', -1, 1, 0, { format: 'pct' }),
      s('detail.texture', 'Textura', -1, 1, 0, { format: 'pct' }),
      s('detail.sharpen', 'Nitidez', 0, 1, 0, { format: 'pct' }),
      s('detail.denoise', 'Reducción de ruido', 0, 1, 0, { format: 'pct' }),
    ],
  },
  {
    id: 'effects',
    label: 'Efectos',
    icon: 'sparkle',
    controls: [
      s('effects.grain', 'Grano', 0, 1.5, 0, { format: 'pct' }),
      s('effects.grainSize', 'Tamaño del grano', 0.4, 3, 1, { step: 0.01, format: 'x' }),
      s('effects.grainRough', 'Aspereza', 0, 1, 0.5, { format: 'pct' }),
      s('effects.grainChroma', 'Grano de color', 0, 1, 0.2, { format: 'pct' }),
      s('effects.halation', 'Halación', 0, 1.5, 0, { format: 'pct' }),
      s('effects.haloThresh', 'Umbral de halación', 0.2, 0.95, 0.72, { format: 'pct' }),
      s('effects.bloom', 'Bloom', 0, 1, 0, { format: 'pct' }),
      s('effects.bloomThresh', 'Umbral de bloom', 0.3, 0.98, 0.8, { format: 'pct' }),
      s('effects.diffusion', 'Difusión', 0, 1, 0, { format: 'pct' }),
      s('effects.ca', 'Aberración cromática', -1, 1, 0, { format: 'pct' }),
    ],
  },
  {
    id: 'vignette',
    label: 'Viñeta',
    icon: 'vignette',
    controls: [
      s('vignette.amount', 'Cantidad', -1, 1, 0, { format: 'pct' }),
      s('vignette.mid', 'Punto medio', 0.1, 1.2, 0.62, { format: 'pct' }),
      s('vignette.feather', 'Suavizado', 0.02, 0.9, 0.35, { format: 'pct' }),
      s('vignette.round', 'Redondez', 0, 1, 1, { format: 'pct' }),
    ],
  },
  {
    id: 'geometry',
    label: 'Encuadre',
    icon: 'crop',
    custom: 'geometryPanel',
    controls: [
      s('geometry.straighten', 'Enderezar', -15, 15, 0, { step: 0.1, unit: '°' }),
    ],
  },
];

/* ─────────────────────────── Acceso por ruta ─────────────────────────────── */

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let cur = obj;
  for (const k of keys) {
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  cur[last] = value;
  return obj;
}

/** Formatea un valor para el indicador numérico del control. */
export function formatValue(ctrl, value) {
  switch (ctrl.format) {
    case 'pct': return Math.round(value * 100) + '%';
    case 'x': return value.toFixed(2) + '×';
    default: {
      const dec = ctrl.step >= 1 ? 0 : ctrl.step >= 0.1 ? 1 : 2;
      return value.toFixed(dec) + ctrl.unit;
    }
  }
}

/** ¿Se aparta este panel de sus valores neutros? Para marcar la pestaña. */
export function panelIsModified(panel, params) {
  if (panel.id === 'film') return params.film.id !== 'neutral';
  if (panel.id === 'hsl') {
    return ['hue', 'sat', 'lum'].some((k) => params.hsl[k].some((v) => Math.abs(v) > 1e-4));
  }
  if (panel.id === 'curves') {
    return Object.values(params.curves).some(
      (pts) => pts.length !== 2 || pts[0].y !== 0 || pts[1].y !== 1);
  }
  if (panel.id === 'grade') {
    const g = params.grade;
    return ['shadows', 'mids', 'highs'].some((z) => g[z].s > 1e-4 || Math.abs(g[z].l) > 1e-4)
      || Math.abs(g.balance) > 1e-4;
  }
  if (panel.id === 'geometry') {
    const g = params.geometry;
    const c = g.crop || { x: 0, y: 0, w: 1, h: 1 };
    const cropped = c.x !== 0 || c.y !== 0 || c.w !== 1 || c.h !== 1;
    return cropped || g.rotate !== 0 || Math.abs(g.straighten) > 1e-4
      || g.flipH || g.flipV || g.aspect !== 'free';
  }
  if (panel.id === 'color' && params.color.mono) return true;
  return panel.controls.some((c) => Math.abs(getPath(params, c.path) - c.def) > 1e-4);
}

/**
 * Aplica una emulsión a los ajustes: copia su `look` y respeta lo que el
 * usuario ya haya tocado a mano si `keepEdits` está activo.
 */
export function applyFilmLook(params, filmDef) {
  const look = filmDef.look;
  params.film.id = filmDef.id;
  params.light.contrast = look.contrast;
  params.light.matteLow = look.matteLow;
  params.light.matteHigh = look.matteHigh;
  params.color.saturation = look.saturation;
  params.color.vibrance = look.vibrance;
  params.color.temp = 6500 + look.temp;
  params.color.tint = look.tint;
  params.color.mono = look.mono;
  params.color.monoMix = [...look.monoMix];
  params.grade = {
    shadows: { ...look.grade.shadows },
    mids: { ...look.grade.mids },
    highs: { ...look.grade.highs },
    balance: look.grade.balance,
  };
  params.effects = { ...look.effects, haloTint: [...look.effects.haloTint] };
  return params;
}

/** Copia profunda simple: los ajustes son JSON puro por diseño. */
export function cloneParams(p) {
  return JSON.parse(JSON.stringify(p));
}
