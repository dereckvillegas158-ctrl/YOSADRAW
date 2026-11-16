import type { BrushLibrary } from '../brush/BrushLibrary';
import type { BrushPreset } from '../brush/BrushPreset';
import { Emitter } from '../engine/Emitter';
import type { CanvasEngine } from '../engine';
import { comboFromEvent, Keymap } from './keymap';
import { TOOLS } from './registry';
import { selectionActions } from './selectionOps';
import type { ActiveHandler, ToolContext, ToolDef } from './types';

export interface ActionDef { id: string; label: string; group: string; shortcut: string[]; run(m: ToolManager): void }

/** Acciones con atajo además de las herramientas. */
export const ACTIONS: ActionDef[] = [
  { id: 'undo', label: 'Deshacer', group: 'Edición', shortcut: ['Ctrl+Z'], run: m => m.engine.undo() },
  { id: 'redo', label: 'Rehacer', group: 'Edición', shortcut: ['Ctrl+Shift+Z', 'Ctrl+Y'], run: m => m.engine.redo() },
  { id: 'select-all', label: 'Seleccionar todo', group: 'Selección', shortcut: ['Ctrl+A'], run: m => selectionActions.selectAll(m.ctx) },
  { id: 'deselect', label: 'Deseleccionar', group: 'Selección', shortcut: ['Ctrl+D'], run: m => selectionActions.deselect(m.ctx) },
  { id: 'invert-selection', label: 'Invertir selección', group: 'Selección', shortcut: ['Ctrl+Shift+I'], run: m => selectionActions.invert(m.ctx) },
  { id: 'clear-selection', label: 'Borrar contenido seleccionado', group: 'Selección', shortcut: ['Delete', 'Backspace'], run: m => selectionActions.clear(m.ctx) },
  { id: 'fill-selection', label: 'Rellenar selección', group: 'Selección', shortcut: ['Alt+Backspace'], run: m => selectionActions.fill(m.ctx) },
  { id: 'new-layer', label: 'Nueva capa', group: 'Capas', shortcut: ['Ctrl+Shift+N'], run: m => m.engine.addLayer() },
  { id: 'duplicate-layer', label: 'Duplicar capa', group: 'Capas', shortcut: ['Ctrl+J'], run: m => m.engine.exec(m.engine.doc.cmdDuplicateLayer(m.engine.doc.activeId)) },
  { id: 'alpha-lock', label: 'Bloquear alfa de la capa', group: 'Capas', shortcut: ['/'], run: m => { const l = m.engine.doc.active; m.engine.setLayerProps(l.id, { alphaLock: !l.alphaLock }); m.hooks.notify(l.alphaLock ? `Alfa bloqueado en «${l.name}»` : `Alfa desbloqueado en «${l.name}»`); } },
  { id: 'clip-layer', label: 'Máscara de recorte de la capa', group: 'Capas', shortcut: ['Ctrl+Alt+G'], run: m => { const l = m.engine.doc.active; if (!l.clip && m.engine.doc.index(l.id) === 0) { m.hooks.notify('No hay ninguna capa debajo a la que recortar'); return; } m.engine.setLayerProps(l.id, { clip: !l.clip }); m.hooks.notify(l.clip ? `«${l.name}» recortada a la capa de debajo` : `Recorte quitado de «${l.name}»`); } },
  { id: 'merge-down', label: 'Combinar hacia abajo', group: 'Capas', shortcut: ['Ctrl+E'], run: m => m.engine.exec(m.engine.doc.cmdMergeDown(m.engine.doc.activeId)) },
  { id: 'save', label: 'Guardar', group: 'Archivo', shortcut: ['Ctrl+S'], run: m => m.hooks.project?.('save') },
  { id: 'save-as', label: 'Guardar como…', group: 'Archivo', shortcut: ['Ctrl+Shift+S'], run: m => m.hooks.project?.('saveAs') },
  { id: 'new-project', label: 'Nuevo proyecto…', group: 'Archivo', shortcut: ['Ctrl+Alt+N'], run: m => m.hooks.project?.('new') },
  { id: 'gallery', label: 'Volver a la galería', group: 'Archivo', shortcut: ['Ctrl+Shift+G'], run: m => m.hooks.project?.('gallery') },
  { id: 'import-image', label: 'Importar imagen como capa…', group: 'Archivo', shortcut: ['Ctrl+Shift+O'], run: m => m.hooks.importImage?.() },
  { id: 'add-reference', label: 'Añadir imagen de referencia…', group: 'Archivo', shortcut: ['Ctrl+Alt+R'], run: m => m.hooks.addReference?.() },
  { id: 'effects', label: 'Efectos…', group: 'Imagen', shortcut: ['Ctrl+Shift+F'], run: m => m.hooks.openEffects?.() },
  { id: 'export', label: 'Exportar…', group: 'Archivo', shortcut: ['Ctrl+Shift+E'], run: m => m.hooks.openExport?.() },
  { id: 'anim-play', label: 'Reproducir / pausa', group: 'Animación', shortcut: ['Ctrl+Enter'], run: m => m.hooks.anim?.('play') },
  { id: 'anim-prev', label: 'Fotograma anterior', group: 'Animación', shortcut: [','], run: m => m.hooks.anim?.('prev') },
  { id: 'anim-next', label: 'Fotograma siguiente', group: 'Animación', shortcut: ['.'], run: m => m.hooks.anim?.('next') },
  { id: 'anim-prev-cel', label: 'Dibujo anterior de la pista', group: 'Animación', shortcut: ['Alt+Left'], run: m => m.hooks.anim?.('prev-cel') },
  { id: 'anim-next-cel', label: 'Dibujo siguiente de la pista', group: 'Animación', shortcut: ['Alt+Right'], run: m => m.hooks.anim?.('next-cel') },
  { id: 'anim-prev-key', label: 'Clave o marcador anterior', group: 'Animación', shortcut: ['Alt+Shift+Left'], run: m => m.hooks.anim?.('prev-key') },
  { id: 'anim-next-key', label: 'Clave o marcador siguiente', group: 'Animación', shortcut: ['Alt+Shift+Right'], run: m => m.hooks.anim?.('next-key') },
  { id: 'anim-first', label: 'Primer fotograma', group: 'Animación', shortcut: ['Home'], run: m => m.hooks.anim?.('first') },
  { id: 'anim-last', label: 'Último fotograma', group: 'Animación', shortcut: ['End'], run: m => m.hooks.anim?.('last') },
  { id: 'anim-new', label: 'Nuevo fotograma', group: 'Animación', shortcut: ['Ctrl+Alt+F'], run: m => m.hooks.anim?.('new') },
  { id: 'anim-dup', label: 'Duplicar fotograma', group: 'Animación', shortcut: ['Ctrl+Alt+D'], run: m => m.hooks.anim?.('dup') },
  { id: 'anim-hold', label: 'Alargar exposición (+1)', group: 'Animación', shortcut: ['Ctrl+Alt+Right'], run: m => m.hooks.anim?.('hold') },
  { id: 'anim-unhold', label: 'Acortar exposición (−1)', group: 'Animación', shortcut: ['Ctrl+Alt+Left'], run: m => m.hooks.anim?.('unhold') },
  { id: 'anim-key', label: 'Fotograma clave / intermedio', group: 'Animación', shortcut: ['Ctrl+Alt+K'], run: m => m.hooks.anim?.('key') },
  { id: 'anim-onion', label: 'Papel cebolla', group: 'Animación', shortcut: ['O'], run: m => m.hooks.anim?.('onion') },
  { id: 'anim-xsheet', label: 'Hoja de exposición', group: 'Animación', shortcut: ['Ctrl+Alt+X'], run: m => m.hooks.anim?.('xsheet') },
  { id: 'anim-export', label: 'Exportar animación', group: 'Animación', shortcut: ['Ctrl+Alt+E'], run: m => m.hooks.anim?.('export') },
  { id: 'swap-colors', label: 'Intercambiar colores', group: 'Color', shortcut: ['X'], run: m => m.swapColors() },
  { id: 'default-colors', label: 'Colores por defecto', group: 'Color', shortcut: ['D'], run: m => m.setColors('#1b1530', '#ffffff') },
  { id: 'brush-bigger', label: 'Pincel más grande', group: 'Pincel', shortcut: [']'], run: m => m.resizeBrush(1.2) },
  { id: 'brush-smaller', label: 'Pincel más pequeño', group: 'Pincel', shortcut: ['['], run: m => m.resizeBrush(1 / 1.2) },
  { id: 'edit-brush', label: 'Editar pincel activo', group: 'Pincel', shortcut: ['Enter'], run: m => { const p = m.currentPreset(); if (p) m.ctx.openBrushStudio(p); } },
  { id: 'zoom-in', label: 'Acercar', group: 'Vista', shortcut: ['+', '='], run: m => m.engine.zoomBy(1.5) },
  { id: 'zoom-out', label: 'Alejar', group: 'Vista', shortcut: ['-'], run: m => m.engine.zoomBy(1 / 1.5) },
  { id: 'fit', label: 'Encajar lienzo', group: 'Vista', shortcut: ['Ctrl+0'], run: m => m.engine.fit() },
  { id: 'actual-size', label: 'Tamaño real (100%)', group: 'Vista', shortcut: ['Ctrl+1'], run: m => m.engine.zoomTo(1) },
  { id: 'reset-rotation', label: 'Enderezar vista', group: 'Vista', shortcut: ['Shift+R'], run: m => m.engine.setRotation(0) },
  { id: 'toggle-symmetry', label: 'Activar/desactivar simetría', group: 'Guías', shortcut: ['Shift+Y'], run: m => { m.engine.symmetry.enabled = !m.engine.symmetry.enabled; m.engine.requestOverlay(); m.emitProps(); } },
  { id: 'toggle-ruler', label: 'Activar/desactivar regla', group: 'Guías', shortcut: ['Shift+J'], run: m => { m.engine.ruler.enabled = !m.engine.ruler.enabled; m.engine.requestOverlay(); m.emitProps(); } },
];

