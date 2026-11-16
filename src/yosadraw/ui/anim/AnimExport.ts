import { zipSync } from 'fflate';
import { desktopBridge } from '../../brush/storage';
import { encodeWav } from '../../anim/audio';
import * as M from '../../anim/model';
import type { FrameRenderer } from '../../anim/render';
import { h, toast } from '../dom';
import type { AnimStudio } from './AnimStudio';

type Fmt = 'mp4' | 'mov' | 'webm' | 'gif' | 'apng' | 'webp' | 'png-seq' | 'jpeg-seq' | 'tiff-seq' | 'sprite';
type Codec = 'h264' | 'h265' | 'prores' | 'vp9';
type Res = 'canvas' | '720' | '1080' | '1440' | '2160';

interface FormatDef { id: Fmt; label: string; sub: string; ffmpeg: boolean; alpha: boolean; audio: boolean; loop: boolean; quality: boolean; bitrate: boolean; codecs?: Codec[]; even: boolean }
const FORMATS: FormatDef[] = [
  { id: 'mp4', label: 'MP4', sub: 'H.264 / H.265 · con audio', ffmpeg: true, alpha: false, audio: true, loop: false, quality: true, bitrate: true, codecs: ['h264', 'h265'], even: true },
  { id: 'mov', label: 'MOV', sub: 'H.264 / H.265 / ProRes (alfa)', ffmpeg: true, alpha: true, audio: true, loop: false, quality: true, bitrate: true, codecs: ['h264', 'h265', 'prores'], even: true },
  { id: 'webm', label: 'WebM', sub: 'VP9 · alfa · Opus', ffmpeg: true, alpha: true, audio: true, loop: false, quality: true, bitrate: true, codecs: ['vp9'], even: true },
  { id: 'gif', label: 'GIF', sub: 'Paleta óptima · bucle', ffmpeg: true, alpha: true, audio: false, loop: true, quality: false, bitrate: false, even: false },
  { id: 'apng', label: 'APNG', sub: 'PNG animado · alfa', ffmpeg: true, alpha: true, audio: false, loop: true, quality: false, bitrate: false, even: false },
  { id: 'webp', label: 'WebP animado', sub: 'Alfa · bucle', ffmpeg: true, alpha: true, audio: false, loop: true, quality: true, bitrate: false, even: false },
  { id: 'png-seq', label: 'Secuencia PNG', sub: 'Un archivo por fotograma', ffmpeg: true, alpha: true, audio: false, loop: false, quality: false, bitrate: false, even: false },
  { id: 'jpeg-seq', label: 'Secuencia JPEG', sub: 'Un archivo por fotograma', ffmpeg: true, alpha: false, audio: false, loop: false, quality: true, bitrate: false, even: false },
  { id: 'tiff-seq', label: 'Secuencia TIFF', sub: 'LZW · alfa', ffmpeg: true, alpha: true, audio: false, loop: false, quality: false, bitrate: false, even: false },
  { id: 'sprite', label: 'Hoja de sprites', sub: 'PNG + JSON (juegos, web)', ffmpeg: false, alpha: true, audio: false, loop: false, quality: false, bitrate: false, even: false },
];
const CODEC_LABEL: Record<Codec, string> = { h264: 'H.264 (compatible)', h265: 'H.265 / HEVC (más pequeño)', prores: 'ProRes 4444 / HQ (edición)', vp9: 'VP9' };
const RES: [Res, string, number, number][] = [['canvas', 'Lienzo', 0, 0], ['720', '720p', 1280, 720], ['1080', '1080p', 1920, 1080], ['1440', '1440p', 2560, 1440], ['2160', '4K', 3840, 2160]];

