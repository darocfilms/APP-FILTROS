/**
 * films.js — Catálogo de emulsiones.
 *
 * Cada emulsión se describe con:
 *
 *   curves  Curva característica por canal (ver colorscience.js). Las
 *           diferencias entre R, G y B son las que producen el "crossover":
 *           el viraje de color que aparece sólo en sombras o sólo en altas
 *           luces y que distingue una película de otra mucho más que la
 *           saturación global.
 *             gamma      contraste del canal
 *             toe        dureza del pie (sombras)
 *             shoulder   dureza del hombro (altas luces)
 *             pivotX     desplazamiento de exposición del canal, en diafragmas
 *             pivotY     valor impreso del gris medio en ese canal
 *             whiteStops diafragmas hasta el blanco del soporte
 *
 *   matrix  Acoplamiento entre capas de la emulsión. Las filas suman 1 para
 *           que los grises se mantengan neutros; los valores fuera de la
 *           diagonal ensanchan o comprimen la gama.
 *
 *   look    Ajustes que se copian al panel al elegir la emulsión. A partir de
 *           ahí son del usuario: la emulsión propone, no impone.
 */

import { MID_GREY_PRINT, WHITE_STOPS } from '../engine/colorscience.js';

const P = MID_GREY_PRINT;
const W = WHITE_STOPS;

/** Atajo para declarar un canal. */
function ch(gamma, toe, shoulder, opts = {}) {
  return {
    gamma,
    toe,
    shoulder,
    pivotX: opts.x || 0,
    pivotY: P + (opts.y || 0),
    whiteStops: W + (opts.w || 0),
  };
}

/** Matriz identidad con las filas normalizadas a 1. */
const NEUTRAL_MATRIX = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/** Valores por defecto de `look`, para no repetirlos en cada emulsión. */
const BASE_LOOK = {
  contrast: 0,
  saturation: 0,
  vibrance: 0,
  temp: 0,          // desplazamiento en kelvin sobre el balance de la toma
  tint: 0,
  matteLow: 0,
  matteHigh: 1,
  mono: false,
  monoMix: [0.299, 0.587, 0.114],
  grade: {
    shadows: { h: 0, s: 0, l: 0 },
    mids: { h: 0, s: 0, l: 0 },
    highs: { h: 0, s: 0, l: 0 },
    balance: 0,
  },
  effects: {
    grain: 0, grainSize: 1, grainRough: 0.5, grainChroma: 0.2,
    halation: 0, haloThresh: 0.72, haloTint: [1.0, 0.32, 0.16],
    bloom: 0, bloomThresh: 0.8, diffusion: 0, ca: 0,
  },
};

function film(def) {
  return {
    ...def,
    matrix: def.matrix || NEUTRAL_MATRIX,
    look: {
      ...BASE_LOOK,
      ...def.look,
      grade: { ...BASE_LOOK.grade, ...(def.look?.grade || {}) },
      effects: { ...BASE_LOOK.effects, ...(def.look?.effects || {}) },
    },
  };
}

