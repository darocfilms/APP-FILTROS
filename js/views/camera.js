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

/** Lado mayor de la previsualización en directo. */
const PREVIEW_MAX = 1440;

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

    this.stage = el('div', { class: 'cam__stage' },
      this.canvas, this.grid, this.badge, this.recPill, this.message);

    this.filmStrip = el('div', { class: 'strip' });
    this._buildStrip();

    this.evSlider = el('input', {
      type: 'range', class: 'cam__ev', min: -3, max: 3, step: 0.05, value: 0,
      'aria-label': 'Compensación de exposición',
    });
    this.evSlider.addEventListener('input', () => {
      this.params.light.exposure = parseFloat(this.evSlider.value);
      this.evLabel.textContent = (this.params.light.exposure >= 0 ? '+' : '') + this.params.light.exposure.toFixed(2) + ' EV';
    });
    this.evLabel = el('span', { class: 'cam__evlabel', text: '+0.00 EV' });

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

    return el('section', { class: 'view view--camera', id: 'view-camera' },
      this.stage,
      el('div', { class: 'cam__controls' },
        el('div', { class: 'cam__evrow' }, el('span', { class: 'cam__evicon', text: '☀' }), this.evSlider, this.evLabel),
        this.filmStrip,
        this.modeSwitch,
        el('div', { class: 'cam__bar' },
          el('button', {
            type: 'button', class: 'iconbtn', 'aria-label': 'Cuadrícula',
            onclick: (e) => {
              this.gridOn = !this.gridOn;
              this.grid.hidden = !this.gridOn;
              e.currentTarget.classList.toggle('is-active', this.gridOn);
              haptic();
            },
          }, '⊞'),
          this.shutter,
          el('button', {
            type: 'button', class: 'iconbtn', 'aria-label': 'Cambiar de cámara',
            onclick: () => this.flip(),
          }, '⟳'))));
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
    const constraints = {
      audio: this.mode === 'video' ? { echoCancellation: true } : false,
      video: {
        facingMode: { ideal: this.facing },
        width: { ideal: 3840 },
        height: { ideal: 2160 },
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
        const k = Math.min(1, PREVIEW_MAX / Math.max(v.videoWidth, v.videoHeight));
        const w = Math.round(v.videoWidth * k);
        const h = Math.round(v.videoHeight * k);
        try {
          this.renderer.setSource(v, w, h);
          this.renderer.render(this.params, { mirror: this.mirrored, seed: (performance.now() / 90) | 0 });
        } catch { /* un fotograma perdido no rompe la sesión */ }
      }
      if (this.recorder) this._tickRecording();
      this._schedule(draw);
    };
    this._schedule(draw);
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