export interface ColorState { primary: string; secondary: string; recent: string[] }

export type ToolManagerEvents = { tool: ToolDef; props: void; colors: ColorState; keymap: void };

/**
 * Activa herramientas, guarda sus ajustes y los colores, y despacha los
 * atajos configurables. Es el único punto que traduce "herramienta" en modo
 * del motor de lienzo.
 */
export class ToolManager extends Emitter<ToolManagerEvents> {
  readonly tools = TOOLS;
  readonly actions = ACTIONS;
  readonly keymap: Keymap;
  readonly ctx: ToolContext;
  current: ToolDef;
  private handlers = new Map<string, ActiveHandler>();
  private settings: Record<string, Record<string, unknown>> = {};
  colors: ColorState = { primary: '#1b1530', secondary: '#ffffff', recent: [] };
  private recentTimer = 0;

  constructor(readonly engine: CanvasEngine, readonly lib: BrushLibrary, readonly hooks: { openBrushStudio(p: BrushPreset): void; notify(m: string, k?: 'info' | 'ok' | 'error'): void; openExport?(): void; openEffects?(): void; importImage?(): void; addReference?(): void; anim?(id: string): void; project?(a: 'save' | 'saveAs' | 'new' | 'gallery'): void }) {
    super();
    const defaults: Record<string, string[]> = {};
    for (const t of TOOLS) defaults[`tool:${t.id}`] = t.shortcut;
    for (const a of ACTIONS) defaults[`action:${a.id}`] = a.shortcut;
    this.keymap = new Keymap(defaults);
    for (const t of TOOLS) this.settings[t.id] = { ...(t.defaults ?? {}) };
    this.colors.primary = lib.color;
    const self = this;
    this.ctx = {
      engine, lib,
      setting<T>(tool: string, key: string): T { return self.settings[tool]?.[key] as T; },
      setSetting(tool: string, key: string, value: unknown) { (self.settings[tool] ??= {})[key] = value; self.emitProps(); self.changed(); },
      get primary() { return self.colors.primary; },
      get secondary() { return self.colors.secondary; },
      setPrimary: hex => self.setColors(hex, self.colors.secondary),
      notify: hooks.notify,
      refreshProps: () => self.emitProps(),
      openBrushStudio: hooks.openBrushStudio,
    };
    this.current = TOOLS.find(t => t.id === 'pen')!;
    lib.on('active', ({ tool }) => { if (tool === this.current.id) this.syncBrush(); this.emitProps(); });
    lib.on('change', () => { if (this.current.brushCategories) this.syncBrush(); this.emitProps(); });
    engine.on('doc', () => this.emitProps());
  }

