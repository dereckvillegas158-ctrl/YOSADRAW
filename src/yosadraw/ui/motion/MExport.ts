import { zipSync, type Zippable } from 'fflate';
import { desktopBridge } from '../../brush/storage';
import { encodeWav } from '../../anim/audio';
import { encodeGif, encodeMp4, mp4Codec } from '../../anim/webexport';
import { mixAudio } from '../../motion/audio';
import { compOf, type Composition } from '../../motion/model';
import { Compositor } from '../../motion/render';
import { h, toast } from '../dom';
import type { MotionStudio } from './MotionStudio';
import { fmtDur } from './util';

type Fmt = 'mp4' | 'mov' | 'webm' | 'gif' | 'webp' | 'png-seq' | 'web-mp4' | 'web-gif' | 'web-png';
type Codec = 'h264' | 'h265' | 'prores' | 'vp9';
type Res = 'comp' | '720' | '1080' | '1440' | '2160' | 'half';

interface FormatDef { id: Fmt; label: string; sub: string; desktop: boolean; web: boolean; alpha: boolean; audio: boolean; quality: boolean; bitrate: boolean; codecs?: Codec[]; even: boolean; loop?: boolean }
const FORMATS: FormatDef[] = [
  { id: 'mp4', label: 'MP4', sub: 'H.264 / H.265 + AAC', desktop: true, web: false, alpha: false, audio: true, quality: true, bitrate: true, codecs: ['h264', 'h265'], even: true },
  { id: 'mov', label: 'MOV', sub: 'H.264 / H.265 / ProRes (alfa)', desktop: true, web: false, alpha: true, audio: true, quality: true, bitrate: true, codecs: ['h264', 'h265', 'prores'], even: true },
  { id: 'webm', label: 'WebM', sub: 'VP9 + Opus · alfa', desktop: true, web: false, alpha: true, audio: true, quality: true, bitrate: true, codecs: ['vp9'], even: true },
  { id: 'gif', label: 'GIF', sub: 'Paleta óptima · bucle', desktop: true, web: false, alpha: true, audio: false, quality: false, bitrate: false, even: false, loop: true },
  { id: 'webp', label: 'WebP animado', sub: 'Alfa · bucle', desktop: true, web: false, alpha: true, audio: false, quality: true, bitrate: false, even: false, loop: true },
  { id: 'png-seq', label: 'Secuencia PNG', sub: 'Un PNG por fotograma · alfa', desktop: true, web: false, alpha: true, audio: false, quality: false, bitrate: false, even: false },
  { id: 'web-mp4', label: 'MP4', sub: 'H.264 del dispositivo + AAC', desktop: false, web: true, alpha: false, audio: true, quality: false, bitrate: true, even: true },
  { id: 'web-gif', label: 'GIF', sub: 'Bucle · transparencia', desktop: false, web: true, alpha: true, audio: false, quality: false, bitrate: false, even: false, loop: true },
  { id: 'web-png', label: 'Secuencia PNG', sub: 'ZIP con un PNG por fotograma', desktop: false, web: true, alpha: true, audio: false, quality: false, bitrate: false, even: false },
];
const CODEC_LABEL: Record<Codec, string> = { h264: 'H.264 (compatible con todo)', h265: 'H.265 / HEVC (más pequeño)', prores: 'ProRes 4444 / HQ (edición, alfa)', vp9: 'VP9' };
const RES: [Res, string, number][] = [['comp', 'Composición', 0], ['720', '720p', 720], ['1080', '1080p', 1080], ['1440', '1440p', 1440], ['2160', '4K (2160p)', 2160], ['half', 'Mitad (borrador)', -1]];

export interface MotionExportPrefs {
  format: Fmt; codec: Codec; res: Res; fps: number; rateMode: 'quality' | 'bitrate'; quality: number; bitrate: number;
  alpha: boolean; audio: boolean; loop: boolean; range: 'all' | 'range' | 'custom'; from: number; to: number;
  motionBlur: boolean; mbSamples: number; mbShutter: number;
}
export const DEFAULT_MOTION_EXPORT: MotionExportPrefs = { format: 'mp4', codec: 'h264', res: '1080', fps: 0, rateMode: 'quality', quality: 82, bitrate: 12000, alpha: false, audio: true, loop: true, range: 'all', from: 0, to: 0, motionBlur: false, mbSamples: 8, mbShutter: 0.5 };
export function normalizeMotionExport(v: unknown): MotionExportPrefs {
  const o = { ...DEFAULT_MOTION_EXPORT, ...(v && typeof v === 'object' ? v : {}) } as MotionExportPrefs;
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
const safe = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 100) || 'Vídeo';

