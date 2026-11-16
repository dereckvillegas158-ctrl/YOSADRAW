import { comboLabel } from '../tools/keymap';
import type { ToolManager } from '../tools/ToolManager';
import { CATEGORIES, type CategoryId, type ToolDef } from '../tools/types';
import { h } from './dom';
import { CATEGORIES as FX_CATEGORIES, type Category as FxCategory } from '../effects/effects';

const fxSvg = (d: string) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
/** Iconos de las categorías de efectos. */
export const FX_ICONS: Record<FxCategory | 'all', string> = {
  all: fxSvg('<path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 10.9 10.1 9z"/><path d="M19 3v4M17 5h4"/>'),
  color: fxSvg('<path d="M12 3.5c3.5 4.2 6 7.4 6 10.5a6 6 0 0 1-12 0c0-3.1 2.5-6.3 6-10.5Z"/><path d="M12 20a6 6 0 0 0 6-6H6"/>'),
  blur: fxSvg('<circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="6.5" opacity=".55" stroke-dasharray="2 2.5"/><circle cx="12" cy="12" r="9" opacity=".3" stroke-dasharray="1.5 3"/>'),
  sharpen: fxSvg('<path d="M12 3.5 20 19H4z"/><path d="M12 9.5v4.5"/>'),
  stylize: fxSvg('<path d="m5 19 9.5-9.5M14.5 9.5l2-2M17 4l.7 1.8L19.5 6.5l-1.8.7L17 9l-.7-1.8L14.5 6.5l1.8-.7z"/><path d="M6 8.5h.01M9 5h.01M19 13.5h.01"/>'),
  distort: fxSvg('<path d="M3 8c3-3 6 3 9 0s6 3 9 0"/><path d="M3 16c3-3 6 3 9 0s6 3 9 0"/>'),
  texture: fxSvg('<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M8 8h.01M12 8h.01M16 8h.01M10 12h.01M14 12h.01M8 16h.01M12 16h.01M16 16h.01"/>'),
};

export interface ToolbarLayout {
  side: 'left' | 'right';
  labels: boolean;
  hidden: string[];
  collapsed: CategoryId[];
  order: Partial<Record<CategoryId, string[]>>;
  /** Sección de efectos plegada. */
  fxCollapsed?: boolean;
}

export const DEFAULT_LAYOUT: ToolbarLayout = { side: 'left', labels: false, hidden: [], collapsed: [], order: {} };

export function normalizeLayout(v: unknown): ToolbarLayout {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<ToolbarLayout>;
  return {
    side: o.side === 'right' ? 'right' : 'left',
    labels: !!o.labels,
    hidden: Array.isArray(o.hidden) ? o.hidden.filter(x => typeof x === 'string') : [],
    collapsed: Array.isArray(o.collapsed) ? o.collapsed.filter((x): x is CategoryId => CATEGORIES.some(c => c.id === x)) : [],
    order: o.order && typeof o.order === 'object' ? o.order : {},
    fxCollapsed: o.fxCollapsed === true,
  };
}

/** Herramientas de una categoría en el orden elegido por el usuario. */
export function orderedTools(mgr: ToolManager, layout: ToolbarLayout, cat: CategoryId): ToolDef[] {
  const tools = mgr.tools.filter(t => t.category === cat);
  const order = layout.order[cat] ?? [];
  return [...tools].sort((a, b) => {
    const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
    return (ia < 0 ? 999 + tools.indexOf(a) : ia) - (ib < 0 ? 999 + tools.indexOf(b) : ib);
  });
}

/** Barra de herramientas vertical agrupada por categorías. */
export class Toolbar {
  readonly el: HTMLElement;

  constructor(private mgr: ToolManager, public layout: ToolbarLayout, private onLayout: (l: ToolbarLayout) => void, private openFx?: (o: { cat?: FxCategory | 'all' }) => void) {
    this.el = h('nav', { class: 'toolbar', 'aria-label': 'Herramientas' });
    mgr.on('tool', () => this.render());
    mgr.on('keymap', () => this.render());
    this.render();
  }

