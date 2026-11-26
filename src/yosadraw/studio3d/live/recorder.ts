/**
 * Grabación de vídeo del modo En vivo.
 *
 * No graba el lienzo del visor directamente (al ocultar la interfaz o cambiar el
 * tamaño de la ventana cambia de medidas y el vídeo se estropea): copia cada
 * fotograma a un lienzo propio de tamaño fijo (encajado, con bandas si la forma no
 * coincide) y entrega los fotogramas a mano, uno por dibujo, para que el ritmo sea
 * exacto. La calidad (resolución y bits por segundo) se elige al empezar.
 */
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { mp4Codec } from '../../anim/webexport';

export type RecSize = 'screen' | '720' | '1080' | '1440' | 'gif';
export const REC_SIZES: [RecSize, string][] = [['1080', 'MP4 1080p (Full HD)'], ['1440', 'MP4 1440p (2K)'], ['720', 'MP4 720p'], ['screen', 'MP4 tamaño de la pantalla'], ['gif', 'GIF animado (640 px, hasta 40 s)']];
/** Lo común a las grabaciones en vivo (vídeo o GIF). */
export interface LiveRec { frame(src: HTMLCanvasElement): void; stop(): void; /** Para sin guardar nada. */ cancel?(): void; readonly seconds: number; readonly frames: number }

/** Medidas del vídeo (pares, para H.264) con la forma de la pantalla o la del render. */
export function recDims(size: RecSize, aspect: number, screen: { w: number; h: number }): { w: number; h: number } {
  const even = (x: number) => Math.max(2, Math.round(x / 2) * 2);
  if (size === 'screen') return { w: even(screen.w), h: even(screen.h) };
  const H = Number(size), a = Math.max(0.3, Math.min(4, aspect || 16 / 9));
  // Vertical: la altura manda en la medida pequeña.
  return a >= 1 ? { w: even(H * a), h: even(H) } : { w: even(H), h: even(H / a) };
}
/** Bits por segundo según tamaño y fps (alta calidad, sin pasarse). */
export const recBitrate = (w: number, h: number, fps: number) => Math.round(Math.min(60_000_000, Math.max(6_000_000, w * h * fps * 0.22)));

/** Audio de la escena para grabar: el contexto de audio y la pista con la mezcla. */
export interface RecAudio { ctx: AudioContext; track: MediaStreamTrack }
export type RecDone = (data: Uint8Array, ext: 'mp4' | 'webm', note: string, summary?: string) => void;

/**
 * Empieza a grabar vídeo: con WebCodecs (H.264 y AAC u Opus en un MP4 normal, con
 * tiempos exactos) si el sistema puede; si no, con MediaRecorder en WebM.
 */
export async function startLiveVideo(w: number, h: number, fps: number, done: RecDone, first?: HTMLCanvasElement, audio?: RecAudio | null): Promise<LiveRec> {
  const codec = typeof VideoFrame !== 'undefined' ? await mp4Codec(w, h, fps) : null;
  if (codec) {
    const ac = audio ? await audioCodec(audio.ctx.sampleRate) : null;
    // Codificador de la tarjeta gráfica si lo hay (más fotogramas por segundo sin frenar el dibujo).
    let hw = false;
    try { hw = !!(await VideoEncoder.isConfigSupported({ codec, width: w, height: h, framerate: fps, bitrate: recBitrate(w, h, fps), hardwareAcceleration: 'prefer-hardware' })).supported; } catch { hw = false; }
    return new LiveRecorder(w, h, fps, codec, done, first, audio && ac ? { ...audio, codec: ac } : null, hw);
  }
  return new MediaRec(w, h, fps, done, first, audio?.track ?? null);
}
/** Códec de audio para el MP4: AAC si se puede, si no Opus (también válido en MP4). */
async function audioCodec(sampleRate: number): Promise<'aac' | 'opus' | null> {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const [c, codec] of [['aac', 'mp4a.40.2'], ['opus', 'opus']] as const) {
    try { if ((await AudioEncoder.isConfigSupported({ codec, sampleRate, numberOfChannels: 2, bitrate: 160_000 })).supported) return c; } catch { /* siguiente */ }
  }
  return null;
}

