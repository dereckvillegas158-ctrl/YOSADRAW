import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';

/**
 * Codificadores sin FFmpeg (Android y navegador):
 * - GIF con paleta propia por fotograma (gifenc), transparencia de 1 bit y bucle.
 * - MP4 H.264 con el codificador del sistema (WebCodecs: en Android, el de hardware
 *   del teléfono) y audio AAC si el sistema lo codifica; contenedor con mp4-muxer.
 * Los fotogramas se piden de uno en uno: sólo hay uno en memoria a la vez.
 */

export interface WebEncodeOptions {
  width: number; height: number; fps: number; frames: number;
  /** Dibuja el fotograma k y devuelve su lienzo (width × height). */
  frame: (k: number) => Promise<HTMLCanvasElement> | HTMLCanvasElement;
  progress?: (k: number, n: number) => void;
  cancelled?: () => boolean;
}

const tick = () => new Promise(r => setTimeout(r, 0));

export async function encodeGif(o: WebEncodeOptions & { loop: boolean; alpha: boolean }): Promise<Uint8Array | null> {
  const gif = GIFEncoder();
  const delay = Math.round(1000 / o.fps);
  for (let k = 0; k < o.frames; k++) {
    if (o.cancelled?.()) return null;
    const c = await o.frame(k);
    const data = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, o.width, o.height).data;
    const format = o.alpha ? 'rgba4444' : 'rgb565';
    const palette = quantize(data, 256, { format, oneBitAlpha: o.alpha, clearAlpha: o.alpha, clearAlphaThreshold: 128 });
    const index = applyPalette(data, palette, format);
    const transparentIndex = o.alpha ? palette.findIndex((p: number[]) => p[3] === 0) : -1;
    gif.writeFrame(index, o.width, o.height, { palette, delay, repeat: o.loop ? 0 : -1, transparent: transparentIndex >= 0, transparentIndex: Math.max(0, transparentIndex), dispose: o.alpha ? 2 : -1 });
    o.progress?.(k + 1, o.frames);
    if (k % 2 === 1) await tick();
  }
  gif.finish();
  return gif.bytes();
}

const AVC = ['avc1.640033', 'avc1.640028', 'avc1.4d0028', 'avc1.42e01f', 'avc1.42001f'];

/** Perfil H.264 que el sistema puede codificar a ese tamaño (null = ninguno). */
export async function mp4Codec(width: number, height: number, fps: number): Promise<string | null> {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const codec of AVC) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec, width, height, framerate: fps, bitrate: 4_000_000 });
      if (r.supported) return codec;
    } catch { /* siguiente */ }
  }
  return null;
}

async function aacSupported(sampleRate: number) {
  if (typeof AudioEncoder === 'undefined') return false;
  try { return !!(await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate, numberOfChannels: 2, bitrate: 160_000 })).supported; } catch { return false; }
}

export async function encodeMp4(o: WebEncodeOptions & { bitrate: number; audio: AudioBuffer | null }): Promise<{ data: Uint8Array; audio: boolean } | null> {
  const codec = await mp4Codec(o.width, o.height, o.fps);
  if (!codec) throw new Error('Este dispositivo no puede codificar vídeo H.264 a este tamaño');
  const withAudio = !!o.audio && (await aacSupported(o.audio.sampleRate));
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target, fastStart: 'in-memory',
    video: { codec: 'avc', width: o.width, height: o.height, frameRate: o.fps },
    ...(withAudio ? { audio: { codec: 'aac' as const, numberOfChannels: 2, sampleRate: o.audio!.sampleRate } } : {}),
  });
  let failure: Error | null = null;
  const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { failure = e instanceof Error ? e : new Error(String(e)); } });
  venc.configure({ codec, width: o.width, height: o.height, framerate: o.fps, bitrate: o.bitrate, avc: { format: 'avc' } });
  const dur = 1e6 / o.fps;
  for (let k = 0; k < o.frames; k++) {
    if (failure) throw failure;
    if (o.cancelled?.()) { venc.close(); return null; }
    const c = await o.frame(k);
    const vf = new VideoFrame(c, { timestamp: Math.round(k * dur), duration: Math.round(dur) });
    venc.encode(vf, { keyFrame: k % Math.max(1, Math.round(o.fps * 2)) === 0 });
    vf.close();
    // Contrapresión: el codificador no acumula fotogramas sin procesar.
    while (venc.encodeQueueSize > 3) await new Promise(r => setTimeout(r, 4));
    o.progress?.(k + 1, o.frames);
  }
  await venc.flush();
  venc.close();
  if (failure) throw failure;
  if (withAudio) {
    const buf = o.audio!;
    const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: e => { failure = e instanceof Error ? e : new Error(String(e)); } });
    aenc.configure({ codec: 'mp4a.40.2', sampleRate: buf.sampleRate, numberOfChannels: 2, bitrate: 160_000 });
    const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    const total = Math.min(buf.length, Math.round((o.frames / o.fps) * buf.sampleRate));
    for (let i = 0; i < total; i += 1024) {
      const n = Math.min(1024, total - i), planar = new Float32Array(n * 2);
      planar.set(L.subarray(i, i + n), 0); planar.set(R.subarray(i, i + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: buf.sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / buf.sampleRate) * 1e6), data: planar });
      aenc.encode(ad);
      ad.close();
    }
    await aenc.flush();
    aenc.close();
    if (failure) throw failure;
  }
  muxer.finalize();
  return { data: new Uint8Array(target.buffer), audio: withAudio };
}
