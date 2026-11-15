import { h } from './dom';

export interface ModalAction<T> { label: string; value: T; kind?: 'primary' | 'danger' | 'ghost' }

/**
 * Diálogo modal accesible: título, cuerpo y botones. Devuelve el valor del
 * botón pulsado, o null si se cierra (Esc, Atrás de Android, clic fuera).
 */
export function modal<T>(o: { title: string; body?: (string | Node)[]; actions: ModalAction<T>[]; wide?: boolean; className?: string; onOpen?: (root: HTMLElement, close: (v: T | null) => void) => void }): Promise<T | null> {
  return new Promise(resolve => {
    const prev = document.activeElement as HTMLElement | null;
    let done = false;
    const close = (v: T | null) => {
      if (done) return;
      done = true;
      root.classList.add('closing');
      setTimeout(() => root.remove(), 140);
      prev?.focus?.();
      resolve(v);
    };
    const root = h('div', {
      class: `dialog-backdrop modal-backdrop${o.className ? ` ${o.className}` : ''}`,
      on: {
        keydown: (e: Event) => { e.stopPropagation(); if ((e as KeyboardEvent).key === 'Escape') close(null); },
        pointerdown: (e: Event) => { if (e.target === root) close(null); },
      },
    });
    const buttons = o.actions.map(a => h('button', { type: 'button', class: `btn${a.kind ? ` ${a.kind}` : ''}`, on: { click: () => close(a.value) } }, a.label));
    const dlg = h('div', { class: `dialog modal${o.wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title, tabindex: '-1' },
      h('h2', null, o.title),
      ...(o.body ?? []).map(b => (typeof b === 'string' ? h('p', { class: 'muted' }, b) : b)),
      h('div', { class: 'dialog-actions' }, ...buttons));
    root.append(dlg);
    document.body.append(root);
    o.onOpen?.(root, close);
    (dlg.querySelector('input, select, textarea') as HTMLElement | null ?? buttons.find((_, i) => o.actions[i].kind === 'primary') ?? dlg).focus();
  });
}

/** Pregunta un texto (renombrar, nueva carpeta…). */
export async function promptText(title: string, value: string, o: { label?: string; ok?: string; max?: number } = {}): Promise<string | null> {
  const input = h('input', { type: 'text', value, maxlength: String(o.max ?? 120), spellcheck: 'false', autocomplete: 'off', 'aria-label': o.label ?? title });
  const res = await modal<'ok'>({
    title, body: [h('label', { class: 'modal-field' }, h('span', null, o.label ?? 'Nombre'), input)],
    actions: [{ label: 'Cancelar', value: null as never, kind: 'ghost' }, { label: o.ok ?? 'Aceptar', value: 'ok', kind: 'primary' }],
    onOpen: (_root, close) => {
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); close('ok'); } });
      requestAnimationFrame(() => { input.focus(); input.select(); });
    },
  });
  const v = input.value.trim();
  return res === 'ok' && v ? v : null;
}

export const confirmDialog = async (title: string, text: string, ok: string, danger = false) =>
  (await modal({ title, body: [text], actions: [{ label: 'Cancelar', value: false, kind: 'ghost' }, { label: ok, value: true, kind: danger ? 'danger' : 'primary' }] })) === true;