/**
 * Casilla de tiempo (número de fotograma del vídeo) para un dibujo hecho en el
 * fotograma `s` (con decimales). Antes se redondeaba hacia abajo y, como la hora de
 * cada dibujo varía unos milisegundos, dos seguidos caían a menudo en la misma
 * casilla y se perdía uno (a 60 fps en una pantalla de 60 Hz, ~1 de cada 4). Ahora
 * se acepta todo dibujo separado al menos 0,4 fotogramas del anterior, en la casilla
 * más cercana libre (como mucho un fotograma por delante de su hora real). null = se descarta.
 */
export function nextSlot(last: number, lastS: number, s: number): number | null {
  // Demasiado pegado al dibujo anterior, o la casilla siguiente queda muy por delante de su hora.
  if (s - lastS < 0.4 || last + 1 - s > 1) return null;
  return Math.max(Math.round(s), last + 1);
}

/** Copia el fotograma del visor (encajado, sin deformar) a un lienzo de tamaño fijo. */
function fit(g: CanvasRenderingContext2D, src: HTMLCanvasElement, w: number, h: number) {
  const sw = src.width, sh = src.height;
  if (!sw || !sh) return false;
  const k = Math.min(w / sw, h / sh), dw = sw * k, dh = sh * k;
  if (Math.abs(dw - w) > 1 || Math.abs(dh - h) > 1) { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); }
  g.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return true;
}

/**
 * Grabación con WebCodecs: cada fotograma lleva su tiempo real ajustado a la
 * rejilla de fps (siempre creciente, sin saltos raros) y el audio de la escena se
 * toma como muestras del propio contexto de audio. El resultado es un MP4 normal
 * (índice al principio, duración correcta) que abre cualquier reproductor o editor.
 */
