import { comboFromEvent, comboLabel } from '../tools/keymap';
import type { ToolManager } from '../tools/ToolManager';
import { CATEGORIES } from '../tools/types';
import { h, toast } from './dom';
import { DEFAULT_LAYOUT, orderedTools, type ToolbarLayout } from './Toolbar';

function modal(title: string, body: HTMLElement[], onClose?: () => void): { root: HTMLElement; close: () => void } {
  const ret = document.activeElement as HTMLElement | null;
  const close = () => { root.remove(); onClose?.(); ret?.focus?.(); };
  const titleId = `dlg-${Math.random().toString(36).slice(2, 8)}`;
  const root = h('div', { class: 'dialog-backdrop', on: { keydown: (e: Event) => { e.stopPropagation(); if ((e as KeyboardEvent).key === 'Escape' && !root.dataset.capturing) close(); }, pointerdown: (e: Event) => { if (e.target === root) close(); } } },
    h('div', { class: 'dialog wide', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('div', { class: 'dialog-head' }, h('h2', { id: titleId }, title), h('button', { type: 'button', class: 'btn ghost sm', on: { click: close } }, 'Cerrar')),
      ...body));
  document.body.append(root);
  return { root, close };
}

/** Editor de atajos: pulsar "Cambiar" y la combinación deseada. */
export function openShortcuts(mgr: ToolManager, onSave: () => void) {
  const search = h('input', { type: 'search', placeholder: 'Buscar herramienta o acción', 'aria-label': 'Buscar', class: 'search' });
  const list = h('div', { class: 'keys-list' });
  const rows: { id: string; label: string; group: string }[] = [
    ...mgr.tools.map(t => ({ id: `tool:${t.id}`, label: t.label, group: `Herramientas · ${CATEGORIES.find(c => c.id === t.category)!.label}` })),
    ...mgr.actions.map(a => ({ id: `action:${a.id}`, label: a.label, group: a.group })),
  ];
  let capturing: string | null = null;
  const render = () => {
    const q = search.value.trim().toLowerCase();
    const groups = new Map<string, HTMLElement[]>();
    for (const r of rows) {
      if (q && !r.label.toLowerCase().includes(q) && !r.group.toLowerCase().includes(q)) continue;
      const combos = mgr.keymap.get(r.id);
      const keys = capturing === r.id ? h('span', { class: 'capture' }, 'Pulsa la combinación… (Esc cancela)')
        : combos.length ? h('span', { class: 'kbds' }, ...combos.map(c => h('kbd', null, comboLabel(c)))) : h('span', { class: 'muted' }, 'Sin atajo');
      const row = h('div', { class: 'key-row' },
        h('span', null, r.label, mgr.keymap.isCustom(r.id) ? h('span', { class: 'badge' }, 'personalizado') : null), keys,
        h('div', { class: 'key-actions' },
          h('button', { type: 'button', class: 'btn sm', on: { click: () => { capturing = r.id; root.dataset.capturing = '1'; render(); } } }, 'Cambiar'),
          h('button', { type: 'button', class: 'btn ghost sm', disabled: !combos.length, on: { click: () => { mgr.keymap.set(r.id, null); changed(); } } }, 'Quitar'),
          mgr.keymap.isCustom(r.id) ? h('button', { type: 'button', class: 'btn ghost sm', on: { click: () => { mgr.keymap.reset(r.id); changed(); } } }, 'Restablecer') : null));
      (groups.get(r.group) ?? groups.set(r.group, []).get(r.group)!).push(row);
    }
    list.replaceChildren(...[...groups].map(([g, els]) => h('section', null, h('h3', null, g), ...els)));
  };
  const changed = () => { mgr.keymapChanged(); onSave(); render(); };
  const onKey = (e: KeyboardEvent) => {
    if (!capturing) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { capturing = null; delete root.dataset.capturing; render(); return; }
    const combo = comboFromEvent({ key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey, altGraph: e.getModifierState?.('AltGraph') });
    if (!combo) return;
    if (combo === 'Space') { toast('Espacio está reservado para mover el lienzo'); return; }
    const taken = mgr.keymap.set(capturing, combo);
    const names = taken.map(id => rows.find(r => r.id === id)?.label).filter(Boolean);
    if (names.length) toast(`${comboLabel(combo)} se ha quitado de: ${names.join(', ')}`);
    capturing = null; delete root.dataset.capturing;
    changed();
  };
  search.addEventListener('input', render);
  const { root } = modal('Atajos de teclado', [
    h('div', { class: 'row' }, search, h('button', { type: 'button', class: 'btn ghost sm', on: { click: () => { mgr.keymap.reset(); changed(); toast('Atajos restablecidos', 'ok'); } } }, 'Restablecer todo')),
    list,
  ], () => window.removeEventListener('keydown', onKey, true));
  window.addEventListener('keydown', onKey, true);
  render();
  search.focus();
}

/** Personalizar la barra: lado, etiquetas, herramientas visibles y orden. */
export function openCustomize(mgr: ToolManager, layout: ToolbarLayout, apply: (l: ToolbarLayout) => void) {
  let L: ToolbarLayout = JSON.parse(JSON.stringify(layout));
  const body = h('div', { class: 'customize' });
  const commit = () => { apply(L); render(); };
  const render = () => {
    const sections = CATEGORIES.map(cat => {
      const tools = orderedTools(mgr, L, cat.id);
      return h('section', null, h('h3', null, cat.label), ...tools.map((t, i) => {
        const id = `vis-${t.id}`;
        const move = (d: number) => {
          const ids = tools.map(x => x.id);
          const j = i + d;
          if (j < 0 || j >= ids.length) return;
          [ids[i], ids[j]] = [ids[j], ids[i]];
          L = { ...L, order: { ...L.order, [cat.id]: ids } };
          commit();
        };
        return h('div', { class: 'cust-row' },
          h('input', { type: 'checkbox', id, checked: !L.hidden.includes(t.id), on: { change: (e: Event) => {
            const on = (e.target as HTMLInputElement).checked;
            L = { ...L, hidden: on ? L.hidden.filter(x => x !== t.id) : [...L.hidden, t.id] };
            commit();
          } } }),
          h('label', { for: id, html: `${t.icon}<span>${t.label}</span>` }),
          h('button', { type: 'button', class: 'icon sm', 'aria-label': `Subir ${t.label}`, disabled: i === 0, on: { click: () => move(-1) } }, '↑'),
          h('button', { type: 'button', class: 'icon sm', 'aria-label': `Bajar ${t.label}`, disabled: i === tools.length - 1, on: { click: () => move(1) } }, '↓'));
      }));
    });
    body.replaceChildren(
      h('div', { class: 'cust-top' },
        h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Posición de la barra' },
          ...(['left', 'right'] as const).map(s => h('button', { type: 'button', role: 'radio', 'aria-checked': String(L.side === s), on: { click: () => { L = { ...L, side: s }; commit(); } } }, s === 'left' ? 'Barra a la izquierda' : 'Barra a la derecha'))),
        h('label', { class: 'switch', for: 'cust-labels' },
          h('input', { type: 'checkbox', id: 'cust-labels', checked: L.labels, on: { change: (e: Event) => { L = { ...L, labels: (e.target as HTMLInputElement).checked }; commit(); } } }),
          h('span', { class: 'track', 'aria-hidden': 'true' }), h('span', null, 'Mostrar nombres')),
        h('button', { type: 'button', class: 'btn ghost sm', on: { click: () => { L = JSON.parse(JSON.stringify(DEFAULT_LAYOUT)); commit(); } } }, 'Restablecer')),
      h('div', { class: 'cust-grid' }, ...sections));
  };
  render();
  modal('Personalizar barra de herramientas', [h('p', { class: 'muted' }, 'Los cambios se aplican y se guardan al momento. Las herramientas ocultas siguen disponibles con su atajo.'), body]);
}
