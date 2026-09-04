/**
 * camera.js — Cámara con la emulsión aplicada en directo.
 *
 * Estrategia de resolución
 * ------------------------
 * La previsualización se procesa a resolución limitada (fluidez), pero la foto
 * NO se saca de esa previsualización: al disparar se captura el fotograma
 * actual a resolución nativa con `createImageBitmap(video)` y se revela en un
 * pase aparte a tamaño completo. Así la pantalla va suave y el archivo sale con
 * todo el detalle que da el navegador.
 *
 * El vídeo sí se graba desde el lienzo de previsualización, porque es la única
 * forma de que MediaRecorder reciba los fotogramas ya revelados.
 */

import { el, clear, toast, haptic } from '../utils/dom.js';
import { Renderer, renderToBlob } from '../engine/renderer.js';
import { defaultParams, applyFilmLook, cloneParams } from '../data/params.js';
import { getFilm, FILMS } from '../data/films.js';
import { library, makeThumb } from '../store/library.js';

/**
 * Lado mayor de la previsualización en directo.
 *
 * Se ajusta a la pantalla: en un iPhone con densidad 3× no tiene sentido
 * procesar 1440 px si el visor muestra 1170, ni quedarse corto en un modelo
 * grande. El techo evita que un panel enorme dispare el coste por fotograma.
 */
function previewBudget() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const side = Math.max(window.screen?.width || 0, window.screen?.height || 0, 640);
  return Math.round(Math.min(1920, Math.max(1080, side * dpr)));
}

/**
 * Encuadres.
 *
 * El primero, «Máx», no recorta nada: muestra y captura exactamente lo que
 * entrega la cámara. Es el valor por defecto justamente por eso — imponer 4:3
 * a un dispositivo que sólo ofrece 16:9 tiraría los laterales, que es lo
 * contrario de aprovechar el sensor.
 *
 * Los demás son recortes sobre ESE fotograma, nunca una petición distinta al
 * sistema: así el encuadre es una decisión reversible sobre la toma máxima y no
 * información descartada antes de llegar.
 */
const ASPECTS = [
  { key: 'full', label: 'Máx', ratio: null, note: 'Todo lo que entrega la cámara' },
  { key: '4:3', label: '4:3', ratio: 3 / 4 },
  { key: '1:1', label: '1:1', ratio: 1 },
  { key: '16:9', label: '16:9', ratio: 9 / 16 },
];

const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_CANDIDATES.find((m) => {
    try { return MediaRecorder.isTypeSupported(m); } catch { return false; }
  }) || null;
}

export class CameraView {
  constructor(app) {
    this.app = app;
    this.params = defaultParams();
    this.mode = 'photo';
    this.facing = 'environment';
    this.stream = null;
    this.renderer = null;
    this.running = false;
    this.recorder = null;
    this.chunks = [];
    this.recStart = 0;
    this.gridOn = false;
    this.busy = false;
    this.aspect = 'full';
    this.immersive = false;
    this.previewMax = previewBudget();
    this._frameTimes = [];

    this.video = el('video', { class: 'cam__video', playsinline: '', muted: '', autoplay: '' });
    this.video.muted = true;
    this.canvas = el('canvas', { class: 'cam__canvas' });

    this.root = this._build();
  }

  /* ─────────────────────────────── Interfaz ──────────────────────────── */

