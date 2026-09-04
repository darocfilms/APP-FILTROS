/**
 * glcore.js — Envoltorio mínimo sobre WebGL2: compilación de programas, caché
 * de uniformes, quad de pantalla completa y un pool de framebuffers.
 *
 * El pool importa: en un iPhone crear y destruir texturas a resolución completa
 * en cada fotograma dispara el recolector y provoca tirones. Aquí se reutilizan.
 */

export class GLError extends Error {}

/** Anota el log del compilador con la línea de código fuente correspondiente. */
function annotate(src, log) {
  const lines = src.split('\n');
  return String(log)
    .trim()
    .split('\n')
    .map((entry) => {
      const m = entry.match(/^\w+:\s*\d+:(\d+):/);
      if (!m) return entry;
      const n = parseInt(m[1], 10);
      const ctx = lines[n - 1] !== undefined ? `\n      → ${lines[n - 1].trim()}` : '';
      return entry + ctx;
    })
    .join('\n');
}

export class GLContext {
  /**
   * @param {HTMLCanvasElement|OffscreenCanvas} canvas
   */
  constructor(canvas) {
    const opts = {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true, // necesario para toBlob() tras el render
      powerPreference: 'high-performance',
      desynchronized: true,
    };
    const gl = canvas.getContext('webgl2', opts);
    if (!gl) throw new GLError('WebGL2 no disponible');

    this.gl = gl;
    this.canvas = canvas;
    this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.programs = new Map();
    this.pool = [];
    this.leased = new Set();

    // Quad de pantalla completa compartido por todos los pases.
    this._initState();

    // iOS reclama contextos WebGL al pasar la aplicación a segundo plano o
    // cuando anda justo de memoria de vídeo. Sin `preventDefault` el contexto
    // no se puede restaurar y la pestaña se queda con el lienzo en negro para
    // siempre; con él, el navegador dispara `webglcontextrestored` y se
    // reconstruye todo.
    this._onLost = (e) => {
      e.preventDefault();
      this.programs.clear();
      this.pool.length = 0;
      this.leased.clear();
      this.onLost?.();
    };
    this._onRestored = () => {
      this.vao = null;
      this.fbo = null;
      this._initState();
      this.onRestored?.();
    };
    canvas.addEventListener('webglcontextlost', this._onLost);
    canvas.addEventListener('webglcontextrestored', this._onRestored);
  }

  /** Recrea los objetos que no sobreviven a la pérdida del contexto. */
  _initState() {
    const gl = this.gl;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.fbo = gl.createFramebuffer();
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
  }

  get lost() { return this.gl.isContextLost(); }

  /* ───────────────────────────── Programas ──────────────────────────── */