export class LiveRecorder implements LiveRec {
  readonly canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private target = new ArrayBufferTarget();
  private muxer: Muxer<ArrayBufferTarget>;
  private venc: VideoEncoder;
  private aenc: AudioEncoder | null = null;
  private failure: Error | null = null;
  private t0 = performance.now();
  private slot = -1;
  private lastS = -1e9;
  private lastKey = -1e9;
  private stopped = false;
  /** Codificador de la tarjeta gráfica (si no, el procesador). */
  readonly hw: boolean;
  private audioNodes: AudioNode[] = [];
  private aStart = -1;
  private aSamples = 0;
  frames = 0;
  dropped = 0;
  readonly mime = 'video/mp4';
  constructor(readonly w: number, readonly h: number, readonly fps: number, codec: string, private done: RecDone, first?: HTMLCanvasElement, audio?: (RecAudio & { codec: 'aac' | 'opus' }) | null, hw = false) {
    this.hw = hw;
    this.canvas.width = w; this.canvas.height = h;
    this.g = this.canvas.getContext('2d', { alpha: false })!;
    this.g.fillStyle = '#000'; this.g.fillRect(0, 0, w, h);
    this.g.imageSmoothingQuality = 'high';
    const sr = audio?.ctx.sampleRate ?? 48000;
    this.muxer = new Muxer({
      target: this.target, fastStart: 'in-memory', firstTimestampBehavior: 'cross-track-offset',
      video: { codec: 'avc', width: w, height: h, frameRate: fps },
      ...(audio ? { audio: { codec: audio.codec, numberOfChannels: 2, sampleRate: sr } } : {}),
    });
    const fail = (e: unknown) => { this.failure ??= e instanceof Error ? e : new Error(String(e)); };
    this.venc = new VideoEncoder({ output: (c, m) => this.muxer.addVideoChunk(c, m), error: fail });
    this.venc.configure({ codec, width: w, height: h, framerate: fps, bitrate: recBitrate(w, h, fps), latencyMode: hw ? 'quality' : 'realtime', hardwareAcceleration: hw ? 'prefer-hardware' : 'no-preference', avc: { format: 'avc' } });
    if (audio) {
      this.aenc = new AudioEncoder({ output: (c, m) => this.muxer.addAudioChunk(c, m), error: fail });
      this.aenc.configure({ codec: audio.codec === 'aac' ? 'mp4a.40.2' : 'opus', sampleRate: sr, numberOfChannels: 2, bitrate: 192_000 });
      // Muestras de la mezcla (pistas y micrófono) tal como suenan.
      const ctx = audio.ctx, src = ctx.createMediaStreamSource(new MediaStream([audio.track]));
      const sp = ctx.createScriptProcessor(4096, 2, 2), mute = ctx.createGain(); mute.gain.value = 0;
      sp.onaudioprocess = e => this.audioIn(e.inputBuffer);
      src.connect(sp); sp.connect(mute); mute.connect(ctx.destination);
      this.audioNodes = [src, sp, mute];
    }
    // (Sin «primer fotograma» aparte: el codificador se prepara de forma asíncrona y para
    // entonces la imagen del visor ya se borró; el vídeo empieza con el siguiente dibujo.)
    void first;
  }
  static supported() { return (typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined') || (typeof MediaRecorder !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype); }
  private endT = 0;
  get seconds() { return ((this.endT || performance.now()) - this.t0) / 1000; }
  /** Resumen para el aviso al guardar. */
  get summary() { const sec = Math.max(0.001, this.seconds); return `${(this.frames / sec).toFixed(0)} fps de media · codificador: ${this.hw ? 'tarjeta gráfica' : 'procesador'}${this.dropped ? ` · ${this.dropped} fotogramas descartados (el codificador no daba abasto)` : ''}`; }
  frame(src: HTMLCanvasElement) {
    if (this.stopped || this.failure) return;
    const sNow = ((performance.now() - this.t0) / 1000) * this.fps;
    const slot = nextSlot(this.slot, this.lastS, sNow);
    if (slot === null) return;
    // Si el codificador va muy atrasado, se salta el fotograma (el anterior dura más).
    if (this.venc.encodeQueueSize > 12) { this.dropped++; return; }
    // Mismo tamaño que el vídeo: el fotograma sale directo del visor (sin copiarlo antes).
    const direct = src.width === this.w && src.height === this.h;
    if (!direct && !fit(this.g, src, this.w, this.h)) return;
    this.slot = slot; this.lastS = sNow;
    const us = 1e6 / this.fps;
    const vf = new VideoFrame(direct ? src : this.canvas, { timestamp: Math.round(slot * us), duration: Math.round(us) });
    const key = slot - this.lastKey >= this.fps * 2;
    if (key) this.lastKey = slot;
    this.venc.encode(vf, { keyFrame: key });
    vf.close();
    this.frames++;
  }
  private audioIn(b: AudioBuffer) {
    if (this.stopped || !this.aenc || this.failure) return;
    const n = b.length, sr = b.sampleRate;
    // El primer bloque: su sitio en el tiempo del vídeo (descontando lo que dura el bloque).
    if (this.aStart < 0) this.aStart = Math.max(0, (performance.now() - this.t0) / 1000 - n / sr);
    const L = b.getChannelData(0), R = b.numberOfChannels > 1 ? b.getChannelData(1) : L;
    const data = new Float32Array(n * 2); data.set(L, 0); data.set(R, n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((this.aStart + this.aSamples / sr) * 1e6), data });
    this.aSamples += n;
    this.aenc.encode(ad);
    ad.close();
  }
  cancel() { this.done = () => undefined; this.stop(); }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.endT = performance.now();
    for (const n of this.audioNodes) { try { n.disconnect(); } catch { /* ya desconectado */ } }
    const sp = this.audioNodes[1] as ScriptProcessorNode | undefined; if (sp) sp.onaudioprocess = null;
    void (async () => {
      try {
        await this.venc.flush(); this.venc.close();
        if (this.aenc) { await this.aenc.flush(); this.aenc.close(); }
        if (this.failure) throw this.failure;
        this.muxer.finalize();
        this.done(new Uint8Array(this.target.buffer), 'mp4', '', this.summary);
      } catch (e) {
        this.done(new Uint8Array(0), 'mp4', e instanceof Error ? e.message : String(e));
      }
    })();
  }
}