export interface AnimExportPrefs {
  format: Fmt; codec: Codec; res: Res; fps: number; rateMode: 'quality' | 'bitrate'; quality: number; bitrate: number;
  alpha: boolean; audio: boolean; loop: boolean; range: 'all' | 'range' | 'custom'; from: number; to: number; cols: number; padding: number;
}
export const DEFAULT_ANIM_EXPORT: AnimExportPrefs = { format: 'mp4', codec: 'h264', res: '1080', fps: 0, rateMode: 'quality', quality: 80, bitrate: 8000, alpha: false, audio: true, loop: true, range: 'all', from: 1, to: 1, cols: 8, padding: 2 };
export function normalizeAnimExport(v: unknown): AnimExportPrefs {
  const o = { ...DEFAULT_ANIM_EXPORT, ...(v && typeof v === 'object' ? v : {}) } as AnimExportPrefs;
  if (!FORMATS.some(f => f.id === o.format)) o.format = 'mp4';
  if (!RES.some(r => r[0] === o.res)) o.res = '1080';
  return o;
}

interface VideoBridge {
  probe(): Promise<{ ok: boolean; version?: string; error?: string }>;
  begin(o: Record<string, unknown>): Promise<{ id: number; target: string }>;
  frame(id: number, data: Uint8Array): Promise<number>;
  finish(id: number): Promise<{ path: string; size: number; files: number }>;
  abort(id: number): Promise<void>;
}
const videoBridge = () => (desktopBridge() as unknown as { video?: VideoBridge } | null)?.video ?? null;
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const mb = (n: number) => `${(n / 1048576).toFixed(n > 10 * 1048576 ? 0 : 1).replace('.', ',')} MB`;
const safe = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 100) || 'Animación';

/**
 * Exportación de la animación. Vídeo (MP4, MOV, WebM), GIF, APNG, WebP y
 * secuencias se codifican con FFmpeg en la app de escritorio: cada fotograma se
 * compone (caché por cels), se envía en RGBA y FFmpeg lo codifica al momento, así
 * que la memoria no crece con la duración. El audio se mezcla sin conexión
 * (volumen, recortes, silencios) y entra sincronizado al fotograma. La hoja de
 * sprites se genera en la propia interfaz (también en el navegador).
 */
export class AnimExport {
  open = false;
  private folder: string | null = null;
  private ffmpeg: { ok: boolean; version?: string; error?: string } | null = null;

  constructor(private s: AnimStudio, public prefs: AnimExportPrefs, private persist: (p: AnimExportPrefs) => void, private projectName: () => string) {}

