/**
 * colorscience.js
 * -----------------------------------------------------------------------------
 * Núcleo colorimétrico de la app. Todo lo que aquí se calcula en JS se envía al
 * shader como matrices / vectores ya resueltos, para que la GPU sólo haga
 * operaciones por píxel.
 *
 * Referencias de trabajo:
 *   - Espacio de trabajo: sRGB lineal, blanco D65.
 *   - Adaptación cromática: Bradford (CAT02 da resultados muy similares pero
 *     Bradford es el estándar de facto en flujos fotográficos).
 *   - Locus: Planckiano (aprox. Kim et al. 1667–25000 K) + locus de luz día.
 * -----------------------------------------------------------------------------
 */

/* ─────────────────────────── Álgebra de matrices 3×3 ─────────────────────── */

/** Matrices en formato row-major: [ [r0], [r1], [r2] ]. */
export function matMul(a, b) {
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    }
  }
  return out;
}

export function matVec(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

export function matInvert(m) {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return identity();
  const id = 1 / det;
  return [
    [A * id, (c * h - b * i) * id, (b * f - c * e) * id],
    [B * id, (a * i - c * g) * id, (c * d - a * f) * id],
    [C * id, (b * g - a * h) * id, (a * e - b * d) * id],
  ];
}

export function identity() {
  return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
}

export function matScaleDiag(k) {
  return [[k[0], 0, 0], [0, k[1], 0], [0, 0, k[2]]];
}

/** WebGL espera column-major en un Float32Array de 9 elementos. */
export function matToGL(m) {
  return new Float32Array([
    m[0][0], m[1][0], m[2][0],
    m[0][1], m[1][1], m[2][1],
    m[0][2], m[1][2], m[2][2],
  ]);
}

export function matLerp(a, b, t) {
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out[i][j] = a[i][j] + (b[i][j] - a[i][j]) * t;
  return out;
}

/* ─────────────────────── Primarios y matrices estándar ───────────────────── */

/** sRGB / Rec.709 lineal → XYZ (D65). */
export const SRGB_TO_XYZ = [
  [0.4123907993, 0.3575843394, 0.1804807884],
  [0.2126390059, 0.7151686788, 0.0721923154],
  [0.0193308187, 0.1191947798, 0.9505321522],
];

export const XYZ_TO_SRGB = matInvert(SRGB_TO_XYZ);

/** Bradford: XYZ → LMS "afilado". */
export const BRADFORD = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296],
];
export const BRADFORD_INV = matInvert(BRADFORD);

/** Blanco D65 normalizado a Y = 1. */
export const D65_XYZ = [0.9504559271, 1.0, 1.0890577508];

/** Coeficientes de luminancia Rec.709. */
export const LUMA_709 = [0.2126, 0.7152, 0.0722];

/* ───────────────────────── Funciones de transferencia ────────────────────── */

