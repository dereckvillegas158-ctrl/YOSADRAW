import type { Mat3, Scene3, Studio3 } from './model';

export type Shading = 'solid' | 'wire' | 'material' | 'render';

/** Preferencias del editor 3D (de la app, no del proyecto). */
export interface Prefs3 {
  shading: Shading; leftW: number; rightW: number; tlH: number; assistant: boolean; tutorialSeen: boolean; autoKey: boolean;
  favMats: Mat3[];
  templates: { id: string; name: string; scene: Scene3; materials: Mat3[]; textures: Studio3['textures'] }[];
  render: { format: 'png' | 'mp4' | 'gif' };
}
export function normalizePrefs3(v: unknown): Prefs3 {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const n = (x: unknown, d: number, lo: number, hi: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d);
  return {
    shading: (['solid', 'wire', 'material', 'render'] as unknown[]).includes(o.shading) ? o.shading as Shading : 'material',
    leftW: n(o.leftW, 250, 180, 480), rightW: n(o.rightW, 300, 240, 520), tlH: n(o.tlH, 170, 90, 600),
    assistant: o.assistant !== false, tutorialSeen: o.tutorialSeen === true, autoKey: o.autoKey === true,
    favMats: Array.isArray(o.favMats) ? o.favMats as Mat3[] : [],
    templates: Array.isArray(o.templates) ? o.templates as Prefs3['templates'] : [],
    render: { format: 'png', ...(o.render && typeof o.render === 'object' ? o.render as object : {}) },
  };
}