  program(key, vertSrc, fragSrc) {
    if (this.programs.has(key)) return this.programs.get(key);
    const gl = this.gl;
    const vs = this._shader(gl.VERTEX_SHADER, vertSrc);
    const fs = this._shader(gl.FRAGMENT_SHADER, fragSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new GLError(`No se pudo enlazar "${key}":\n${log}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    const uniforms = new Map();
    const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(prog, i);
      const name = info.name.replace(/\[0\]$/, '');
      uniforms.set(name, { loc: gl.getUniformLocation(prog, info.name), type: info.type, size: info.size });
    }
    const entry = { prog, uniforms };
    this.programs.set(key, entry);
    return entry;
  }

  _shader(type, src) {
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
      throw new GLError(`Error compilando el shader ${kind}:\n${annotate(src, log)}`);
    }
    return sh;
  }

  /* ───────────────────────────── Texturas ───────────────────────────── */

  createTexture(width, height, { filter = 'linear', wrap = 'clamp' } = {}) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this._texParams(tex, filter, wrap);
    return { tex, width, height };
  }

  _texParams(tex, filter, wrap) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const f = filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
    const w = wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w);
  }

  /** Sube una imagen/vídeo/ImageBitmap reutilizando la textura si cabe. */
  uploadSource(existing, source, width, height) {
    const gl = this.gl;
    let target = existing;
    if (!target || target.width !== width || target.height !== height) {
      if (target) gl.deleteTexture(target.tex);
      target = { tex: gl.createTexture(), width, height };
      gl.bindTexture(gl.TEXTURE_2D, target.tex);
      this._texParams(target.tex, 'linear', 'clamp');
    }
    gl.bindTexture(gl.TEXTURE_2D, target.tex);
    // FLIP_Y se deja desactivado A PROPÓSITO: la especificación de WebGL manda
    // ignorarlo cuando la fuente es un ImageBitmap, así que con él activo un
    // <canvas> y un ImageBitmap salían con orientaciones distintas. Aquí la
    // convención es siempre la misma —v = 0 es la fila superior— y el volteo lo
    // hace el primer pase que lee la fuente, mediante el uniforme uFlip.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    return target;
  }

  /** LUT 1D de 256×1 con filtrado lineal. */
  uploadLUT(existing, data) {
    const gl = this.gl;
    let target = existing;
    if (!target) {
      target = { tex: gl.createTexture(), width: 256, height: 1 };
      gl.bindTexture(gl.TEXTURE_2D, target.tex);
      this._texParams(target.tex, 'linear', 'clamp');
    }
    gl.bindTexture(gl.TEXTURE_2D, target.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return target;
  }

  /* ────────────────────── Pool de framebuffers ──────────────────────── */

  /** Toma prestada una textura de las dimensiones pedidas. */
  lease(width, height) {
    width = Math.max(1, width | 0);
    height = Math.max(1, height | 0);
    const idx = this.pool.findIndex((t) => t.width === width && t.height === height);
    let t;
    if (idx >= 0) t = this.pool.splice(idx, 1)[0];
    else t = this.createTexture(width, height);
    this.leased.add(t);
    return t;
  }

  release(...textures) {
    for (const t of textures) {
      if (!t || !this.leased.has(t)) continue;
      this.leased.delete(t);
      this.pool.push(t);
    }
  }

  /** Libera la memoria de vídeo del pool (al salir del laboratorio, por ejemplo). */
  purge() {
    const gl = this.gl;
    for (const t of this.pool) gl.deleteTexture(t.tex);
    this.pool.length = 0;
  }

  /* ───────────────────────────── Dibujado ───────────────────────────── */

  /**
   * Ejecuta un pase.
   * @param {{prog:WebGLProgram,uniforms:Map}} program
   * @param {object|null} target  textura destino, o null para el canvas
   * @param {object} uniforms     valores por nombre
   */
  draw(program, target, uniforms) {
    const gl = this.gl;
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.tex, 0);
      gl.viewport(0, 0, target.width, target.height);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }

    gl.useProgram(program.prog);
    let unit = 0;
    for (const [name, value] of Object.entries(uniforms)) {
      const u = program.uniforms.get(name);
      if (!u) continue;
      this._setUniform(u, value, () => unit++);
    }
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  _setUniform(u, value, nextUnit) {
    const gl = this.gl;
    // Textura: {tex} o un WebGLTexture directo.
    if (value && (value.tex || value instanceof WebGLTexture)) {
      const unit = nextUnit();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, value.tex || value);
      gl.uniform1i(u.loc, unit);
      return;
    }
    if (typeof value === 'number') { gl.uniform1f(u.loc, value); return; }
    if (typeof value === 'boolean') { gl.uniform1f(u.loc, value ? 1 : 0); return; }

    const arr = value instanceof Float32Array ? value : new Float32Array(value);
    switch (u.type) {
      case gl.FLOAT_MAT3: gl.uniformMatrix3fv(u.loc, false, arr); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(u.loc, false, arr); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, arr); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, arr); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, arr); break;
      default: gl.uniform1fv(u.loc, arr); break;   // también cubre float[N]
    }
  }

  /** Lee píxeles de una textura (o del canvas si target es null). */
  readPixels(target, x, y, w, h) {
    const gl = this.gl;
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.tex, 0);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    const out = new Uint8Array(w * h * 4);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  }

  dispose() {
    const gl = this.gl;
    this.canvas.removeEventListener('webglcontextlost', this._onLost);
    this.canvas.removeEventListener('webglcontextrestored', this._onRestored);
    this.purge();
    for (const { prog } of this.programs.values()) gl.deleteProgram(prog);
    this.programs.clear();
    gl.deleteFramebuffer(this.fbo);
    gl.deleteVertexArray(this.vao);
    // Borrar los recursos no basta: el contexto en sí sigue vivo hasta que lo
    // recoja el recolector, y el navegador sólo admite unos pocos a la vez.
    // Cada exportación crea uno, así que hay que devolverlo explícitamente.
    try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* opcional */ }
  }
}
