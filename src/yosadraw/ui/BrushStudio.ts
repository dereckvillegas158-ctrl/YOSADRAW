import { clonePreset, normalizePreset, setPath, type BrushPreset } from '../brush/BrushPreset';
import type { BrushLibrary } from '../brush/BrushLibrary';
import { SECTIONS, type Section } from '../brush/schema';
import type { StrokePainter } from '../brush/StrokePainter';
import { buildControl, type BuiltControl } from './controls';
import { h, toast } from './dom';
import { PreviewPad } from './PreviewPad';
import type { Thumbnails } from './thumbnails';

/**
 * Brush Studio: editor completo de un pincel.
 * Trabaja sobre un borrador; nada cambia en la biblioteca hasta "Guardar".
 * La hoja de pruebas se repinta con cada ajuste.
 */
export class BrushStudio {
  readonly el: HTMLElement;
  private nav: HTMLElement;
  private params: HTMLElement;
  private title: HTMLElement;
  private resetBtn: HTMLButtonElement;
  private confirmBar: HTMLElement;
  private pad: PreviewPad;
  private draft!: BrushPreset;
  private original!: BrushPreset;
  private section: Section = SECTIONS[0];
  private built: { c: Section['controls'][number]; b: BuiltControl }[] = [];
  private visSig = '';
  private returnFocus: HTMLElement | null = null;
  onSaved: ((p: BrushPreset, isNew: boolean) => void) | null = null;

  constructor(private lib: BrushLibrary, private painter: StrokePainter, private thumbs: Thumbnails) {
    this.pad = new PreviewPad(painter);
    this.title = h('h2', { id: 'studio-title' });
    this.nav = h('nav', { class: 'studio-nav', 'aria-label': 'Secciones del pincel' });
    this.params = h('div', { class: 'studio-params' });
    this.resetBtn = h('button', { type: 'button', class: 'btn ghost', on: { click: () => this.resetFactory() } }, 'Restablecer de fábrica');
    this.confirmBar = h('div', { class: 'confirm-bar', hidden: true },
      h('span', null, 'Hay cambios sin guardar.'),
      h('button', { type: 'button', class: 'btn danger', on: { click: () => this.close(true) } }, 'Descartar'),
      h('button', { type: 'button', class: 'btn', on: { click: () => { this.confirmBar.hidden = true; } } }, 'Seguir editando'));

    const pressureReadout = h('output', { class: 'pad-readout' }, 'Presión –');
    this.pad.onPressure = p => {
      pressureReadout.textContent = p === null ? 'Presión –' : `Presión ${p.toFixed(2)}`;
      this.built.forEach(x => x.b.curve?.showInput(p));
    };

    const preview = h('section', { class: 'studio-preview', 'aria-label': 'Vista previa' },
      h('div', { class: 'preview-head' },
        h('h3', null, 'Vista previa en vivo'),
        h('div', { class: 'preview-actions' },
          h('button', { type: 'button', class: 'btn ghost sm', on: { click: () => this.pad.restoreSample() } }, 'Trazo de muestra'),
          h('button', { type: 'button', class: 'btn ghost sm', on: { click: () => this.pad.clear() } }, 'Limpiar'))),
      this.pad.el,
      h('p', { class: 'preview-note' }, 'Dibuja en la hoja para probar el pincel; cada ajuste la repinta al momento. ', pressureReadout));

    this.el = h('div', { class: 'studio-backdrop', hidden: true, on: { keydown: (e: Event) => this.onKey(e as KeyboardEvent) } },
      h('div', { class: 'studio', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'studio-title' },
        h('header', { class: 'studio-head' },
          h('div', { class: 'studio-heading' }, h('span', { class: 'eyebrow' }, 'Brush Studio'), this.title),
          h('div', { class: 'studio-actions' },
            this.resetBtn,
            h('button', { type: 'button', class: 'btn ghost', on: { click: () => this.close(false) } }, 'Cancelar'),
            h('button', { type: 'button', class: 'btn', on: { click: () => this.save(true) } }, 'Guardar como nuevo'),
            h('button', { type: 'button', class: 'btn primary', on: { click: () => this.save(false) } }, 'Guardar'))),
        this.confirmBar,
        h('div', { class: 'studio-body' }, this.nav, this.params, preview)));
    document.body.append(this.el);
  }

  get open() { return !this.el.hidden; }

  show(p: BrushPreset, color: string) {
    this.returnFocus = document.activeElement as HTMLElement | null;
    this.original = p;
    this.draft = clonePreset(p);
    this.pad.setColor(color);
    this.pad.setPreset(this.draft);
    this.confirmBar.hidden = true;
    this.el.hidden = false;
    this.renderNav();
    this.renderSection();
    this.updateHeader();
    (this.nav.querySelector('[aria-current="true"]') as HTMLElement | null)?.focus();
  }