  /** Cambios que hay que guardar (lo escucha la app). */
  onChange: (() => void) | null = null;
  private changed() { this.onChange?.(); }

  tool(id: string) { return this.tools.find(t => t.id === id); }
  handler(id: string): ActiveHandler | undefined {
    const t = this.tool(id);
    if (!t?.create) return undefined;
    let h = this.handlers.get(id);
    if (!h) { h = t.create(this.ctx); this.handlers.set(id, h); }
    return h;
  }

  /** Al cambiar de documento: la herramienta activa aplica o descarta lo pendiente y empieza limpia. */
  resetForDocument() {
    const prev = this.handlers.get(this.current.id);
    prev?.deactivate?.();
    this.handlers.clear();
    const id = this.current.id;
    this.current = this.tools.find(t => t.id === 'pen')!;
    this.select(id);
  }

  select(id: string) {
    const t = this.tool(id);
    if (!t) return;
    if (this.engine.isDrawing) return;
    const prev = this.handlers.get(this.current.id);
    if (t.id !== this.current.id) prev?.deactivate?.();
    this.current = t;
    if (t.kind === 'brush' || t.kind === 'eraser') { this.engine.setMode(t.kind === 'eraser' ? 'erase' : 'paint'); this.syncBrush(); }
    else if (t.kind === 'pan') this.engine.setMode('pan');
    else if (t.kind === 'rotate') this.engine.setMode('rotate');
    else {
      const h = this.handler(t.id)!;
      this.engine.setMode('custom', h);
      h.activate?.();
    }
    this.emit('tool', t);
    this.emitProps();
    this.changed();
  }

