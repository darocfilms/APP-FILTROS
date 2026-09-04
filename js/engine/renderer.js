/**
 * renderer.js — Orquestador del pipeline.
 *
 * Traduce los ajustes del laboratorio a uniformes y encadena los pases:
 *
 *   origen → [geometría] → BASE → pirámide de desenfoques → COMPOSITE → salida
 *
 * La misma clase sirve para la previsualización, la cámara en directo y la
 * exportación a resolución completa: sólo cambia el tamaño del lienzo. Por eso
 * lo que se ve en pantalla es exactamente lo que se guarda.
 */

import { GLContext } from './glcore.js';
import {
  VERT_QUAD, FRAG_GEOMETRY, FRAG_BASE, FRAG_DOWNSAMPLE, FRAG_BLUR, FRAG_COMPOSITE, FRAG_BLIT,
} from './shaders.js';
import * as CS from './colorscience.js';
import { getFilm } from '../data/films.js';

/** Resolución de referencia del grano: hace que el tamaño relativo no dependa
 *  de si estamos previsualizando o exportando. */
const GRAIN_REFERENCE = 1400;

/** Lado de la reducción que alimenta el histograma. */
const HISTOGRAM_SIZE = 128;

/** Valor de uFlip cuando no hay que voltear nada. Compartido para no crear un
 *  Float32Array por pase y fotograma. */
const NO_FLIP = new Float32Array([1, 1]);

/* ───────────────────────────── Matrices 3×3 UV ───────────────────────────── */

const m3 = {
  id: () => [1, 0, 0, 0, 1, 0, 0, 0, 1],
  mul(a, b) {
    const o = new Array(9);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
      }
    }
    return o;
  },
  translate: (x, y) => [1, 0, x, 0, 1, y, 0, 0, 1],
  scale: (x, y) => [x, 0, 0, 0, y, 0, 0, 0, 1],
  rotate(rad) {
    const c = Math.cos(rad), s = Math.sin(rad);
    return [c, -s, 0, s, c, 0, 0, 0, 1];
  },
  /** WebGL espera column-major. */
  toGL(m) {
    return new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
  },
};

/**
 * Zoom mínimo para que un rectángulo girado siga cubriendo todo el encuadre,
 * sin esquinas vacías.
 */
export function autoZoomForRotation(w, h, deg) {
  const a = Math.abs((deg * Math.PI) / 180);
  if (a < 1e-6) return 1;
  const cos = Math.cos(a), sin = Math.sin(a);
  return Math.max((w * cos + h * sin) / w, (w * sin + h * cos) / h);
}

