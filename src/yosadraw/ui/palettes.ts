import { fromHex, isHex, toHex } from './color';

export interface Palette { id: string; name: string; colors: string[]; builtin?: boolean }

export const MAX_PALETTES = 60;
export const MAX_COLORS = 256;

/** Paleta de siempre (la que tenía el panel de color): se puede copiar, no borrar. */
export const DEFAULT_PALETTE: Palette = {
  id: 'yosadraw', name: 'YOSADRAW', builtin: true,
  colors: ['#1b1530', '#4b4366', '#8b84a3', '#f4f1fb', '#ffffff', '#9d6bff', '#5b8cff', '#2fb7a3', '#5fae4a', '#f2c84b', '#f08a3c', '#e2445c', '#b8336a', '#7a4b33', '#d9b38c', '#2b2f6e'],
};
export const BUILTIN_PALETTES: Palette[] = [
  DEFAULT_PALETTE,
  { id: 'skin', name: 'Pieles', builtin: true, colors: ['#ffe0d0', '#f8cbb0', '#eab394', '#d99a78', '#c68460', '#a8694a', '#8a5238', '#6b3d2a', '#4e2c1f', '#33201a'] },
  { id: 'grays', name: 'Grises', builtin: true, colors: ['#000000', '#1c1c1c', '#383838', '#555555', '#717171', '#8e8e8e', '#aaaaaa', '#c6c6c6', '#e3e3e3', '#ffffff'] },
  { id: 'pastel', name: 'Pastel', builtin: true, colors: ['#ffb3ba', '#ffdfba', '#ffffba', '#baffc9', '#bae1ff', '#d5baff', '#ffc6e8', '#c9f2ef'] },
];

export interface PalettePrefs { palettes: Palette[]; active: string; mode: 'square' | 'wheel' | 'values' | 'harmony'; wheel: 'ryb' | 'rgb' }
export const DEFAULT_PALETTE_PREFS: PalettePrefs = { palettes: [], active: 'yosadraw', mode: 'square', wheel: 'ryb' };

let n = 0;
export const paletteId = () => `pal${Date.now().toString(36)}${(n++).toString(36)}`;

export function normalizePalettePrefs(v: unknown): PalettePrefs {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<PalettePrefs>;
  const palettes = (Array.isArray(o.palettes) ? o.palettes : []).filter(p => p && typeof p === 'object' && typeof p.id === 'string' && !BUILTIN_PALETTES.some(b => b.id === p.id))
    .slice(0, MAX_PALETTES).map(p => ({ id: p.id, name: String(p.name ?? 'Paleta').slice(0, 60) || 'Paleta', colors: (Array.isArray(p.colors) ? p.colors : []).filter(isHex).map(c => c.toLowerCase()).slice(0, MAX_COLORS) }));
  const all = [...BUILTIN_PALETTES, ...palettes];
  return {
    palettes,
    active: typeof o.active === 'string' && all.some(p => p.id === o.active) ? o.active : 'yosadraw',
    mode: o.mode === 'wheel' || o.mode === 'values' || o.mode === 'harmony' ? o.mode : 'square',
    wheel: o.wheel === 'rgb' ? 'rgb' : 'ryb',
  };
}

/** Lee una paleta GIMP (.gpl, también la usan Krita e Inkscape), JSON de YOSADRAW o una lista de colores hex. */
export function parsePalette(text: string, fileName = 'Paleta'): Palette {
  const base = fileName.replace(/\.[^.]+$/, '').slice(0, 60) || 'Paleta';
  const t = text.replace(/^﻿/, '').trim();
  if (t.startsWith('{')) {
    let j: { name?: unknown; colors?: unknown };
    try { j = JSON.parse(t); } catch { throw new Error('JSON de paleta dañado'); }
    const colors = (Array.isArray(j.colors) ? j.colors : []).filter(isHex).map(c => c.toLowerCase());
    if (!colors.length) throw new Error('La paleta no tiene colores');
    return { id: paletteId(), name: typeof j.name === 'string' && j.name.trim() ? j.name.trim().slice(0, 60) : base, colors: colors.slice(0, MAX_COLORS) };
  }
  let name = base;
  const colors: string[] = [];
  for (const raw of t.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') && !/^#[0-9a-f]{6}\b/i.test(line)) continue;
    if (/^GIMP Palette/i.test(line) || /^Columns:/i.test(line)) continue;
    const nm = /^Name:\s*(.+)$/i.exec(line);
    if (nm) { name = nm[1].trim().slice(0, 60) || name; continue; }
    const rgb = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\b/.exec(line);
    if (rgb) { colors.push(toHex(+rgb[1], +rgb[2], +rgb[3])); continue; }
    for (const m of line.matchAll(/#?([0-9a-f]{6})\b/gi)) colors.push(`#${m[1].toLowerCase()}`);
  }
  if (!colors.length) throw new Error('No se encontraron colores (usa .gpl, .json o una lista de colores #rrggbb)');
  return { id: paletteId(), name, colors: colors.slice(0, MAX_COLORS) };
}

/** Paleta en formato GIMP (.gpl). */
export function toGpl(p: Palette): string {
  const lines = ['GIMP Palette', `Name: ${p.name}`, `Columns: ${Math.min(16, Math.max(1, p.colors.length))}`, '#'];
  for (const c of p.colors) { const [r, g, b] = fromHex(c); lines.push(`${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t${c}`); }
  return `${lines.join('\n')}\n`;
}