export function srgbToLinear(v) {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(v) {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/* ──────────────────────────── Temperatura de color ───────────────────────── */

/**
 * Coordenadas xy del locus de color para una temperatura dada.
 *   - T ≥ 4000 K: locus CIE de luz día (el mismo que define D50/D55/D65). Es el
 *     correcto para luz natural y el que usan los reveladores RAW.
 *   - T < 4000 K: locus Planckiano, aproximación de Kim et al. (1667–4000 K),
 *     apropiado para tungsteno y llama.
 */
export function kelvinToXY(kelvin) {
  const T = Math.min(25000, Math.max(1667, kelvin));
  let x, y;
  if (T >= 4000) {
    // Locus CIE de luz día: en 6504 K devuelve exactamente D65.
    if (T <= 7000) {
      x = -4.6070e9 / (T * T * T) + 2.9678e6 / (T * T) + 0.09911e3 / T + 0.244063;
    } else {
      x = -2.0064e9 / (T * T * T) + 1.9018e6 / (T * T) + 0.24748e3 / T + 0.237040;
    }
    y = -3.000 * x * x + 2.870 * x - 0.275;
  } else {
    const t = 1000 / T;
    x = -0.2661239 * t * t * t - 0.2343589 * t * t + 0.8776956 * t + 0.179910;
    if (T <= 2222) {
      y = -1.1063814 * x * x * x - 1.34811020 * x * x + 2.18555832 * x - 0.20219683;
    } else {
      y = -0.9549476 * x * x * x - 1.37418593 * x * x + 2.09137015 * x - 0.16748867;
    }
  }
  return [x, y];
}

/** xy → XYZ con Y = 1. */
export function xyToXYZ(x, y) {
  if (y <= 1e-6) return [...D65_XYZ];
  return [x / y, 1.0, (1 - x - y) / y];
}

/** XYZ → coordenadas uv de CIE 1960 (útiles para el eje de matiz verde/magenta). */
function xyzToUV(XYZ) {
  const d = XYZ[0] + 15 * XYZ[1] + 3 * XYZ[2];
  if (d <= 1e-9) return [0, 0];
  return [(4 * XYZ[0]) / d, (6 * XYZ[1]) / d];
}

function uvToXYZ(u, v) {
  if (Math.abs(v) < 1e-9) return [...D65_XYZ];
  const x = (3 * u) / (2 * u - 8 * v + 4);
  const y = (2 * v) / (2 * u - 8 * v + 4);
  return xyToXYZ(x, y);
}

/**
 * Blanco de escena a partir de temperatura (K) y matiz (tint, −150..150).
 * El tint desplaza el punto blanco perpendicularmente al locus en el plano uv:
 * positivo → magenta, negativo → verde (convención Lightroom/Capture One).
 */
export function whitePointFromTempTint(kelvin, tint) {
  const [x, y] = kelvinToXY(kelvin);
  const XYZ = xyToXYZ(x, y);
  const [u, v] = xyzToUV(XYZ);
  // Derivada del locus para obtener la normal (paso finito de 1 %).
  const [x2, y2] = kelvinToXY(kelvin * 1.01);
  const [u2, v2] = xyzToUV(xyToXYZ(x2, y2));
  let du = u2 - u, dv = v2 - v;
  const len = Math.hypot(du, dv) || 1;
  du /= len; dv /= len;
  // Normal unitaria a la tangente del locus.
  const nu = -dv, nv = du;
  const k = (tint / 150) * 0.05; // 0.05 en uv ≈ el rango completo de tint
  return uvToXYZ(u + nu * k, v + nv * k);
}

/**
 * Matriz de balance de blancos en sRGB lineal.
 * Adapta el blanco declarado por el usuario (la luz con la que se hizo la toma)
 * al blanco del display (D65). Bajar la temperatura enfría la imagen, que es el
 * comportamiento esperado por cualquier fotógrafo.
 */
export const NEUTRAL_KELVIN = 6500;

export function whiteBalanceMatrix(kelvin, tint) {
  const srcXYZ = whitePointFromTempTint(kelvin, tint);
  // El destino se evalúa con las mismas funciones que el origen: así el neutro
  // del control (6500 K / tint 0) produce exactamente la identidad y el slider
  // no introduce una dominante propia.
  const dstXYZ = whitePointFromTempTint(NEUTRAL_KELVIN, 0);
  const srcLMS = matVec(BRADFORD, srcXYZ);
  const dstLMS = matVec(BRADFORD, dstXYZ);
  const gain = [
    dstLMS[0] / Math.max(srcLMS[0], 1e-9),
    dstLMS[1] / Math.max(srcLMS[1], 1e-9),
    dstLMS[2] / Math.max(srcLMS[2], 1e-9),
  ];
  const cat = matMul(BRADFORD_INV, matMul(matScaleDiag(gain), BRADFORD));
  const m = matMul(XYZ_TO_SRGB, matMul(cat, SRGB_TO_XYZ));
  // Renormaliza para no alterar la exposición del gris neutro.
  const white = matVec(m, [1, 1, 1]);
  const lum = LUMA_709[0] * white[0] + LUMA_709[1] * white[1] + LUMA_709[2] * white[2];
  const s = 1 / Math.max(lum, 1e-6);
  return [
    [m[0][0] * s, m[0][1] * s, m[0][2] * s],
    [m[1][0] * s, m[1][1] * s, m[1][2] * s],
    [m[2][0] * s, m[2][1] * s, m[2][2] * s],
  ];
}

/* ───────────────────── Splines monótonas para las curvas ─────────────────── */

/**
 * Interpolación cúbica monótona (Fritsch–Carlson). Garantiza que una curva de
 * tono nunca invierta la pendiente entre puntos de control, que es exactamente
 * lo que se necesita en un editor de curvas.
 *
 * @param {Array<{x:number,y:number}>} pts puntos ordenados, x,y ∈ [0,1]
 * @returns {(x:number)=>number}
 */
export function monotoneSpline(pts) {
  const p = [...pts].sort((a, b) => a.x - b.x);
  const n = p.length;
  if (n === 0) return (x) => x;
  if (n === 1) return () => p[0].y;

  const dx = new Float64Array(n - 1);
  const dy = new Float64Array(n - 1);
  const slope = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    dx[i] = Math.max(p[i + 1].x - p[i].x, 1e-9);
    dy[i] = p[i + 1].y - p[i].y;
    slope[i] = dy[i] / dx[i];
  }

  const m = new Float64Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) m[i] = 0;
    else m[i] = (slope[i - 1] + slope[i]) / 2;
  }
  // Condición de monotonía.
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      const t = 3 / h;
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }

  return (x) => {
    if (x <= p[0].x) return p[0].y + m[0] * (x - p[0].x);
    if (x >= p[n - 1].x) return p[n - 1].y + m[n - 1] * (x - p[n - 1].x);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (p[mid].x <= x) lo = mid; else hi = mid;
    }
    const h = dx[lo];
    const t = (x - p[lo].x) / h;
    const t2 = t * t, t3 = t2 * t;
    return (
      p[lo].y * (2 * t3 - 3 * t2 + 1) +
      h * m[lo] * (t3 - 2 * t2 + t) +
      p[lo + 1].y * (-2 * t3 + 3 * t2) +
      h * m[lo + 1] * (t3 - t2)
    );
  };
}

