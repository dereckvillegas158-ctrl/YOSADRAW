/**
 * Atajos de teclado configurables (lógica pura).
 *
 * Formato de combinación: "Ctrl+Shift+Z", "Alt+Backspace", "[", "Shift+M".
 * - Letras y dígitos se leen por tecla física (e.code), así Mayús o AltGr no
 *   cambian la letra.
 * - Símbolos ("[", "+", "-") se leen por el carácter producido (e.key), que
 *   respeta la distribución del teclado (en español "+" tiene tecla propia).
 */
export interface KeyLike { key: string; code?: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; altGraph?: boolean }

const NAMED: Record<string, string> = {
  ' ': 'Space', Escape: 'Escape', Enter: 'Enter', Backspace: 'Backspace', Delete: 'Delete', Tab: 'Tab',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
};

export function comboFromEvent(e: KeyLike): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Dead'].includes(e.key)) return null;
  const ctrl = (e.ctrlKey || e.metaKey) && !e.altGraph, alt = e.altKey && !e.altGraph;
  let key: string, shiftCounts = true;
  if (e.code && /^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (e.code && /^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (NAMED[e.key]) key = NAMED[e.key];
  else if (/^F\d{1,2}$/.test(e.key)) key = e.key;
  else if (e.key.length === 1) { key = e.key.toUpperCase(); shiftCounts = false; } // el carácter ya incluye Mayús
  else return null;
  return [ctrl && 'Ctrl', alt && 'Alt', e.shiftKey && shiftCounts && 'Shift', key].filter(Boolean).join('+');
}

/** Normaliza lo que escriba el usuario: "shift + ctrl + z" → "Ctrl+Shift+Z". */
export function normalizeCombo(s: string): string {
  const parts = s.split('+').map(p => p.trim()).filter(Boolean);
  // "+" como tecla: "+" o "Ctrl++".
  const key = s.trim() === '+' || s.trim().endsWith('++') ? '+' : (parts.pop() ?? '');
  const mods = new Set(parts.map(p => p.toLowerCase()));
  const k = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1);
  return [(mods.has('ctrl') || mods.has('cmd') || mods.has('control')) && 'Ctrl', mods.has('alt') && 'Alt', mods.has('shift') && 'Shift', k].filter(Boolean).join('+');
}

/** Texto para mostrar al usuario. */
export const comboLabel = (c: string) => c.replace(/Ctrl/g, 'Ctrl').replace(/Shift/g, 'Mayús').replace(/Backspace/g, 'Retroceso').replace(/Delete/g, 'Supr').replace(/Escape/g, 'Esc').replace(/Space/g, 'Espacio');

export class Keymap {
  private overrides: Record<string, string[]> = {};
  constructor(private defaults: Record<string, string[]>) {}

  get(id: string): string[] { return this.overrides[id] ?? this.defaults[id] ?? []; }
  isCustom(id: string) { return id in this.overrides; }

  /** Asigna una combinación y devuelve las acciones que la tenían (se les quita). */
  set(id: string, combo: string | null): string[] {
    const taken: string[] = [];
    if (combo) {
      const c = normalizeCombo(combo);
      for (const other of this.ids()) {
        if (other === id || !this.get(other).includes(c)) continue;
        this.overrides[other] = this.get(other).filter(x => x !== c);
        taken.push(other);
      }
      this.overrides[id] = [c];
    } else this.overrides[id] = [];
    return taken;
  }

  reset(id?: string) { if (id) delete this.overrides[id]; else this.overrides = {}; }

  /** Acción asignada a la combinación. */
  find(combo: string): string | undefined {
    for (const id of this.ids()) if (this.get(id).includes(combo)) return id;
    return undefined;
  }

  ids() { return [...new Set([...Object.keys(this.defaults), ...Object.keys(this.overrides)])]; }
  toJSON() { return { ...this.overrides }; }
  load(data: unknown) {
    if (!data || typeof data !== 'object') return;
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (k in this.defaults && Array.isArray(v) && v.every(x => typeof x === 'string')) this.overrides[k] = v.map(normalizeCombo);
    }
  }
}
