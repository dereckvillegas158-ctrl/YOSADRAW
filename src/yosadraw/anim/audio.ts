import type { Animation, AudioClip, MouthKey, MouthShape } from './model';

/** Puente opcional de escritorio: decodifica con FFmpeg lo que Chromium no sabe (devuelve WAV). */
type DecodeBridge = (data: Uint8Array, name: string) => Promise<Uint8Array>;
const bridge = (): DecodeBridge | null => (globalThis as { yosadraw?: { decodeAudio?: DecodeBridge } }).yosadraw?.decodeAudio ?? null;

export const AUDIO_ACCEPT = '.mp3,.wav,.ogg,.oga,.flac,.aac,.m4a,.opus,.webm,audio/*';
export const AUDIO_MIME: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4', opus: 'audio/ogg', webm: 'audio/webm' };

/** Segundos que ocupa un clip en la línea de tiempo. */
export const clipSpan = (c: AudioClip) => Math.max(0, c.duration - c.trimStart - c.trimEnd);
export const clipEnd = (c: AudioClip) => c.offset + clipSpan(c);

/** Ganancia efectiva de un clip (volumen del clip × pista; silencio y solo). */
export function clipGain(a: Animation, c: AudioClip): number {
  const lane = a.lanes.find(l => l.id === c.lane);
  const solo = a.lanes.some(l => l.solo);
  if (c.muted || !lane || lane.muted || (solo && !lane.solo)) return 0;
  return c.volume * lane.volume;
}