const IDENTITY_CURVE = [{ x: 0, y: 0 }, { x: 1, y: 1 }];

function isIdentity(pts) {
  if (!pts || pts.length !== 2) return false;
  return pts[0].x === 0 && pts[0].y === 0 && pts[1].x === 1 && pts[1].y === 1;
}

/**
 * Compone curva maestra ∘ curva de canal en una única LUT 1D de 256 entradas
 * (RGBA8: r/g/b = canal ya compuesto con la maestra). Una sola textura, tres
 * lecturas en el shader.
 */
export function buildCurveLUT(curves) {
  const master = monotoneSpline(curves?.master?.length ? curves.master : IDENTITY_CURVE);
  const red = monotoneSpline(curves?.red?.length ? curves.red : IDENTITY_CURVE);
  const green = monotoneSpline(curves?.green?.length ? curves.green : IDENTITY_CURVE);
  const blue = monotoneSpline(curves?.blue?.length ? curves.blue : IDENTITY_CURVE);
  const data = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    data[i * 4 + 0] = clamp255(master(red(x)));
    data[i * 4 + 1] = clamp255(master(green(x)));
    data[i * 4 + 2] = clamp255(master(blue(x)));
    data[i * 4 + 3] = 255;
  }
  return data;
}

export function curvesAreNeutral(curves) {
  if (!curves) return true;
  return (
    isIdentity(curves.master) && isIdentity(curves.red) &&
    isIdentity(curves.green) && isIdentity(curves.blue)
  );
}

