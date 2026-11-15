import type { CanvasEngine } from '../engine';
import { applyToDocument, type FxTarget } from '../effects/apply';
import { CATEGORIES, defaults, EFFECTS, type Category, type EffectDef, type Param, type Values } from '../effects/effects';
import { getGL, glAvailable } from '../effects/gl';
import { applyEffect } from '../effects/run';
import { h, toast } from './dom';

const SPARK = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 13.6 9l5.4 1.6-5.4 1.6L12 17.6l-1.6-5.4L5 10.6 10.4 9z"/><path d="M18.5 3v3M17 4.5h3M5 16.5v3M3.5 18h3"/></svg>';
export const EFFECTS_ICON = SPARK;

interface PanelPrefs { last: string; target: 'layer' | 'all'; values: Record<string, Values> }

/**
 * Ventana de efectos: elige un efecto, ajusta sus parámetros con vista previa en
 * vivo sobre el lienzo (a resolución de pantalla) y aplícalo a la capa activa o
 * al lienzo completo (a resolución de documento, como un paso deshacible).
 */
export class EffectsPanel {
  private root: HTMLElement | null = null;
  private effect: EffectDef;
  private values: Values;
  private mix = 1;
  private target: 'layer' | 'all';
  private cat: Category | 'all' = 'all';
  private query = '';
  private seq = 0;
  private timer = 0;
  private busy = false;
  private comparing = false;
  private offView: (() => void) | null = null;
  private offDoc: (() => void) | null = null;
  private prefs: PanelPrefs;
  /** Imagen de origen de la vista previa: se rehace sólo si cambian la vista, el documento o el destino. */
  private source: ReturnType<CanvasEngine['viewSource']> = null;
  private sourceKey = '';
  /** Dos lienzos alternos para la vista previa: uno se muestra mientras el otro se calcula. */
  private bufs: HTMLCanvasElement[] = [];

  constructor(private engine: CanvasEngine, saved: unknown, private persist: (p: PanelPrefs) => void) {
    const o = (saved && typeof saved === 'object' ? saved : {}) as Partial<PanelPrefs>;
    this.prefs = { last: typeof o.last === 'string' ? o.last : 'gauss', target: o.target === 'all' ? 'all' : 'layer', values: o.values && typeof o.values === 'object' ? o.values : {} };
    this.effect = EFFECTS.find(e => e.id === this.prefs.last) ?? EFFECTS[0];
    this.values = { ...defaults(this.effect), ...(this.prefs.values[this.effect.id] ?? {}) };
    this.target = this.prefs.target;
  }

  get open() { return !!this.root; }

  show() {
    if (this.root) return;
    if (!glAvailable()) { toast('Este dispositivo no admite WebGL2: los efectos no están disponibles.', 'error'); return; }
    this.engine.inputLocked = true;
    this.root = h('aside', {
      class: 'fx-panel', role: 'dialog', 'aria-label': 'Efectos', tabindex: '-1',
      on: { keydown: (e: Event) => { const k = e as KeyboardEvent; k.stopPropagation(); if (k.key === 'Escape' && !this.busy) this.close(); if (k.key === 'Enter' && (k.ctrlKey || k.metaKey)) void this.apply(); } },
    });
    document.body.append(this.root);
    document.body.classList.add('fx-open');
    // En el teléfono el lienzo se encoge para dejar sitio a la hoja: se vuelve a encajar el dibujo.
    if (document.documentElement.classList.contains('phone')) requestAnimationFrame(() => requestAnimationFrame(() => this.engine.fit()));
    this.render();
    this.root.focus();
    // Al mover o ampliar el lienzo, la vista previa se rehace con la nueva vista.
    this.offView = this.engine.on('view', () => { this.source = null; this.engine.showEffectPreview(null); this.schedule(180); });
    this.offDoc = this.engine.on('doc', () => { if (!this.busy) { this.source = null; this.renderHead(); this.schedule(60); } });
    this.schedule(0);
  }

  close() {
    if (!this.root || this.busy) return;
    clearTimeout(this.timer);
    this.seq++;
    this.offView?.(); this.offDoc?.();
    this.engine.showEffectPreview(null);
    this.engine.inputLocked = false;
    this.source = null;
    this.bufs = [];
    try { getGL().trim(); } catch { /* sin WebGL */ }
    this.root.remove();
    this.root = null;
    document.body.classList.remove('fx-open');
    if (document.documentElement.classList.contains('phone')) requestAnimationFrame(() => requestAnimationFrame(() => this.engine.fit()));
  }

  private fxTarget(): FxTarget { return this.target === 'all' ? 'all' : { layer: this.engine.doc.activeId }; }

  private save() {
    this.prefs.last = this.effect.id;
    this.prefs.target = this.target;
    this.prefs.values[this.effect.id] = this.values;
    this.persist(this.prefs);
  }