/**
 * Exportación de YOSADRAW MOTION. Cada fotograma se compone con los medios
 * ORIGINALES (nunca con proxies) a la resolución de salida, con el fotograma de
 * vídeo exacto y, si se elige, desenfoque de movimiento por sub-fotogramas. En la
 * app de escritorio, FFmpeg codifica al vuelo (MP4/MOV H.264, H.265, ProRes con
 * alfa, WebM VP9, GIF, WebP, PNG): la memoria no crece con la duración. En Android
 * y el navegador, MP4 H.264 con el codificador del dispositivo (WebCodecs), GIF y
 * secuencias PNG. El audio es la misma mezcla que se oye al reproducir.
 */
export class MExport {
  open = false;
  private folder: string | null = null;
  private ffmpeg: { ok: boolean; version?: string; error?: string } | null = null;
  private webMp4: boolean | null = null;

  constructor(private s: MotionStudio, public prefs: MotionExportPrefs, private persist: (p: MotionExportPrefs) => void, private projectName: () => string) {}

  private get desktop() { return !!videoBridge(); }
  private def(id: Fmt) { return FORMATS.find(f => f.id === id)!; }
  private formats() { return FORMATS.filter(f => (this.desktop ? f.desktop : f.web)); }
  /** Composición que se exporta: la principal. */
  private get comp(): Composition { return compOf(this.s.m, this.s.m.main); }

