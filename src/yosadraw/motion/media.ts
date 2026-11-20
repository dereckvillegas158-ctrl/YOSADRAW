import type { StrokePainter } from '../brush/StrokePainter';
import { desktopBridge } from '../brush/storage';
import { FrameRenderer } from '../anim/render';
import { browserImageCodec, readProject } from '../project/format';
import type { ProjectLibrary } from '../project/library';
import type { BlobStore } from '../project/store';
import { mid, type MediaItem, type MediaKind } from './model';

/**
 * Medios de YOSADRAW MOTION: importar, guardar en el almacén (`m/<id>`), leer por
 * streaming, metadatos, miniaturas, forma de onda y fotogramas para el compositor.
 *
 * El vídeo se decodifica con el reproductor del sistema (`<video>`: por hardware
 * cuando el equipo lo tiene) y se lee por streaming: nunca se carga entero en
 * memoria. Cada clip tiene su propio reproductor (un mismo vídeo puede verse a la
 * vez en dos momentos distintos).
 */

interface MediaBridge { probe(key: string): Promise<{ dur: number; w: number; h: number; fps: number; hasVideo: boolean; hasAudio: boolean }>; transcode(key: string, outKey: string, mode: 'compat' | 'proxy'): Promise<number> }
const mediaBridge = () => (desktopBridge() as unknown as { media?: MediaBridge } | null)?.media ?? null;

export const MEDIA_ACCEPT = 'video/*,audio/*,image/*,.mp4,.mov,.m4v,.mkv,.webm,.avi,.gif,.png,.jpg,.jpeg,.webp,.svg,.wav,.mp3,.ogg,.oga,.flac,.aac,.m4a,.opus,.ttf,.otf,.woff,.woff2,.cube';
const EXT_KIND: Record<string, MediaKind> = {
  mp4: 'video', mov: 'video', m4v: 'video', mkv: 'video', webm: 'video', avi: 'video', ogv: 'video',
  wav: 'audio', mp3: 'audio', ogg: 'audio', oga: 'audio', flac: 'audio', aac: 'audio', m4a: 'audio', opus: 'audio',
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', bmp: 'image', avif: 'image', gif: 'gif', svg: 'svg',
  ttf: 'font', otf: 'font', woff: 'font', woff2: 'font', cube: 'lut',
};
export function kindOf(f: { name: string; type: string }): MediaKind | null {
  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
  if (EXT_KIND[ext]) return EXT_KIND[ext];
  if (f.type === 'image/gif') return 'gif';
  if (f.type === 'image/svg+xml') return 'svg';
  if (f.type.startsWith('video/')) return 'video';
  if (f.type.startsWith('audio/')) return 'audio';
  if (f.type.startsWith('image/')) return 'image';
  return null;
}

export const blobKey = (m: Pick<MediaItem, 'id'>) => `m/${m.id}`;
const convKey = (m: Pick<MediaItem, 'id'>) => `m/${m.id}.mp4`;
const proxyKey = (m: Pick<MediaItem, 'id'>) => `m/${m.id}.proxy`;
const seqKey = (m: Pick<MediaItem, 'id'>, i: number) => `m/${m.id}.f${String(i).padStart(5, '0')}`;

function once<T extends Event>(el: EventTarget, ok: string, bad = 'error', timeout = 20000): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => { done(); rej(new Error('Tiempo de espera agotado')); }, timeout);
    const a = (e: Event) => { done(); res(e as T); }, b = () => { done(); rej(new Error('No se pudo leer el medio')); };
    const done = () => { clearTimeout(t); el.removeEventListener(ok, a); el.removeEventListener(bad, b); };
    el.addEventListener(ok, a, { once: true });
    el.addEventListener(bad, b, { once: true });
  });
}

/** Contexto de audio compartido (decodificar y reproducir). */
let actx: AudioContext | null = null;
export const audioContext = () => (actx ??= new AudioContext({ latencyHint: 'interactive' }));