/* ─────────────────────────────── Renderer ────────────────────────────────── */

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{onRestored?:()=>void}} [hooks] aviso de que hay que volver a
   *        subir la fuente y redibujar tras recuperar el contexto.
   */
  constructor(canvas, hooks = {}) {
    this.ctx = new GLContext(canvas);
    this.canvas = canvas;
    this.srcTex = null;
    this.lutTex = null;
    this.srcWidth = 0;
    this.srcHeight = 0;
    this._lutKey = '';
    this._filmCache = new Map();
    this._programs = null;

    // Al perderse el contexto no queda nada válido: ni programas, ni texturas,
    // ni LUT. Se marca todo para reconstruirlo en el siguiente dibujado.
    this.ctx.onLost = () => {
      this._programs = null;
      this.srcTex = null;
      this.lutTex = null;
      this._histTex = null;
      this._lutKey = '';
    };
    this.ctx.onRestored = () => hooks.onRestored?.();
  }

  get maxTexture() { return this.ctx.maxTexture; }
  get lost() { return this.ctx.lost; }

  _prog() {
    if (this._programs) return this._programs;
    const c = this.ctx;
    this._programs = {
      geometry: c.program('geometry', VERT_QUAD, FRAG_GEOMETRY),
      base: c.program('base', VERT_QUAD, FRAG_BASE),
      down: c.program('down', VERT_QUAD, FRAG_DOWNSAMPLE),
      blur: c.program('blur', VERT_QUAD, FRAG_BLUR),
      composite: c.program('composite', VERT_QUAD, FRAG_COMPOSITE),
      blit: c.program('blit', VERT_QUAD, FRAG_BLIT),
    };
    return this._programs;
  }

  /** Sube el fotograma o la imagen de origen. Reutiliza la textura si encaja. */
  setSource(source, width, height) {
    this.srcWidth = width;
    this.srcHeight = height;
    this.srcTex = this.ctx.uploadSource(this.srcTex, source, width, height);
    return this;
  }

  /* ─────────────────────── Resolución de parámetros ───────────────────── */

  /** Las curvas de una emulsión sólo se resuelven una vez. */
  _film(filmDef) {
    let r = this._filmCache.get(filmDef.id);
    if (!r) {
      const c = CS.resolveFilmCurves(filmDef.curves);
      r = {
        m: new Float32Array([c.r.m, c.g.m, c.b.m]),
        q: new Float32Array([c.r.q, c.g.q, c.b.q]),
        toe: new Float32Array([c.r.toe, c.g.toe, c.b.toe]),
        sh: new Float32Array([c.r.shoulder, c.g.shoulder, c.b.shoulder]),
        pivotX: new Float32Array([c.r.pivotX, c.g.pivotX, c.b.pivotX]),
        norm: new Float32Array([c.r.norm, c.g.norm, c.b.norm]),
        matrix: CS.matToGL(filmDef.matrix),
      };
      this._filmCache.set(filmDef.id, r);
    }
    return r;
  }

  _curveLUT(curves) {
    const key = JSON.stringify(curves);
    if (key !== this._lutKey) {
      this.lutTex = this.ctx.uploadLUT(this.lutTex, CS.buildCurveLUT(curves));
      this._lutKey = key;
    }
    return this.lutTex;
  }

  /**
   * Dimensiones del original después del giro de 90°. El recorte se define
   * sobre ESTE marco, que es el que el usuario ve y sobre el que arrastra.
   */
  rotatedSize(params, srcW = this.srcWidth, srcH = this.srcHeight) {
    const quarter = ((((params.geometry?.rotate || 0) / 90) % 4) + 4) % 4;
    return quarter % 2 === 0 ? { w: srcW, h: srcH } : { w: srcH, h: srcW };
  }

  /** Tamaño de salida: el recorte aplicado sobre el marco girado. */
  outputSize(params, srcW = this.srcWidth, srcH = this.srcHeight) {
    const r = this.rotatedSize(params, srcW, srcH);
    const crop = params.geometry?.crop || { w: 1, h: 1 };
    return {
      width: Math.max(1, Math.round(r.w * crop.w)),
      height: Math.max(1, Math.round(r.h * crop.h)),
    };
  }

  /**
   * Matriz UV de destino → origen.
   *
   * Se compone en píxeles con la Y hacia abajo, que es como piensa la interfaz,
   * y sólo al final se pasa a coordenadas de textura. El orden de lectura es el
   * inverso al del efecto visual: primero se deshace el recorte, luego el
   * enderezado, luego el giro y por último el espejo.
   */
  _geometryMatrix(params, outW, outH) {
    const g = params.geometry || {};
    const crop = g.crop || { x: 0, y: 0, w: 1, h: 1 };
    const quarter = ((((g.rotate || 0) / 90) % 4) + 4) % 4;
    const straighten = g.straighten || 0;
    const srcW = this.srcWidth, srcH = this.srcHeight;
    const rot = this.rotatedSize(params);

    const cropX = crop.x * rot.w;
    const cropY = crop.y * rot.h;
    const cropW = crop.w * rot.w;
    const cropH = crop.h * rot.h;

    // UV de destino → píxeles de destino (Y hacia abajo).
    let m = [outW, 0, 0, 0, -outH, outH, 0, 0, 1];

    // Recorte: desplaza al rectángulo dentro del marco girado.
    m = m3.mul(m3.translate(cropX, cropY), m);

    // Enderezado: se deshace girando alrededor del centro del recorte, con el
    // zoom justo para que no aparezcan esquinas vacías.
    if (Math.abs(straighten) > 1e-6) {
      const cx = cropX + cropW / 2;
      const cy = cropY + cropH / 2;
      const zoom = autoZoomForRotation(cropW, cropH, straighten);
      m = m3.mul(m3.translate(-cx, -cy), m);
      m = m3.mul(m3.rotate((-straighten * Math.PI) / 180), m);
      m = m3.mul(m3.scale(1 / zoom, 1 / zoom), m);
      m = m3.mul(m3.translate(cx, cy), m);
    }

    // Giro de 90°: del marco girado a píxeles del original.
    const unrotate = [
      [1, 0, 0, 0, 1, 0, 0, 0, 1],                  //   0°
      [0, 1, 0, -1, 0, rot.w, 0, 0, 1],             //  90° horario
      [-1, 0, srcW, 0, -1, srcH, 0, 0, 1],          // 180°
      [0, -1, rot.h, 1, 0, 0, 0, 0, 1],             // 270°
    ][quarter];
    m = m3.mul(unrotate, m);

    // Espejos, ya en el sistema del original.
    if (g.flipH) m = m3.mul([-1, 0, srcW, 0, 1, 0, 0, 0, 1], m);
    if (g.flipV) m = m3.mul([1, 0, 0, 0, -1, srcH, 0, 0, 1], m);

    // Píxeles del original → UV de textura. La textura se sube sin voltear, así
    // que v = 0 es la fila de arriba.
    m = m3.mul([1 / srcW, 0, 0, 0, 1 / srcH, 0, 0, 0, 1], m);
    return m3.toGL(m);
  }

  _isGeometryNeutral(params) {
    const g = params.geometry || {};
    const c = g.crop;
    const fullCrop = !c || (c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1);
    return fullCrop && !g.rotate && !g.straighten && !g.flipH && !g.flipV;
  }

  /** Traduce los ajustes a los uniformes de la etapa BASE. */
  _baseUniforms(params, filmDef) {
    const film = this._film(filmDef);
    const wb = CS.whiteBalanceMatrix(params.color.temp, params.color.tint);
    const mix = filmDef.neutral ? 0 : Math.max(0, Math.min(1, params.film.strength));

    // Las ruedas de etalonaje se resuelven a desplazamientos RGB de media cero
    // más un desplazamiento de luminancia.
    const zone = (z) => {
      const rgb = CS.wheelToRGB(z.h, z.s);
      return new Float32Array([rgb[0] * 0.6 + z.l, rgb[1] * 0.6 + z.l, rgb[2] * 0.6 + z.l]);
    };

    const useCurve = CS.curvesAreNeutral(params.curves) ? 0 : 1;

    return {
      uSrc: null,                       // lo pone render()
      uCurve: this._curveLUT(params.curves),
      uUseCurve: useCurve,
      uWB: CS.matToGL(wb),
      uExposure: params.light.exposure,
      uFilmMatrix: film.matrix,
      uFilmMix: mix,
      uFilmM: film.m,
      uFilmQ: film.q,
      uFilmToe: film.toe,
      uFilmSh: film.sh,
      uFilmPivotX: film.pivotX,
      uFilmNorm: film.norm,
      uContrast: params.light.contrast,
      uHighlights: params.light.highlights,
      uShadows: params.light.shadows,
      uWhites: params.light.whites,
      uBlacks: params.light.blacks,
      uMatteLow: params.light.matteLow,
      uMatteHigh: params.light.matteHigh,
      uVibrance: params.color.vibrance,
      uSaturation: params.color.saturation,
      uHueShift: params.color.hueShift,
      uMono: params.color.mono ? 1 : 0,
      uMonoMix: new Float32Array(params.color.monoMix),
      uLift: zone(params.grade.shadows),
      uGammaOff: zone(params.grade.mids),
      uGain: zone(params.grade.highs),
      uGradeBalance: params.grade.balance,
      uHSLHue: new Float32Array(params.hsl.hue),
      uHSLSat: new Float32Array(params.hsl.sat),
      uHSLLum: new Float32Array(params.hsl.lum),
      uFlip: NO_FLIP,
    };
  }

  _compositeUniforms(params, width, height, seed) {
    const e = params.effects;
    const v = params.vignette;
    const d = params.detail;
    return {
      uTexel: new Float32Array([1 / width, 1 / height]),
      uAspect: new Float32Array([width / height, 1]),
      uClarity: d.clarity,
      uTexture: d.texture,
      uSharpen: d.sharpen,
      uDenoise: d.denoise,
      uGrainAmt: e.grain,
      uGrainSize: e.grainSize,
      uGrainRough: e.grainRough,
      uGrainChroma: e.grainChroma,
      uHaloAmt: e.halation,
      uHaloThresh: e.haloThresh,
      uHaloTint: new Float32Array(e.haloTint),
      uBloomAmt: e.bloom,
      uBloomThresh: e.bloomThresh,
      uDiffusion: e.diffusion,
      uVigAmt: v.amount,
      uVigMid: v.mid,
      uVigFeather: v.feather,
      uVigRound: v.round,
      uCA: e.ca,
      uSeed: seed,
      uGrainRef: GRAIN_REFERENCE,
      uFlip: NO_FLIP,
    };
  }

  /* ──────────────────────────── Render ─────────────────────────────── */

  /**
   * Dibuja un fotograma completo en el lienzo.
   * @param {object} params  ajustes del laboratorio
   * @param {object} [opts]
   * @param {boolean} [opts.mirror]   espeja en horizontal (cámara frontal)
   * @param {number}  [opts.seed]     semilla del grano; fija = grano estable
   * @param {boolean} [opts.bypass]   dibuja el origen sin procesar (antes/después)
   * @returns {{width:number,height:number}} tamaño renderizado
   */
  render(params, opts = {}) {
    if (!this.srcTex) return { width: 0, height: 0 };
    const c = this.ctx;
    const P = this._prog();
    const filmDef = getFilm(params.film.id);
    const seed = opts.seed ?? 1;
    const mirror = opts.mirror ? new Float32Array([-1, 1]) : new Float32Array([1, 1]);

    const { width, height } = this.outputSize(params);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    /* Etapa 0 — geometría (sólo si hace falta).
       Quien lee la textura de origen es quien voltea la Y: a partir de ahí
       todos los destinos intermedios comparten la orientación del lienzo. */
    let source = this.srcTex;
    let geoTex = null;
    let sourceNeedsFlip = true;
    if (!this._isGeometryNeutral(params)) {
      geoTex = c.lease(width, height);
      c.draw(P.geometry, geoTex, {
        uSrc: this.srcTex,
        uXform: this._geometryMatrix(params, width, height),
        uFlip: NO_FLIP,
      });
      source = geoTex;
      sourceNeedsFlip = false;   // el volteo ya va dentro de uXform
    }
    const flipY = sourceNeedsFlip ? -1 : 1;

    if (opts.bypass) {
      c.draw(P.blit, null, { uSrc: source, uFlip: new Float32Array([mirror[0], flipY]) });
      c.release(geoTex);
      return { width, height };
    }

    /* Etapa 1 — grade punto a punto. */
    const base = c.lease(width, height);
    const baseU = this._baseUniforms(params, filmDef);
    baseU.uSrc = source;
    // Aquí se resuelve la orientación definitiva: espejo de la cámara frontal y,
    // si la fuente se lee en crudo, el volteo vertical. Todo lo que viene
    // después (grano, viñeta, halación) trabaja ya en el sentido correcto.
    baseU.uFlip = new Float32Array([mirror[0], flipY]);
    c.draw(P.base, base, baseU);
    c.release(geoTex);

    /* Etapa 2 — pirámide. */
    const needsBlur = this._needsBlur(params);
    let blurS = base, blurL = base;
    const scratch = [];
    if (needsBlur) {
      let cur = base;
      const levels = [];
      for (let i = 0; i < 4; i++) {
        const w = Math.max(1, Math.floor(width / (2 ** (i + 1))));
        const h = Math.max(1, Math.floor(height / (2 ** (i + 1))));
        const dst = c.lease(w, h);
        c.draw(P.down, dst, {
          uSrc: cur,
          uTexel: new Float32Array([1 / cur.width, 1 / cur.height]),
          uFlip: NO_FLIP,
        });
        levels.push(dst);
        scratch.push(dst);
        cur = dst;
      }
      blurS = this._gaussian(levels[1], scratch);   // 1/4  → textura y claridad
      blurL = this._gaussian(levels[3], scratch);   // 1/16 → halación y bloom
    }

    /* Etapa 3 — composición. */
    const compU = this._compositeUniforms(params, width, height, seed);
    compU.uBase = base;
    compU.uBlurS = blurS;
    compU.uBlurL = blurL;

    if (opts.histogram) {
      // Con histograma la composición va a textura y de ahí al lienzo. El paso
      // extra permite reducirla a 128×128 y leer 64 KB en vez de los megabytes
      // del lienzo entero: leer píxeles bloquea la GPU, y hacerlo a resolución
      // completa en cada movimiento de un deslizador se nota como tirones.
      const full = c.lease(width, height);
      c.draw(P.composite, full, compU);
      c.draw(P.blit, null, { uSrc: full, uFlip: NO_FLIP });
      this._buildHistogramTexture(full);
      c.release(full);
    } else {
      c.draw(P.composite, null, compU);
    }

    c.release(base, ...scratch);
    return { width, height };
  }

  /** Reduce la imagen final a una textura pequeña, sólo para el histograma. */
  _buildHistogramTexture(full) {
    const c = this.ctx;
    const P = this._prog();
    let cur = full;
    const temps = [];
    while (Math.max(cur.width, cur.height) > HISTOGRAM_SIZE * 2) {
      const dst = c.lease(Math.max(1, cur.width >> 1), Math.max(1, cur.height >> 1));
      c.draw(P.down, dst, {
        uSrc: cur,
        uTexel: new Float32Array([1 / cur.width, 1 / cur.height]),
        uFlip: NO_FLIP,
      });
      if (cur !== full) temps.push(cur);
      cur = dst;
    }
    if (!this._histTex || this._histTex.width !== cur.width || this._histTex.height !== cur.height) {
      if (this._histTex) c.gl.deleteTexture(this._histTex.tex);
      this._histTex = c.createTexture(cur.width, cur.height, { filter: 'nearest' });
    }
    c.draw(P.blit, this._histTex, { uSrc: cur, uFlip: NO_FLIP });
    if (cur !== full) temps.push(cur);
    c.release(...temps);
  }

  /** Desenfoque gaussiano separable sobre un nivel de la pirámide. */
  _gaussian(level, scratch) {
    const c = this.ctx;
    const P = this._prog();
    const tmp = c.lease(level.width, level.height);
    const out = c.lease(level.width, level.height);
    c.draw(P.blur, tmp, { uSrc: level, uDir: new Float32Array([1 / level.width, 0]), uFlip: NO_FLIP });
    c.draw(P.blur, out, { uSrc: tmp, uDir: new Float32Array([0, 1 / level.height]), uFlip: NO_FLIP });
    scratch.push(tmp, out);
    return out;
  }

  _needsBlur(params) {
    const e = params.effects, d = params.detail;
    return Math.abs(d.clarity) > 1e-4 || Math.abs(d.texture) > 1e-4
      || e.halation > 1e-4 || e.bloom > 1e-4 || e.diffusion > 1e-4;
  }

  /* ──────────────────────────── Histograma ─────────────────────────────── */

  /**
   * Histograma de la imagen ya revelada, calculado sobre la reducción que deja
   * `render({ histogram: true })`. Sin esa reducción no hay histograma: es
   * deliberado, para que nadie acabe leyendo el lienzo entero por descuido.
   */
  histogram(bins = 64) {
    const t = this._histTex;
    if (!t) return null;
    const px = this.ctx.readPixels(t, 0, 0, t.width, t.height);
    const r = new Uint32Array(bins), g = new Uint32Array(bins);
    const b = new Uint32Array(bins), l = new Uint32Array(bins);
    const k = bins / 256;
    for (let i = 0; i < px.length; i += 4) {
      r[(px[i] * k) | 0]++;
      g[(px[i + 1] * k) | 0]++;
      b[(px[i + 2] * k) | 0]++;
      l[((px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722) * k) | 0]++;
    }
    return { r, g, b, l, bins };
  }

  dispose() {
    const gl = this.ctx.gl;
    if (this.srcTex) gl.deleteTexture(this.srcTex.tex);
    if (this.lutTex) gl.deleteTexture(this.lutTex.tex);
    if (this._histTex) gl.deleteTexture(this._histTex.tex);
    this.srcTex = this.lutTex = this._histTex = null;
    this.ctx.dispose();
  }
}

