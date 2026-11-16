import type { ToolManager } from '../tools/ToolManager';
import { CATEGORIES } from '../tools/types';
import { h } from './dom';
import { openSheet } from './Mobile';
import type { PropertiesBar } from './PropertiesBar';

const svg = (d: string) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const DOCK_ICONS = {
  tools: svg('<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><path d="M17 13.5v7M13.5 17h7"/>'),
  settings: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/>'),
  layers: svg('<path d="m12 3.5 8.5 4.5L12 12.5 3.5 8 12 3.5Z"/><path d="m3.5 12 8.5 4.5 8.5-4.5"/><path d="m3.5 16 8.5 4.5 8.5-4.5"/>'),
  more: svg('<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>'),
  image: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="9.5" r="1.7"/><path d="m4 17 5-5 4 4 2.5-2.5L20 18"/>'),
  ref: svg('<rect x="3.5" y="3.5" width="12" height="12" rx="2"/><path d="M8.5 20.5h10a2 2 0 0 0 2-2v-10"/><path d="m5 13 3-3 3 3 2-2 2.5 2.5"/>'),
};

export interface DockDeps {
  mgr: ToolManager;
  props: PropertiesBar;
  propsHome: HTMLElement;
  openPanel: (tab: 'layers' | 'color') => void;
  openMore: () => void;
}

/**
 * Interfaz simplificada del teléfono: en lugar de la barra de herramientas
 * completa y la de propiedades, un dock con siete botones grandes:
 * herramientas · último pincel · borrador · ajustes · capas · color · más.
 * Las propiedades de la herramienta (las mismas de la barra de escritorio) se
 * abren en una hoja; las herramientas, en una cuadrícula por categorías.
 */
export class PhoneDock {
  readonly el: HTMLElement;
  private lastBrush = 'pen';
  private btn: Record<'tools' | 'brush' | 'eraser' | 'settings' | 'layers' | 'color' | 'more', HTMLButtonElement>;
  private dot = h('span', { class: 'color-dot' });

  constructor(private d: DockDeps) {
    const { mgr } = d;
    const b = (cls: string, label: string, run: () => void, html = '') =>
      h('button', { type: 'button', class: `dock-btn ${cls}`, 'aria-label': label, title: label, html, on: { click: run } }) as HTMLButtonElement;
    this.btn = {
      tools: b('dk-tools', 'Herramientas', () => this.openTools(), DOCK_ICONS.tools),
      brush: b('dk-brush', 'Pincel', () => { if (mgr.current.id === this.lastBrush) this.openSettings(); else mgr.select(this.lastBrush); }),
      eraser: b('dk-eraser', 'Borrador', () => { if (mgr.current.id === 'eraser') this.openSettings(); else mgr.select('eraser'); }),
      settings: b('dk-settings', 'Ajustes de la herramienta', () => this.openSettings(), DOCK_ICONS.settings),
      layers: b('dk-layers', 'Capas', () => d.openPanel('layers'), DOCK_ICONS.layers),
      color: b('dk-color', 'Color', () => d.openPanel('color')),
      more: b('dk-more', 'Más opciones', () => d.openMore(), DOCK_ICONS.more),
    };
    this.btn.color.append(this.dot);
    this.el = h('nav', { class: 'phone-dock', 'aria-label': 'Herramientas', 'data-ui': '' },
      this.btn.tools, this.btn.brush, this.btn.eraser, this.btn.settings, h('span', { class: 'dock-sep', 'aria-hidden': 'true' }), this.btn.layers, this.btn.color, this.btn.more);
    mgr.on('tool', () => this.render());
    mgr.on('colors', () => this.render());
    this.render();
  }

  render() {
    const { mgr } = this.d;
    const cur = mgr.current;
    if (cur.kind === 'brush' && cur.id !== 'eraser') this.lastBrush = cur.id;
    const brush = mgr.tools.find(t => t.id === this.lastBrush) ?? mgr.tools[0];
    this.btn.brush.innerHTML = brush.icon;
    this.btn.brush.title = this.btn.brush.ariaLabel = `${brush.label} (toca otra vez para ajustes)`;
    this.btn.eraser.innerHTML = mgr.tools.find(t => t.id === 'eraser')?.icon ?? '';
    const other = cur.id !== this.lastBrush && cur.id !== 'eraser';
    // El botón de herramientas muestra la herramienta activa si no es el pincel ni el borrador.
    this.btn.tools.innerHTML = other ? cur.icon : DOCK_ICONS.tools;
    this.btn.tools.title = other ? `${cur.label} · todas las herramientas` : 'Herramientas';
    this.btn.tools.setAttribute('aria-pressed', String(other));
    this.btn.brush.setAttribute('aria-pressed', String(cur.id === this.lastBrush));
    this.btn.eraser.setAttribute('aria-pressed', String(cur.id === 'eraser'));
    this.btn.settings.disabled = !(cur.props?.(mgr.ctx) ?? []).length;
    this.dot.style.background = mgr.colors.primary;
  }

  openTools() {
    const { mgr } = this.d;
    openSheet('Herramientas', close => CATEGORIES.map(cat => {
      const tools = mgr.tools.filter(t => t.category === cat.id);
      if (!tools.length) return null;
      return h('section', { class: 'sheet-sec' }, h('h3', null, cat.label),
        h('div', { class: 'tool-grid' }, ...tools.map(t => h('button', {
          type: 'button', class: 'tool-cell', 'aria-pressed': String(t.id === mgr.current.id), title: t.hint,
          on: { click: () => { mgr.select(t.id); close(); } },
        }, h('span', { class: 'tc-icon', html: t.icon }), h('span', { class: 'tc-label' }, t.label)))));
    }));
  }

  /** Las propiedades de la herramienta en una hoja (se reutiliza la barra de propiedades). */
  openSettings() {
    const { props, propsHome, mgr } = this.d;
    if (!(mgr.current.props?.(mgr.ctx) ?? []).length) return;
    const holder = h('div', { class: 'props-sheet' });
    const close = openSheet(mgr.current.label, () => [holder]);
    holder.append(props.el);
    const title = holder.closest('.sheet')?.querySelector('h2');
    const off = mgr.on('tool', () => { if (title) title.textContent = mgr.current.label; });
    // Al cerrarse la hoja, la barra vuelve a su sitio.
    const mo = new MutationObserver(() => {
      if (holder.isConnected) return;
      mo.disconnect();
      off?.();
      propsHome.append(props.el);
    });
    mo.observe(document.body, { childList: true });
    return close;
  }
}