export class MediaManager {
  private urls = new Map<string, string>();
  private videos = new Map<string, HTMLVideoElement>();
  private images = new Map<string, Promise<CanvasImageSource>>();
  private audio = new Map<string, Promise<AudioBuffer | null>>();
  private peakCache = new Map<string, Float32Array>();
  private gifs = new Map<string, { dec: ImageDecoder; times: number[]; total: number; cache: Map<number, VideoFrame> }>();
  private drawings = new Map<string, Promise<{ fr: FrameRenderer; rev: number }>>();
  private projectDocs = new Map<string, Promise<import('../doc/Document').Document>>();
  private thumbs = new Map<string, Promise<HTMLCanvasElement | null>>();
  /** Medios cuyo archivo no está en el almacén (proyecto importado sin sus medios, borrado…). */
  missing = new Set<string>();
  /** Usar proxies (vista previa) en vez del original. */
  useProxies = true;

  constructor(readonly store: BlobStore, private painter: StrokePainter, private projects: ProjectLibrary | null) {}

  get canTranscode() { return !!mediaBridge(); }

  // ---------------------------------------------------------------- importar

  /** Importa archivos: los guarda en el almacén y devuelve sus fichas (el llamador las añade al proyecto). */
  async importFiles(files: File[], folder = '', progress?: (msg: string) => void): Promise<{ items: MediaItem[]; errors: string[] }> {
    const items: MediaItem[] = [], errors: string[] = [];
    for (const f of files) {
      try {
        const kind = kindOf(f);
        if (!kind) throw new Error('formato no compatible');
        progress?.(`Importando ${f.name}…`);
        const item: MediaItem = { id: mid('md'), name: f.name, kind, mime: f.type || '', size: f.size, w: 0, h: 0, dur: 0, fps: 0, frames: 1, hasAudio: false, folder, added: Date.now() };
        if (this.store.putBlob && f.size > 8 * 1024 * 1024) await this.store.putBlob(blobKey(item), f);
        else await this.store.put(blobKey(item), new Uint8Array(await f.arrayBuffer()));
        try { await this.probe(item, progress); }
        catch (e) { await this.store.delete(blobKey(item)).catch(() => undefined); throw e; }
        items.push(item);
      } catch (e) { errors.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    return { items, errors };
  }

  /** Imágenes como secuencia (un fotograma cada una, en orden por nombre). */
  async importSequence(files: File[], fps: number, folder = ''): Promise<MediaItem> {
    files = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const item: MediaItem = { id: mid('md'), name: `${files[0].name.replace(/[_-]?\d*\.[^.]+$/, '') || 'Secuencia'} (${files.length})`, kind: 'seq', mime: files[0].type, size: 0, w: 0, h: 0, dur: files.length / fps, fps, frames: files.length, hasAudio: false, folder, added: Date.now() };
    for (let i = 0; i < files.length; i++) {
      const b = new Uint8Array(await files[i].arrayBuffer());
      item.size += b.length;
      await this.store.put(seqKey(item, i), b);
      if (i === 0) { const bmp = await createImageBitmap(new Blob([b])); item.w = bmp.width; item.h = bmp.height; bmp.close(); }
    }
    return item;
  }

  /** Un dibujo o animación de la galería como medio (se cita, no se copia: el original no cambia). */
  async fromProject(id: string, layer: string | null, paper: boolean): Promise<MediaItem> {
    if (!this.projects) throw new Error('La galería no está disponible');
    const e = this.projects.get(id);
    if (!e) throw new Error('El proyecto ya no existe');
    const anim = !!e.anim;
    return {
      id: mid('md'), name: e.name, kind: anim ? 'anim' : 'drawing', mime: 'application/x-yosadraw', size: e.size ?? 0, w: e.width, h: e.height,
      dur: anim ? e.anim!.frames / e.anim!.fps : 5, fps: anim ? e.anim!.fps : 0, frames: anim ? e.anim!.frames : 1, hasAudio: false,
      project: { id, rev: e.rev, layer, paper }, folder: '', added: Date.now(),
    };
  }

  /** Lee los metadatos del medio (y crea la copia compatible si el sistema no lo reproduce). */
  private async probe(m: MediaItem, progress?: (msg: string) => void) {
    if (m.kind === 'video') {
      let meta = await this.videoMeta(m).catch(() => null);
      if (!meta) {
        const b = mediaBridge();
        if (!b) throw new Error('este dispositivo no reproduce este formato de vídeo (prueba MP4 H.264 o WebM)');
        progress?.(`Convirtiendo ${m.name} a un formato compatible (FFmpeg)…`);
        await b.transcode(blobKey(m), convKey(m), 'compat');
        m.conv = true;
        this.forgetUrl(m);
        meta = await this.videoMeta(m);
      }
      Object.assign(m, meta);
      const p = await mediaBridge()?.probe(blobKey(m)).catch(() => null);
      if (p?.fps) m.fps = Math.round(p.fps * 1000) / 1000;
      if (p) m.hasAudio = p.hasAudio;
      else m.hasAudio = !!(await this.audioBuffer(m).catch(() => null));
      m.fps ||= 30;
      m.frames = Math.round(m.dur * m.fps);
    } else if (m.kind === 'audio') {
      const buf = await this.audioBuffer(m);
      if (!buf) throw new Error('no se pudo decodificar el audio');
      m.dur = buf.duration; m.hasAudio = true;
    } else if (m.kind === 'image' || m.kind === 'svg') {
      const img = await this.image(m);
      const s = img as { width: number; height: number; naturalWidth?: number; naturalHeight?: number };
      m.w = s.naturalWidth || s.width || 512; m.h = s.naturalHeight || s.height || 512;
    } else if (m.kind === 'gif') {
      const g = await this.gif(m);
      if (g) { m.dur = g.total; m.frames = g.times.length; const f = await g.dec.decode({ frameIndex: 0 }); m.w = f.image.displayWidth; m.h = f.image.displayHeight; f.image.close(); m.fps = m.frames / Math.max(0.001, m.dur); }
      else { const img = await this.image(m); m.w = (img as ImageBitmap).width; m.h = (img as ImageBitmap).height; m.kind = 'image'; }
    } else if (m.kind === 'font') {
      await this.font(m);
    } else if (m.kind === 'lut') {
      const t = await this.lutText(m);
      if (!/LUT_3D_SIZE/i.test(t)) throw new Error('no es un LUT 3D .cube');
    }
  }

  private async videoMeta(m: MediaItem) {
    const v = document.createElement('video');
    v.muted = true; v.preload = 'metadata'; v.crossOrigin = 'anonymous';
    v.src = (await this.url(m, false))!;
    await once(v, 'loadedmetadata');
    if (!v.videoWidth || !Number.isFinite(v.duration)) throw new Error('vídeo sin imagen');
    const r = { w: v.videoWidth, h: v.videoHeight, dur: v.duration };
    v.removeAttribute('src'); v.load();
    return r;
  }

  /** Crea un proxy de 540p para editar con fluidez (escritorio, con FFmpeg). */
  async makeProxy(m: MediaItem) {
    const b = mediaBridge();
    if (!b) throw new Error('Los proxies necesitan la app de escritorio');
    await b.transcode(m.conv ? convKey(m) : blobKey(m), proxyKey(m), 'proxy');
    m.proxy = true;
    this.forgetUrl(m);
  }

  // ---------------------------------------------------------------- lectura

  /** URL del medio (`preview` = puede usar el proxy). */
  async url(m: MediaItem, preview = true): Promise<string | null> {
    const key = preview && this.useProxies && m.proxy ? proxyKey(m) : m.conv ? convKey(m) : blobKey(m);
    const hit = this.urls.get(key);
    if (hit) return hit;
    const u = await this.store.url?.(key) ?? null;
    if (!u) { const d = await this.store.get(key); if (!d) { this.missing.add(m.id); return null; } const b = URL.createObjectURL(new Blob([d as Uint8Array<ArrayBuffer>], { type: m.mime || undefined })); this.urls.set(key, b); return b; }
    this.urls.set(key, u);
    return u;
  }
  private forgetUrl(m: MediaItem) { for (const k of [blobKey(m), convKey(m), proxyKey(m)]) { const u = this.urls.get(k); if (u) { this.store.releaseUrl?.(u); this.urls.delete(k); } } }

  /** Comprueba qué medios no están en el almacén. */
  async checkMissing(items: MediaItem[]) {
    const keys = new Set(await this.store.list('m/'));
    this.missing.clear();
    for (const m of items) {
      if (m.kind === 'drawing' || m.kind === 'anim') { if (!this.projects?.get(m.project?.id ?? '')) this.missing.add(m.id); continue; }
      const k = m.kind === 'seq' ? seqKey(m, 0) : m.conv ? convKey(m) : blobKey(m);
      if (!keys.has(k)) this.missing.add(m.id);
    }
    return this.missing;
  }

  /** Bytes del medio (para recopilar en un .yosa portable). */
  async bytes(m: MediaItem): Promise<Map<string, Uint8Array>> {
    const out = new Map<string, Uint8Array>();
    const keys = m.kind === 'seq' ? Array.from({ length: m.frames }, (_, i) => seqKey(m, i)) : [blobKey(m), ...(m.conv ? [convKey(m)] : [])];
    for (const k of keys) { const d = await this.store.get(k); if (d) out.set(k, d); }
    return out;
  }

  /** Sustituye el archivo de un medio que falta (o cualquiera) por otro, conservando su id. */
  async relink(m: MediaItem, f: File) {
    await this.store.put(blobKey(m), new Uint8Array(await f.arrayBuffer()));
    m.conv = false; m.proxy = false; m.size = f.size; m.name = f.name;
    this.release(m);
    await this.probe(m);
    this.missing.delete(m.id);
  }

  /** Borra los archivos de un medio del almacén. */
  async remove(m: MediaItem) {
    this.release(m);
    const keys = (await this.store.list(`m/${m.id}`)).filter(k => k === blobKey(m) || k.startsWith(`${blobKey(m)}.`));
    for (const k of keys) await this.store.delete(k).catch(() => undefined);
  }

  /** Olvida lo cargado de un medio (al reemplazarlo o quitarlo). */
  release(m: MediaItem) {
    this.forgetUrl(m);
    this.images.delete(m.id); this.audio.delete(m.id); this.peakCache.delete(m.id); this.thumbs.delete(m.id); this.drawings.delete(m.id);
    const g = this.gifs.get(m.id); if (g) { for (const f of g.cache.values()) f.close(); g.dec.close(); this.gifs.delete(m.id); }
    for (const [k, v] of this.videos) if (k.startsWith(`${m.id}|`)) { v.removeAttribute('src'); v.load(); this.videos.delete(k); }
  }

  /** Suelta todo (al cerrar el proyecto). */
  dispose() {
    for (const v of this.videos.values()) { v.pause(); v.removeAttribute('src'); v.load(); }
    this.videos.clear();
    for (const u of this.urls.values()) this.store.releaseUrl?.(u);
    this.urls.clear(); this.images.clear(); this.audio.clear(); this.thumbs.clear(); this.drawings.clear(); this.projectDocs.clear(); this.peakCache.clear();
    for (const g of this.gifs.values()) { for (const f of g.cache.values()) f.close(); g.dec.close(); }
    this.gifs.clear();
  }

  // ---------------------------------------------------------------- vídeo

  /** Reproductor de vídeo de un clip (uno por clip: el mismo vídeo puede verse a la vez en dos sitios). */
  async video(clipId: string, m: MediaItem, preview = true): Promise<HTMLVideoElement | null> {
    const key = `${m.id}|${clipId}|${preview && this.useProxies && m.proxy ? 'p' : 'o'}`;
    let v = this.videos.get(key);
    if (v) return v;
    const u = await this.url(m, preview);
    if (!u) return null;
    v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    v.src = u;
    this.videos.set(key, v);
    await once(v, 'loadeddata').catch(() => undefined);
    return v;
  }

  /** El reproductor de un clip si ya está creado (sin esperar). */
  peekVideo(clipId: string, m: MediaItem, preview = true): HTMLVideoElement | null {
    const v = this.videos.get(`${m.id}|${clipId}|${preview && this.useProxies && m.proxy ? 'p' : 'o'}`);
    return v && v.readyState >= 1 ? v : null;
  }

  /** Todos los reproductores de vídeo creados. */
  liveVideos() { return this.videos.values(); }

  /** Pone el vídeo exactamente en `t` (s) y espera a que el fotograma esté listo. */
  async seek(v: HTMLVideoElement, t: number) {
    t = Math.max(0, Math.min(t, (v.duration || t) - 1e-3));
    if (Math.abs(v.currentTime - t) < 1e-3 && v.readyState >= 2 && !v.seeking) return;
    v.currentTime = t;
    await once(v, 'seeked', 'error', 10000).catch(() => undefined);
    if (v.readyState < 2) await once(v, 'canplay', 'error', 4000).catch(() => undefined);
  }

  // ---------------------------------------------------------------- imágenes, GIF, secuencias

  image(m: MediaItem): Promise<CanvasImageSource> {
    let p = this.images.get(m.id);
    if (!p) {
      p = (async () => {
        const d = await this.store.get(blobKey(m));
        if (!d) { this.missing.add(m.id); throw new Error(`Falta el archivo de «${m.name}»`); }
        if (m.kind === 'svg' || m.mime === 'image/svg+xml') {
          // SVG: imagen con tamaño propio; se dibuja como vector a la escala que haga falta.
          const img = new Image();
          img.src = URL.createObjectURL(new Blob([d as Uint8Array<ArrayBuffer>], { type: 'image/svg+xml' }));
          await img.decode();
          if (!img.naturalWidth) { img.width = 512; img.height = 512; }
          return img;
        }
        return createImageBitmap(new Blob([d as Uint8Array<ArrayBuffer>]));
      })();
      this.images.set(m.id, p);
      p.catch(() => this.images.delete(m.id));
    }
    return p;
  }

  private async gif(m: MediaItem) {
    const hit = this.gifs.get(m.id);
    if (hit) return hit;
    if (typeof ImageDecoder === 'undefined') return null;
    const d = await this.store.get(blobKey(m));
    if (!d) { this.missing.add(m.id); return null; }
    const dec = new ImageDecoder({ data: d, type: 'image/gif' });
    await dec.tracks.ready;
    await dec.completed.catch(() => undefined);
    const n = dec.tracks.selectedTrack?.frameCount ?? 1;
    const times: number[] = [];
    let total = 0;
    for (let i = 0; i < n; i++) { const f = await dec.decode({ frameIndex: i }); times.push(total); total += Math.max(0.02, (f.image.duration ?? 100000) / 1e6); f.image.close(); }
    const g = { dec, times, total, cache: new Map<number, VideoFrame>() };
    this.gifs.set(m.id, g);
    return g;
  }

  /** Fotograma de un GIF animado en `t` s. */
  async gifFrame(m: MediaItem, t: number): Promise<CanvasImageSource | null> {
    const g = await this.gif(m);
    if (!g) return this.image(m);
    t = ((t % g.total) + g.total) % g.total;
    let i = 0;
    while (i + 1 < g.times.length && g.times[i + 1] <= t) i++;
    let f = g.cache.get(i);
    if (!f) {
      f = (await g.dec.decode({ frameIndex: i })).image;
      g.cache.set(i, f);
      if (g.cache.size > 48) { const [k, old] = g.cache.entries().next().value!; old.close(); g.cache.delete(k); }
    }
    return f;
  }

  private seqImgs = new Map<string, Promise<ImageBitmap>>();
  /** Fotograma de una secuencia de imágenes en `t` s (caché pequeña: no se cargan todas). */
  async seqFrame(m: MediaItem, t: number): Promise<CanvasImageSource | null> {
    const i = Math.max(0, Math.min(m.frames - 1, Math.floor(t * m.fps + 1e-6)));
    const k = `${m.id}#${i}`;
    let p = this.seqImgs.get(k);
    if (!p) {
      p = this.store.get(seqKey(m, i)).then(d => { if (!d) throw new Error('falta un fotograma de la secuencia'); return createImageBitmap(new Blob([d as Uint8Array<ArrayBuffer>])); });
      this.seqImgs.set(k, p);
      if (this.seqImgs.size > 60) { const [old, op] = this.seqImgs.entries().next().value!; void op.then(b => b.close()).catch(() => undefined); this.seqImgs.delete(old); }
    }
    return p.catch(() => null);
  }

  // ---------------------------------------------------------------- dibujos y animaciones de YOSADRAW

  private drawing(m: MediaItem) {
    let p = this.drawings.get(m.id);
    if (!p) {
      p = (async () => {
        if (!this.projects || !m.project) throw new Error('Proyecto no disponible');
        const rev = this.projects.get(m.project.id)?.rev ?? 0;
        // El proyecto se lee una sola vez aunque se usen varias de sus capas por separado.
        const key = `${m.project.id}@${rev}`;
        let docP = this.projectDocs.get(key);
        if (!docP) { docP = readProject(await this.projects.read(m.project.id), browserImageCodec).then(f => f.doc); this.projectDocs.set(key, docP); docP.catch(() => this.projectDocs.delete(key)); }
        let doc = await docP;
        // Una capa concreta: sólo esa, visible y fuera de su carpeta (se eligió a propósito), sin tocar el documento compartido.
        if (m.project.layer) {
          const l = doc.layers.find(x => x.id === m.project!.layer);
          if (l) doc = Object.assign(Object.create(Object.getPrototypeOf(doc)), doc, { layers: [{ ...l, visible: true, group: null, clip: false }] });
        }
        return { fr: new FrameRenderer(this.painter, doc, 128 * 1024 * 1024), rev };
      })();
      this.drawings.set(m.id, p);
      p.catch(() => { this.drawings.delete(m.id); this.missing.add(m.id); });
    }
    return p;
  }

  /** ¿El dibujo original cambió desde que se cargó? (para ofrecer «Actualizar»). */
  async outdated(m: MediaItem) {
    if (!m.project || !this.projects) return false;
    const e = this.projects.get(m.project.id);
    return !!e && e.rev !== m.project.rev;
  }
  /** Vuelve a leer el dibujo original (tras editarlo en YOSADRAW). */
  refreshProject(m: MediaItem) { this.drawings.delete(m.id); this.thumbs.delete(m.id); if (m.project && this.projects) m.project.rev = this.projects.get(m.project.id)?.rev ?? m.project.rev; }

  /** Imagen de un dibujo o del fotograma de una animación de YOSADRAW a `scale` px por px. */
  async drawingFrame(m: MediaItem, t: number, scale: number): Promise<HTMLCanvasElement | null> {
    const d = await this.drawing(m).catch(() => null);
    if (!d) return null;
    const out = document.createElement('canvas');
    const a = d.fr['doc'] as { anim: { length: number; fps: number } | null };
    const f = a.anim ? Math.max(0, Math.min(a.anim.length - 1, Math.floor(t * a.anim.fps + 1e-6))) : 0;
    return d.fr.renderFrame(f, Math.max(0.01, Math.min(2, scale)), out, { background: !!m.project?.paper, includeReference: false });
  }

  // ---------------------------------------------------------------- audio

  audioBuffer(m: MediaItem): Promise<AudioBuffer | null> {
    let p = this.audio.get(m.id);
    if (!p) {
      p = (async () => {
        const u = await this.url(m, false);
        if (!u) return null;
        const data = await (await fetch(u)).arrayBuffer();
        try { return await audioContext().decodeAudioData(data); }
        catch {
          // Formatos que Chromium no decodifica: FFmpeg (escritorio) los pasa a WAV.
          const dec = (desktopBridge() as unknown as { decodeAudio?: (d: Uint8Array, n: string) => Promise<Uint8Array> } | null)?.decodeAudio;
          if (!dec) return null;
          const wav = await dec(new Uint8Array(data), m.name).catch(() => null);
          return wav ? audioContext().decodeAudioData(wav.slice().buffer) : null;
        }
      })();
      this.audio.set(m.id, p);
    }
    return p;
  }

  /** Picos para la forma de onda (máximo cada 1/200 s). */
  async peaks(m: MediaItem): Promise<Float32Array | null> {
    const hit = this.peakCache.get(m.id);
    if (hit) return hit;
    const buf = await this.audioBuffer(m);
    if (!buf) return null;
    const step = Math.max(1, Math.floor(buf.sampleRate / 200)), n = Math.ceil(buf.length / step), p = new Float32Array(n);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) { let mx = p[i]; for (let k = i * step, e = Math.min(d.length, k + step); k < e; k++) { const v = d[k] < 0 ? -d[k] : d[k]; if (v > mx) mx = v; } p[i] = mx; }
    }
    this.peakCache.set(m.id, p);
    return p;
  }