/* ────────────────────── Renderizado fuera de pantalla ────────────────────── */

/**
 * Revela una imagen a resolución completa en un lienzo aparte y devuelve el
 * blob. Usa su propio contexto WebGL, que se destruye al terminar: así el pico
 * de memoria de vídeo de una exportación de 12 Mpx no se queda ocupado durante
 * el resto de la sesión, que es justo lo que tumba a Safari en iPhone.
 *
 * @param {ImageBitmap|HTMLImageElement|HTMLCanvasElement} source
 * @param {object} params
 * @param {object} [opts] { type, quality, maxSize }
 * @returns {Promise<{blob:Blob,width:number,height:number,scaled:boolean}>}
 */
export async function renderToBlob(source, params, opts = {}) {
  const type = opts.type || 'image/jpeg';
  const quality = opts.quality ?? 0.95;
  const srcW = source.width || source.videoWidth || source.naturalWidth;
  const srcH = source.height || source.videoHeight || source.naturalHeight;

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const renderer = new Renderer(canvas);

  try {
    // El límite de textura del dispositivo manda: por encima, se reduce.
    const limit = Math.min(renderer.maxTexture, opts.maxSize || Infinity);
    let w = srcW, h = srcH, scaled = false;
    if (Math.max(w, h) > limit) {
      const k = limit / Math.max(w, h);
      w = Math.max(1, Math.round(w * k));
      h = Math.max(1, Math.round(h * k));
      scaled = true;
    }

    let uploadSource = source;
    let temp = null;
    if (scaled) {
      temp = document.createElement('canvas');
      temp.width = w;
      temp.height = h;
      temp.getContext('2d').drawImage(source, 0, 0, w, h);
      uploadSource = temp;
    }

    renderer.setSource(uploadSource, w, h);
    const size = renderer.render(params, { seed: opts.seed ?? 1 });

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo codificar la imagen'))), type, quality);
    });

    if (temp) { temp.width = temp.height = 0; }
    return { blob, width: size.width, height: size.height, scaled };
  } finally {
    renderer.dispose();
    canvas.width = canvas.height = 0;
  }
}
