import { desktopBridge } from '../brush/storage';
import type { CanvasEngine } from '../engine';
import { Exporter, type PreviewResult } from '../export/Exporter';
import { sizeProblem } from '../export/render';
import { FORMATS, normalizeOptions, safeFileName, type ExportFormat, type ExportOptions } from '../export/types';
import { h, IS_ARTIFACT, toast } from './dom';

const fmtBytes = (n: number) => n < 1024 ? `${Math.round(n)} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(n < 10485760 ? 2 : 1)} MB`;
const cm = (px: number, dpi: number) => ((px / dpi) * 2.54).toLocaleString('es', { maximumFractionDigits: 1 });
const DPIS = [72, 96, 150, 300, 600];

/**
 * Ventana de exportación: formato, archivo, contenido, tamaño, calidad,
 * transparencia y color, con vista previa real, tamaño estimado y progreso.
 */
export class ExportDialog {
  private root: HTMLElement | null = null;
  private o: ExportOptions;
  private exporter: Exporter;
  private folder: string | null = null;
  private previewReq = 0;
  private previewSeq = 0;
  private busy = false;
  private last: PreviewResult | null = null;

  constructor(private engine: CanvasEngine, saved: unknown, private persist: (o: ExportOptions) => void) {
    this.o = normalizeOptions(saved);
    this.exporter = new Exporter(engine);
  }

  get open() { return !!this.root; }

  /**
   * Al abrir o crear un proyecto, la exportación parte de sus datos: nombre,
   * DPI, perfil de color y fondo (transparente o el color del papel).
   */
  adoptProject(p: { name: string; dpi: number; profile: 'srgb' | 'p3' | 'gray'; background: string | null }) {
    this.o = normalizeOptions({ ...this.o, name: p.name, dpi: p.dpi, profile: p.profile, transparent: p.background === null, background: p.background ?? this.o.background });
    this.persist(this.o);
  }

  async show() {
    if (this.root) return;
    if (this.o.scope === 'selection' && !this.engine.doc.selection) this.o.scope = 'canvas';
    const bridge = desktopBridge();
    if (bridge?.exportFolder && !this.folder) { try { this.folder = await bridge.exportFolder(); } catch { this.folder = null; } }
    const ret = document.activeElement as HTMLElement | null;
    this.root = h('div', { class: 'dialog-backdrop export-backdrop', on: { keydown: (e: Event) => { e.stopPropagation(); if ((e as KeyboardEvent).key === 'Escape' && !this.busy) this.close(); } } });
    (this.root as HTMLElement & { ret?: HTMLElement | null }).ret = ret;
    document.body.append(this.root);
    this.render();
    (this.root.querySelector('.fmt[aria-checked="true"]') as HTMLElement | null)?.focus();
  }

  close() {
    if (!this.root || this.busy) return;
    const ret = (this.root as HTMLElement & { ret?: HTMLElement | null }).ret;
    this.root.remove();
    this.root = null;
    ret?.focus?.();
  }

  private set<K extends keyof ExportOptions>(k: K, v: ExportOptions[K], rerender = true) {
    this.o = normalizeOptions({ ...this.o, [k]: v });
    this.persist(this.o);
    if (rerender) this.render(); else this.updateSummary();
    this.schedulePreview();
  }

  private plan() { return this.exporter.plan(this.o); }

  /* ---------- Construcción ---------- */

