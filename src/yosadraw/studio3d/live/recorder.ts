/**
 * Grabación de vídeo del modo En vivo.
 *
 * No graba el lienzo del visor directamente (al ocultar la interfaz o cambiar el
 * tamaño de la ventana cambia de medidas y el vídeo se estropea): copia cada
 * fotograma a un lienzo propio de tamaño fijo (encajado, con bandas si la forma no
 * coincide) y entrega los fotogramas a mano, uno por dibujo, para que el ritmo sea
 * exacto. La calidad (resolución y bits por segundo) se elige al empezar.
 */

export type RecSize = 'screen' | '720' | '1080' | '1440' | 'gif';
export const REC_SIZES: [RecSize, string][] = [['1080', 'MP4 1080p (Full HD)'], ['1440', 'MP4 1440p (2K)'], ['720', 'MP4 720p'], ['screen', 'MP4 tamaño de la pantalla'], ['gif', 'GIF animado (640 px, hasta 40 s)']];
/** Lo común a las grabaciones en vivo (vídeo o GIF). */
export interface LiveRec { frame(src: HTMLCanvasElement): void; stop(): void; readonly seconds: number; readonly frames: number }

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

export class LiveRecorder implements LiveRec {
  readonly canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private track: MediaStreamTrack & { requestFrame?: () => void };
  private rec: MediaRecorder;
  private chunks: Blob[] = [];
  readonly mime: string;
  private t0 = performance.now();
  private last = 0;
  frames = 0;
  constructor(readonly w: number, readonly h: number, readonly fps: number, private done: (blob: Blob, mime: string) => void, first?: HTMLCanvasElement, audio?: MediaStreamTrack | null) {
    this.canvas.width = w; this.canvas.height = h;
    this.g = this.canvas.getContext('2d', { alpha: false })!;
    this.g.fillStyle = '#000'; this.g.fillRect(0, 0, w, h);
    this.g.imageSmoothingQuality = 'high';
    const stream = (this.canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(0);
    this.track = stream.getVideoTracks()[0] as LiveRecorder['track'];
    // Con audio (voz, música del PNGTuber) si la escena lo tiene.
    if (audio) stream.addTrack(audio);
    const types = audio
      // (siempre con el códec de vídeo explícito: «video/mp4» a secas puede quedarse sin la pista de vídeo)
      ? ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1.640028,opus', 'video/mp4;codecs=avc1,opus', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      : ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    this.mime = types.find(m => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';
    this.rec = new MediaRecorder(stream, { mimeType: this.mime, videoBitsPerSecond: recBitrate(w, h, fps), ...(audio ? { audioBitsPerSecond: 192_000 } : {}) });
    this.rec.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.onstop = () => this.done(new Blob(this.chunks, { type: this.mime }), this.mime);
    // El primer fotograma ya con la escena (no un cuadro negro).
    if (first) { this.frame(first); this.last = 0; }
    this.rec.start(1000);
  }
  static supported() { return typeof MediaRecorder !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype; }
  get seconds() { return (performance.now() - this.t0) / 1000; }
  /** Copia el fotograma del visor (encajado, sin deformar) al ritmo del vídeo. */
  frame(src: HTMLCanvasElement) {
    const now = performance.now();
    if (now - this.last < 1000 / this.fps - 2) return;
    this.last = now;
    const sw = src.width, sh = src.height;
    if (!sw || !sh) return;
    const k = Math.min(this.w / sw, this.h / sh), dw = sw * k, dh = sh * k;
    const g = this.g;
    if (Math.abs(dw - this.w) > 1 || Math.abs(dh - this.h) > 1) { g.fillStyle = '#000'; g.fillRect(0, 0, this.w, this.h); }
    g.drawImage(src, (this.w - dw) / 2, (this.h - dh) / 2, dw, dh);
    this.track.requestFrame?.();
    this.frames++;
  }
  stop() { if (this.rec.state !== 'inactive') this.rec.stop(); this.track.stop(); }
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
