import type { BrushLibrary } from '../brush/BrushLibrary';
import type { ToolManager } from '../tools/ToolManager';
import type { Prop } from '../tools/types';
import { h } from './dom';
import type { Thumbnails } from './thumbnails';

let uid = 0;
const fmt = (v: number, unit = '', display = 1) => {
  const x = v * display;
  const s = Math.abs(x) >= 100 || Number.isInteger(x) ? String(Math.round(x)) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2).replace(/\.?0+$/, '');
  return `${s}${unit === 'px' ? ' px' : unit}`;
};

/**
 * Panel de propiedades contextual: muestra los ajustes de la herramienta
 * activa. Se genera a partir de la lista `props()` de cada herramienta.
 */
export class PropertiesBar {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private title: HTMLElement;
  private popover: HTMLElement | null = null;
  private req = 0;

  constructor(private mgr: ToolManager, private lib: BrushLibrary, private thumbs: Thumbnails) {
    this.title = h('div', { class: 'props-title' });
    this.body = h('div', { class: 'props-body' });
    this.el = h('div', { class: 'propsbar', role: 'toolbar', 'aria-label': 'Propiedades de la herramienta' }, this.title, this.body);
    mgr.on('tool', () => this.render());
    mgr.on('props', () => this.schedule());
    mgr.on('colors', () => this.schedule());
    document.addEventListener('pointerdown', e => { if (this.popover && !this.popover.contains(e.target as Node) && !(e.target as HTMLElement).closest('.preset-btn')) this.closePopover(); }, true);
    this.render();
  }

  /** Repinta en el siguiente fotograma salvo que el usuario esté arrastrando un control. */
  private schedule() {
    if (this.req) return;
    this.req = requestAnimationFrame(() => {
      this.req = 0;
      const a = document.activeElement as HTMLElement | null;
      if (a && this.body.contains(a) && (a as HTMLInputElement).type === 'range' && a.matches(':active')) return;
      this.render();
    });
  }

  render() {
    const t = this.mgr.current;
    this.title.innerHTML = `${t.icon}<span>${t.label}</span>`;
    this.title.title = t.hint;
    const props = t.props?.(this.mgr.ctx) ?? [{ type: 'note', text: t.hint } as Prop];
    const focusLabel = (document.activeElement as HTMLElement | null)?.closest?.('[data-prop]')?.getAttribute('data-prop');
    this.body.replaceChildren(...props.map((p, i) => this.control(p, i)));
    if (focusLabel) (this.body.querySelector(`[data-prop="${CSS.escape(focusLabel)}"] input, [data-prop="${CSS.escape(focusLabel)}"] select, [data-prop="${CSS.escape(focusLabel)}"] button`) as HTMLElement | null)?.focus();
  }

