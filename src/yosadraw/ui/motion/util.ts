import { contextMenu } from '../anim/Timeline';
import { h } from '../dom';
import { isPhone, openSheet } from '../Mobile';

/** Código de tiempo h:mm:ss:ff (o mm:ss:ff si dura menos de una hora). */
export function fmtTC(t: number, fps: number): string {
  const f = Math.round(Math.max(0, t) * fps);
  const fr = Math.round(fps) || 1;
  const ff = f % fr, s = Math.floor(f / fr), ss = s % 60, mm = Math.floor(s / 60) % 60, hh = Math.floor(s / 3600);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${hh ? `${hh}:` : ''}${p(mm)}:${p(ss)}:${p(ff)}`;
}

/** Duración legible: 4,2 s · 1:05 min. */
export function fmtDur(s: number): string {
  if (!Number.isFinite(s)) return '–';
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1).replace('.', ',')} s`;
  const m = Math.floor(s / 60), x = Math.round(s % 60);
  return `${m}:${String(x).padStart(2, '0')} min`;
}

export const fmtSize = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);


export type MenuItem = { label: string; run: () => void; disabled?: boolean; danger?: boolean } | null;
/** Menú de acciones: contextual en PC, hoja inferior en el teléfono. */
export function menu(x: number, y: number, title: string, items: MenuItem[]) {
  if (isPhone()) {
    const list = items.filter((i): i is NonNullable<MenuItem> => !!i && !i.disabled);
    openSheet(title, close => [h('div', { class: 'action-list' }, ...list.map(it => h('button', { type: 'button', class: `action-item${it.danger ? ' danger' : ''}`, on: { click: () => { close(); it.run(); } } }, it.label)))]);
    return;
  }
  contextMenu(x, y, items);
}
