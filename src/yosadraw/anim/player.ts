import type { CanvasEngine } from '../engine';
import { Emitter } from '../engine/Emitter';
import type { AudioEngine } from './audio';
import { playRange } from './model';
import type { FrameRenderer } from './render';

export type PreviewQuality = 1 | 0.5 | 0.25;

/**
 * Reproductor en tiempo real.
 *
 * El reloj es el del audio (AudioContext) si hay clips, así imagen y sonido no se
 * separan; si no, el reloj del sistema. En cada refresco de pantalla se calcula
 * qué fotograma toca y se compone desde la caché por cels (FrameRenderer) a la
 * resolución de pantalla × calidad. Con el tiempo sobrante se preparan los
 * fotogramas siguientes. Si un fotograma no llega a tiempo se salta (como un
 * reproductor de vídeo) y se cuenta como perdido: la velocidad nunca se altera.
 */
export class Player extends Emitter<{ state: boolean; frame: number; stats: { fps: number; dropped: number } }> {
  quality: PreviewQuality = 1;
  /** Mostrar las pistas de referencia al reproducir. */
  showReference = true;
  private raf = 0;
  private surface = document.createElement('canvas');
  private frameImg = document.createElement('canvas');
  private t0 = 0;
  private from = 0;
  private shown = -1;
  private stats = { frames: 0, dropped: 0, since: 0 };
  private useAudio = false;

  constructor(private engine: CanvasEngine, private frames: FrameRenderer, private audio: AudioEngine) {
    super();
    this.surface.dataset.layer = 'playback';
    // Precalentado: con la reproducción parada, en los ratos libres se rasterizan los dibujos
    // del intervalo (empezando por el fotograma actual) mientras quepan en la caché.
    for (const ev of ['frame', 'history', 'view', 'document'] as const) engine.on(ev, () => this.scheduleWarm());
  }

  private warmTimer = 0;
  private warmIdle = 0;
  scheduleWarm() {
    clearTimeout(this.warmTimer);
    if (this.warmIdle) cancelIdleCallback(this.warmIdle);
    this.warmIdle = 0;
    if (this.playing || !this.engine.doc.anim) return;
    this.warmTimer = window.setTimeout(() => { this.warmIdle = requestIdleCallback(this.warm, { timeout: 500 }); }, 400);
  }
  private warm = (deadline: IdleDeadline) => {
    this.warmIdle = 0;
    const a = this.engine.doc.anim;
    if (!a || this.playing) return;
    if (this.engine.isDrawing) { this.scheduleWarm(); return; }
    const scale = this.scale(), [r0, r1] = playRange(a);
    const n = r1 - r0 + 1;
    for (let i = 0; i < n; i++) {
      if (deadline.timeRemaining() < 3 || !this.frames.roomy) break;
      const f = r0 + ((a.current - r0 + i) % n + n) % n;
      if (this.frames.ready(f, scale, this.showReference)) continue;
      this.frames.prepare(f, scale, this.showReference, deadline.timeRemaining() - 2);
      if (!this.frames.ready(f, scale, this.showReference) || deadline.timeRemaining() < 3) { this.warmIdle = requestIdleCallback(this.warm, { timeout: 500 }); return; }
    }
    // ¿Queda algo por preparar y hay sitio? Otra tanda.
    if (this.frames.roomy) for (let f = r0; f <= r1; f++) if (!this.frames.ready(f, scale, this.showReference)) { this.warmIdle = requestIdleCallback(this.warm, { timeout: 500 }); return; }
  };

  get playing() { return this.raf !== 0; }

  /** Escala a la que se cachean los dibujos para reproducir. */
  get renderScale() { return this.scale(); }

  /** Escala de render: la de pantalla (sin pasar de 1:1 con el documento) × calidad. */
  private scale() {
    const v = this.engine.view;
    return Math.min(1, v.scale * this.engine.dprValue) * this.quality;
  }

