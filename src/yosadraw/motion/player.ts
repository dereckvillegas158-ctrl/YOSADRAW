import { scheduleAudio } from './audio';
import { audioContext, type MediaManager } from './media';
import { activeClips, compOf, sourceTime, type Composition, type MediaClip, type Motion } from './model';
import { Compositor } from './render';

/** Clips de vídeo que se ven en `t` (también dentro de composiciones anidadas), con su tiempo de origen. */
export function activeVideos(m: Motion, comp: Composition, t: number, rate = 1, depth = 0): { c: MediaClip; st: number; rate: number }[] {
  const out: { c: MediaClip; st: number; rate: number }[] = [];
  for (const c of activeClips(comp, t)) {
    const lt = t - c.start;
    if (c.kind === 'media') {
      const md = m.media.find(x => x.id === c.media);
      if (md?.kind === 'video') out.push({ c, st: sourceTime(c, lt, md.dur), rate: c.reverse || c.freeze !== null ? 0 : rate * c.speed });
    } else if (c.kind === 'comp' && depth < 8) {
      const sub = m.comps.find(x => x.id === c.comp);
      if (sub) out.push(...activeVideos(m, sub, sourceTime(c, lt, sub.dur), rate * c.speed, depth + 1));
    }
  }
  return out;
}

export interface PlayerOpts {
  /** Resolución de la vista previa: 1, 1/2, 1/4… o 'auto' (baja si no da tiempo). */
  quality: number | 'auto';
  /** Usar proxies de vídeo (si existen) en la vista previa. */
  proxies: boolean;
  /** Repetir el rango al llegar al final. */
  loop: boolean;
}

/**
 * Reproductor en tiempo real de YOSADRAW MOTION.
 *
 * El reloj es el del audio (WebAudio), así imagen y sonido no se desfasan. Los
 * vídeos se reproducen con su decodificador por hardware (elementos <video>
 * sincronizados, se corrigen si se desvían) en lugar de buscar fotograma a
 * fotograma; en pausa se busca el fotograma exacto. La calidad puede bajarse
 * (o bajar sola) para que la interfaz nunca se congele, y lo ya dibujado en
 * pausa se guarda en una caché de fotogramas que se vacía al editar.
 */
export class Player {
  readonly comp: Compositor;
  time = 0;
  playing = false;
  opts: PlayerOpts = { quality: 'auto', proxies: true, loop: true };
  /** Escala real usada (para 'auto'). */
  autoScale = 1;
  onTime: (t: number) => void = () => {};
  onState: (playing: boolean) => void = () => {};
  /** Fotogramas por segundo realmente dibujados durante la reproducción. */
  fps = 0;

  private nodes: AudioScheduledSourceNode[] = [];
  private t0 = 0;
  private a0 = 0;
  private raf = 0;
  private busy = false;
  private pending = false;
  private rev = 0;
  private cache = new Map<string, ImageBitmap>();
  private frames = 0;
  private fpsT = 0;
  private slow = 0;

  constructor(private readonly media: MediaManager, private readonly motion: () => Motion, readonly out: HTMLCanvasElement, private readonly fit: () => number) {
    this.comp = new Compositor(media);
  }

  get composition(): Composition { const m = this.motion(); return compOf(m, m.open); }

  /** Escala de dibujo: la del visor × la calidad elegida. */
  scale() {
    const base = Math.min(1, this.fit() * (window.devicePixelRatio || 1));
    const q = this.opts.quality === 'auto' ? this.autoScale : this.opts.quality;
    return Math.max(0.05, base * q);
  }

  /** Algo cambió (edición): vacía la caché y vuelve a dibujar. */
  invalidate() {
    this.rev++;
    for (const b of this.cache.values()) b.close();
    this.cache.clear();
    if (!this.playing) this.draw();
  }

  private range() {
    const c = this.composition;
    return c.range ? { a: c.range[0], b: c.range[1] } : { a: 0, b: c.dur };
  }

  seek(t: number) {
    const c = this.composition;
    this.time = Math.max(0, Math.min(t, c.dur));
    if (this.playing) { this.stopAudio(); this.start(); }
    else this.draw();
    this.onTime(this.time);
  }

  toggle() { if (this.playing) this.pause(); else void this.play(); }

  async play() {
    if (this.playing) return;
    const r = this.range();
    if (this.time >= r.b - 1e-3 || this.time < r.a - 1e-3) this.time = r.a;
    this.playing = true;
    this.onState(true);
    this.media.useProxies = this.opts.proxies;
    await audioContext().resume().catch(() => undefined);
    this.start();
    this.fpsT = performance.now(); this.frames = 0;
    const loop = () => {
      if (!this.playing) return;
      this.raf = requestAnimationFrame(loop);
      this.tick();
    };
    this.raf = requestAnimationFrame(loop);
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.stopAudio();
    for (const v of this.media.liveVideos()) v.pause();
    this.onState(false);
    this.draw();
  }