  async show() {
    const a = this.s.anim;
    if (!a || this.open) return;
    if (this.s.player.playing) this.s.player.pause();
    this.open = true;
    const bridge = desktopBridge();
    if (bridge?.exportFolder && !this.folder) { try { this.folder = await bridge.exportFolder(); } catch { this.folder = null; } }
    const vb = videoBridge();
    if (vb && !this.ffmpeg) this.ffmpeg = await vb.probe().catch(e => ({ ok: false, error: String(e) }));
    const p = this.prefs;
    if (p.range === 'custom' && (p.from < 1 || p.to > a.length || p.from > p.to)) { p.from = 1; p.to = a.length; }
    if (p.range === 'range' && !a.range) p.range = 'all';
    if (!this.available(this.def(p.format))) p.format = 'sprite';

    const body = h('div', { class: 'ax-body' });
    const actions = h('div', { class: 'dialog-actions' });
    const close = () => { root.remove(); this.open = false; };
    let busy = false;
    const root = h('div', {
      class: 'dialog-backdrop modal-backdrop ax-dialog',
      on: { keydown: (e: Event) => { e.stopPropagation(); if ((e as KeyboardEvent).key === 'Escape' && !busy) close(); } },
    }, h('div', { class: 'dialog modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Exportar animación' },
      h('div', { class: 'dialog-head' }, h('h2', null, 'Exportar animación')), body, actions));
    document.body.append(root);

    const render = () => {
      const d = this.def(p.format);
      if (d.codecs && !d.codecs.includes(p.codec)) p.codec = d.codecs[0];
      const fmtBtns = FORMATS.map(f => h('button', {
        type: 'button', class: 'ax-format', role: 'radio', 'aria-checked': String(f.id === p.format), disabled: !this.available(f),
        title: this.available(f) ? f.sub : 'Necesita la app de escritorio (FFmpeg)', on: { click: () => { p.format = f.id; render(); } },
      }, h('strong', null, f.label), h('small', null, f.sub)));
      const sel = <T extends string>(label: string, value: T, opts: [T, string][], set: (v: T) => void) => {
        const s = h('select', { 'aria-label': label }, ...opts.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
        s.addEventListener('change', () => { set(s.value as T); render(); });
        return h('label', { class: 'ap-field' }, h('span', null, label), s);
      };
      const numIn = (label: string, value: number, min: number, max: number, set: (v: number) => void, unit = '') => {
        const i = h('input', { type: 'number', min: String(min), max: String(max), value: String(value), 'aria-label': label });
        i.addEventListener('change', () => { set(Math.max(min, Math.min(max, Math.round(Number(i.value) || min)))); render(); });
        return h('label', { class: 'ap-field' }, h('span', null, label), h('span', { class: 'ap-num' }, i, unit ? h('small', null, unit) : null));
      };
      const check = (label: string, value: boolean, set: (v: boolean) => void, disabled = false, note = '') => {
        const i = h('input', { type: 'checkbox', checked: value && !disabled, disabled });
        i.addEventListener('change', () => { set(i.checked); render(); });
        return h('label', { class: 'switch', title: note }, i, h('span', { class: 'track' }), h('span', null, label + (disabled && note ? ` (${note})` : '')));
      };
      const { w, h: hh } = this.size();
      const [f0, f1] = this.range();
      const outFps = p.fps || a.fps;
      const n = this.outFrames();
      const hasAudio = a.audio.some(c => c.duration > 0);
      const proresAlpha = p.format !== 'mov' || p.codec === 'prores';
      const alphaOk = d.alpha && proresAlpha && !(d.id === 'jpeg-seq');
      const warn: string[] = [];
      if (d.ffmpeg && !this.available(d)) warn.push('Este formato necesita la app de escritorio de YOSADRAW (incluye FFmpeg).');
      if (this.ffmpeg && !this.ffmpeg.ok) warn.push(`FFmpeg no disponible: ${this.ffmpeg.error}`);
      if (p.format === 'gif' && (w > 1280 || n > 600)) warn.push('Un GIF grande o largo ocupa mucho: considera WebM, MP4 o WebP.');
      if (p.format === 'sprite') { const cols = Math.min(p.cols, n), rows = Math.ceil(n / cols); const sw = cols * (w + p.padding), sh = rows * (hh + p.padding); if (sw > 16384 || sh > 16384) warn.push(`La hoja mediría ${sw} × ${sh} px (máx. 16384): baja la resolución o el número de fotogramas.`); }
      body.replaceChildren(
        h('div', { class: 'ax-formats', role: 'radiogroup', 'aria-label': 'Formato' }, ...fmtBtns),
        h('div', { class: 'ax-grid' },
          d.codecs ? sel<Codec>('Códec', p.codec, d.codecs.map(c => [c, CODEC_LABEL[c]]), v => { p.codec = v; }) : null,
          sel<Res>('Resolución', p.res, RES.map(([id, l, bw, bh]) => [id, bw ? `${l} (${this.fit(bw, bh).w} × ${this.fit(bw, bh).h})` : `${l} (${this.s.doc.width} × ${this.s.doc.height})`]), v => { p.res = v; }),
          sel<string>('FPS de salida', String(p.fps), [['0', `Del proyecto (${a.fps})`], ...M.FPS_OPTIONS.map(f => [String(f), `${f} fps`] as [string, string])], v => { p.fps = Number(v); }),
          sel<AnimExportPrefs['range']>('Intervalo', p.range, [['all', `Todo (1–${a.length})`], ...(a.range ? [['range', `Intervalo de reproducción (${a.range[0] + 1}–${a.range[1] + 1})`]] as [AnimExportPrefs['range'], string][] : []), ['custom', 'Personalizado']], v => { p.range = v; if (v === 'custom') { p.from = 1; p.to = a.length; } }),
          p.range === 'custom' ? h('div', { class: 'ap-row2' }, numIn('Desde', p.from, 1, a.length, v => { p.from = v; }), numIn('Hasta', p.to, 1, a.length, v => { p.to = v; })) : null,
          d.quality || d.bitrate ? (d.bitrate ? sel<AnimExportPrefs['rateMode']>('Control', p.rateMode, [['quality', 'Calidad constante'], ['bitrate', 'Bitrate']], v => { p.rateMode = v; }) : null) : null,
          (d.quality && (p.rateMode === 'quality' || !d.bitrate)) && !(p.format === 'mov' && p.codec === 'prores') ? numIn('Calidad', p.quality, 1, 100, v => { p.quality = v; }, '%') : null,
          d.bitrate && p.rateMode === 'bitrate' && !(p.format === 'mov' && p.codec === 'prores') ? numIn('Bitrate de vídeo', p.bitrate, 100, 400000, v => { p.bitrate = v; }, 'kbit/s') : null,
          p.format === 'sprite' ? h('div', { class: 'ap-row2' }, numIn('Columnas', p.cols, 1, 64, v => { p.cols = v; }), numIn('Separación', p.padding, 0, 64, v => { p.padding = v; }, 'px')) : null),
        h('div', { class: 'ax-checks' },
          check('Fondo transparente', p.alpha, v => { p.alpha = v; }, !alphaOk, p.format === 'mov' ? 'sólo con ProRes' : 'este formato no tiene transparencia'),
          check('Incluir audio', p.audio, v => { p.audio = v; }, !d.audio || !hasAudio, !hasAudio ? 'no hay audio' : 'este formato no lleva audio'),
          d.loop ? check('Repetir en bucle', p.loop, v => { p.loop = v; }) : null),
        h('p', { class: 'ax-note' }, `${n} fotogramas de ${w} × ${hh} px a ${outFps} fps = ${(n / outFps).toFixed(2).replace('.', ',')} s · fotogramas ${f0 + 1}–${f1 + 1} del proyecto${outFps !== a.fps ? ` (${a.fps} fps → ${outFps} fps: se repiten o se saltan fotogramas, la duración no cambia)` : ''}. Las pistas de referencia no se exportan.`),
        bridge?.chooseFolder ? h('div', { class: 'ex-folder' }, h('span', { class: 'ex-label' }, 'Carpeta'), h('code', null, this.folder ?? '—'),
          h('button', { type: 'button', class: 'btn sm', on: { click: async () => { const f = await bridge.chooseFolder!(this.folder ?? ''); if (f) { this.folder = f; render(); } } } }, 'Cambiar…')) : h('p', { class: 'ax-note' }, 'Se descargará en el navegador.'),
        this.ffmpeg?.ok ? h('p', { class: 'ax-note' }, `Codificador: ${this.ffmpeg.version}`) : '',
        ...warn.map(t => h('p', { class: 'ax-warn' }, t)));
      const go = h('button', { type: 'button', class: 'btn primary', disabled: !this.available(d) || warn.some(t => t.startsWith('La hoja')), on: { click: () => void run() } }, 'Exportar');
      actions.replaceChildren(h('button', { type: 'button', class: 'btn ghost', on: { click: close } }, 'Cancelar'), go);
      this.persist(p);
    };

    const run = async () => {
      busy = true;
      const bar = h('span'), label = h('p', { class: 'ax-note' }, 'Preparando…');
      let cancelled = false;
      const cancel = h('button', { type: 'button', class: 'btn', on: { click: () => { cancelled = true; cancel.setAttribute('disabled', ''); label.textContent = 'Cancelando…'; } } }, 'Cancelar');
      body.replaceChildren(h('div', { class: 'ax-progress' }, h('div', { class: 'ax-bar' }, bar), label));
      actions.replaceChildren(cancel);
      const t0 = performance.now();
      const progress = (k: number, n: number, what: string) => {
        bar.style.width = `${(k / n) * 100}%`;
        const el = (performance.now() - t0) / 1000, eta = k > 2 ? (el / k) * (n - k) : 0;
        label.textContent = `${what} ${k} / ${n}${eta > 1 ? ` · quedan ~${Math.ceil(eta)} s` : ''}`;
      };
      try {
        const res = p.format === 'sprite' ? await this.sprite(progress, () => cancelled) : await this.encode(progress, () => cancelled);
        if (!res) { toast('Exportación cancelada'); render(); actions.querySelector('.btn.primary')?.removeAttribute('disabled'); busy = false; return; }
        close();
        const bridgeNow = desktopBridge();
        toast(`Exportado: ${res.name} (${mb(res.size)}${res.files > 1 ? `, ${res.files} archivos` : ''})`, 'ok', res.path && bridgeNow?.revealFile ? { label: 'Mostrar', run: () => void bridgeNow.revealFile!(res.path!) } : undefined);
      } catch (e) {
        busy = false;
        toast(`No se pudo exportar: ${e instanceof Error ? e.message : String(e)}`, 'error');
        render();
      }
    };
    render();
  }

  private def(id: Fmt) { return FORMATS.find(f => f.id === id)!; }
  private available(f: FormatDef) { return !f.ffmpeg || (!!videoBridge() && this.ffmpeg?.ok !== false); }

  /** Encaje del lienzo en una caja (vertical si el lienzo lo es). */
  private fit(bw: number, bh: number) {
    const d = this.s.doc;
    if (d.height > d.width) [bw, bh] = [bh, bw];
    const k = Math.min(bw / d.width, bh / d.height);
    return { w: Math.round(d.width * k), h: Math.round(d.height * k), k };
  }

  private size() {
    const p = this.prefs, d = this.s.doc, def = this.def(p.format);
    const r = RES.find(x => x[0] === p.res)!;
    let { w, h: hh } = r[2] ? this.fit(r[2], r[3]) : { w: d.width, h: d.height };
    if (def.even && !(p.format === 'mov' && p.codec === 'prores')) { w = even(w); hh = even(hh); }
    return { w, h: hh };
  }

  private range(): [number, number] {
    const a = this.s.anim!, p = this.prefs;
    if (p.range === 'range' && a.range) return M.playRange(a);
    if (p.range === 'custom') return [Math.max(0, p.from - 1), Math.min(a.length - 1, Math.max(p.from, p.to) - 1)];
    return [0, a.length - 1];
  }

  private outFrames() {
    const a = this.s.anim!, [f0, f1] = this.range(), out = this.prefs.fps || a.fps;
    return Math.max(1, Math.round(((f1 - f0 + 1) / a.fps) * out));
  }
  /** Fotograma del proyecto que corresponde al k-ésimo de salida (FPS distintos: se repite o se salta). */
  private source(k: number) {
    const a = this.s.anim!, [f0, f1] = this.range(), out = this.prefs.fps || a.fps;
    return Math.min(f1, f0 + Math.floor((k * a.fps) / out + 1e-6));
  }

  /** Compone el fotograma k de salida a w × h. */
  private compose(r: FrameRenderer, k: number, w: number, hh: number, alpha: boolean, tmp: HTMLCanvasElement, out: HTMLCanvasElement) {
    const d = this.s.doc;
    const scale = w / d.width;
    r.renderFrame(this.source(k), scale, tmp, { background: !alpha, includeReference: false });
    if (out.width !== w || out.height !== hh) { out.width = w; out.height = hh; }
    const g = out.getContext('2d', { willReadFrequently: true })!;
    g.clearRect(0, 0, w, hh);
    if (!alpha) { g.fillStyle = d.settings.background ?? '#ffffff'; g.fillRect(0, 0, w, hh); }
    g.imageSmoothingQuality = 'high';
    g.drawImage(tmp, 0, 0, w, hh);
    return g;
  }

  private async encode(progress: (k: number, n: number, what: string) => void, cancelled: () => boolean): Promise<{ name: string; path?: string; size: number; files: number } | null> {
    const vb = videoBridge(), a = this.s.anim!, p = this.prefs, def = this.def(p.format);
    if (!vb || !this.folder) throw new Error('La exportación de vídeo necesita la app de escritorio');
    const { w, h: hh } = this.size(), n = this.outFrames(), out = p.fps || a.fps;
    const alpha = p.alpha && def.alpha && (p.format !== 'mov' || p.codec === 'prores');
    let audio: Uint8Array | null = null;
    if (p.audio && def.audio && a.audio.length) {
      progress(0, n, 'Mezclando audio…');
      const [f0] = this.range();
      const mix = await this.s.audio.mix(a, f0 / a.fps, n / out);
      if (mix) audio = encodeWav(mix);
    }
    const { id, target } = await vb.begin({
      folder: this.folder, name: safe(this.projectName()), format: p.format, codec: p.codec, width: w, height: hh, fps: out,
      quality: p.quality, bitrate: def.bitrate && p.rateMode === 'bitrate' ? p.bitrate : 0, alpha, loop: p.loop, audio, frames: n,
    });
    const r = this.s.frames.fork(768 * 1024 * 1024);
    const tmp = document.createElement('canvas'), canvas = document.createElement('canvas');
    try {
      for (let k = 0; k < n; k++) {
        if (cancelled()) { await vb.abort(id); return null; }
        const g = this.compose(r, k, w, hh, alpha, tmp, canvas);
        const px = g.getImageData(0, 0, w, hh).data;
        await vb.frame(id, new Uint8Array(px.buffer, px.byteOffset, px.byteLength));
        progress(k + 1, n, 'Codificando fotograma');
      }
      progress(n, n, 'Terminando el archivo…');
      const res = await vb.finish(id);
      return { name: res.path.split(/[\\/]/).pop() ?? target, path: res.path, size: res.size, files: res.files };
    } catch (e) {
      await vb.abort(id).catch(() => undefined);
      throw e;
    } finally { r.clear(); }
  }

  /** Hoja de sprites: PNG con todos los fotogramas en rejilla + JSON con sus posiciones y duración. */
  private async sprite(progress: (k: number, n: number, what: string) => void, cancelled: () => boolean): Promise<{ name: string; path?: string; size: number; files: number } | null> {
    const a = this.s.anim!, p = this.prefs, out = p.fps || a.fps;
    const { w, h: hh } = this.size(), n = this.outFrames();
    const cols = Math.min(p.cols, n), rows = Math.ceil(n / cols), pad = p.padding;
    const sheet = document.createElement('canvas');
    sheet.width = cols * w + (cols - 1) * pad; sheet.height = rows * hh + (rows - 1) * pad;
    const sg = sheet.getContext('2d')!;
    const r = this.s.frames.fork(512 * 1024 * 1024);
    const tmp = document.createElement('canvas'), canvas = document.createElement('canvas');
    const frames: Record<string, unknown> = {};
    const base = safe(this.projectName());
    for (let k = 0; k < n; k++) {
      if (cancelled()) return null;
      this.compose(r, k, w, hh, p.alpha, tmp, canvas);
      const x = (k % cols) * (w + pad), y = Math.floor(k / cols) * (hh + pad);
      sg.drawImage(canvas, x, y);
      frames[`${base}_${String(k + 1).padStart(4, '0')}`] = { frame: { x, y, w, h: hh }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w, h: hh }, sourceSize: { w, h: hh }, duration: Math.round(1000 / out) };
      progress(k + 1, n, 'Componiendo fotograma');
      if (k % 4 === 3) await new Promise(res => setTimeout(res, 0));
    }
    r.clear();
    const png = new Uint8Array(await (await new Promise<Blob>((res, rej) => sheet.toBlob(b => (b ? res(b) : rej(new Error('No se pudo codificar la hoja'))), 'image/png'))).arrayBuffer());
    const json = new TextEncoder().encode(JSON.stringify({ frames, meta: { app: 'YOSADRAW', image: `${base}.png`, size: { w: sheet.width, h: sheet.height }, format: 'RGBA8888', scale: '1', fps: out, columns: cols, rows } }, null, 1));
    const bridge = desktopBridge();
    if (bridge?.writeExport && this.folder) {
      const path = await bridge.writeExport(this.folder, `${base}.png`, png, false);
      const stem = path.split(/[\\/]/).pop()!.replace(/\.png$/i, '');
      await bridge.writeExport(this.folder, `${stem}.json`, json, false);
      return { name: `${stem}.png + .json`, path, size: png.length + json.length, files: 2 };
    }
    const zip = zipSync({ [`${base}.png`]: [png, { level: 0 }], [`${base}.json`]: json });
    const url = URL.createObjectURL(new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
    const link = document.createElement('a');
    link.href = url; link.download = `${base}-sprites.zip`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { name: `${base}-sprites.zip`, size: zip.length, files: 2 };
  }
}