  /** Pincel que corresponde a la herramienta actual. */
  currentPreset(): BrushPreset | null {
    const t = this.current;
    return t.brushCategories ? this.lib.activeFor(t.id, t.brushCategories) : null;
  }

  private syncBrush() {
    const p = this.currentPreset();
    if (p) this.engine.setBrushPreset(p);
  }

  resizeBrush(f: number) {
    const t = this.current;
    if (!t.brushCategories) return;
    const p = JSON.parse(JSON.stringify(this.lib.activeFor(t.id, t.brushCategories))) as BrushPreset;
    p.size.size = Math.min(1000, Math.max(0.5, Math.round(p.size.size * f * 10) / 10));
    this.lib.update(p);
  }

  setColors(primary: string, secondary: string) {
    this.colors.primary = primary;
    this.colors.secondary = secondary;
    this.engine.setColor(primary);
    this.lib.setColor(primary);
    clearTimeout(this.recentTimer);
    // Se recuerda como reciente si se queda puesto un momento (no mientras se arrastra el selector).
    this.recentTimer = window.setTimeout(() => {
      const r = [primary, ...this.colors.recent.filter(c => c !== primary)].slice(0, 14);
      this.colors.recent = r;
      this.emit('colors', this.colors);
      this.changed();
    }, 700);
    this.emit('colors', this.colors);
  }
  swapColors() { this.setColors(this.colors.secondary, this.colors.primary); }

  emitProps() { this.emit('props', undefined); }
  /** Avisa de que cambiaron los atajos (para refrescar descripciones). */
  keymapChanged() { this.emit('keymap', undefined); this.changed(); }

  /** Atajos: devuelve true si la tecla se ha usado. */
  handleKey(e: KeyboardEvent): boolean {
    const h = this.handlers.get(this.current.id);
    if (this.engine.mode === 'custom' && h?.key?.(e)) return true;
    const combo = comboFromEvent({ key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey, altGraph: e.getModifierState?.('AltGraph') });
    if (!combo) return false;
    const id = this.keymap.find(combo);
    if (!id) return false;
    if (id.startsWith('tool:')) this.select(id.slice(5));
    else this.actions.find(a => `action:${a.id}` === id)?.run(this);
    return true;
  }

  /* ---------- Persistencia ---------- */
  toJSON() {
    return { tool: this.current.id, settings: this.settings, colors: this.colors, keymap: this.keymap.toJSON(), symmetry: this.engine.symmetry, ruler: this.engine.ruler, rulerSnap: this.engine.rulerSnap };
  }
  load(data: Record<string, unknown> | null) {
    if (!data) return;
    const st = data.settings as Record<string, Record<string, unknown>> | undefined;
    if (st && typeof st === 'object') for (const t of TOOLS) if (st[t.id] && typeof st[t.id] === 'object') this.settings[t.id] = { ...(t.defaults ?? {}), ...st[t.id] };
    const c = data.colors as ColorState | undefined;
    const hex = (v: unknown) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
    if (c && hex(c.primary) && hex(c.secondary)) {
      this.colors = { primary: c.primary, secondary: c.secondary, recent: Array.isArray(c.recent) ? c.recent.filter(hex).slice(0, 14) : [] };
      this.engine.setColor(c.primary);
    }
    this.keymap.load(data.keymap);
    const sym = data.symmetry as Record<string, unknown> | undefined;
    const modes = ['vertical', 'horizontal', 'quadrant', 'radial', 'mandala'];
    if (sym && typeof sym === 'object' && modes.includes(sym.mode as string) && Number.isFinite(sym.cx) && Number.isFinite(sym.cy)) {
      Object.assign(this.engine.symmetry, { mode: sym.mode, count: Number(sym.count) || 6, cx: Number(sym.cx), cy: Number(sym.cy), enabled: !!sym.enabled });
    }
    const r = data.ruler as Record<string, unknown> | undefined;
    if (r && typeof r === 'object' && ['x0', 'y0', 'x1', 'y1'].every(k => Number.isFinite(r[k]))) Object.assign(this.engine.ruler, { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, enabled: !!r.enabled });
    if (Number.isFinite(data.rulerSnap)) this.engine.rulerSnap = Number(data.rulerSnap);
    if (typeof data.tool === 'string' && this.tool(data.tool)) this.current = this.tool(data.tool)!;
  }
}