  // ---------------------------------------------------------------- vista previa

  private schedule(ms = 30) {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.preview(), ms);
  }

  private async preview() {
    if (!this.root || this.busy) return;
    if (this.comparing) { this.engine.showEffectPreview(null); return; }
    const seq = ++this.seq;
    const target = this.fxTarget();
    const key = JSON.stringify(target);
    if (!this.source || this.sourceKey !== key) { this.source = this.engine.viewSource(target); this.sourceKey = key; }
    const src = this.source;
    if (!src) { this.engine.showEffectPreview(null); return; }
    const layer = target === 'all' ? null : this.engine.doc.layer(target.layer);
    try {
      const t = performance.now();
      // Dos lienzos alternos: uno se muestra mientras el otro se calcula.
      if (!this.bufs.length) this.bufs = [document.createElement('canvas'), document.createElement('canvas')];
      const into = this.bufs.find(c => !c.isConnected) ?? this.bufs[0];
      const res = await applyEffect(src.canvas, this.effect, this.values, { unit: src.unit, doc: src.doc, mask: src.mask, keepAlpha: !!layer?.alphaLock, mix: this.mix, into });
      if (seq !== this.seq || !this.root) return;
      this.engine.showEffectPreview(res, target);
      const ms = performance.now() - t;
      const info = this.root.querySelector('.fx-perf');
      if (info) info.textContent = `Vista previa ${Math.round(ms)} ms`;
    } catch (err) {
      if (seq === this.seq) toast(`Efecto: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }

  // ---------------------------------------------------------------- interfaz

  private select(e: EffectDef) {
    this.save();
    this.effect = e;
    this.values = { ...defaults(e), ...(this.prefs.values[e.id] ?? {}) };
    this.mix = 1;
    this.render();
    this.schedule(0);
  }

  private head: HTMLElement | null = null;
  private renderHead() {
    if (!this.head) return;
    const doc = this.engine.doc, l = doc.active;
    const notes: string[] = [];
    if (doc.selection) notes.push('Sólo dentro de la selección.');
    if (this.target === 'layer' && l.alphaLock) notes.push('Alfa bloqueado: se conserva la transparencia de la capa.');
    if (this.target === 'all') notes.push('Crea una capa nueva con el resultado y oculta las de origen.');
    if (this.target === 'layer' && (!l.visible || l.locked)) notes.push(l.locked ? 'La capa activa está bloqueada.' : 'La capa activa está oculta.');
    const seg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Aplicar a' },
      ...([['layer', `Capa: ${l.name}`], ['all', 'Lienzo completo']] as const).map(([v, label]) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(this.target === v), title: label,
        on: { click: () => { this.target = v; this.save(); this.renderHead(); this.schedule(0); } },
      }, label)));
    this.head.replaceChildren(seg, notes.length ? h('p', { class: 'fx-note' }, notes.join(' ')) : '');
  }

  private render() {
    if (!this.root) return;
    this.head = h('div', { class: 'fx-target' });
    this.renderHead();
    const search = h('input', { type: 'search', class: 'fx-search', placeholder: 'Buscar efecto', value: this.query, 'aria-label': 'Buscar efecto' });
    search.addEventListener('input', () => { this.query = search.value.trim().toLowerCase(); list.replaceChildren(...this.items()); });
    const cats = h('div', { class: 'ex-chips fx-cats', role: 'tablist', 'aria-label': 'Categorías' },
      ...[{ id: 'all' as const, label: 'Todos' }, ...CATEGORIES].map(c => h('button', {
        type: 'button', class: 'chip-btn', role: 'tab', 'aria-pressed': String(this.cat === c.id),
        on: { click: () => { this.cat = c.id; this.render(); } },
      }, c.label)));
    const list = h('div', { class: 'fx-list', role: 'listbox', 'aria-label': 'Efectos' }, ...this.items());
    const params = h('div', { class: 'fx-params' },
      h('h3', null, this.effect.label),
      ...this.effect.params.map(p => this.control(p)),
      this.control({ key: '__mix', label: 'Intensidad del efecto', type: 'range', min: 0, max: 100, def: 100, unit: '%' }));
    const compare = h('button', {
      type: 'button', class: 'btn sm', title: 'Mantén pulsado para ver el original',
      on: {
        pointerdown: () => { this.comparing = true; this.engine.showEffectPreview(null); },
        pointerup: () => { this.comparing = false; this.schedule(0); }, pointerleave: () => { if (this.comparing) { this.comparing = false; this.schedule(0); } },
      },
    }, 'Antes / después');
    const reset = h('button', { type: 'button', class: 'btn sm ghost', on: { click: () => { this.values = defaults(this.effect); this.mix = 1; this.save(); this.render(); this.schedule(0); } } }, 'Restablecer');
    const progress = h('div', { class: 'ex-progress fx-progress', hidden: true }, h('div', { class: 'bar' }), h('span', { class: 'label' }, ''));
    this.root.replaceChildren(
      h('div', { class: 'fx-head' }, h('h2', { html: `${SPARK}<span>Efectos</span>` }), h('button', { type: 'button', class: 'btn sm ghost', on: { click: () => this.close() } }, 'Cerrar')),
      this.head,
      h('div', { class: 'fx-browse' }, search, cats, list),
      params,
      h('div', { class: 'fx-foot' }, progress, h('span', { class: 'fx-perf muted' }),
        h('div', { class: 'fx-actions' }, reset, compare,
          h('button', { type: 'button', class: 'btn ghost', on: { click: () => this.close() } }, 'Cancelar'),
          h('button', { type: 'button', class: 'btn primary fx-apply', on: { click: () => void this.apply() } }, 'Aplicar'))));
    (list.querySelector('[aria-selected="true"]') as HTMLElement | null)?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  private items(): HTMLElement[] {
    return EFFECTS.filter(e => (this.cat === 'all' || e.cat === this.cat) && (!this.query || e.label.toLowerCase().includes(this.query)))
      .map(e => h('button', {
        type: 'button', class: 'fx-item', role: 'option', 'aria-selected': String(e.id === this.effect.id),
        on: { click: () => this.select(e) },
      }, h('span', { class: 'fx-item-name' }, e.label), h('span', { class: 'fx-item-cat' }, CATEGORIES.find(c => c.id === e.cat)!.label)));
  }

  private control(p: Param): HTMLElement {
    const id = `fx-${p.key}`;
    const isMix = p.key === '__mix';
    const get = () => (isMix ? Math.round(this.mix * 100) : this.values[p.key]);
    const set = (v: number | string | boolean) => {
      if (isMix) this.mix = Number(v) / 100; else this.values = { ...this.values, [p.key]: v };
      this.save();
      this.schedule(16);
    };
    if (p.type === 'range') {
      const out = h('output', { for: id }, fmt(Number(get()), p.unit));
      const input = h('input', { type: 'range', id, min: String(p.min), max: String(p.max), step: String(p.step ?? (p.max - p.min > 20 ? 1 : 0.01)), value: String(get()) });
      const fill = () => input.style.setProperty('--fill', `${((Number(input.value) - p.min) / (p.max - p.min)) * 100}%`);
      fill();
      input.addEventListener('input', () => { fill(); out.textContent = fmt(Number(input.value), p.unit); set(Number(input.value)); });
      // Doble clic: valor por defecto.
      input.addEventListener('dblclick', () => { input.value = String(p.def); fill(); out.textContent = fmt(p.def, p.unit); set(p.def); });
      return h('div', { class: 'ctl' }, h('div', { class: 'ctl-row' }, h('label', { for: id }, p.label), out), input);
    }
    if (p.type === 'color') {
      const input = h('input', { type: 'color', id, value: String(get()) });
      input.addEventListener('input', () => set(input.value));
      return h('div', { class: 'ctl-row fx-color' }, h('label', { for: id }, p.label), input);
    }
    if (p.type === 'select') {
      const sel = h('select', { id }, ...p.options.map(([v, l]) => h('option', { value: v, selected: v === get() ? true : undefined }, l)));
      sel.value = String(get());
      sel.addEventListener('change', () => set(sel.value));
      return h('div', { class: 'ctl-row' }, h('label', { for: id }, p.label), sel);
    }
    const input = h('input', { type: 'checkbox', id, checked: get() === true });
    input.addEventListener('change', () => set(input.checked));
    return h('label', { class: 'switch' }, input, h('span', { class: 'track' }), h('span', null, p.label));
  }

  // ---------------------------------------------------------------- aplicar

  private async apply() {
    if (!this.root || this.busy) return;
    const target = this.fxTarget();
    this.busy = true;
    this.seq++;
    this.root.classList.add('busy');
    const prog = this.root.querySelector('.fx-progress') as HTMLElement;
    prog.hidden = false;
    const setP = (f: number) => { prog.style.setProperty('--p', `${Math.round(f * 100)}%`); (prog.querySelector('.label') as HTMLElement).textContent = `Aplicando · ${Math.round(f * 100)}%`; };
    setP(0);
    const t = performance.now();
    try {
      await applyToDocument(this.engine, this.effect, this.values, this.mix, target, setP);
      const secs = ((performance.now() - t) / 1000).toFixed(1);
      this.busy = false;
      this.close();
      toast(`${this.effect.label} aplicado (${secs} s). Ctrl+Z para deshacer.`, 'ok');
    } catch (err) {
      this.busy = false;
      this.root?.classList.remove('busy');
      prog.hidden = true;
      toast(`No se pudo aplicar: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }
}

function fmt(v: number, unit = '') {
  const s = Math.abs(v) >= 10 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(2).replace(/\.?0+$/, '');
  return `${s}${unit}`;
}