  _build() {
    this.badge = el('div', { class: 'cam__badge' });
    this.recPill = el('div', { class: 'cam__rec', hidden: true },
      el('span', { class: 'cam__recdot' }), el('span', { class: 'cam__rectime', text: '0:00' }));
    this.grid = el('div', { class: 'cam__grid', hidden: true });
    this.message = el('div', { class: 'cam__message', hidden: true });
    this.resLabel = el('span', { class: 'cam__res' });

    this.stage = el('div', {
      class: 'cam__stage',
      // Tocar el visor esconde los mandos: el encuadre manda, y a veces hace
      // falta verlo entero sin nada encima.
      onclick: (e) => { if (e.target === this.stage || e.target === this.canvas) this.toggleImmersive(); },
    }, this.canvas, this.grid, this.badge, this.recPill, this.resLabel, this.message);

    /* ── Mandos superiores ─────────────────────────────────────────────── */
    this.evToggle = el('button', {
      type: 'button', class: 'iconbtn iconbtn--sm', 'aria-label': 'Compensación de exposición',
      onclick: (e) => {
        const on = this.evRow.hidden;
        this.evRow.hidden = !on;
        e.currentTarget.classList.toggle('is-active', on);
        haptic();
      },
    }, '☀');

    this.aspectSeg = el('div', { class: 'cam__aspects', role: 'group', 'aria-label': 'Proporción' },
      ASPECTS.map((a) => el('button', {
        type: 'button',
        class: 'cam__aspect' + (a.key === this.aspect ? ' is-active' : ''),
        dataset: { aspect: a.key },
        title: a.note || a.label,
        onclick: () => this.setAspect(a.key),
      }, a.label)));

    this.topBar = el('div', { class: 'cam__top' },
      el('button', {
        type: 'button', class: 'iconbtn iconbtn--sm', 'aria-label': 'Cuadrícula',
        onclick: (e) => {
          this.gridOn = !this.gridOn;
          this.grid.hidden = !this.gridOn;
          e.currentTarget.classList.toggle('is-active', this.gridOn);
          haptic();
        },
      }, '⊞'),
      this.aspectSeg,
      this.evToggle);

    /* ── Mandos inferiores ─────────────────────────────────────────────── */
    this.evSlider = el('input', {
      type: 'range', class: 'cam__ev', min: -3, max: 3, step: 0.05, value: 0,
      'aria-label': 'Compensación de exposición',
    });
    this.evSlider.addEventListener('input', () => {
      this.params.light.exposure = parseFloat(this.evSlider.value);
      this.evLabel.textContent = (this.params.light.exposure >= 0 ? '+' : '') + this.params.light.exposure.toFixed(2);
    });
    this.evSlider.addEventListener('dblclick', () => {
      this.evSlider.value = 0;
      this.evSlider.dispatchEvent(new Event('input'));
    });
    this.evLabel = el('span', { class: 'cam__evlabel', text: '+0.00' });
    this.evRow = el('div', { class: 'cam__evrow', hidden: true }, this.evSlider, this.evLabel, el('span', { class: 'cam__evunit', text: 'EV' }));

    this.filmStrip = el('div', { class: 'strip' });
    this._buildStrip();

    this.shutter = el('button', {
      type: 'button', class: 'shutter', 'aria-label': 'Disparar',
      onclick: () => this._trigger(),
    }, el('span', { class: 'shutter__ring' }), el('span', { class: 'shutter__core' }));

    this.modeSwitch = el('div', { class: 'cam__modes', role: 'tablist' },
      ...[['photo', 'FOTO'], ['video', 'VÍDEO']].map(([k, label]) =>
        el('button', {
          type: 'button', class: 'cam__mode' + (k === this.mode ? ' is-active' : ''),
          dataset: { mode: k }, onclick: () => this.setMode(k),
        }, label)));

    this.bottomBar = el('div', { class: 'cam__bottom' },
      this.evRow,
      this.filmStrip,
      this.modeSwitch,
      el('div', { class: 'cam__bar' },
        el('button', {
          type: 'button', class: 'iconbtn', 'aria-label': 'Mostrar u ocultar los mandos',
          onclick: () => this.toggleImmersive(),
        }, '⤢'),
        this.shutter,
        el('button', {
          type: 'button', class: 'iconbtn', 'aria-label': 'Cambiar de cámara',
          onclick: () => this.flip(),
        }, '⟳')));

    const root = el('section', { class: 'view view--camera', id: 'view-camera' },
      this.stage, this.topBar, this.bottomBar);

    // El visor se reencuadra según lo que ocupen los mandos de verdad, no según
    // un número escrito a mano: al desplegar la exposición o cambiar el alto de
    // la tira de películas, la imagen recupera o cede el espacio justo.
    this._ro = new ResizeObserver(([entry]) => {
      root.style.setProperty('--cam-controls', Math.round(entry.contentRect.height) + 'px');
    });
    this._ro.observe(this.bottomBar);
    return root;
  }

  /** Oculta los mandos para ver el encuadre limpio. */
  toggleImmersive() {
    this.immersive = !this.immersive;
    this.root.classList.toggle('is-immersive', this.immersive);
    haptic();
  }

  /**
   * Cambia el encuadre recortando el fotograma de sensor completo, sin volver a
   * negociar el flujo con el sistema: la toma sigue siendo la máxima posible.
   */
  setAspect(key) {
    this.aspect = key;
    for (const b of this.aspectSeg.children) b.classList.toggle('is-active', b.dataset.aspect === key);
    this._applyAspect();
    haptic();
  }