  // ---------------------------------------------------------------- fuentes y LUT

  private fonts = new Map<string, Promise<string>>();
  /** Registra una fuente importada; devuelve su nombre de familia. */
  font(m: MediaItem): Promise<string> {
    let p = this.fonts.get(m.id);
    if (!p) {
      p = (async () => {
        const d = await this.store.get(blobKey(m));
        if (!d) { this.missing.add(m.id); throw new Error('falta la fuente'); }
        const family = m.name.replace(/\.[^.]+$/, '');
        const ff = new FontFace(family, d.slice().buffer);
        await ff.load();
        document.fonts.add(ff);
        return family;
      })();
      this.fonts.set(m.id, p);
    }
    return p;
  }
  async lutText(m: MediaItem) { const d = await this.store.get(blobKey(m)); if (!d) throw new Error('falta el LUT'); return new TextDecoder().decode(d); }

  // ---------------------------------------------------------------- miniaturas

  thumb(m: MediaItem, w = 160, h = 90): Promise<HTMLCanvasElement | null> {
    let p = this.thumbs.get(m.id);
    if (!p) {
      p = (async () => {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d')!;
        g.fillStyle = '#14111d'; g.fillRect(0, 0, w, h);
        const fit = (sw: number, sh: number) => { const k = Math.min(w / sw, h / sh); return [(w - sw * k) / 2, (h - sh * k) / 2, sw * k, sh * k] as const; };
        try {
          if (m.kind === 'audio') {
            const pk = await this.peaks(m);
            g.fillStyle = '#5fd3a5';
            if (pk) for (let x = 0; x < w; x++) { const v = pk[Math.floor((x / w) * pk.length)] ?? 0; g.fillRect(x, h / 2 - v * h * 0.45, 1, Math.max(1, v * h * 0.9)); }
          } else if (m.kind === 'video') {
            const v = document.createElement('video');
            v.muted = true; v.crossOrigin = 'anonymous'; v.src = (await this.url(m))!;
            await once(v, 'loadeddata');
            await this.seek(v, Math.min(1, v.duration * 0.1));
            g.drawImage(v, ...fit(v.videoWidth, v.videoHeight));
            v.removeAttribute('src'); v.load();
          } else if (m.kind === 'image' || m.kind === 'svg') {
            const img = await this.image(m);
            g.drawImage(img, ...fit(m.w || 1, m.h || 1));
          } else if (m.kind === 'gif') {
            const f = await this.gifFrame(m, 0);
            if (f) g.drawImage(f, ...fit(m.w || 1, m.h || 1));
          } else if (m.kind === 'seq') {
            const f = await this.seqFrame(m, 0);
            if (f) g.drawImage(f, ...fit(m.w || 1, m.h || 1));
          } else if (m.kind === 'drawing' || m.kind === 'anim') {
            const f = await this.drawingFrame(m, 0, Math.min(w / (m.w || 1), h / (m.h || 1)) * 2);
            if (f) g.drawImage(f, ...fit(f.width, f.height));
          } else {
            g.fillStyle = '#c3a5ff'; g.font = '600 22px Outfit, system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText(m.kind === 'font' ? 'Aa' : 'LUT', w / 2, h / 2);
          }
          return c;
        } catch { return null; }
      })();
      this.thumbs.set(m.id, p);
    }
    return p;
  }
}