function clamp255(v) {
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

/* ─────────────────────────── Utilidades varias ───────────────────────────── */

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export function lerp(a, b, t) { return a + (b - a) * t; }

/**
 * Rueda de color (matiz 0..360, saturación 0..1) → desplazamiento RGB con media
 * cero, tal y como lo esperan los controles lift/gamma/gain.
 */
export function wheelToRGB(hueDeg, sat) {
  const h = ((hueDeg % 360) + 360) % 360 / 60;
  const i = Math.floor(h) % 6;
  const f = h - Math.floor(h);
  const table = [
    [1, f, 0], [1 - f, 1, 0], [0, 1, f],
    [0, 1 - f, 1], [f, 0, 1], [1, 0, 1 - f],
  ];
  const rgb = table[i];
  const mean = (rgb[0] + rgb[1] + rgb[2]) / 3;
  return [(rgb[0] - mean) * sat, (rgb[1] - mean) * sat, (rgb[2] - mean) * sat];
}

/* ───────────────── Curva característica de película (densitométrica) ───────
 *
 * Sigmoide asimétrica sobre la exposición logarítmica: la forma real de una
 * curva característica H&D (Hurter–Driffield). Cada canal lleva sus propios
 * parámetros, y de esa asimetría entre canales nace el "crossover" de color en
 * sombras y altas luces que da carácter a cada emulsión.
 *
 *   S(u) = u / (1 + u^n)^(1/n)          sigmoide normalizada: S(0)=0, S(∞)=1
 *
 *   raw(x) = q -    q ·S( m·(-x)/q,   toe      )    x < 0   (pie)
 *   raw(x) = q + (1-q)·S( m· x /(1-q), shoulder )   x ≥ 0   (hombro)
 *   y(x)   = raw(x) · norm
 *
 * con x en diafragmas respecto del gris medio y m = contraste en el pivote.
 *
 * Propiedades que se verifican numéricamente en el arranque:
 *   · continuidad C¹ en el pivote — raw'(0⁻) = raw'(0⁺) = m, y `norm` es una
 *     escala uniforme, así que no introduce ningún codo;
 *   · el pie tiende a 0 de forma asintótica (x → −∞), nunca corta a un
 *     diafragma finito: las sombras conservan latitud, como en una emulsión;
 *   · y(whiteStops) = 1 exacto — `norm` ancla ahí el blanco del soporte;
 *   · y(0) = pivotY exacto — el gris medio no se mueve. Para lograrlo se
 *     resuelve por bisección el pivote crudo `q`, ya que `norm` depende de él.
 * ------------------------------------------------------------------------- */

/** log2(0.18): el gris medio expresado en diafragmas. */
export const MID_GREY_LOG2 = Math.log2(0.18);

/** Codificación sRGB del gris medio: dónde "imprime" el gris 18 %. */
export const MID_GREY_PRINT = linearToSrgb(0.18); // ≈ 0.4626

/** Pendiente de la codificación sRGB en el gris medio, en unidades por diafragma.
 *  Se usa como unidad de referencia del parámetro `gamma`. */
export const SRGB_SLOPE_AT_MID = (Math.LN2 / 2.4) * 1.055 * Math.pow(0.18, 1 / 2.4); // ≈ 0.1457

/** Diafragmas del blanco lineal 1.0 sobre el gris medio. */
export const WHITE_STOPS = -MID_GREY_LOG2; // ≈ 2.474

function sigmoid01(u, n) {
  if (u <= 0) return 0;
  return u / Math.pow(1 + Math.pow(u, n), 1 / n);
}

function filmRaw(x, m, q, toePow, shPow) {
  if (x >= 0) return q + (1 - q) * sigmoid01((m * x) / (1 - q), shPow);
  return q - q * sigmoid01((m * -x) / q, toePow);
}

/**
 * Resuelve un canal de película.
 *
 * Entrada (parámetros de autoría, todos intuitivos):
 *   gamma       contraste base en los medios, en múltiplos de la pendiente
 *               sRGB. Ojo: es el valor ANTES de `norm`, así que la pendiente
 *               final del pivote sale algo mayor; lo que importa es que crece
 *               de forma monótona y comparable entre emulsiones.
 *   toe         dureza del pie. Bajo = sombras lavadas; alto = sombras densas.
 *   shoulder    dureza del hombro. Bajo = altas luces muy laminadas.
 *   pivotX      desplazamiento de exposición del canal, en diafragmas.
 *   pivotY      valor de copia del gris medio en ese canal.
 *   whiteStops  diafragmas sobre el gris medio que imprimen blanco puro.
 *
 * Salida: los seis escalares que consume el shader.
 */
export function resolveFilmChannel(ch) {
  const m = Math.max(ch.gamma, 0.05) * SRGB_SLOPE_AT_MID;
  const toe = Math.max(ch.toe, 0.2);
  const shoulder = Math.max(ch.shoulder, 0.2);
  const whiteStops = Math.max(ch.whiteStops ?? WHITE_STOPS, 0.5);
  const pivotY = clamp(ch.pivotY ?? MID_GREY_PRINT, 0.02, 0.98);

  // `norm` = 1 / raw(whiteStops) depende de q, y queremos q·norm = pivotY.
  // q ↦ q / raw(whiteStops; q) es monótona creciente, así que bisecamos.
  let lo = 1e-4, hi = 0.999;
  for (let i = 0; i < 60; i++) {
    const q = (lo + hi) / 2;
    const printed = q / filmRaw(whiteStops, m, q, toe, shoulder);
    if (printed < pivotY) lo = q; else hi = q;
  }
  const q = (lo + hi) / 2;
  const norm = 1 / filmRaw(whiteStops, m, q, toe, shoulder);

  return { m, toe, shoulder, pivotX: ch.pivotX || 0, q, norm };
}

/** Respuesta de un canal ya resuelto: escena lineal → valor de display [0,1]. */
export function filmicChannel(lin, r) {
  const x = Math.log2(Math.max(lin, 1e-7)) - MID_GREY_LOG2 - r.pivotX;
  return clamp(filmRaw(x, r.m, r.q, r.toe, r.shoulder) * r.norm, 0, 1);
}

/** Resuelve los tres canales de una emulsión. */
export function resolveFilmCurves(curves) {
  return {
    r: resolveFilmChannel(curves.r),
    g: resolveFilmChannel(curves.g),
    b: resolveFilmChannel(curves.b),
  };
}