/**
 * Plan B sin WebCodecs: MediaRecorder en WebM (su MP4 sale con tiempos rotos), con
 * el lienzo de tamaño fijo y fotogramas automáticos al ritmo del vídeo.
 */
class MediaRec implements LiveRec {
  readonly canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private rec: MediaRecorder;
  private chunks: Blob[] = [];
  private t0 = performance.now();
  private last = 0;
  frames = 0;
  constructor(readonly w: number, readonly h: number, readonly fps: number, done: RecDone, first?: HTMLCanvasElement, audio?: MediaStreamTrack | null) {
    this.canvas.width = w; this.canvas.height = h;
    this.g = this.canvas.getContext('2d', { alpha: false })!;
    this.g.fillStyle = '#000'; this.g.fillRect(0, 0, w, h);
    if (first) fit(this.g, first, w, h);
    const stream = (this.canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(fps);
    if (audio) stream.addTrack(audio);
    const types = audio ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'] : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mime = types.find(m => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';
    this.rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: recBitrate(w, h, fps), ...(audio ? { audioBitsPerSecond: 192_000 } : {}) });
    this.rec.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.onstop = () => { for (const t of stream.getVideoTracks()) t.stop(); void new Blob(this.chunks, { type: mime }).arrayBuffer().then(b => done(new Uint8Array(b), 'webm', '')); };
    this.rec.start(1000);
  }
  get seconds() { return (performance.now() - this.t0) / 1000; }
  frame(src: HTMLCanvasElement) {
    const now = performance.now();
    if (now - this.last < 1000 / this.fps - 2) return;
    this.last = now;
    if (fit(this.g, src, this.w, this.h)) this.frames++;
  }
  stop() { if (this.rec.state !== 'inactive') this.rec.stop(); }
  cancel() { this.rec.onstop = null; this.stop(); }
}

/**
 * GIF del modo En vivo: guarda los fotogramas pequeños (hasta 640 px, 15 fps y 40 s
 * para no gastar memoria) y al parar los codifica con el mismo codificador GIF del
 * módulo de animación.
 */
export class LiveGifRecorder implements LiveRec {
  static readonly MAX_SECONDS = 40;
  readonly fps = 15;
  readonly w: number; readonly h: number;
  private frames_: ImageData[] = [];
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private t0 = performance.now();
  private last = 0;
  constructor(aspect: number, private done: (frames: ImageData[], w: number, h: number, fps: number) => void, first?: HTMLCanvasElement) {
    const a = Math.max(0.3, Math.min(4, aspect || 16 / 9));
    const M = 640;
    this.w = Math.round(a >= 1 ? M : M * a / 1) & ~1; this.h = Math.round(a >= 1 ? M / a : M) & ~1;
    this.canvas.width = this.w; this.canvas.height = this.h;
    this.g = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.g.imageSmoothingQuality = 'high';
    if (first) { this.frame(first); this.last = 0; }
  }
  get frames() { return this.frames_.length; }
  get seconds() { return (performance.now() - this.t0) / 1000; }
  get full() { return this.seconds >= LiveGifRecorder.MAX_SECONDS; }
  frame(src: HTMLCanvasElement) {
    const now = performance.now();
    if (now - this.last < 1000 / this.fps - 2 || this.full) return;
    this.last = now;
    const sw = src.width, sh = src.height;
    if (!sw || !sh) return;
    const k = Math.min(this.w / sw, this.h / sh), dw = sw * k, dh = sh * k;
    this.g.fillStyle = '#000'; this.g.fillRect(0, 0, this.w, this.h);
    this.g.drawImage(src, (this.w - dw) / 2, (this.h - dh) / 2, dw, dh);
    this.frames_.push(this.g.getImageData(0, 0, this.w, this.h));
  }
  stop() { this.done(this.frames_, this.w, this.h, this.fps); this.frames_ = []; }
}