  async show() {
    const s = this.s;
    if (!s.active || this.open) return;
    if (s.player.playing) s.player.pause();
    this.open = true;
    const bridge = desktopBridge();
    if (bridge?.exportFolder && !this.folder) { try { this.folder = await bridge.exportFolder(); } catch { this.folder = null; } }
    const vb = videoBridge();
    if (vb && !this.ffmpeg) this.ffmpeg = await vb.probe().catch(e => ({ ok: false, error: String(e) }));
    if (this.webMp4 === null && !vb) this.webMp4 = !!(await mp4Codec(1280, 720, 30));
    const p = this.prefs;
    if (!this.formats().some(f => f.id === p.format)) p.format = this.desktop ? 'mp4' : 'web-mp4';
    const comp = this.comp;
    if (p.range === 'range' && !comp.range) p.range = 'all';
    if (p.range === 'custom' && !(p.to > p.from)) { p.from = 0; p.to = comp.dur; }

    const body = h('div', { class: 'ax-body' });
    const actions = h('div', { class: 'dialog-actions' });
    let busy = false;
    const close = () => { root.remove(); this.open = false; };
    const root = h('div', { class: 'dialog-backdrop modal-backdrop ax-dialog mo-export-dlg', on: { keydown: (e: Event) => { e.stopPropagation(); if ((e as KeyboardEvent).key === 'Escape' && !busy) close(); } } },
      h('div', { class: 'dialog modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Exportar vídeo' }, h('div', { class: 'dialog-head' }, h('h2', null, 'Exportar vídeo')), body, actions));
    document.body.append(root);

    const render = () => {
      const d = this.def(p.format);
      if (d.codecs && !d.codecs.includes(p.codec)) p.codec = d.codecs[0];
      const sel = <T extends string>(label: string, value: T, opts: [T, string][], set: (v: T) => void) => {
        const el = h('select', { 'aria-label': label }, ...opts.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
        el.addEventListener('change', () => { set(el.value as T); render(); });
        return h('label', { class: 'mo-field' }, label, el);
      };
      const numIn = (label: string, value: number, min: number, max: number, step: number, set: (v: number) => void, unit = '') => {
        const i = h('input', { type: 'number', min: String(min), max: String(max), step: String(step), value: String(+value.toFixed(3)), 'aria-label': label });
        i.addEventListener('change', () => { const v = Number(i.value.replace(',', '.')); set(Math.max(min, Math.min(max, Number.isFinite(v) ? v : min))); render(); });
        return h('label', { class: 'mo-field' }, unit ? `${label} (${unit})` : label, i);
      };
      const check = (label: string, value: boolean, set: (v: boolean) => void, disabled = false, note = '') => {
        const i = h('input', { type: 'checkbox', checked: value && !disabled, disabled });
        i.addEventListener('change', () => { set(i.checked); render(); });
        return h('label', { class: 'switch', title: note }, i, h('span', { class: 'track' }), h('span', null, label + (disabled && note ? ` (${note})` : '')));
      };
      const { w, h: hh } = this.size();
      const [t0, t1] = this.range();
      const fps = this.fps();
      const n = this.frames();
      const hasAudio = this.s.m.media.some(m => m.kind === 'audio' || m.hasAudio) && comp.clips.some(c => c.kind === 'media' || c.kind === 'comp');
      const alphaOk = d.alpha && (p.format !== 'mov' || p.codec === 'prores');
      const warn: string[] = [];
      if (this.desktop && this.ffmpeg && !this.ffmpeg.ok) warn.push(`FFmpeg no disponible: ${this.ffmpeg.error}`);
      if (p.format === 'web-mp4' && !this.webMp4) warn.push('Este dispositivo no codifica H.264: elige GIF o secuencia PNG.');
      if ((p.format === 'gif' || p.format === 'web-gif') && (w > 1280 || n > 900)) warn.push('Un GIF grande o largo ocupa mucho: mejor MP4 o WebM.');
      if (!this.desktop && p.format === 'web-mp4' && w * hh > 1920 * 1080) warn.push('Más de 1080p puede no estar soportado por el codificador del dispositivo.');
      if (!this.desktop && n * w * hh > 1920 * 1080 * 60 * 60 * 3) warn.push('Vídeo largo: en el teléfono el archivo se arma en memoria; si falla, exporta por partes con el intervalo.');
      const missing = this.s.m.media.filter(m => this.s.media.missing.has(m.id)).length;
      if (missing) warn.push(`Faltan ${missing} medios: saldrán vacíos. Vuelve a vincularlos antes.`);
      // Estimación del tamaño (bitrate fijo: exacta; calidad: aproximada).
      const dur = n / fps;
      const kbps = d.bitrate && p.rateMode === 'bitrate' ? p.bitrate : p.format === 'mov' && p.codec === 'prores' ? (w * hh * fps * 3.2) / 1000 : (w * hh * fps * (0.04 + (p.quality / 100) ** 2 * 0.14)) / 1000 * (p.codec === 'h265' ? 0.6 : 1);
      const est = p.format.includes('gif') ? w * hh * n * 0.18 : p.format.includes('png') ? w * hh * n * 1.6 : (kbps * 1000 / 8) * dur + (p.audio && hasAudio ? 20000 * dur : 0);
      const kids: (Node | null)[] = [
        h('div', { class: 'ax-formats', role: 'radiogroup', 'aria-label': 'Formato' }, ...this.formats().map(f => h('button', {
          type: 'button', class: 'ax-format', role: 'radio', 'aria-checked': String(f.id === p.format), title: f.sub, on: { click: () => { p.format = f.id; render(); } },
        }, h('strong', null, f.label), h('small', null, f.sub)))),
        h('div', { class: 'mo-grid2' },
          d.codecs ? sel<Codec>('Códec', p.codec, d.codecs.map(c => [c, CODEC_LABEL[c]]), v => { p.codec = v; }) : null,
          sel<Res>('Resolución', p.res, RES.map(([id, l]) => { const z = this.sizeFor(id); return [id, `${l} — ${z.w} × ${z.h}`]; }), v => { p.res = v; }),
          sel<string>('FPS', [0, 23.976, 24, 25, 29.97, 30, 50, 59.94, 60].includes(p.fps) ? String(p.fps) : 'x', [['0', `De la composición (${comp.fps})`], ...[23.976, 24, 25, 29.97, 30, 50, 59.94, 60].map(f => [String(f), `${f} fps`] as [string, string]), ['x', 'Personalizado…']], v => { p.fps = v === 'x' ? (p.fps || comp.fps) : Number(v); if (v === 'x') p.fps = Math.round(p.fps) + 0.001; }),
          ![0, 23.976, 24, 25, 29.97, 30, 50, 59.94, 60].includes(p.fps) ? numIn('FPS personalizados', p.fps, 1, 240, 0.001, v => { p.fps = v; }) : null,
          sel<MotionExportPrefs['range']>('Intervalo', p.range, [['all', `Todo (${fmtDur(comp.dur)})`], ...(comp.range ? [['range', `Intervalo de trabajo (${fmtDur(comp.range[1] - comp.range[0])})`]] as [MotionExportPrefs['range'], string][] : []), ['custom', 'Personalizado']], v => { p.range = v; if (v === 'custom') { p.from = 0; p.to = comp.dur; } }),
          p.range === 'custom' ? numIn('Desde', p.from, 0, comp.dur, 0.01, v => { p.from = v; }, 's') : null,
          p.range === 'custom' ? numIn('Hasta', p.to, 0, comp.dur, 0.01, v => { p.to = v; }, 's') : null,
          d.bitrate && d.quality ? sel<MotionExportPrefs['rateMode']>('Control de tamaño', p.rateMode, [['quality', 'Calidad constante (recomendado)'], ['bitrate', 'Bitrate fijo']], v => { p.rateMode = v; }) : null,
          d.quality && (p.rateMode === 'quality' || !d.bitrate) && !(p.format === 'mov' && p.codec === 'prores') ? numIn('Calidad', p.quality, 1, 100, 1, v => { p.quality = v; }, '%') : null,
          d.bitrate && (p.rateMode === 'bitrate' || !d.quality) && !(p.format === 'mov' && p.codec === 'prores') ? numIn('Bitrate de vídeo', p.bitrate, 300, 400000, 100, v => { p.bitrate = v; }, 'kbit/s') : null),
        h('div', { class: 'ax-checks' },
          check('Fondo transparente', p.alpha, v => { p.alpha = v; }, !alphaOk, p.format === 'mov' ? 'sólo con ProRes' : 'este formato no admite transparencia'),
          check('Incluir audio (mezcla de todas las pistas)', p.audio, v => { p.audio = v; }, !d.audio || !hasAudio, !hasAudio ? 'no hay audio' : 'este formato no lleva audio'),
          d.loop ? check('Repetir en bucle', p.loop, v => { p.loop = v; }) : null,
          check(`Desenfoque de movimiento (${p.mbSamples} muestras, más lento)`, p.motionBlur, v => { p.motionBlur = v; })),
        p.motionBlur ? h('div', { class: 'mo-grid2' }, numIn('Muestras por fotograma', p.mbSamples, 2, 32, 1, v => { p.mbSamples = Math.round(v); }), numIn('Obturación', Math.round(p.mbShutter * 360), 10, 360, 5, v => { p.mbShutter = v / 360; }, '°')) : null,
        h('p', { class: 'mo-estimate' }, `${n} fotogramas de ${w} × ${hh} a ${+fps.toFixed(3)} fps = ${fmtDur(dur)} (${fmtDur(t0)} – ${fmtDur(t1)}). Tamaño aproximado: ${mb(est)}. Se usan los medios originales (no los proxies).`),
        bridge?.chooseFolder ? h('div', { class: 'ex-folder' }, h('span', { class: 'ex-label' }, 'Carpeta'), h('code', null, this.folder ?? '—'),
          h('button', { type: 'button', class: 'btn sm', on: { click: async () => { const f = await bridge.chooseFolder!(this.folder ?? ''); if (f) { this.folder = f; render(); } } } }, 'Cambiar…')) : null,
        this.ffmpeg?.ok ? h('p', { class: 'ax-note' }, `Codificador: ${this.ffmpeg.version}`) : null,
        ...warn.map(t => h('p', { class: 'ax-warn' }, t))];
      body.replaceChildren(...kids.filter((x): x is Node => !!x));
      const blocked = (this.desktop && this.ffmpeg?.ok === false) || (p.format === 'web-mp4' && !this.webMp4) || !(t1 > t0);
      actions.replaceChildren(h('button', { type: 'button', class: 'btn ghost', on: { click: close } }, 'Cancelar'),
        h('button', { type: 'button', class: 'btn primary', disabled: blocked, on: { click: () => void run() } }, 'Exportar'));
      this.persist(p);
    };

    const run = async () => {
      busy = true;
      const bar = h('div'), label = h('p', { class: 'ax-note' }, 'Preparando…');
      let cancelled = false;
      const cancel = h('button', { type: 'button', class: 'btn', on: { click: () => { cancelled = true; cancel.setAttribute('disabled', ''); label.textContent = 'Cancelando…'; } } }, 'Cancelar');
      body.replaceChildren(h('div', { class: 'mo-progress' }, bar), label);
      actions.replaceChildren(cancel);
      const start = performance.now();
      const progress = (k: number, n: number, what: string) => {
        bar.style.width = `${(k / Math.max(1, n)) * 100}%`;
        const el = (performance.now() - start) / 1000, eta = k > 2 ? (el / k) * (n - k) : 0;
        label.textContent = `${what} ${k} / ${n}${eta > 1 ? ` · quedan ~${eta > 90 ? `${Math.ceil(eta / 60)} min` : `${Math.ceil(eta)} s`}` : ''}`;
      };
      try {
        const res = this.desktop ? await this.encodeDesktop(progress, () => cancelled) : await this.encodeWeb(progress, () => cancelled);
        busy = false;
        if (!res) { toast('Exportación cancelada'); render(); return; }
        close();
        const b = desktopBridge();
        toast(`Exportado: ${res.name} (${mb(res.size)}${res.files > 1 ? `, ${res.files} archivos` : ''}) en ${fmtDur((performance.now() - start) / 1000)}`, 'ok',
          res.path && b?.platform === 'android' && b.shareFile ? { label: 'Compartir', run: () => void b.shareFile!(res.path!) } : res.path && b?.revealFile ? { label: 'Mostrar', run: () => void b.revealFile!(res.path!) } : undefined);
      } catch (e) {
        busy = false;
        toast(`No se pudo exportar: ${e instanceof Error ? e.message : String(e)}`, 'error');
        render();
      }
    };
    render();
  }

  // ---------------------------------------------------------------- medidas

  private sizeFor(r: Res) {
    const c = this.comp, d = this.def(this.prefs.format);
    let w = c.w, hh = c.h;
    const line = RES.find(x => x[0] === r)![2];
    if (line === -1) { w = c.w / 2; hh = c.h / 2; }
    else if (line > 0) { const k = line / Math.min(c.w, c.h); w = c.w * k; hh = c.h * k; }
    w = Math.round(w); hh = Math.round(hh);
    if (d.even && !(this.prefs.format === 'mov' && this.prefs.codec === 'prores')) { w = even(w); hh = even(hh); }
    return { w: Math.min(8192, w), h: Math.min(8192, hh) };
  }
  private size() { return this.sizeFor(this.prefs.res); }
  private fps() { return this.prefs.fps || this.comp.fps; }
  private range(): [number, number] {
    const c = this.comp, p = this.prefs;
    if (p.range === 'range' && c.range) return [c.range[0], c.range[1]];
    if (p.range === 'custom') return [Math.max(0, Math.min(p.from, p.to)), Math.min(c.dur, Math.max(p.from, p.to))];
    return [0, c.dur];
  }
  private frames() { const [a, b] = this.range(); return Math.max(1, Math.round((b - a) * this.fps())); }

  /** Compone el fotograma k (medios originales, vídeo exacto). */
  private async compose(cmp: Compositor, k: number, out: HTMLCanvasElement, alpha: boolean) {
    const p = this.prefs, comp = this.comp, { w, h: hh } = this.size();
    const t = this.range()[0] + k / this.fps();
    const scale = w / comp.w;
    await cmp.render(this.s.m, comp, t, out, { scale, preview: false, exact: true, motionBlur: p.motionBlur ? { samples: p.mbSamples, shutter: p.mbShutter } : null });
    // Tamaños redondeados a par: se ajusta el lienzo; sin alfa, fondo opaco.
    let c = out;
    if (out.width !== w || out.height !== hh || (!alpha && !comp.bg)) {
      const tmp = document.createElement('canvas');
      tmp.width = w; tmp.height = hh;
      const g = tmp.getContext('2d')!;
      if (!alpha) { g.fillStyle = comp.bg ?? '#000000'; g.fillRect(0, 0, w, hh); }
      g.drawImage(out, 0, 0, w, hh);
      c = tmp;
    }
    return c;
  }

  private async audio(): Promise<AudioBuffer | null> {
    const p = this.prefs, d = this.def(p.format);
    if (!p.audio || !d.audio) return null;
    const [a] = this.range();
    return mixAudio(this.s.m, this.comp, this.s.media, a, this.frames() / this.fps());
  }

  private async encodeDesktop(progress: (k: number, n: number, what: string) => void, cancelled: () => boolean) {
    const vb = videoBridge()!, p = this.prefs, d = this.def(p.format);
    if (!this.folder) throw new Error('Elige una carpeta de destino');
    const { w, h: hh } = this.size(), n = this.frames();
    const alpha = p.alpha && d.alpha && (p.format !== 'mov' || p.codec === 'prores');
    progress(0, n, 'Mezclando audio…');
    const mix = await this.audio();
    const { id, target } = await vb.begin({
      folder: this.folder, name: safe(this.projectName()), format: p.format, codec: p.codec, width: w, height: hh, fps: this.fps(),
      quality: p.quality, bitrate: d.bitrate && p.rateMode === 'bitrate' ? p.bitrate : 0, alpha, loop: p.loop, audio: mix ? encodeWav(mix) : null, frames: n,
    });
    const cmp = new Compositor(this.s.media);
    const out = document.createElement('canvas');
    this.s.media.useProxies = false;
    try {
      for (let k = 0; k < n; k++) {
        if (cancelled()) { await vb.abort(id); return null; }
        const c = await this.compose(cmp, k, out, alpha);
        const px = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, hh).data;
        await vb.frame(id, new Uint8Array(px.buffer, px.byteOffset, px.byteLength));
        progress(k + 1, n, 'Codificando fotograma');
      }
      progress(n, n, 'Terminando el archivo…');
      const res = await vb.finish(id);
      return { name: res.path.split(/[\\/]/).pop() ?? target, path: res.path, size: res.size, files: res.files };
    } catch (e) {
      await vb.abort(id).catch(() => undefined);
      throw e;
    } finally { this.s.media.useProxies = this.s.prefs.proxies; }
  }