  _applyAspect() {
    const def = ASPECTS.find((a) => a.key === this.aspect) || ASPECTS[0];
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    if (!vw || !vh) return;

    if (def.ratio === null) {
      // Sin recorte: el fotograma íntegro tal y como llega.
      this.params.geometry.crop = { x: 0, y: 0, w: 1, h: 1 };
    } else {
      // `ratio` es ancho/alto en vertical; si la cámara entrega el fotograma
      // apaisado se invierte, para que el encuadre signifique lo mismo.
      const target = vw >= vh ? 1 / def.ratio : def.ratio;
      const source = vw / vh;
      let w = 1, h = 1;
      if (target > source) h = source / target; else w = target / source;
      this.params.geometry.crop = { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
    }
    this._updateResLabel();
  }

  _updateResLabel() {
    const c = this.params.geometry.crop || { w: 1, h: 1 };
    const w = Math.round((this.nativeWidth || 0) * c.w);
    const h = Math.round((this.nativeHeight || 0) * c.h);
    if (!w || !h) { this.resLabel.textContent = ''; return; }
    const mp = (w * h) / 1e6;
    const completo = this.aspect === 'full' ? ' · sensor completo' : '';
    this.resLabel.textContent = `${w}×${h} · ${mp.toFixed(1)} Mpx${completo}`;
  }

  _buildStrip() {
    clear(this.filmStrip);
    for (const f of FILMS) {
      const btn = el('button', {
        type: 'button',
        class: 'strip__item' + (f.id === this.params.film.id ? ' is-active' : ''),
        dataset: { film: f.id },
        style: { '--c1': f.swatch[0], '--c2': f.swatch[1] },
        onclick: () => this.setFilm(f.id),
      }, el('span', { class: 'strip__swatch' }), el('span', { class: 'strip__name', text: f.name }));
      this.filmStrip.append(btn);
    }
  }

  setFilm(id) {
    const keepExposure = this.params.light.exposure;
    applyFilmLook(this.params, getFilm(id));
    this.params.light.exposure = keepExposure;
    for (const b of this.filmStrip.children) {
      b.classList.toggle('is-active', b.dataset.film === id);
      if (b.dataset.film === id) b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
    this.badge.textContent = getFilm(id).name;
    this.badge.classList.remove('is-hidden');
    clearTimeout(this._badgeTimer);
    this._badgeTimer = setTimeout(() => this.badge.classList.add('is-hidden'), 1800);
    haptic();
  }

  setMode(mode) {
    if (this.recorder) return;
    this.mode = mode;
    for (const b of this.modeSwitch.children) b.classList.toggle('is-active', b.dataset.mode === mode);
    this.shutter.classList.toggle('shutter--video', mode === 'video');
    haptic();
  }

  /* ──────────────────────────── Ciclo de vida ────────────────────────── */

  async activate() {
    this._showMessage(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      return this._showMessage('Este navegador no da acceso a la cámara. En iPhone hace falta Safari sobre HTTPS.');
    }
    if (!window.isSecureContext) {
      return this._showMessage('La cámara sólo funciona sobre HTTPS (o en localhost). Abre la aplicación con una dirección segura.');
    }
    try {
      await this._openStream();
      this._startLoop();
    } catch (err) {
      const map = {
        NotAllowedError: 'Permiso denegado. Actívalo en Ajustes → Safari → Cámara y recarga.',
        NotFoundError: 'No se ha encontrado ninguna cámara en este dispositivo.',
        NotReadableError: 'La cámara está ocupada por otra aplicación.',
        OverconstrainedError: 'La cámara no admite la configuración solicitada.',
      };
      this._showMessage(map[err?.name] || ('No se pudo abrir la cámara: ' + (err?.message || err)));
    }
  }

  deactivate() {
    this.running = false;
    if (this.recorder) this._stopRecording(true);
    this._closeStream();
    this.renderer?.dispose();
    this.renderer = null;
  }

  async _openStream() {
    this._closeStream();
    // Se pide 4:3 a la máxima resolución: es la lectura completa del sensor.
    // Pedir 16:9 parece "más grande" por el número, pero es un RECORTE: el
    // sistema tira las bandas superior e inferior antes de entregarlo, y esa
    // parte de la imagen ya no se puede recuperar. Los demás encuadres se
    // obtienen recortando este fotograma en `_applyAspect`.
    const constraints = {
      audio: this.mode === 'video' ? { echoCancellation: true } : false,
      video: {
        facingMode: { ideal: this.facing },
        width: { ideal: 4032 },
        height: { ideal: 3024 },
        aspectRatio: { ideal: 4 / 3 },
        frameRate: { ideal: 30 },
      },
    };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      if (err?.name !== 'OverconstrainedError' && err?.name !== 'NotReadableError') throw err;
      // Segundo intento sin exigencias de resolución.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: constraints.audio, video: { facingMode: { ideal: this.facing } },
      });
    }
    this.stream = stream;
    this.video.srcObject = stream;
    await this.video.play().catch(() => {});
    await new Promise((resolve) => {
      if (this.video.videoWidth) return resolve();
      this.video.onloadedmetadata = () => resolve();
      setTimeout(resolve, 3000);
    });

