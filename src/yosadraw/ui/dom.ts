import { desktopBridge } from '../brush/storage';

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown> & { class?: string; on?: Record<string, EventListener>; style?: Record<string, string>; dataset?: Record<string, string> };

/** Crea un elemento con atributos, eventos e hijos. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'on') for (const [ev, fn] of Object.entries(v as Record<string, EventListener>)) el.addEventListener(ev, fn);
      else if (k === 'style') for (const [sk, sv] of Object.entries(v as Record<string, string>)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv); else (el.style as unknown as Record<string, string>)[sk] = sv;
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = String(v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden') (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

let toastHost: HTMLElement | null = null;
/** Aviso breve no bloqueante. */
export function toast(message: string, kind: 'info' | 'ok' | 'error' = 'info', action?: { label: string; run: () => void }) {
  if (!toastHost) { toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toastHost); }
  const close = () => { t.classList.add('out'); setTimeout(() => t.remove(), 300); };
  const t = h('div', { class: `toast ${kind}${action ? ' with-action' : ''}` }, h('span', null, message),
    action ? h('button', { type: 'button', class: 'btn sm', on: { click: () => { action.run(); close(); } } }, action.label) : null);
  toastHost.append(t);
  setTimeout(close, action ? 9000 : kind === 'error' ? 6000 : 2600);
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/** Selector de archivos del sistema. */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise(resolve => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } }) as HTMLInputElement;
    input.multiple = multiple;
    input.addEventListener('change', () => { resolve([...(input.files ?? [])]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

/** true cuando la build es la vista previa publicada (sin descargas). */
export const IS_ARTIFACT = import.meta.env.VITE_TARGET === 'artifact';

/**
 * Guarda un archivo de texto: diálogo nativo en la app de escritorio,
 * descarga en el navegador. Devuelve false si no se pudo (o se canceló).
 */
export async function saveTextFile(name: string, text: string): Promise<boolean> {
  const bridge = desktopBridge();
  if (bridge) return bridge.exportFile(name, text);
  if (IS_ARTIFACT) return false;
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/** Lee archivos de texto: diálogo nativo en escritorio o selector del navegador. */
export async function openTextFiles(accept: string): Promise<{ name: string; content: string }[]> {
  const bridge = desktopBridge();
  if (bridge) return bridge.importFiles();
  const files = await pickFiles(accept, true);
  return Promise.all(files.map(async f => ({ name: f.name, content: await f.text() })));
}

export const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'pincel';