export const FILMS = [
  /* ─────────────────────────── Referencia ──────────────────────────── */
  film({
    id: 'neutral',
    name: 'Neutro digital',
    brand: 'Referencia',
    kind: 'digital',
    iso: null,
    note: 'Sin emulsión: la imagen tal y como la entrega la cámara. Punto de partida para etalonar desde cero.',
    swatch: ['#8a8a8a', '#c9c9c9'],
    neutral: true,
    curves: { r: ch(1.0, 1.5, 1.9), g: ch(1.0, 1.5, 1.9), b: ch(1.0, 1.5, 1.9) },
  }),

  /* ──────────────────────── Negativo de color ──────────────────────── */
  film({
    id: 'portra400',
    name: 'Portra 400',
    brand: 'Kodak',
    kind: 'Negativo color',
    iso: 400,
    note: 'La referencia para retrato. Contraste bajo, latitud enorme y pieles cálidas sin exagerar el rojo.',
    swatch: ['#e8c4a8', '#7d9a8e'],
    curves: {
      r: ch(1.02, 1.30, 1.55, { y: +0.008, w: -0.05 }),
      g: ch(1.00, 1.35, 1.60),
      b: ch(0.98, 1.45, 1.70, { y: -0.010, w: +0.12 }),
    },
    matrix: [[1.03, -0.02, -0.01], [-0.02, 1.04, -0.02], [-0.01, -0.03, 1.04]],
    look: {
      saturation: -0.04, vibrance: 0.10, temp: 120,
      grade: { shadows: { h: 205, s: 0.05, l: 0.005 }, highs: { h: 35, s: 0.045, l: 0 } },
      effects: { grain: 0.16, grainSize: 1.05, grainRough: 0.45, grainChroma: 0.18, halation: 0.13, haloThresh: 0.74 },
    },
  }),

  film({
    id: 'portra800',
    name: 'Portra 800',
    brand: 'Kodak',
    kind: 'Negativo color',
    iso: 800,
    note: 'La hermana rápida de la 400: más grano, más contraste y unos rojos algo más densos. Excelente con luz escasa.',
    swatch: ['#e3b394', '#6d8b93'],
    curves: {
      r: ch(1.10, 1.35, 1.55, { y: +0.010, w: -0.08 }),
      g: ch(1.07, 1.40, 1.60),
      b: ch(1.04, 1.50, 1.72, { y: -0.008, w: +0.10 }),
    },
    matrix: [[1.05, -0.03, -0.02], [-0.02, 1.05, -0.03], [-0.02, -0.04, 1.06]],
    look: {
      saturation: 0.02, vibrance: 0.08, temp: 150,
      grade: { shadows: { h: 215, s: 0.06, l: 0 }, highs: { h: 32, s: 0.05, l: 0 } },
      effects: { grain: 0.30, grainSize: 1.25, grainRough: 0.55, grainChroma: 0.28, halation: 0.20, haloThresh: 0.70 },
    },
  }),

  film({
    id: 'gold200',
    name: 'Gold 200',
    brand: 'Kodak',
    kind: 'Negativo color',
    iso: 200,
    note: 'El dorado de las fotos familiares. Amarillos densos, sombras cálidas y una nostalgia difícil de disimular.',
    swatch: ['#f0c069', '#9a8452'],
    curves: {
      r: ch(1.14, 1.45, 1.55, { y: +0.016, w: -0.12 }),
      g: ch(1.10, 1.45, 1.62, { y: +0.006 }),
      b: ch(1.02, 1.60, 1.80, { y: -0.020, w: +0.22 }),
    },
    matrix: [[1.06, -0.02, -0.04], [-0.01, 1.05, -0.04], [-0.02, -0.05, 1.07]],
    look: {
      saturation: 0.08, vibrance: 0.12, temp: 350, tint: 4,
      grade: { shadows: { h: 40, s: 0.05, l: 0 }, highs: { h: 48, s: 0.10, l: 0.01 } },
      effects: { grain: 0.24, grainSize: 1.15, grainRough: 0.5, grainChroma: 0.25, halation: 0.16, haloThresh: 0.72 },
    },
  }),

  film({
    id: 'ektar100',
    name: 'Ektar 100',
    brand: 'Kodak',
    kind: 'Negativo color',
    iso: 100,
    note: 'El negativo más saturado que existe. Grano casi invisible, azules profundos y rojos que empujan. Paisaje puro.',
    swatch: ['#d94b3a', '#2f6ea8'],
    curves: {
      r: ch(1.28, 1.75, 1.45, { w: -0.14 }),
      g: ch(1.26, 1.75, 1.48),
      b: ch(1.30, 1.70, 1.42, { y: +0.006, w: -0.16 }),
    },
    matrix: [[1.14, -0.09, -0.05], [-0.07, 1.13, -0.06], [-0.05, -0.10, 1.15]],
    look: {
      saturation: 0.18, vibrance: 0.05, temp: -60,
      grade: { shadows: { h: 230, s: 0.04, l: -0.01 } },
      effects: { grain: 0.07, grainSize: 0.85, grainRough: 0.35, grainChroma: 0.12, halation: 0.07, haloThresh: 0.80 },
    },
  }),

  film({
    id: 'superia400',
    name: 'Superia X-TRA 400',
    brand: 'Fujifilm',
    kind: 'Negativo color',
    iso: 400,
    note: 'La respuesta japonesa a la Gold: verdes vivos, sombras que tiran a cian y un carácter claramente más frío.',
    swatch: ['#5fae6e', '#3f7fa8'],
    curves: {
      r: ch(1.14, 1.55, 1.60, { y: -0.008, w: +0.08 }),
      g: ch(1.18, 1.45, 1.55, { y: +0.010, w: -0.10 }),
      b: ch(1.16, 1.50, 1.58, { y: +0.004, w: -0.04 }),
    },
    matrix: [[1.08, -0.06, -0.02], [-0.05, 1.10, -0.05], [-0.02, -0.07, 1.09]],
    look: {
      saturation: 0.12, vibrance: 0.08, temp: -180, tint: -5,
      grade: { shadows: { h: 190, s: 0.08, l: 0 }, highs: { h: 150, s: 0.03, l: 0 } },
      effects: { grain: 0.26, grainSize: 1.2, grainRough: 0.55, grainChroma: 0.3, halation: 0.10, haloThresh: 0.76 },
    },
  }),

  film({
    id: 'pro400h',
    name: 'Pro 400H',
    brand: 'Fujifilm',
    kind: 'Negativo color',
    iso: 400,
    note: 'Descatalogada y muy llorada. Pastel, verdes de menta y altas luces que nunca se endurecen. Boda y editorial.',
    swatch: ['#cfe0d2', '#e6c9c2'],
    curves: {
      r: ch(0.94, 1.30, 1.80, { y: -0.004, w: +0.14 }),
      g: ch(0.96, 1.28, 1.78, { y: +0.008, w: +0.10 }),
      b: ch(0.95, 1.32, 1.82, { y: +0.004, w: +0.12 }),
    },
    matrix: [[1.00, 0.01, -0.01], [-0.01, 1.02, -0.01], [-0.01, 0.00, 1.01]],
    look: {
      saturation: -0.12, vibrance: 0.14, temp: -140, tint: -8,
      matteLow: 0.028,
      grade: { shadows: { h: 170, s: 0.07, l: 0.01 }, mids: { h: 150, s: 0.03, l: 0 }, highs: { h: 195, s: 0.04, l: 0.005 } },
      effects: { grain: 0.18, grainSize: 1.1, grainRough: 0.4, grainChroma: 0.2, halation: 0.09, haloThresh: 0.78 },
    },
  }),

  film({
    id: 'agfavista',
    name: 'Vista Plus 200',
    brand: 'Agfa',
    kind: 'Negativo color',
    iso: 200,
    note: 'Consumo europeo de los noventa: rojos encendidos, azules eléctricos y ningún interés por la sutileza.',
    swatch: ['#e2503f', '#2e63b8'],
    curves: {
      r: ch(1.20, 1.55, 1.50, { y: +0.010, w: -0.10 }),
      g: ch(1.16, 1.55, 1.58),
      b: ch(1.22, 1.50, 1.48, { y: +0.008, w: -0.14 }),
    },
    matrix: [[1.10, -0.07, -0.03], [-0.05, 1.09, -0.04], [-0.04, -0.08, 1.12]],
    look: {
      saturation: 0.16, vibrance: 0.06, temp: -40,
      grade: { shadows: { h: 240, s: 0.05, l: 0 } },
      effects: { grain: 0.22, grainSize: 1.15, grainRough: 0.5, grainChroma: 0.3, halation: 0.12, haloThresh: 0.74 },
    },
  }),

  /* ───────────────────────────── Diapositiva ───────────────────────── */
  film({
    id: 'velvia50',
    name: 'Velvia 50',
    brand: 'Fujifilm',
    kind: 'Diapositiva',
    iso: 50,
    note: 'Saturación extrema y latitud mínima: o expones bien o no hay foto. Verdes y magentas legendarios.',
    swatch: ['#1f7a4c', '#b8246b'],
    curves: {
      r: ch(1.55, 2.30, 1.20, { w: -0.30 }),
      g: ch(1.58, 2.35, 1.18, { y: +0.004, w: -0.32 }),
      b: ch(1.52, 2.25, 1.22, { y: -0.006, w: -0.26 }),
    },
    matrix: [[1.22, -0.14, -0.08], [-0.10, 1.20, -0.10], [-0.08, -0.16, 1.24]],
    look: {
      contrast: 0.10, saturation: 0.30, temp: -80, tint: 6,
      grade: { shadows: { h: 250, s: 0.05, l: -0.015 }, highs: { h: 330, s: 0.03, l: 0 } },
      effects: { grain: 0.06, grainSize: 0.8, grainRough: 0.3, grainChroma: 0.1, halation: 0.05, haloThresh: 0.84 },
    },
  }),

  film({
    id: 'provia100f',
    name: 'Provia 100F',
    brand: 'Fujifilm',
    kind: 'Diapositiva',
    iso: 100,
    note: 'La diapositiva sensata: contraste alto pero color fiel. Cuando quieres transparencia sin el drama de la Velvia.',
    swatch: ['#4e8fc0', '#d8d2c4'],
    curves: {
      r: ch(1.34, 2.00, 1.34, { w: -0.18 }),
      g: ch(1.34, 2.00, 1.34, { w: -0.18 }),
      b: ch(1.36, 1.95, 1.32, { y: +0.004, w: -0.20 }),
    },
    matrix: [[1.12, -0.08, -0.04], [-0.06, 1.11, -0.05], [-0.04, -0.08, 1.12]],
    look: {
      contrast: 0.04, saturation: 0.10, temp: -40,
      grade: { shadows: { h: 225, s: 0.035, l: -0.008 } },
      effects: { grain: 0.08, grainSize: 0.9, grainRough: 0.35, grainChroma: 0.12, halation: 0.05, haloThresh: 0.82 },
    },
  }),

  film({
    id: 'kodachrome64',
    name: 'Kodachrome 64',
    brand: 'Kodak',
    kind: 'Diapositiva',
    iso: 64,
    note: 'El proceso K-14 murió en 2010 y con él estos rojos. Sombras densas casi azuladas y una nitidez que aún duele.',
    swatch: ['#c0392b', '#1c3f5c'],
    curves: {
      r: ch(1.44, 2.10, 1.28, { y: +0.014, w: -0.24 }),
      g: ch(1.40, 2.20, 1.32, { y: -0.004, w: -0.20 }),
      b: ch(1.42, 2.45, 1.30, { y: -0.016, w: -0.16 }),
    },
    matrix: [[1.18, -0.12, -0.06], [-0.06, 1.12, -0.06], [-0.04, -0.14, 1.18]],
    look: {
      contrast: 0.06, saturation: 0.14, vibrance: 0.06, temp: 60,
      grade: { shadows: { h: 218, s: 0.09, l: -0.018 }, highs: { h: 30, s: 0.04, l: 0 } },
      effects: { grain: 0.10, grainSize: 0.9, grainRough: 0.4, grainChroma: 0.1, halation: 0.06, haloThresh: 0.80 },
    },
  }),

  /* ────────────────────────────── Cine ─────────────────────────────── */
  film({
    id: 'vision3_250d',
    name: 'Vision3 250D',
    brand: 'Kodak',
    kind: 'Cine',
    iso: 250,
    note: 'Negativo de cine equilibrado a luz día. Plano a propósito: está pensado para etalonarse después.',
    swatch: ['#b9a894', '#7f8f9c'],
    curves: {
      r: ch(0.86, 1.20, 2.00, { w: +0.28 }),
      g: ch(0.86, 1.22, 2.00, { w: +0.28 }),
      b: ch(0.85, 1.25, 2.05, { y: -0.004, w: +0.32 }),
    },
    matrix: [[1.02, -0.01, -0.01], [-0.01, 1.02, -0.01], [-0.01, -0.02, 1.03]],
    look: {
      saturation: -0.08, vibrance: 0.06, matteLow: 0.020, matteHigh: 0.975,
      grade: { shadows: { h: 200, s: 0.04, l: 0.008 } },
      effects: { grain: 0.14, grainSize: 1.0, grainRough: 0.45, grainChroma: 0.18, halation: 0.11, haloThresh: 0.76 },
    },
  }),

  film({
    id: 'vision3_500t',
    name: 'Vision3 500T',
    brand: 'Kodak',
    kind: 'Cine',
    iso: 500,
    note: 'Equilibrada a tungsteno: con luz de día vira a azul si no corriges. El estándar de la noche en cine.',
    swatch: ['#7f93b4', '#c98f5e'],
    curves: {
      r: ch(0.88, 1.25, 1.95, { y: -0.006, w: +0.26 }),
      g: ch(0.88, 1.25, 1.98, { w: +0.26 }),
      b: ch(0.90, 1.20, 1.90, { y: +0.010, w: +0.20 }),
    },
    matrix: [[1.03, -0.02, -0.01], [-0.01, 1.02, -0.01], [-0.01, -0.03, 1.04]],
    look: {
      saturation: -0.05, vibrance: 0.08, temp: -700, matteLow: 0.024, matteHigh: 0.98,
      grade: { shadows: { h: 210, s: 0.08, l: 0.008 }, highs: { h: 30, s: 0.03, l: 0 } },
      effects: { grain: 0.26, grainSize: 1.2, grainRough: 0.55, grainChroma: 0.25, halation: 0.18, haloThresh: 0.70 },
    },
  }),

  film({
    id: 'cinestill800t',
    name: 'CineStill 800T',
    brand: 'CineStill',
    kind: 'Cine',
    iso: 800,
    note: 'Vision3 500T sin la capa antihalo. Por eso los rojos sangran alrededor de cada luz: es su firma, no un defecto.',
    swatch: ['#ff5b3a', '#3f6fa8'],
    curves: {
      r: ch(1.00, 1.30, 1.75, { y: +0.004, w: +0.10 }),
      g: ch(0.98, 1.35, 1.80, { w: +0.12 }),
      b: ch(1.02, 1.28, 1.72, { y: +0.012, w: +0.06 }),
    },
    matrix: [[1.05, -0.03, -0.02], [-0.02, 1.04, -0.02], [-0.01, -0.04, 1.05]],
    look: {
      saturation: 0.04, vibrance: 0.10, temp: -900, matteLow: 0.018,
      grade: { shadows: { h: 205, s: 0.10, l: 0.006 }, highs: { h: 20, s: 0.05, l: 0 } },
      effects: {
        grain: 0.28, grainSize: 1.25, grainRough: 0.6, grainChroma: 0.3,
        halation: 0.72, haloThresh: 0.55, haloTint: [1.0, 0.20, 0.08],
        bloom: 0.06, diffusion: 0.05,
      },
    },
  }),

  /* ────────────────────────── Blanco y negro ───────────────────────── */
  film({
    id: 'trix400',
    name: 'Tri-X 400',
    brand: 'Kodak',
    kind: 'Blanco y negro',
    iso: 400,
    note: 'El blanco y negro del fotoperiodismo. Negros densos, grano evidente y una respuesta que perdona el subexpuesto.',
    swatch: ['#1a1a1a', '#d8d8d8'],
    curves: {
      r: ch(1.24, 1.85, 1.48), g: ch(1.24, 1.85, 1.48), b: ch(1.24, 1.85, 1.48),
    },
    look: {
      mono: true, monoMix: [0.30, 0.58, 0.12], contrast: 0.05,
      effects: { grain: 0.34, grainSize: 1.2, grainRough: 0.62, grainChroma: 0, halation: 0.05, haloThresh: 0.82 },
    },
  }),

  film({
    id: 'hp5',
    name: 'HP5 Plus 400',
    brand: 'Ilford',
    kind: 'Blanco y negro',
    iso: 400,
    note: 'Más suave y gris que la Tri-X, con una escala de medios larguísima. La favorita de quien revela en casa.',
    swatch: ['#2b2b2b', '#cfcfcf'],
    curves: {
      r: ch(1.06, 1.45, 1.72), g: ch(1.06, 1.45, 1.72), b: ch(1.06, 1.45, 1.72),
    },
    look: {
      mono: true, monoMix: [0.28, 0.60, 0.12], matteLow: 0.020, matteHigh: 0.985,
      effects: { grain: 0.30, grainSize: 1.15, grainRough: 0.58, grainChroma: 0, halation: 0.04, haloThresh: 0.84 },
    },
  }),

  film({
    id: 'delta3200',
    name: 'Delta 3200',
    brand: 'Ilford',
    kind: 'Blanco y negro',
    iso: 3200,
    note: 'Para fotografiar donde no hay luz. El grano deja de ser textura y pasa a ser el tema de la imagen.',
    swatch: ['#3a3a3a', '#c4c4c4'],
    curves: {
      r: ch(0.94, 1.25, 1.85), g: ch(0.94, 1.25, 1.85), b: ch(0.94, 1.25, 1.85),
    },
    look: {
      mono: true, monoMix: [0.30, 0.56, 0.14], matteLow: 0.038, matteHigh: 0.97,
      effects: { grain: 0.62, grainSize: 1.7, grainRough: 0.72, grainChroma: 0, halation: 0.06, haloThresh: 0.78, bloom: 0.05 },
    },
  }),

  /* ──────────────────────────── Instantánea ────────────────────────── */
  film({
    id: 'polaroid600',
    name: 'Polaroid 600',
    brand: 'Polaroid',
    kind: 'Instantánea',
    iso: 640,
    note: 'Contraste bajo, negros levantados y una dominante que cambia con la temperatura del día del revelado.',
    swatch: ['#dcd2b8', '#8fb0b8'],
    curves: {
      r: ch(0.90, 1.15, 1.95, { y: +0.014, w: +0.22 }),
      g: ch(0.88, 1.18, 2.00, { y: +0.004, w: +0.26 }),
      b: ch(0.86, 1.10, 2.05, { y: -0.008, w: +0.34 }),
    },
    // Acoplamiento positivo fuera de la diagonal: las capas se contaminan y la
    // gama se estrecha. Es lo que da ese color "descolorido" de la instantánea.
    matrix: [[0.90, 0.07, 0.03], [0.05, 0.90, 0.05], [0.04, 0.10, 0.86]],
    look: {
      contrast: -0.06, saturation: -0.16, vibrance: 0.10, temp: 220, tint: 8,
      matteLow: 0.075, matteHigh: 0.955,
      grade: { shadows: { h: 185, s: 0.10, l: 0.02 }, mids: { h: 45, s: 0.03, l: 0 }, highs: { h: 40, s: 0.07, l: 0.005 } },
      effects: { grain: 0.14, grainSize: 1.5, grainRough: 0.4, grainChroma: 0.35, halation: 0.10, haloThresh: 0.68, diffusion: 0.16, bloom: 0.08 },
    },
  }),

  /* ───────────────────────────── Creativa ──────────────────────────── */
  film({
    id: 'lomopurple',
    name: 'LomoChrome Purple',
    brand: 'Lomography',
    kind: 'Creativa',
    iso: 400,
    note: 'Heredera de la película infrarroja Aerochrome: el verde se convierte en púrpura y el cielo se vuelve irreal.',
    swatch: ['#9b59b6', '#f0d9a8'],
    curves: {
      r: ch(1.08, 1.50, 1.60, { y: +0.006 }),
      g: ch(1.05, 1.55, 1.65, { y: -0.006 }),
      b: ch(1.10, 1.45, 1.58, { y: +0.010 }),
    },
    // Intercambio de canales: el verde alimenta rojo y azul (→ púrpura) pero las
    // filas siguen sumando 1, así que los grises no se tiñen.
    matrix: [[0.55, 0.75, -0.30], [0.10, 0.30, 0.60], [0.35, 0.75, -0.10]],
    look: {
      saturation: 0.12, vibrance: 0.08, temp: -60,
      grade: { shadows: { h: 270, s: 0.06, l: 0 }, highs: { h: 50, s: 0.05, l: 0 } },
      effects: { grain: 0.24, grainSize: 1.2, grainRough: 0.55, grainChroma: 0.35, halation: 0.14, haloThresh: 0.72 },
    },
  }),
];

export const FILM_BY_ID = new Map(FILMS.map((f) => [f.id, f]));

export function getFilm(id) {
  return FILM_BY_ID.get(id) || FILM_BY_ID.get('neutral');
}

/** Emulsiones agrupadas por tipo, en el orden del catálogo. */
export function filmsByKind() {
  const groups = new Map();
  for (const f of FILMS) {
    if (!groups.has(f.kind)) groups.set(f.kind, []);
    groups.get(f.kind).push(f);
  }
  return [...groups.entries()].map(([kind, items]) => ({ kind, items }));
}