  private control(p: Prop, i: number): HTMLElement {
    const key = 'label' in p && p.label ? p.label : `${p.type}-${i}`;
    const id = `prop-${++uid}`;
    switch (p.type) {
      case 'slider': {
        const LOG = 1000, display = p.display ?? 1;
        const toS = (v: number) => p.log ? Math.round((Math.log(v / p.min) / Math.log(p.max / p.min)) * LOG) : v;
        const fromS = (s: number) => p.log ? p.min * Math.pow(p.max / p.min, s / LOG) : s;
        const step = p.step ?? 1;
        const q = (v: number) => Math.min(p.max, Math.max(p.min, Math.round(v / step) * step));
        const range = h('input', { type: 'range', id, min: String(p.log ? 0 : p.min), max: String(p.log ? LOG : p.max), step: p.log ? '1' : String(step), value: String(toS(p.value)) });
        const out = h('output', { for: id }, fmt(p.value, p.unit, display));
        const fill = () => range.style.setProperty('--fill', `${((Number(range.value) - Number(range.min)) / (Number(range.max) - Number(range.min))) * 100}%`);
        fill();
        range.addEventListener('input', () => { const v = q(fromS(Number(range.value))); out.textContent = fmt(v, p.unit, display); fill(); p.onInput(v); });
        range.addEventListener('change', () => { const v = q(fromS(Number(range.value))); p.onChange?.(v); });
        return h('label', { class: 'prop slider', for: id, dataset: { prop: key } }, h('span', null, p.label), range, out);
      }
      case 'select':
        return h('label', { class: 'prop', for: id, dataset: { prop: key } }, h('span', null, p.label),
          h('select', { id, on: { change: (e: Event) => p.onChange((e.target as HTMLSelectElement).value) } }, ...p.options.map(o => h('option', { value: o.value, selected: o.value === p.value ? 'selected' : null }, o.label))));
      case 'segmented':
        return h('div', { class: 'prop', role: 'radiogroup', 'aria-label': p.label ?? 'Opciones', dataset: { prop: key } },
          p.label ? h('span', null, p.label) : null,
          h('div', { class: 'segmented compact' }, ...p.options.map(o => h('button', {
            type: 'button', role: 'radio', 'aria-checked': String(o.value === p.value), title: o.label, 'aria-label': o.label,
            class: o.icon ? 'with-icon' : '', html: o.icon ?? '', on: { click: () => p.onChange(o.value) },
          }, o.icon ? null : o.label))));
      case 'toggle': {
        const input = h('input', { type: 'checkbox', id, checked: p.value, on: { change: (e: Event) => p.onChange((e.target as HTMLInputElement).checked) } });
        return h('label', { class: 'prop switch', for: id, dataset: { prop: key } }, input, h('span', { class: 'track', 'aria-hidden': 'true' }), h('span', null, p.label));
      }
      case 'button':
        return h('button', { type: 'button', class: `btn sm${p.primary ? ' primary' : ' ghost'}`, disabled: !!p.disabled, title: p.title ?? '', dataset: { prop: key }, html: p.icon ?? '', on: { click: () => p.onClick() } }, p.label);
      case 'note':
        return h('span', { class: 'prop-note' }, p.text);
      case 'sep':
        return h('span', { class: 'prop-sep', 'aria-hidden': 'true' });
      case 'preset': {
        const pr = this.lib.activeFor(p.slot, p.categories);
        const btn = h('button', { type: 'button', class: 'preset-btn', 'aria-haspopup': 'listbox', title: 'Elegir pincel', dataset: { prop: 'preset' }, on: { click: () => this.openPresets(btn, p.slot, p.categories) } },
          h('span', { class: 'thumb' }, this.thumbs.stroke(pr, this.mgr.colors.primary, 92, 26)), h('span', { class: 'preset-name' }, pr.name), h('span', { 'aria-hidden': 'true' }, '▾'));
        return btn;
      }
    }
  }

  private closePopover() { this.popover?.remove(); this.popover = null; }

  private openPresets(anchor: HTMLElement, slot: string, cats: string[]) {
    if (this.popover) { this.closePopover(); return; }
    let all = false;
    const list = h('ul', { class: 'brush-list', role: 'listbox', 'aria-label': 'Pinceles' });
    const fill = () => {
      const active = this.lib.activeId(slot);
      const items = this.lib.presets.filter(x => all || cats.includes(x.category));
      list.replaceChildren(...items.map(x => h('li', {
        class: 'brush-item compact', role: 'option', tabindex: '0', 'aria-selected': String(x.id === active),
        on: {
          click: () => { this.lib.setActive(slot, x.id); this.closePopover(); },
          keydown: (e: Event) => { if ((e as KeyboardEvent).key === 'Enter') { this.lib.setActive(slot, x.id); this.closePopover(); } },
        },
      }, h('span', { class: 'thumb' }, this.thumbs.stroke(x, this.mgr.colors.primary, 120, 32)), h('span', { class: 'brush-meta' }, h('span', { class: 'brush-name' }, x.name), h('span', { class: 'brush-cat' }, x.category)))));
    };
    const toggle = h('button', { type: 'button', class: 'link', on: { click: () => { all = !all; toggle.textContent = all ? `Sólo ${cats.join(' y ')}` : 'Ver todos los pinceles'; fill(); } } }, 'Ver todos los pinceles');
    fill();
    const pop = h('div', { class: 'popover', role: 'dialog', 'aria-label': 'Pinceles', on: { keydown: (e: Event) => { if ((e as KeyboardEvent).key === 'Escape') { this.closePopover(); anchor.focus(); } } } },
      h('div', { class: 'row' }, h('strong', null, cats.join(' · ')), toggle), list);
    document.body.append(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(window.innerWidth - 300, r.left))}px`;
    pop.style.top = `${r.bottom + 6}px`;
    this.popover = pop;
    (list.querySelector('[aria-selected="true"]') as HTMLElement | null)?.focus();
  }
}