  private get dirty() { return JSON.stringify(this.draft) !== JSON.stringify(this.original); }

  private updateHeader() {
    this.title.textContent = this.draft.name + (this.dirty ? ' ·' : '');
    this.title.title = this.dirty ? 'Cambios sin guardar' : '';
    this.resetBtn.hidden = !(this.original.builtinId && this.lib.isModified(this.draft));
  }

  private renderNav() {
    this.nav.replaceChildren(...SECTIONS.map(s => h('button', {
      type: 'button', 'aria-current': String(s === this.section), dataset: { id: s.id },
      on: { click: () => { this.section = s; this.renderNav(); this.renderSection(); } },
    }, h('span', { class: 'nav-title' }, s.title), h('span', { class: 'nav-sub' }, s.subtitle))));
  }

  private visibility() { return this.section.controls.map(c => ('when' in c && c.when ? c.when(this.draft) : true) ? 1 : 0).join(''); }

  private renderSection() {
    const ctx = {
      draft: this.draft,
      set: (path: string, value: unknown) => this.set(path, value),
      categories: () => this.lib.categories(),
      tipPreview: (shape: BrushPreset['tip']['shape']) => shape === 'image' && !this.draft.tip.image ? null : this.thumbs.tip(this.painter.tips, { ...this.draft.tip, shape, angle: 0, roundness: 1, flipX: false, flipY: false, hardness: shape === 'round' ? 0.9 : this.draft.tip.hardness }, 34, '#ece6ff'),
      grainPreview: (type: BrushPreset['grain']['type']) => {
        if (type === 'image' && !this.draft.grain.image) return null;
        const tile = this.painter.grains.tile({ ...this.draft.grain, type, depth: 1, contrast: 1.2, invert: false });
        if (!tile) return null;
        const c = h('canvas', { width: '68', height: '68' });
        const g = c.getContext('2d')!;
        g.fillStyle = '#ece6ff'; g.fillRect(0, 0, 68, 68);
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(tile, 0, 0, 96, 96, 0, 0, 68, 68);
        return c;
      },
    };
    this.visSig = this.visibility();
    this.built = [];
    const nodes: HTMLElement[] = [h('header', { class: 'params-head' }, h('h3', null, this.section.title), h('span', null, this.section.subtitle))];
    for (const c of this.section.controls) {
      if ('when' in c && c.when && !c.when(this.draft)) continue;
      const b = buildControl(c, ctx);
      this.built.push({ c, b });
      nodes.push(b.el);
    }
    this.params.replaceChildren(...nodes);
  }

  private set(path: string, value: unknown) {
    setPath(this.draft, path, value);
    if (path === 'tip.shape' && value === 'image' && !this.draft.tip.image) toast('Elige una imagen para la punta', 'info');
    // Mismo campo en otros controles visibles (p. ej. el ángulo aparece en dos secciones).
    for (const x of this.built) if (x.c.path === path) x.b.sync();
    if (this.visibility() !== this.visSig) { const scroll = this.params.scrollTop; this.renderSection(); this.params.scrollTop = scroll; }
    else if (path === 'tip.shape' || path === 'grain.type' || path === 'grain.image' || path === 'tip.image') this.renderSection();
    this.pad.setPreset(this.draft);
    this.updateHeader();
  }

  private save(asNew: boolean) {
    const clean = normalizePreset(this.draft);
    if (this.draft.tip.shape === 'image' && clean.tip.shape !== 'image') toast('La punta "Imagen" necesita una imagen; se ha guardado como redonda.', 'info');
    let saved: BrushPreset;
    if (asNew) saved = this.lib.add({ ...clean, name: clean.name === this.original.name ? `${clean.name} (variante)` : clean.name }, this.original.id);
    else saved = this.lib.update(clean);
    toast(asNew ? `Creado «${saved.name}»` : `Guardado «${saved.name}»`, 'ok');
    this.onSaved?.(saved, asNew);
    this.close(true);
  }

  private resetFactory() {
    const r = this.lib.reset(this.original.id);
    if (!r) return;
    this.original = r;
    this.draft = clonePreset(r);
    this.pad.setPreset(this.draft);
    this.renderSection();
    this.updateHeader();
    toast('Pincel restablecido a los valores de fábrica', 'ok');
  }

  close(force: boolean) {
    if (!force && this.dirty) { this.confirmBar.hidden = false; return; }
    this.el.hidden = true;
    this.returnFocus?.focus?.();
  }

  private onKey(e: KeyboardEvent) {
    e.stopPropagation(); // los atajos del lienzo no actúan dentro del editor
    if (e.key === 'Escape') { e.preventDefault(); this.close(false); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this.save(false); }
  }
}
