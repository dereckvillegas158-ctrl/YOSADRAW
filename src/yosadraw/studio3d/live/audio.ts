import type { Audio3, Track3 } from '../model';

/**
 * Audio del modo En vivo (PNGTuber): reproduce las pistas de la escena y/o escucha
 * el micrófono, mide el nivel (un único analizador para todo, sólo si hay audio) y
 * decide si el personaje «habla» con un umbral con histéresis y una espera para que
 * la boca no parpadee entre sílabas. También da una pista de audio para grabarla
 * junto con el vídeo.
 */
export class LiveAudio {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private buf: Float32Array<ArrayBuffer> | null = null;
  private els = new Map<string, HTMLAudioElement>();
  private mic: MediaStream | null = null;
  /** Nivel actual (0..1, suavizado) y si está hablando. */
  level = 0;
  talking = false;
  private lastLoud = -1;
  private quietSince = 0;
  /** Para pruebas o fuentes externas: nivel fijado a mano (null = medir). */
  forced: number | null = null;
  /** `get` lee los ajustes actuales (se pueden cambiar mientras corre). */
  constructor(private get: () => Audio3) {}
  private get cfg() { return this.get(); }

  get active() { return !!this.analyser || this.forced !== null; }
  private ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.4;
    this.buf = new Float32Array(this.analyser.fftSize);
    this.dest = this.ctx.createMediaStreamDestination();
  }
  /** Empieza: pistas automáticas y micrófono si está activado. */
  async start() {
    for (const t of this.cfg.tracks) if (t.auto) this.play(t.id);
    if (this.cfg.mic) await this.useMic(true);
  }
  /** Reproduce una pista (por id o nombre) desde el principio. */
  play(idOrName: string) {
    const t = this.cfg.tracks.find(x => x.id === idOrName || x.name === idOrName);
    if (!t) return false;
    this.ensure();
    let el = this.els.get(t.id);
    if (!el) {
      el = new Audio(t.src);
      el.crossOrigin = 'anonymous';
      const src = this.ctx!.createMediaElementSource(el);
      src.connect(this.analyser!); src.connect(this.ctx!.destination); src.connect(this.dest!);
      this.els.set(t.id, el);
    }
    el.loop = t.loop; el.volume = Math.max(0, Math.min(1, t.volume));
    el.currentTime = 0;
    void this.ctx!.resume();
    void el.play().catch(() => undefined);
    return true;
  }
  stopTrack(idOrName?: string) {
    for (const [id, el] of this.els) {
      const t = this.cfg.tracks.find(x => x.id === id);
      if (!idOrName || t?.id === idOrName || t?.name === idOrName) el.pause();
    }
  }
  /** Micrófono: el nivel sale de la voz (no se oye por los altavoces, sí se graba). */
  async useMic(on: boolean): Promise<boolean> {
    if (!on) { this.mic?.getTracks().forEach(t => t.stop()); this.mic = null; return true; }
    if (this.mic) return true;
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      this.ensure();
      const src = this.ctx!.createMediaStreamSource(this.mic);
      src.connect(this.analyser!); src.connect(this.dest!);
      void this.ctx!.resume();
      return true;
    } catch { return false; }
  }
  get micOn() { return !!this.mic; }
  /** Pista de audio para la grabación de vídeo (lo que suena y el micrófono). */
  get recordTrack(): MediaStreamTrack | null { return this.dest?.stream.getAudioTracks()[0] ?? null; }
  /** Prepara el audio para grabarlo (si la escena tiene pistas o micrófono). */
  /** Lo necesario para grabar el audio: el contexto y la pista con la mezcla (null = sin audio). */
  recordAudio(): { ctx: AudioContext; track: MediaStreamTrack } | null {
    const track = this.recordable();
    return track && this.ctx ? { ctx: this.ctx, track } : null;
  }
  recordable(): MediaStreamTrack | null {
    if (!this.cfg.tracks.length && !this.cfg.mic && !this.els.size && !this.mic) return null;
    this.ensure();
    return this.recordTrack;
  }
  /**
   * Avanza (una vez por fotograma): nivel RMS suavizado y cambios de estado.
   * Devuelve los sucesos: «talk» al empezar a hablar, «quiet» al callarse, «loud» en un pico.
   */
  step(time: number, dt = 1 / 60): ('talk' | 'quiet' | 'loud')[] {
    let raw = 0;
    if (this.forced !== null) raw = this.forced;
    else if (this.analyser && this.buf) {
      this.analyser.getFloatTimeDomainData(this.buf);
      let s = 0; for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
      raw = Math.min(1, Math.sqrt(s / this.buf.length) * 4);
    } else return [];
    // Sube rápido y baja más despacio (la boca no tiembla); por tiempo, no por fotograma.
    const k = 1 - Math.exp(-Math.max(0, dt) * (raw > this.level ? 55 : 26));
    this.level += (raw - this.level) * k;
    const ev: ('talk' | 'quiet' | 'loud')[] = [];
    const th = this.cfg.threshold;
    if (this.level > th) { this.quietSince = time; if (!this.talking) { this.talking = true; ev.push('talk'); } }
    else if (this.talking && this.level < th * 0.7 && time - this.quietSince > this.cfg.hold) { this.talking = false; ev.push('quiet'); }
    if (this.level > this.cfg.loud && time - this.lastLoud > 0.6) { this.lastLoud = time; ev.push('loud'); }
    return ev;
  }
  stop() {
    for (const el of this.els.values()) { el.pause(); el.src = ''; }
    this.els.clear();
    this.mic?.getTracks().forEach(t => t.stop()); this.mic = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null; this.analyser = null; this.dest = null;
  }
}
export type { Track3 };