  async play() {
    const a = this.engine.doc.anim;
    if (!a || this.playing) return;
    const [r0, r1] = playRange(a);
    if (a.current >= r1 || a.current < r0) this.engine.setFrame(r0, { quiet: true });
    this.engine.setPlaying(true);
    this.engine.setPlaybackSurface(this.surface);
    this.from = a.current;
    this.shown = -1;
    this.stats = { frames: 0, dropped: 0, since: performance.now() };
    this.raf = requestAnimationFrame(this.loop);
    this.useAudio = a.audio.length > 0;
    if (this.useAudio) await this.audio.start(a, this.from / a.fps, (r1 + 1) / a.fps).catch(() => { this.useAudio = false; });
    this.t0 = performance.now();
    this.emit('state', true);
  }

  pause() {
    if (!this.playing) return;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.audio.stop();
    this.engine.setPlaybackSurface(null);
    this.engine.setPlaying(false);
    this.emit('state', false);
    this.scheduleWarm();
  }

  toggle() { if (this.playing) this.pause(); else void this.play(); }

  /** Segundos transcurridos desde el inicio de la reproducción. */
  private elapsed(fps: number) {
    const c = this.useAudio ? this.audio.clock() : null;
    return c !== null ? c - this.from / fps : (performance.now() - this.t0) / 1000;
  }

  private loop = () => {
    const a = this.engine.doc.anim;
    if (!a) { this.pause(); return; }
    const [r0, r1] = playRange(a);
    let f = this.from + Math.floor(this.elapsed(a.fps) * a.fps + 1e-6);
    if (f > r1) {
      if (!a.loop) { this.engine.setFrame(r1); this.pause(); return; }
      // Vuelta al principio del intervalo: se reinicia también el audio.
      this.from = r0;
      f = r0;
      this.t0 = performance.now();
      if (this.useAudio) void this.audio.start(a, r0 / a.fps, (r1 + 1) / a.fps);
    }
    this.raf = requestAnimationFrame(this.loop);
    const scale = this.scale();
    if (f !== this.shown) {
      // Si los dibujos de este fotograma no están preparados y el anterior sí, se intenta igualmente:
      // la caché por cels hace que casi siempre haya poco que rasterizar.
      const t = performance.now();
      this.frames.renderFrame(f, scale, this.frameImg, { background: false, includeReference: this.showReference });
      if (this.shown >= 0 && f > this.shown + 1) this.stats.dropped += f - this.shown - 1;
      this.shown = f;
      this.stats.frames++;
      this.engine.setFrame(f, { quiet: true });
      this.emit('frame', f);
      this.paint(scale);
      // Tiempo sobrante del refresco: preparar los siguientes.
      let budget = Math.max(0, 1000 / a.fps - (performance.now() - t) - 4);
      for (let k = 1; k <= 6 && budget > 1; k++) {
        const nf = f + k > r1 ? r0 + (f + k - r1 - 1) : f + k;
        if (!this.frames.ready(nf, scale, this.showReference)) budget -= this.frames.prepare(nf, scale, this.showReference, budget);
      }
    } else this.paint(scale);
    const now = performance.now();
    if (now - this.stats.since > 1000) {
      this.emit('stats', { fps: (this.stats.frames * 1000) / (now - this.stats.since), dropped: this.stats.dropped });
      this.stats = { frames: 0, dropped: 0, since: now };
    }
  };

  /** Dibuja el fotograma con la vista actual (se puede mover y ampliar mientras se reproduce). */
  private paint(scale: number) {
    const { w, h } = this.engine.viewport, d = this.engine.dprValue;
    const W = Math.round(w * d), H = Math.round(h * d);
    if (this.surface.width !== W || this.surface.height !== H) { this.surface.width = W; this.surface.height = H; this.surface.style.width = `${w}px`; this.surface.style.height = `${h}px`; }
    const g = this.surface.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    const m = this.engine.V;
    g.setTransform(d * m[0] / scale, d * m[1] / scale, d * m[2] / scale, d * m[3] / scale, d * m[4], d * m[5]);
    g.imageSmoothingQuality = this.quality < 1 ? 'low' : 'high';
    g.drawImage(this.frameImg, 0, 0);
  }
}
