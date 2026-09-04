/**
 * shaders.js — Todo el GLSL del laboratorio.
 *
 * El pipeline tiene tres etapas:
 *   1. BASE       — todo lo que es punto a punto (color, tono, curvas, HSL,
 *                   etalonaje). Escribe una imagen ya codificada a display.
 *   2. PIRÁMIDE   — reducciones sucesivas + desenfoque separable. De ahí salen
 *                   el desenfoque corto (claridad) y el largo (halación/bloom).
 *   3. COMPOSITE  — todo lo que necesita vecindad: nitidez, grano, halación,
 *                   difusión, viñeta, aberración cromática y tramado final.
 */

export const VERT_QUAD = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
uniform vec2 uFlip;   // (-1,1) espeja en horizontal; (1,-1) en vertical
out vec2 vUV;
void main() {
  vec2 p = aPos * uFlip;
  vUV = p * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/* Fragmentos compartidos por varios shaders. */
const COMMON = `
precision highp float;
precision highp sampler2D;

const float PI = 3.141592653589793;
const float MID_GREY_LOG2 = -2.4739311883324122;  // log2(0.18)
const float MID_PRINT     = 0.46135613;           // sRGB(0.18)
const vec3  LUMA_709 = vec3(0.2126, 0.7152, 0.0722);

float luma(vec3 c) { return dot(c, LUMA_709); }

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

vec3 linearToSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

/**
 * Contraste biyectivo en [0,1] con pivote.
 *
 * Por debajo del pivote se aplica una potencia y por encima su reflejo, con la
 * misma pendiente a ambos lados del punto de unión. Es exactamente la identidad
 * cuando el contraste es 0, nunca se sale del rango y por tanto nunca recorta:
 * el contraste redistribuye la escala, no la amputa.
 */
vec3 contrastCurve(vec3 c, float amount, float pivot) {
  if (abs(amount) < 1.0e-5) return c;
  float gamma = exp2(amount * 1.2);
  float p = clamp(pivot, 0.02, 0.98);
  vec3 lo = p * pow(clamp(c / p, 0.0, 1.0), vec3(gamma));
  vec3 hi = p + (1.0 - p) * (1.0 - pow(clamp((1.0 - c) / (1.0 - p), 0.0, 1.0), vec3(gamma)));
  return mix(lo, hi, step(vec3(p), c));
}

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  const float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// Hash entero de Jenkins: ruido blanco reproducible, sin las bandas diagonales
// del clásico fract(sin(dot(...))).
uint hashU(uint x) {
  x += (x << 10u); x ^= (x >>  6u);
  x += (x <<  3u); x ^= (x >> 11u);
  x += (x << 15u);
  return x;
}
float hash21(vec2 p, float seed) {
  uvec2 q = uvec2(ivec2(floor(p))) * uvec2(1597334673u, 3812015801u);
  uint n = hashU(q.x ^ q.y ^ uint(seed * 65536.0));
  return float(n & 0x00FFFFFFu) / float(0x01000000u);
}
// Ruido de valor con interpolación suave.
float valueNoise(vec2 p, float seed) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i + vec2(0.0, 0.0), seed);
  float b = hash21(i + vec2(1.0, 0.0), seed);
  float c = hash21(i + vec2(0.0, 1.0), seed);
  float d = hash21(i + vec2(1.0, 1.0), seed);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`;

/* ═══════════════════════════════ ETAPA 1: BASE ═══════════════════════════ */

export const FRAG_BASE = `#version 300 es
${COMMON}

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uSrc;
uniform sampler2D uCurve;        // LUT 1D 256×1, canales ya compuestos
uniform float     uUseCurve;

// — Escena (antes de la curva de película) —
uniform mat3  uWB;               // adaptación cromática
uniform float uExposure;         // diafragmas
uniform mat3  uFilmMatrix;       // acoplamiento entre capas de la emulsión
uniform float uFilmMix;          // 0 = digital limpio, 1 = emulsión completa

// — Curva característica, resuelta en JS —
uniform vec3 uFilmM, uFilmQ, uFilmToe, uFilmSh, uFilmPivotX, uFilmNorm;

// — Display-referred —
uniform float uContrast, uHighlights, uShadows, uWhites, uBlacks;
uniform float uVibrance, uSaturation, uHueShift;
uniform float uMatteLow, uMatteHigh;
uniform vec3  uLift, uGammaOff, uGain;   // etalonaje de 3 vías (ya con el tinte de la película)
uniform float uGradeBalance;
uniform float uMono;
uniform vec3  uMonoMix;
uniform float uHSLHue[8], uHSLSat[8], uHSLLum[8];

const float HSL_CENTERS[8] = float[8](0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 280.0, 320.0);

float sigmoid01(float u, float n) {
  if (u <= 0.0) return 0.0;
  return u / pow(1.0 + pow(u, n), 1.0 / n);
}

// Curva característica H&D por canal. Ver colorscience.js: el JS resuelve q y
// norm de modo que el pivote y el blanco caen exactos y la derivada es continua.
vec3 filmResponse(vec3 lin) {
  vec3 x = log2(max(lin, vec3(1.0e-7))) - vec3(MID_GREY_LOG2) - uFilmPivotX;
  vec3 outc;
  for (int i = 0; i < 3; i++) {
    float q = uFilmQ[i], m = uFilmM[i];
    float v = x[i] >= 0.0
      ? q + (1.0 - q) * sigmoid01((m * x[i]) / (1.0 - q), uFilmSh[i])
      : q -        q  * sigmoid01((m * -x[i]) / q,        uFilmToe[i]);
    outc[i] = v * uFilmNorm[i];
  }
  return outc;
}

float bandWeight(float hueDeg, float center) {
  float d = abs(mod(hueDeg - center + 540.0, 360.0) - 180.0);
  return max(0.0, 1.0 - d / 60.0);
}

void main() {
  vec3 c = texture(uSrc, vUV).rgb;

  /* ── Escena ─────────────────────────────────────────────────────────── */
  vec3 lin = srgbToLinear(clamp(c, 0.0, 1.0));
  lin = uWB * lin;
  lin *= exp2(uExposure);
  lin = max(lin, vec3(0.0));

  // Acoplamiento entre capas: la luz que expone una capa vela un poco las otras.
  lin = mix(lin, max(uFilmMatrix * lin, vec3(0.0)), uFilmMix);

  // La entrada ya viene referida a display, así que el "sin película" es la
  // codificación sRGB exacta (identidad). La emulsión se mezcla contra eso.
  c = mix(linearToSrgb(lin), filmResponse(lin), uFilmMix);
  c = clamp(c, 0.0, 1.0);

  /* ── Tono ───────────────────────────────────────────────────────────── */
  float l = luma(c);
  float wShadow = pow(1.0 - smoothstep(0.0, 0.62, l), 2.0);
  float wHigh   = pow(smoothstep(0.38, 1.0, l), 2.0);
  float wBlack  = pow(1.0 - smoothstep(0.0, 0.28, l), 2.0);
  float wWhite  = pow(smoothstep(0.72, 1.0, l), 2.0);

  c *= 1.0 + uShadows * 0.85 * wShadow + uHighlights * 0.55 * wHigh;
  c += vec3(uBlacks * 0.22 * wBlack + uWhites * 0.30 * wWhite);
  c = max(c, vec3(0.0));

  // Contraste con pivote en el gris medio impreso.
  c = contrastCurve(clamp(c, 0.0, 1.0), uContrast, MID_PRINT);

  /* ── Curvas ─────────────────────────────────────────────────────────── */
  if (uUseCurve > 0.5) {
    c = vec3(
      texture(uCurve, vec2(c.r, 0.5)).r,
      texture(uCurve, vec2(c.g, 0.5)).g,
      texture(uCurve, vec2(c.b, 0.5)).b);
  }

  /* ── HSL por bandas ─────────────────────────────────────────────────── */
  vec3 hsv = rgb2hsv(c);
  float hueDeg = hsv.x * 360.0;
  float wsum = 0.0, dHue = 0.0, dSat = 0.0, dLum = 0.0;
  for (int i = 0; i < 8; i++) {
    float w = bandWeight(hueDeg, HSL_CENTERS[i]);
    wsum += w;
    dHue += w * uHSLHue[i];
    dSat += w * uHSLSat[i];
    dLum += w * uHSLLum[i];
  }
  if (wsum > 1.0e-4) {
    float inv = 1.0 / wsum;
    // Sólo actúa donde hay color: en un gris el matiz no significa nada.
    float chroma = smoothstep(0.02, 0.18, hsv.y);
    hsv.x = fract(hsv.x + (dHue * inv) * (1.0 / 360.0) * 30.0 * chroma);
    hsv.y = clamp(hsv.y * (1.0 + (dSat * inv) * chroma), 0.0, 1.0);
    c = hsv2rgb(hsv);
    c *= 1.0 + (dLum * inv) * 0.5 * chroma;
  }

  /* ── Matiz global ───────────────────────────────────────────────────── */
  if (abs(uHueShift) > 1.0e-4) {
    vec3 h = rgb2hsv(max(c, vec3(0.0)));
    h.x = fract(h.x + uHueShift / 360.0);
    c = hsv2rgb(h);
  }

  /* ── Monocromo ──────────────────────────────────────────────────────── */
  if (uMono > 0.5) {
    float g = dot(max(c, vec3(0.0)), uMonoMix / max(dot(uMonoMix, vec3(1.0)), 1.0e-4));
    c = vec3(g);
  }

  /* ── Etalonaje de 3 vías ────────────────────────────────────────────── */
  float lg = luma(max(c, vec3(0.0)));
  float pivot = clamp(0.5 + uGradeBalance * 0.3, 0.05, 0.95);
  float ws = pow(1.0 - smoothstep(0.0, pivot, lg), 1.6);
  float wh = pow(smoothstep(pivot, 1.0, lg), 1.6);
  float wm = max(0.0, 1.0 - ws - wh);
  c += uLift * ws + uGammaOff * wm + uGain * wh;
  c = max(c, vec3(0.0));

  /* ── Saturación e intensidad ────────────────────────────────────────── */
  float lv = luma(c);
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float satNow = mx - mn;
  // La intensidad respeta lo ya saturado y frena en los naranjas de la piel.
  float hueNow = rgb2hsv(c).x * 360.0;
  float skin = 1.0 - 0.55 * bandWeight(hueNow, 25.0);
  float vib = uVibrance * (1.0 - smoothstep(0.0, 0.7, satNow)) * skin;
  c = mix(vec3(lv), c, max(0.0, 1.0 + uSaturation + vib));

  /* ── Velado / mate ──────────────────────────────────────────────────── */
  c = vec3(uMatteLow) + c * (uMatteHigh - uMatteLow);

  fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

/* ══════════════════════════ ETAPA 2: PIRÁMIDE ════════════════════════════ */

export const FRAG_DOWNSAMPLE = `#version 300 es
${COMMON}
in vec2 vUV;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform vec2 uTexel;   // texel del ORIGEN
void main() {
  // Cuatro muestras bilineales desplazadas media unidad: box 4×4 efectivo.
  vec3 s = texture(uSrc, vUV + uTexel * vec2(-0.5, -0.5)).rgb
         + texture(uSrc, vUV + uTexel * vec2( 0.5, -0.5)).rgb
         + texture(uSrc, vUV + uTexel * vec2(-0.5,  0.5)).rgb
         + texture(uSrc, vUV + uTexel * vec2( 0.5,  0.5)).rgb;
  fragColor = vec4(s * 0.25, 1.0);
}`;

export const FRAG_BLUR = `#version 300 es
${COMMON}
in vec2 vUV;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform vec2 uDir;     // (texel.x,0) o (0,texel.y), ya escalado por el radio
void main() {
  // Gaussiana de 9 taps resuelta con 5 muestras bilineales.
  const float o[3] = float[3](0.0, 1.3846153846, 3.2307692308);
  const float w[3] = float[3](0.2270270270, 0.3162162162, 0.0702702703);
  vec3 s = texture(uSrc, vUV).rgb * w[0];
  for (int i = 1; i < 3; i++) {
    s += texture(uSrc, vUV + uDir * o[i]).rgb * w[i];
    s += texture(uSrc, vUV - uDir * o[i]).rgb * w[i];
  }
  fragColor = vec4(s, 1.0);
}`;

/* ═══════════════════════════ ETAPA 3: COMPOSITE ══════════════════════════ */

export const FRAG_COMPOSITE = `#version 300 es
${COMMON}

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uBase;    // salida de la etapa 1, resolución completa
uniform sampler2D uBlurS;   // desenfoque corto  (1/4)  → claridad
uniform sampler2D uBlurL;   // desenfoque largo  (1/16) → halación, bloom, difusión
uniform vec2  uTexel;       // 1 / resolución del base
uniform vec2  uAspect;      // (w/h, 1) normalizado, para la viñeta

uniform float uClarity, uTexture, uSharpen, uDenoise;
uniform float uGrainAmt, uGrainSize, uGrainRough, uGrainChroma;
uniform float uHaloAmt, uHaloThresh;
uniform vec3  uHaloTint;
uniform float uBloomAmt, uBloomThresh, uDiffusion;
uniform float uVigAmt, uVigMid, uVigFeather, uVigRound;
uniform float uCA, uSeed, uGrainRef;

void main() {
  /* ── Aberración cromática (desplazamiento radial por canal) ─────────── */
  vec2 d = vUV - 0.5;
  vec3 base;
  if (abs(uCA) > 1.0e-4) {
    float s = uCA * 0.004;
    base = vec3(
      texture(uBase, 0.5 + d * (1.0 + s)).r,
      texture(uBase, vUV).g,
      texture(uBase, 0.5 + d * (1.0 - s)).b);
  } else {
    base = texture(uBase, vUV).rgb;
  }

  vec3 c = base;

  /* ── Reducción de ruido: media bilateral 3×3 sobre la crominancia ───── */
  if (uDenoise > 1.0e-4) {
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 s = texture(uBase, vUV + vec2(float(x), float(y)) * uTexel).rgb;
        float w = exp(-dot(s - base, s - base) / max(0.0025, 0.02 * uDenoise));
        acc += s * w; wsum += w;
      }
    }
    vec3 sm = acc / max(wsum, 1.0e-4);
    // Conserva el detalle de luminancia y suaviza sobre todo el color.
    c = mix(c, vec3(luma(c) - luma(sm)) + sm, uDenoise);
  }

  /* ── Nitidez (máscara de desenfoque de 5 taps) ──────────────────────── */
  if (uSharpen > 1.0e-4) {
    vec3 n = texture(uBase, vUV + vec2(uTexel.x, 0.0)).rgb
           + texture(uBase, vUV - vec2(uTexel.x, 0.0)).rgb
           + texture(uBase, vUV + vec2(0.0, uTexel.y)).rgb
           + texture(uBase, vUV - vec2(0.0, uTexel.y)).rgb;
    c += (c - n * 0.25) * uSharpen * 1.6;
  }

  vec3 blurS = texture(uBlurS, vUV).rgb;
  vec3 blurL = texture(uBlurL, vUV).rgb;

  /* ── Textura: alta frecuencia (base − desenfoque corto) ─────────────── */
  if (abs(uTexture) > 1.0e-4) {
    c += (base - blurS) * uTexture * 1.2;
  }

  /* ── Claridad: contraste local sobre el desenfoque largo ────────────── */
  if (abs(uClarity) > 1.0e-4) {
    float dl = luma(base) - luma(blurL);
    c += vec3(dl) * uClarity * 1.5;
  }

  /* ── Difusión tipo Pro-Mist: vela las luces sin tocar el contraste ──── */
  if (uDiffusion > 1.0e-4) {
    c = 1.0 - (1.0 - c) * (1.0 - blurL * uDiffusion * 0.55);
  }

  /* ── Halación: la luz atraviesa la emulsión, rebota en el soporte y
        vuelve, velando de rojo-naranja alrededor de las altas luces. ──── */
  if (uHaloAmt > 1.0e-4) {
    vec3 bright = max(blurL - vec3(uHaloThresh), vec3(0.0)) / max(1.0 - uHaloThresh, 0.05);
    float energy = max(max(bright.r, bright.g), bright.b);
    vec3 halo = uHaloTint * energy * uHaloAmt;
    c = 1.0 - (1.0 - c) * (1.0 - clamp(halo, 0.0, 1.0));
  }

  /* ── Bloom neutro ───────────────────────────────────────────────────── */
  if (uBloomAmt > 1.0e-4) {
    vec3 bright = max(blurL - vec3(uBloomThresh), vec3(0.0)) / max(1.0 - uBloomThresh, 0.05);
    c += bright * uBloomAmt * 0.6;
  }

  /* ── Grano ──────────────────────────────────────────────────────────
     Las coordenadas se refieren a una resolución fija, así que el tamaño
     relativo del grano es el mismo en la previsualización y en la exportación:
     lo que se ve en pantalla es lo que sale en el archivo. */
  if (uGrainAmt > 1.0e-4) {
    vec2 gp = vUV * vec2(uGrainRef * uAspect.x, uGrainRef) / max(uGrainSize, 0.05);
    float n1 = valueNoise(gp, uSeed);
    float n2 = valueNoise(gp * 2.17 + 31.7, uSeed + 7.0);
    float g = mix(n1, (n1 + n2) * 0.5, uGrainRough) - 0.5;
    // Los haluros revelados son máximos en los medios: el grano casi
    // desaparece en el negro sólido y en el blanco quemado.
    float lv = luma(c);
    float density = 4.0 * lv * (1.0 - lv);
    density = mix(0.35, 1.0, density);
    if (uGrainChroma > 1.0e-4) {
      vec3 gc = vec3(g,
        mix(g, valueNoise(gp + 13.3, uSeed + 3.0) - 0.5, uGrainChroma),
        mix(g, valueNoise(gp + 47.1, uSeed + 11.0) - 0.5, uGrainChroma));
      c += gc * uGrainAmt * density * 0.55;
    } else {
      c += vec3(g) * uGrainAmt * density * 0.55;
    }
  }

  /* ── Viñeta ─────────────────────────────────────────────────────────── */
  if (abs(uVigAmt) > 1.0e-4) {
    vec2 v = d * 2.0;
    float ax = mix(1.0, uAspect.x, uVigRound);
    v.x *= ax;
    // Normaliza por la esquina: con redondez 1 la caída es un círculo real en
    // píxeles; con 0 sigue la forma del encuadre.
    float r = length(v) / length(vec2(ax, 1.0));
    float mask = smoothstep(uVigMid + uVigFeather, max(uVigMid - uVigFeather, 0.0), r);
    c *= 1.0 + uVigAmt * (mask - 1.0);
  }

  /* ── Tramado: rompe el bandeado al cuantizar a 8 bits ───────────────── */
  float dither = (hash21(gl_FragCoord.xy, uSeed + 101.0) - 0.5) / 255.0;
  fragColor = vec4(clamp(c + dither, 0.0, 1.0), 1.0);
}`;

/* ══════════════════════════ ETAPA 0: GEOMETRÍA ═══════════════════════════
 *
 * Recorte, giro de 90°, enderezado y espejo en un solo pase, antes de tocar el
 * color. `uXform` mapea UV de destino → UV de origen; se compone en JS.
 */

export const FRAG_GEOMETRY = `#version 300 es
${COMMON}
in vec2 vUV;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform mat3 uXform;
void main() {
  vec2 uv = (uXform * vec3(vUV, 1.0)).xy;
  vec3 c = texture(uSrc, clamp(uv, 0.0, 1.0)).rgb;
  // Lo que cae fuera del original se va a negro en vez de estirar el borde.
  vec2 e = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  fragColor = vec4(c * e.x * e.y, 1.0);
}`;

/* ═══════════════════════════════ AUXILIARES ══════════════════════════════ */

export const FRAG_BLIT = `#version 300 es
${COMMON}
in vec2 vUV;
out vec4 fragColor;
uniform sampler2D uSrc;
void main() { fragColor = vec4(texture(uSrc, vUV).rgb, 1.0); }`;