  private section(title: string, ...children: (HTMLElement | null | false)[]) {
    return h('section', { class: 'ex-section' }, h('h3', null, title), ...children);
  }
  private seg<T extends string | number>(label: string, value: T, options: { value: T; label: string; disabled?: boolean }[], on: (v: T) => void) {
    return h('div', { class: 'ex-field' }, h('span', { class: 'ex-label' }, label),
      h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label }, ...options.map(op => h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(op.value === value), disabled: !!op.disabled, on: { click: () => on(op.value) },
      }, op.label))));
  }
  private toggle(id: string, label: string, value: boolean, on: (v: boolean) => void, disabled = false) {
    return h('label', { class: 'switch ex-switch', for: id }, h('input', { type: 'checkbox', id, checked: value, disabled, on: { change: (e: Event) => on((e.target as HTMLInputElement).checked) } }),
      h('span', { class: 'track', 'aria-hidden': 'true' }), h('span', null, label));
  }
  private range(id: string, label: string, value: number, min: number, max: number, step: number, fmt: (v: number) => string, on: (v: number) => void) {
    const out = h('output', { for: id }, fmt(value));
    const input = h('input', { type: 'range', id, min: String(min), max: String(max), step: String(step), value: String(value) });
    const fill = () => input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`);
    fill();
    input.addEventListener('input', () => { out.textContent = fmt(Number(input.value)); fill(); });
    input.addEventListener('change', () => on(Number(input.value)));
    return h('div', { class: 'ex-field' }, h('label', { for: id, class: 'row' }, h('span', { class: 'ex-label' }, label), out), input);
  }

  private render() {
    if (!this.root) return;
    const o = this.o, info = FORMATS[o.format], plan = this.plan();
    const hasSel = !!this.engine.doc.selection;
    const bridge = desktopBridge();
    const visible = this.engine.doc.layers.filter(l => l.visible).length;

    const formats = h('div', { class: 'fmt-grid', role: 'radiogroup', 'aria-label': 'Formato' }, ...(Object.keys(FORMATS) as ExportFormat[]).map(f => h('button', {
      type: 'button', role: 'radio', class: 'fmt', 'aria-checked': String(f === o.format), title: FORMATS[f].description, on: { click: () => this.set('format', f) },
    }, h('strong', null, FORMATS[f].label), h('span', null, FORMATS[f].lossy ? (f === 'webp' ? 'con o sin pérdida' : 'con pérdida') : 'sin pérdida'))));

    const nameInput = h('input', { type: 'text', id: 'ex-name', value: o.name, maxlength: '120', spellcheck: 'false', autocomplete: 'off' });
    nameInput.addEventListener('input', () => { this.o = normalizeOptions({ ...this.o, name: nameInput.value || 'Dibujo' }); this.persist(this.o); this.updateSummary(); });
    const folderRow = IS_ARTIFACT
      ? h('p', { class: 'ex-warn' }, 'La vista previa web no puede guardar archivos. Usa la app de escritorio o la versión local para exportar.')
      : bridge?.platform === 'android'
        ? h('p', { class: 'muted' }, o.format === 'pdf' ? 'Se guardará en Descargas/YOSADRAW.' : 'Se guardará en Imágenes/YOSADRAW (aparece en la galería).')
      : bridge?.chooseFolder
        ? h('div', { class: 'ex-folder' }, h('span', { class: 'ex-path', title: this.folder ?? '' }, this.folder ?? 'Imágenes'),
          h('button', { type: 'button', class: 'btn sm', on: { click: async () => { const f = await bridge.chooseFolder!(this.folder ?? ''); if (f) { this.folder = f; this.render(); } } } }, 'Cambiar…'))
        : h('p', { class: 'muted' }, 'Se guardará en la carpeta de descargas del navegador.');

    // Tamaño: ancho y alto enlazados a la escala.
    const r = plan.region;
    const wIn = h('input', { type: 'number', id: 'ex-w', min: '1', value: String(plan.width), 'aria-label': 'Ancho en píxeles' });
    const hIn = h('input', { type: 'number', id: 'ex-h', min: '1', value: String(plan.height), 'aria-label': 'Alto en píxeles' });
    const pctIn = h('input', { type: 'number', id: 'ex-scale', min: '1', max: '1600', step: '1', value: String(Math.round(o.scale * 1000) / 10), 'aria-label': 'Escala en porcentaje' });
    wIn.addEventListener('change', () => { const v = Number(wIn.value); if (v > 0) this.set('scale', v / r.w); });
    hIn.addEventListener('change', () => { const v = Number(hIn.value); if (v > 0) this.set('scale', v / r.h); });
    pctIn.addEventListener('change', () => { const v = Number(pctIn.value); if (v > 0) this.set('scale', v / 100); });
    const dpiIn = h('input', { type: 'number', id: 'ex-dpi', min: '1', max: '2400', value: String(o.dpi), 'aria-label': 'Resolución personalizada en PPP' });
    dpiIn.addEventListener('change', () => { const v = Number(dpiIn.value); if (v > 0) this.set('dpi', v); });
    const problem = sizeProblem(plan.width, plan.height);

    // Calidad y compresión según formato.
    const q = (label: string) => this.range('ex-quality', label, Math.round(o.quality * 100), 1, 100, 1, v => `${v}%`, v => this.set('quality', v / 100, false));
    let quality: HTMLElement[] = [];
    if (o.format === 'jpeg') quality = [q('Calidad')];
    else if (o.format === 'webp') quality = [this.toggle('ex-lossless', 'Sin pérdida', o.webpLossless, v => this.set('webpLossless', v)), ...(o.webpLossless ? [] : [q('Calidad')])];
    else if (o.format === 'png') quality = [this.range('ex-png', 'Compresión', o.pngLevel, 0, 9, 1, v => (v === 0 ? '0 · rápida' : v === 9 ? '9 · máxima' : String(v)), v => this.set('pngLevel', v, false))];
    else if (o.format === 'tiff') quality = [this.seg('Compresión', o.tiffCompression, [{ value: 'none', label: 'Ninguna' }, { value: 'lzw', label: 'LZW' }, { value: 'deflate', label: 'Deflate (ZIP)' }], v => this.set('tiffCompression', v))];
    else if (o.format === 'pdf') quality = [this.seg('Imagen', o.pdfCompression, [{ value: 'flate', label: 'Sin pérdida' }, { value: 'jpeg', label: 'JPEG', disabled: o.profile === 'gray' }], v => this.set('pdfCompression', v)), ...(o.pdfCompression === 'jpeg' && o.profile !== 'gray' ? [q('Calidad JPEG')] : [])];
    else if (o.format === 'bmp') quality = [this.seg('Profundidad', o.bmpDepth, [{ value: 32, label: '32 bits (con alfa)' }, { value: 24, label: '24 bits' }], v => this.set('bmpDepth', v))];
    else if (o.format === 'psd') quality = [this.toggle('ex-psdz', 'Compresión ZIP (archivos menores; algunos programas antiguos no la leen)', o.psdCompress, v => this.set('psdCompress', v))];

    const alphaOk = info.alpha && !(o.format === 'bmp' && o.bmpDepth === 24);
    const bgIn = h('input', { type: 'color', id: 'ex-bg', value: o.background, 'aria-label': 'Color de fondo' });
    bgIn.addEventListener('change', () => this.set('background', bgIn.value));

    this.preview = h('canvas', { class: 'ex-canvas', 'aria-label': 'Vista previa de la exportación' });
    this.previewInfo = h('p', { class: 'ex-preview-info' }, 'Generando vista previa…');
    this.summary = h('div', { class: 'ex-summary' });
    this.progress = h('div', { class: 'ex-progress', hidden: true, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('div', { class: 'bar' }), h('span', { class: 'label' }));
    this.exportBtn = h('button', { type: 'button', class: 'btn primary', disabled: IS_ARTIFACT || !!problem, on: { click: () => void this.run() } }, 'Exportar');

    const dialog = h('div', { class: 'dialog export-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ex-title' },
      h('div', { class: 'dialog-head' }, h('h2', { id: 'ex-title' }, 'Exportar'), h('button', { type: 'button', class: 'btn ghost sm', on: { click: () => this.close() } }, 'Cerrar')),
      h('div', { class: 'ex-body' },
        h('div', { class: 'ex-preview' }, h('div', { class: 'ex-stage' }, this.preview), this.previewInfo),
        h('div', { class: 'ex-form' },
          this.section('Formato', formats, h('p', { class: 'muted' }, info.description)),
          this.section('Archivo',
            h('div', { class: 'ex-field' }, h('label', { for: 'ex-name', class: 'ex-label' }, 'Nombre'), h('div', { class: 'ex-name' }, nameInput, h('span', { class: 'ex-ext' }, `.${info.ext}`))),
            h('div', { class: 'ex-field' }, h('span', { class: 'ex-label' }, 'Carpeta'), folderRow)),
          this.section('Contenido',
            this.seg('Área', o.scope, [{ value: 'canvas', label: 'Lienzo completo' }, { value: 'selection', label: 'Selección', disabled: !hasSel }], v => this.set('scope', v)),
            o.format === 'psd'
              ? this.toggle('ex-psdlayers', `Conservar las ${this.engine.doc.layers.length} capas (nombres, opacidad, fusión y visibilidad)`, o.psdLayers, v => this.set('psdLayers', v))
              : this.seg('Capas', o.layers, [{ value: 'merged', label: 'Combinar visibles' }, { value: 'individual', label: o.format === 'pdf' ? `Una página por capa (${visible})` : `Un archivo por capa (${visible})` }], v => this.set('layers', v))),
          this.section('Tamaño y resolución',
            h('div', { class: 'ex-dims' },
              h('label', { for: 'ex-w' }, 'Ancho', wIn, h('span', null, 'px')), h('span', { class: 'ex-link', 'aria-hidden': 'true' }, '×'),
              h('label', { for: 'ex-h' }, 'Alto', hIn, h('span', null, 'px')),
              h('label', { for: 'ex-scale' }, 'Escala', pctIn, h('span', null, '%'))),
            h('div', { class: 'ex-chips' }, ...[0.5, 1, 2, 3].map(s => h('button', { type: 'button', class: 'chip-btn', 'aria-pressed': String(Math.abs(o.scale - s) < 1e-6), on: { click: () => this.set('scale', s) } }, `${s * 100}%`))),
            h('div', { class: 'ex-field' }, h('span', { class: 'ex-label' }, 'Resolución'),
              h('div', { class: 'ex-chips' }, ...DPIS.map(d => h('button', { type: 'button', class: 'chip-btn', 'aria-pressed': String(o.dpi === d), on: { click: () => this.set('dpi', d) } }, d === 300 ? '300 ppp · impresión' : `${d} ppp`)), dpiIn)),
            h('p', { class: 'muted' }, `Tamaño impreso: ${cm(plan.width, o.dpi)} × ${cm(plan.height, o.dpi)} cm a ${o.dpi} ppp${info.dpi ? '' : ' (WEBP no guarda los ppp)'}`),
            problem ? h('p', { class: 'ex-warn' }, problem) : null),
          this.section('Calidad', ...(quality.length ? quality : [h('p', { class: 'muted' }, 'Sin opciones de compresión para este formato.')])),
          this.section('Transparencia y fondo',
            this.toggle('ex-alpha', alphaOk ? 'Conservar transparencia' : `${info.label}${o.format === 'bmp' ? ' de 24 bits' : ''} no admite transparencia`, o.transparent && alphaOk, v => this.set('transparent', v), !alphaOk),
            h('div', { class: 'ex-field ex-inline' }, h('label', { for: 'ex-bg', class: 'ex-label' }, o.transparent && alphaOk ? 'Fondo (sólo si se desactiva)' : 'Color de fondo'), bgIn)),
          this.section('Color',
            this.seg('Perfil', o.profile, [{ value: 'srgb', label: 'sRGB' }, { value: 'p3', label: 'Display P3' }, { value: 'gray', label: 'Escala de grises' }], v => this.set('profile', v)),
            h('p', { class: 'muted' }, o.profile === 'srgb' ? 'Sin conversión: los colores del lienzo, tal cual.' : o.profile === 'p3' ? 'Convierte a Display P3 conservando el aspecto (necesita incrustar el perfil).' : info.nativeGray ? 'Guarda un único canal de gris (luminancia).' : 'Píxeles en gris dentro de un archivo RGB.'),
            this.toggle('ex-icc', `Incrustar perfil ICC${o.profile === 'gray' && !info.nativeGray ? ' (sRGB)' : ''}`, o.embedProfile, v => this.set('embedProfile', v)),
            o.profile === 'p3' && !o.embedProfile ? h('p', { class: 'ex-warn' }, 'Sin el perfil, los programas mostrarán los colores P3 como si fueran sRGB (más apagados).') : null,
            this.toggle('ex-aa', 'Antialiasing (bordes suaves)', o.antialias, v => this.set('antialias', v))),
        )),
      h('div', { class: 'ex-foot' }, this.summary, this.progress, h('div', { class: 'ex-actions' }, h('button', { type: 'button', class: 'btn ghost', on: { click: () => this.close() } }, 'Cancelar'), this.exportBtn)));
    this.root.replaceChildren(dialog);
    this.updateSummary();
    this.schedulePreview();
  }

  private preview!: HTMLCanvasElement;
  private previewInfo!: HTMLElement;
  private summary!: HTMLElement;
  private progress!: HTMLElement;
  private exportBtn!: HTMLButtonElement;

  private updateSummary() {
    if (!this.root) return;
    const o = this.o, info = FORMATS[o.format], plan = this.plan();
    const name = o.format === 'psd' || o.format === 'pdf' || plan.files === 1 ? `${safeFileName(o.name)}.${info.ext}` : `${plan.files} archivos ${info.label}${desktopBridge() ? '' : ' (en un ZIP)'}`;
    const est = this.last ? `${this.last.estimateKind === 'exact' ? '' : this.last.estimateKind === 'max' ? 'hasta ' : '≈ '}${fmtBytes(this.last.estimate)}` : '…';
    this.summary.replaceChildren(h('strong', null, name), h('span', null, `${plan.width.toLocaleString('es')} × ${plan.height.toLocaleString('es')} px · ${o.dpi} ppp${o.format === 'pdf' && plan.pages > 1 ? ` · ${plan.pages} páginas` : ''}`), h('span', null, `Tamaño estimado: ${est}`));
  }

  private schedulePreview() {
    clearTimeout(this.previewReq);
    this.previewReq = window.setTimeout(() => void this.renderPreview(), 180);
  }

  private async renderPreview() {
    if (!this.root || this.busy) return;
    const seq = ++this.previewSeq;
    if (sizeProblem(this.plan().width, this.plan().height)) { this.previewInfo.textContent = 'Reduce el tamaño para ver la vista previa.'; return; }
    try {
      const p = await this.exporter.preview(this.o);
      if (seq !== this.previewSeq || !this.root) return;
      this.last = p;
      const c = this.preview;
      c.width = p.width; c.height = p.height;
      c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(p.pixels), p.width, p.height), 0, 0);
      c.style.aspectRatio = `${p.width} / ${p.height}`;
      const lossy = this.o.format === 'jpeg' || (this.o.format === 'webp' && !this.o.webpLossless) || (this.o.format === 'pdf' && this.o.pdfCompression === 'jpeg');
      this.previewInfo.textContent = `Vista previa a ${p.width} × ${p.height} px${lossy ? ', con la compresión real' : ''}. Lo transparente se ve como cuadros.`;
      this.updateSummary();
    } catch (e) {
      if (seq === this.previewSeq) this.previewInfo.textContent = e instanceof Error ? e.message : 'No se pudo generar la vista previa';
    }
  }

  private setProgress(f: number, label: string) {
    this.progress.hidden = false;
    (this.progress.querySelector('.bar') as HTMLElement).style.setProperty('--p', `${Math.round(f * 100)}%`);
    this.progress.setAttribute('aria-valuenow', String(Math.round(f * 100)));
    (this.progress.querySelector('.label') as HTMLElement).textContent = `${label} · ${Math.round(f * 100)}%`;
  }

  private async run() {
    if (this.busy) return;
    const o = this.o;
    const bridge = desktopBridge();
    this.busy = true;
    this.exportBtn.disabled = true;
    this.root?.classList.add('busy');
    const t0 = performance.now();
    try {
      const files = await this.exporter.export(o, (f, label) => this.setProgress(f, label));
      this.setProgress(1, 'Guardando');
      const res = await this.exporter.save(files, o, this.folder, false);
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      const what = res.names.length === 1 ? res.names[0] : `${res.names.length} archivos`;
      const msg = `Exportado: ${what} (${fmtBytes(res.total)}) en ${secs} s`;
      const android = bridge?.platform === 'android';
      const reveal = res.mode === 'desktop' && bridge?.revealFile ? { label: android ? 'Abrir' : 'Abrir carpeta', run: () => void bridge.revealFile!(res.paths[0]).catch(err => toast(String(err?.message ?? err), 'error')) } : undefined;
      const share = android && bridge?.shareFile ? () => void bridge.shareFile!(res.paths[0]).catch(err => toast(String(err?.message ?? err), 'error')) : undefined;
      toast(msg, 'ok', reveal);
      this.notifySystem(msg);
      this.busy = false;
      this.root?.classList.remove('busy');
      this.showDone(msg, res.mode === 'desktop' ? res.paths.map(p => bridge?.describe?.(p).path ?? p) : [], reveal, share);
    } catch (e) {
      this.busy = false;
      this.root?.classList.remove('busy');
      this.exportBtn.disabled = false;
      this.progress.hidden = true;
      toast(e instanceof Error ? `No se pudo exportar: ${e.message}` : 'No se pudo exportar', 'error');
    }
  }

  private notifySystem(msg: string) {
    try { if ('Notification' in window && Notification.permission === 'granted') new Notification('YOSADRAW', { body: msg }); } catch { /* sin notificaciones */ }
  }

  private showDone(msg: string, paths: string[], reveal?: { label: string; run: () => void }, share?: () => void) {
    if (!this.root) return;
    const foot = this.root.querySelector('.ex-foot')!;
    foot.replaceChildren(
      h('div', { class: 'ex-done', role: 'status' }, h('strong', null, '✓ ', msg), paths.length ? h('span', { class: 'ex-path', title: paths.join('\n') }, paths[0]) : h('span', { class: 'muted' }, 'Revisa la carpeta de descargas del navegador.')),
      h('div', { class: 'ex-actions' },
        reveal ? h('button', { type: 'button', class: 'btn', on: { click: reveal.run } }, reveal.label) : null,
        share ? h('button', { type: 'button', class: 'btn', on: { click: share } }, 'Compartir') : null,
        h('button', { type: 'button', class: 'btn ghost', on: { click: () => this.render() } }, 'Exportar otra vez'),
        h('button', { type: 'button', class: 'btn primary', on: { click: () => this.close() } }, 'Cerrar')));
  }
}
