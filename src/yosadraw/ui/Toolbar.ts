import { comboLabel } from '../tools/keymap';
import type { ToolManager } from '../tools/ToolManager';
import { CATEGORIES, type CategoryId, type ToolDef } from '../tools/types';
import { h } from './dom';

export interface ToolbarLayout {
  side: 'left' | 'right';
  labels: boolean;
  hidden: string[];
  collapsed: CategoryId[];
  order: Partial<Record<CategoryId, string[]>>;
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

  constructor(private mgr: ToolManager, public layout: ToolbarLayout, private onLayout: (l: ToolbarLayout) => void) {
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
    this.el.replaceChildren(...groups);
  }
}