/**
 * Audio de la animación: decodificación (con caché), forma de onda, reproducción
 * sincronizada con el reloj del AudioContext (que también marca el tiempo del
 * vídeo), mezcla sin conexión para exportar, WAV y sincronización labial.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private buffers = new WeakMap<Uint8Array, AudioBuffer>();
  private pending = new WeakMap<Uint8Array, Promise<AudioBuffer>>();
  private peakCache = new WeakMap<AudioBuffer, Float32Array>();
  private playing: { sources: AudioBufferSourceNode[]; ctxStart: number; from: number } | null = null;

  get context(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext({ latencyHint: 'interactive' });
    return this.ctx;
  }

  buffer(c: AudioClip): AudioBuffer | null { return this.buffers.get(c.data) ?? null; }

  /** Decodifica un clip (una vez). Si Chromium no puede, se intenta con FFmpeg (escritorio). */
  decode(c: AudioClip): Promise<AudioBuffer> {
    const hit = this.buffers.get(c.data);
    if (hit) return Promise.resolve(hit);
    let p = this.pending.get(c.data);
    if (!p) {
      p = (async () => {
        let buf: AudioBuffer;
        try { buf = await this.context.decodeAudioData(c.data.slice().buffer); }
        catch (e) {
          const b = bridge();
          if (!b) throw new Error(`No se pudo decodificar «${c.name}»: ${e instanceof Error ? e.message : String(e)}`);
          buf = await this.context.decodeAudioData((await b(c.data, c.name)).slice().buffer);
        }
        this.buffers.set(c.data, buf);
        return buf;
      })();
      this.pending.set(c.data, p);
      p.catch(() => this.pending.delete(c.data));
    }
    return p;
  }

  /** Picos (máximo absoluto) cada 1/200 s, para dibujar la forma de onda. */
  peaks(buf: AudioBuffer): Float32Array {
    let p = this.peakCache.get(buf);
    if (p) return p;
    const step = Math.max(1, Math.floor(buf.sampleRate / 200));
    const n = Math.ceil(buf.length / step);
    p = new Float32Array(n);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        let m = p[i];
        const e = Math.min(d.length, (i + 1) * step);
        for (let k = i * step; k < e; k++) { const v = d[k] < 0 ? -d[k] : d[k]; if (v > m) m = v; }
        p[i] = m;
      }
    }
    this.peakCache.set(buf, p);
    return p;
  }

  /** Programa los clips en un contexto (en tiempo real o sin conexión) desde `from` segundos de la línea de tiempo. */
  private schedule(ctx: BaseAudioContext, a: Animation, from: number, until: number, at: number): AudioBufferSourceNode[] {
    const out: AudioBufferSourceNode[] = [];
    for (const c of a.audio) {
      const buf = this.buffers.get(c.data), gain = clipGain(a, c);
      if (!buf || gain <= 0) continue;
      const s = c.offset, e = Math.min(clipEnd(c), until);
      if (e <= from || s >= until) continue;
      const startIn = Math.max(0, s - from);
      const srcOffset = c.trimStart + Math.max(0, from - s);
      const dur = e - Math.max(s, from);
      if (dur <= 0) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(g).connect(ctx.destination);
      src.start(at + startIn, srcOffset, dur);
      out.push(src);
    }
    return out;
  }

  /** Empieza a sonar desde `from` (s). Devuelve el reloj: segundos de la línea de tiempo que se están oyendo. */
  async start(a: Animation, from: number, until: number) {
    this.stop();
    await Promise.all(a.audio.map(c => this.decode(c).catch(() => null)));
    const ctx = this.context;
    if (ctx.state === 'suspended') await ctx.resume();
    const at = ctx.currentTime + 0.05;
    this.playing = { sources: this.schedule(ctx, a, from, until, at), ctxStart: at, from };
  }

  stop() {
    if (!this.playing) return;
    for (const s of this.playing.sources) { try { s.stop(); } catch { /* ya parado */ } s.disconnect(); }
    this.playing = null;
  }

  /** Segundo de la línea de tiempo que suena ahora (compensa la latencia de salida), o null si no hay reproducción. */
  clock(): number | null {
    if (!this.playing || !this.ctx) return null;
    const lat = (this.ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0;
    return this.playing.from + Math.max(0, this.ctx.currentTime - this.playing.ctxStart - lat - this.ctx.baseLatency);
  }

  /** Arrastre del cabezal: suena un trozo corto en ese punto. */
  scrub(a: Animation, t: number, dur: number) {
    if (!a.audio.length || this.playing) return;
    const ctx = this.context;
    if (ctx.state === 'suspended') void ctx.resume();
    const srcs = this.schedule(ctx, a, t, t + dur, ctx.currentTime + 0.01);
    setTimeout(() => srcs.forEach(s => s.disconnect()), (dur + 0.2) * 1000);
  }

  /** Mezcla estéreo del intervalo [from, from + dur) s para exportar. */
  async mix(a: Animation, from: number, dur: number, sampleRate = 48000): Promise<AudioBuffer | null> {
    const audible = a.audio.filter(c => clipGain(a, c) > 0 && clipEnd(c) > from && c.offset < from + dur);
    if (!audible.length) return null;
    await Promise.all(audible.map(c => this.decode(c)));
    const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(dur * sampleRate)), sampleRate);
    this.schedule(ctx, a, from, from + dur, 0);
    return ctx.startRendering();
  }

  /**
   * Sincronización labial por volumen: para cada fotograma del clip (o de sus
   * diálogos) mide la energía y elige una boca de más cerrada a más abierta
   * (X reposo, A cerrada, B, C, D muy abierta). No reconoce fonemas: es una base
   * que luego se ajusta a mano en la hoja de exposición.
   */
  lipSync(c: AudioClip, fps: number): MouthKey[] {
    const buf = this.buffers.get(c.data);
    if (!buf) throw new Error('El audio aún no está decodificado');
    const sr = buf.sampleRate, chs = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
    const f0 = Math.ceil(c.offset * fps), f1 = Math.floor(clipEnd(c) * fps);
    const rms: number[] = [];
    for (let f = f0; f < f1; f++) {
      const t = f / fps - c.offset + c.trimStart;
      const a = Math.max(0, Math.floor(t * sr)), b = Math.min(buf.length, Math.floor((t + 1 / fps) * sr));
      let sum = 0;
      for (let k = a; k < b; k++) { let v = 0; for (const d of chs) v += d[k]; v /= chs.length; sum += v * v; }
      rms.push(b > a ? Math.sqrt(sum / (b - a)) : 0);
    }
    const sorted = rms.filter(x => x > 1e-4).sort((x, y) => x - y);
    const ref = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 1;
    const inDialogue = (f: number) => !c.dialogue.length || c.dialogue.some(d => f >= d.start && f <= d.end);
    const shapes: MouthShape[] = rms.map((r, i) => {
      const f = f0 + i, x = r / (ref || 1);
      if (!inDialogue(f) || x < 0.06) return 'X';
      return x < 0.18 ? 'A' : x < 0.4 ? 'B' : x < 0.7 ? 'C' : 'D';
    });
    // Sin parpadeos: una boca dura al menos 2 fotogramas.
    for (let i = 1; i < shapes.length - 1; i++) if (shapes[i] !== shapes[i - 1] && shapes[i] !== shapes[i + 1]) shapes[i] = shapes[i - 1];
    const keys: MouthKey[] = [];
    shapes.forEach((s, i) => { if (!keys.length || keys[keys.length - 1].shape !== s) keys.push({ frame: f0 + i, shape: s }); });
    return keys;
  }
}

/** WAV PCM 16 bits (entrada de audio para FFmpeg). */
export function encodeWav(buf: AudioBuffer): Uint8Array {
  const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate;
  const out = new ArrayBuffer(44 + n * ch * 2);
  const v = new DataView(out);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, data[c][i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return new Uint8Array(out);
}

/** Mapa de bocas → exposición: para cada clave, qué cel etiquetado usar. */
export function mouthTimeline(keys: MouthKey[], end: number): { start: number; length: number; shape: MouthShape }[] {
  const out = [];
  for (let i = 0; i < keys.length; i++) {
    const s = keys[i].frame, e = i + 1 < keys.length ? keys[i + 1].frame : end;
    if (e > s) out.push({ start: s, length: e - s, shape: keys[i].shape });
  }
  return out;
}