    const track = stream.getVideoTracks()[0];
    const settings = track?.getSettings?.() || {};
    this.nativeWidth = settings.width || this.video.videoWidth;
    this.nativeHeight = settings.height || this.video.videoHeight;
    this._applyAspect();
    this._showMessage(null);
  }

  _closeStream() {
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    this.video.srcObject = null;
  }

  async flip() {
    if (this.recorder) return;
    this.facing = this.facing === 'environment' ? 'user' : 'environment';
    haptic();
    try {
      await this._openStream();
    } catch {
      this.facing = this.facing === 'environment' ? 'user' : 'environment';
      toast('No se pudo cambiar de cámara', { error: true });
    }
  }

  get mirrored() { return this.facing === 'user'; }

  /* ─────────────────────────── Bucle de dibujo ───────────────────────── */

  _startLoop() {
    if (this.running) return;
    this.running = true;
    if (!this.renderer) {
      try {
        // El bucle vuelve a subir el fotograma en cada pasada, así que
        // recuperarse del contexto no exige nada más que no dejar de dibujar.
        this.renderer = new Renderer(this.canvas);
      } catch (err) {
        return this._showMessage('Este navegador no admite WebGL2, necesario para el procesado en directo.');
      }
    }

    const draw = () => {
      if (!this.running) return;
      const v = this.video;
      if (v.readyState >= 2 && v.videoWidth) {
        const t0 = performance.now();
        const k = Math.min(1, this.previewMax / Math.max(v.videoWidth, v.videoHeight));
        const w = Math.round(v.videoWidth * k);
        const h = Math.round(v.videoHeight * k);
        try {
          this.renderer.setSource(v, w, h);
          this.renderer.render(this.params, { mirror: this.mirrored, seed: (performance.now() / 90) | 0 });
          this._measure(performance.now() - t0);
        } catch { /* un fotograma perdido no rompe la sesión */ }
      }
      if (this.recorder) this._tickRecording();
      this._schedule(draw);
    };
    this._schedule(draw);
  }

  /**
   * Baja la resolución de la previsualización si el dispositivo no llega.
   *
   * Un iPhone reciente procesa el visor a resolución de pantalla sin despeinarse;
   * uno de hace cinco años, no. En vez de elegir un número conservador para
   * todos, se mide el coste real por fotograma y se ajusta. Nunca sube de nuevo
   * dentro de la misma sesión: oscilar entre dos nitideces se ve peor que
   * quedarse en la baja.
   */
  _measure(ms) {
    if (this.recorder) return;                 // grabando no se toca la resolución
    const t = this._frameTimes;
    t.push(ms);
    if (t.length < 40) return;
    const median = t.slice().sort((a, b) => a - b)[t.length >> 1];
    t.length = 0;
    // 22 ms de presupuesto: deja margen bajo los 33 ms de 30 fps.
    if (median > 22 && this.previewMax > 720) {
      this.previewMax = Math.max(720, Math.round(this.previewMax * 0.8));
    }
  }

  _schedule(fn) {
    // requestVideoFrameCallback evita dibujar dos veces el mismo fotograma.
    if (this.video.requestVideoFrameCallback) this.video.requestVideoFrameCallback(() => fn());
    else requestAnimationFrame(fn);
  }

  /* ──────────────────────────── Disparador ───────────────────────────── */

  _trigger() {
    if (this.busy) return;
    if (this.mode === 'photo') this._capturePhoto();
    else if (this.recorder) this._stopRecording();
    else this._startRecording();
  }

  async _capturePhoto() {
    if (!this.video.videoWidth) return toast('La cámara aún no está lista');
    this.busy = true;
    this.shutter.classList.add('is-busy');
    this.stage.classList.add('is-flashing');
    haptic(18);
    setTimeout(() => this.stage.classList.remove('is-flashing'), 180);

    let bitmap = null;
    try {
      // Fotograma actual a resolución nativa, no la previsualización reducida.
      bitmap = await createImageBitmap(this.video);
      const params = cloneParams(this.params);
      if (this.mirrored) params.geometry.flipH = !params.geometry.flipH;

      const { blob, width, height } = await renderToBlob(bitmap, params, {
        type: 'image/jpeg', quality: 0.95, seed: 1,
      });

      const film = getFilm(params.film.id);
      // La emulsión ya está grabada en los píxeles: se archiva como registro de
      // cómo se reveló, no como ajustes activos, para que al reabrir la foto en
      // el laboratorio no se aplique por segunda vez.
      const item = await library.put(blob, {
        kind: 'photo', width, height, filmId: film.id, filmName: film.name,
        params: null, appliedParams: params, origin: 'camara',
      });
      const thumbSource = await createImageBitmap(blob, { resizeWidth: 480, resizeQuality: 'medium' })
        .catch(() => null);
      if (thumbSource) {
        await library.putThumb(item.id, await makeThumb(thumbSource));
        thumbSource.close?.();
      }
      toast(`Foto guardada · ${width}×${height} · ${film.name}`);
      this.app.notifyCapture(item);
    } catch (err) {
      console.error(err);
      toast('No se pudo guardar la foto: ' + (err?.message || err), { error: true });
    } finally {
      bitmap?.close?.();
      this.busy = false;
      this.shutter.classList.remove('is-busy');
    }
  }

  /* ──────────────────────────── Grabación ────────────────────────────── */

  async _startRecording() {
    const mime = pickMime();
    if (!mime) return toast('Este navegador no permite grabar vídeo', { error: true });
    if (!this.stream) return;

    // Si se entró en modo vídeo con un stream sin audio, se reabre con micro.
    if (!this.stream.getAudioTracks().length) {
      try { await this._openStream(); } catch { /* se graba sin sonido */ }
    }

    try {
      const canvasStream = this.canvas.captureStream(30);
      const audio = this.stream.getAudioTracks();
      if (audio.length) canvasStream.addTrack(audio[0]);

      this.chunks = [];
      this.recorder = new MediaRecorder(canvasStream, {
        mimeType: mime,
        videoBitsPerSecond: 12_000_000,
        audioBitsPerSecond: 128_000,
      });
      this.recorder.ondataavailable = (e) => { if (e.data?.size) this.chunks.push(e.data); };
      this.recorder.onstop = () => this._finishRecording(mime);
      this.recorder.start(1000);

      this.recStart = performance.now();
      this.recPill.hidden = false;
      this.shutter.classList.add('is-recording');
      this.modeSwitch.classList.add('is-locked');
      haptic(20);
    } catch (err) {
      this.recorder = null;
      toast('No se pudo iniciar la grabación: ' + (err?.message || err), { error: true });
    }
  }

  _tickRecording() {
    const s = Math.floor((performance.now() - this.recStart) / 1000);
    const text = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    const node = this.recPill.querySelector('.cam__rectime');
    if (node.textContent !== text) node.textContent = text;
  }

  _stopRecording(silent = false) {
    if (!this.recorder) return;
    this._silentStop = silent;
    try { this.recorder.stop(); } catch { /* ya estaba parada */ }
    this.recPill.hidden = true;
    this.shutter.classList.remove('is-recording');
    this.modeSwitch.classList.remove('is-locked');
    haptic(20);
  }

  async _finishRecording(mime) {
    const chunks = this.chunks;
    const durationMs = performance.now() - this.recStart;
    this.recorder = null;
    this.chunks = [];
    if (this._silentStop || !chunks.length) { this._silentStop = false; return; }

    try {
      const blob = new Blob(chunks, { type: mime.split(';')[0] });
      const film = getFilm(this.params.film.id);
      const item = await library.put(blob, {
        kind: 'video', width: this.canvas.width, height: this.canvas.height,
        durationMs, filmId: film.id, filmName: film.name,
        params: null, appliedParams: cloneParams(this.params), origin: 'camara',
      });
      // Miniatura: el propio lienzo con el último fotograma revelado.
      await library.putThumb(item.id, await makeThumb(this.canvas));
      toast(`Vídeo guardado · ${Math.round(durationMs / 1000)} s · ${film.name}`);
      this.app.notifyCapture(item);
    } catch (err) {
      console.error(err);
      toast('No se pudo guardar el vídeo: ' + (err?.message || err), { error: true });
    }
  }

  /* ──────────────────────────────── Varios ───────────────────────────── */

  _showMessage(text) {
    this.message.hidden = !text;
    if (text) {
      clear(this.message).append(
        el('p', { text }),
        el('button', { type: 'button', class: 'btn btn--primary', text: 'Reintentar', onclick: () => this.activate() }));
    }
  }
}