  setLayout(l: ToolbarLayout) { this.layout = l; this.render(); }

  private title(t: ToolDef) {
    const keys = this.mgr.keymap.get(`tool:${t.id}`);
    return `${t.label}${keys.length ? ` (${keys.map(comboLabel).join(', ')})` : ''}\n${t.hint}`;
  }

  render() {
    const L = this.layout;
    this.el.classList.toggle('with-labels', L.labels);
    document.body.classList.toggle('toolbar-right', L.side === 'right');
    const groups: HTMLElement[] = [];
    for (const cat of CATEGORIES) {
      const tools = orderedTools(this.mgr, L, cat.id).filter(t => !L.hidden.includes(t.id));
      if (!tools.length) continue;
      const collapsed = L.collapsed.includes(cat.id);
      const shown = collapsed ? [tools.find(t => t.id === this.mgr.current.id) ?? tools[0]] : tools;
      const head = h('button', {
        type: 'button', class: 'tb-cat', 'aria-expanded': String(!collapsed), title: collapsed ? `Mostrar ${cat.label}` : `Plegar ${cat.label}`,
        on: { click: () => { const c = new Set(L.collapsed); if (collapsed) c.delete(cat.id); else c.add(cat.id); this.layout = { ...L, collapsed: [...c] }; this.onLayout(this.layout); this.render(); } },
      }, h('span', null, L.labels ? cat.label : cat.short), collapsed && tools.length > 1 ? h('span', { class: 'tb-more', 'aria-hidden': 'true' }, `+${tools.length - 1}`) : null);
      const buttons = shown.map(t => h('button', {
        type: 'button', class: 'tool', 'aria-pressed': String(t.id === this.mgr.current.id), title: this.title(t), 'aria-label': t.label,
        dataset: { tool: t.id }, html: `${t.icon}<span class="tool-label">${t.label}</span>`, on: { click: () => this.mgr.select(t.id) },
      }));
      groups.push(h('section', { class: 'tb-group', 'aria-label': cat.label }, head, ...buttons));
    }
    // Efectos: apartado propio (abre el panel de efectos con esa categoría).
    if (this.openFx) {
      const collapsed = !!L.fxCollapsed;
      const head = h('button', {
        type: 'button', class: 'tb-cat', 'aria-expanded': String(!collapsed), title: collapsed ? 'Mostrar Efectos' : 'Plegar Efectos',
        on: { click: () => { this.layout = { ...L, fxCollapsed: !collapsed }; this.onLayout(this.layout); this.render(); } },
      }, h('span', null, L.labels ? 'Efectos' : 'Efect.'), collapsed ? h('span', { class: 'tb-more', 'aria-hidden': 'true' }, `+${FX_CATEGORIES.length}`) : null);
      const entries: { id: FxCategory | 'all'; label: string }[] = [{ id: 'all', label: 'Todos los efectos' }, ...(collapsed ? [] : FX_CATEGORIES)];
      const buttons = entries.map(c => h('button', {
        type: 'button', class: 'tool fx-tool', title: c.id === 'all' ? 'Efectos (Ctrl+Mayús+F)' : `Efectos de ${c.label.toLowerCase()}`, 'aria-label': c.id === 'all' ? 'Efectos' : `Efectos: ${c.label}`,
        dataset: { fx: c.id }, html: `${FX_ICONS[c.id]}<span class="tool-label">${c.id === 'all' ? 'Todos' : c.label}</span>`, on: { click: () => this.openFx!({ cat: c.id }) },
      }));
      groups.push(h('section', { class: 'tb-group tb-fx', 'aria-label': 'Efectos' }, head, ...buttons));
    }
    this.el.replaceChildren(...groups);
  }
}