  private start() {
    const ctx = audioContext();
    this.t0 = this.time;
    this.a0 = ctx.currentTime + 0.05;
    const r = this.range();
    const m = this.motion(), comp = this.composition;
    const id = ++this.rev;
    void scheduleAudio(ctx, m, comp, this.media, this.t0, r.b, this.a0).then(n => {
      // Si mientras se decodificaba se buscó o se paró, estos nodos sobran.
      if (id !== this.rev || !this.playing) { for (const x of n) try { x.stop(); } catch { /* */ } return; }
      // El audio que tardó en decodificarse arranca con retraso: se reprograma ajustado.
      const late = ctx.currentTime - this.a0;
      if (late > 0.05) { for (const x of n) try { x.stop(); } catch { /* */ } void scheduleAudio(ctx, m, comp, this.media, this.clock(), r.b, ctx.currentTime + 0.02).then(n2 => { if (id === this.rev && this.playing) this.nodes.push(...n2); else for (const x of n2) try { x.stop(); } catch { /* */ } }); }
      else this.nodes.push(...n);
    });
  }

  private stopAudio() {
    for (const n of this.nodes) try { n.stop(); } catch { /* ya parado */ }
    this.nodes = [];
  }

  private clock() { return this.t0 + Math.max(0, audioContext().currentTime - this.a0); }

  private tick() {
    const r = this.range();
    let t = this.clock();
    if (t >= r.b) {
      if (this.opts.loop) { this.time = r.a; this.stopAudio(); this.start(); t = r.a; }
      else { this.time = r.b; this.onTime(r.b); this.pause(); return; }
    }
    this.time = t;
    this.onTime(t);
    this.syncVideos(t);
    if (this.busy) return; // aún dibujando el anterior: se salta este fotograma
    this.busy = true;
    const s0 = performance.now();
    void this.comp.render(this.motion(), this.composition, t, this.out, { scale: this.scale(), preview: true, exact: false }).finally(() => {
      this.busy = false;
      const ms = performance.now() - s0;
      this.frames++;
      const now = performance.now();
      if (now - this.fpsT > 1000) { this.fps = Math.round(this.frames * 1000 / (now - this.fpsT)); this.frames = 0; this.fpsT = now; }
      // Calidad automática: si un fotograma tarda más que un fotograma, se baja; si sobra, se sube.
      if (this.opts.quality === 'auto') {
        const budget = 1000 / this.composition.fps;
        if (ms > budget * 1.1) { if (++this.slow > 3 && this.autoScale > 0.25) { this.autoScale /= 1.5; this.slow = 0; } }
        else if (ms < budget * 0.4 && this.autoScale < 1) { if (--this.slow < -20) { this.autoScale = Math.min(1, this.autoScale * 1.25); this.slow = 0; } }
        else this.slow = 0;
      }
    });
  }

  /** Mantiene los <video> reproduciéndose al ritmo del reloj. */
  private syncVideos(t: number) {
    const m = this.motion();
    const live = new Set<HTMLVideoElement>();
    for (const { c, st, rate } of activeVideos(m, this.composition, t)) {
      const md = m.media.find(x => x.id === c.media)!;
      const v = this.media.peekVideo(c.id, md);
      if (!v) { void this.media.video(c.id, md, true); continue; }
      live.add(v);
      if (rate <= 0 || rate > 16) { if (!v.paused) v.pause(); if (Math.abs(v.currentTime - st) > 0.03) v.currentTime = st; continue; }
      if (Math.abs(v.playbackRate - rate) > 1e-3) v.playbackRate = rate;
      if (Math.abs(v.currentTime - st) > 0.2 && !v.seeking) v.currentTime = st;
      if (v.paused) void v.play().catch(() => undefined);
    }
    for (const v of this.media.liveVideos()) if (!live.has(v) && !v.paused) v.pause();
  }

  /** Dibuja el instante actual con exactitud (en pausa). Si llegan varias peticiones, solo cuenta la última. */
  draw() {
    if (this.busy) { this.pending = true; return; }
    this.busy = true;
    const t = this.time, rev = this.rev, scale = this.scale();
    const key = `${rev}|${scale.toFixed(3)}|${Math.round(t * this.composition.fps)}`;
    const hit = this.cache.get(key);
    const done = () => { this.busy = false; if (this.pending) { this.pending = false; this.draw(); } };
    if (hit) {
      const W = hit.width, H = hit.height;
      if (this.out.width !== W || this.out.height !== H) { this.out.width = W; this.out.height = H; }
      const g = this.out.getContext('2d')!;
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'copy';
      g.drawImage(hit, 0, 0);
      g.globalCompositeOperation = 'source-over';
      done();
      return;
    }
    this.media.useProxies = this.opts.proxies;
    void this.comp.render(this.motion(), this.composition, t, this.out, { scale, preview: true, exact: true })
      .then(async () => {
        if (rev !== this.rev || this.playing) return;
        const b = await createImageBitmap(this.out).catch(() => null);
        if (!b) return;
        this.cache.set(key, b);
        // Caché acotada (~240 fotogramas de vista previa).
        while (this.cache.size > 240) { const k = this.cache.keys().next().value!; this.cache.get(k)!.close(); this.cache.delete(k); }
      })
      .catch(e => console.warn('[motion] dibujo', e))
      .finally(done);
  }

  /** Pausa y suelta los recursos del reproductor. */
  dispose() {
    this.pause();
    this.rev++;
    for (const b of this.cache.values()) b.close();
    this.cache.clear();
  }
}