  private async encodeWeb(progress: (k: number, n: number, what: string) => void, cancelled: () => boolean) {
    const p = this.prefs, d = this.def(p.format);
    const { w, h: hh } = this.size(), n = this.frames(), fps = this.fps();
    const alpha = p.alpha && d.alpha;
    const cmp = new Compositor(this.s.media);
    const out = document.createElement('canvas');
    this.s.media.useProxies = false;
    const base = safe(this.projectName());
    let data: Uint8Array | null = null, name = '';
    try {
      const frame = (k: number) => this.compose(cmp, k, out, alpha);
      if (p.format === 'web-gif') { data = await encodeGif({ width: w, height: hh, fps, frames: n, frame, progress: (k, nn) => progress(k, nn, 'Fotograma'), cancelled, loop: p.loop, alpha }); name = `${base}.gif`; }
      else if (p.format === 'web-mp4') {
        progress(0, n, 'Mezclando audio…');
        const audio = await this.audio();
        const r = await encodeMp4({ width: w, height: hh, fps, frames: n, frame, progress: (k, nn) => progress(k, nn, 'Codificando fotograma'), cancelled, bitrate: (d.bitrate && p.rateMode === 'bitrate' ? p.bitrate : Math.round(w * hh * fps * 0.12 / 1000)) * 1000, audio });
        if (r) { data = r.data; if (audio && !r.audio) toast('El dispositivo no codifica AAC: el vídeo se exportó sin audio', 'error'); }
        name = `${base}.mp4`;
      } else {
        const files: Zippable = {};
        for (let k = 0; k < n; k++) {
          if (cancelled()) return null;
          const c = await frame(k);
          const b = await new Promise<Blob | null>(r => c.toBlob(r, 'image/png'));
          if (!b) throw new Error('No se pudo codificar el PNG');
          files[`${base}_${String(k + 1).padStart(5, '0')}.png`] = [new Uint8Array(await b.arrayBuffer()), { level: 0 }];
          progress(k + 1, n, 'Fotograma');
        }
        data = zipSync(files);
        name = `${base}-png.zip`;
      }
    } finally { this.s.media.useProxies = this.s.prefs.proxies; }
    if (!data) return null;
    const bridge = desktopBridge();
    if (bridge?.writeExport) {
      const path = await bridge.writeExport(bridge.exportFolder ? await bridge.exportFolder() : '', name, data, false);
      return { name: bridge.describe?.(path).path ?? name, path, size: data.length, files: 1 };
    }
    const url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>]));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return { name, size: data.length, files: 1 };
  }
}
