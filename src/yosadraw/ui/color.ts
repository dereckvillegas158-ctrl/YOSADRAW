/** Conversión de color HSV ↔ RGB ↔ hex. */
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
}
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max ? d / max : 0, max];
}
export const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
export function fromHex(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* ---------- Rueda de color y armonías ---------- */

export type WheelModel = 'ryb' | 'rgb';

/**
 * Las 12 posiciones de la rueda (en orden), con su papel: primario, secundario o terciario.
 * - Pintura (RYB, rueda de Itten): primarios rojo, amarillo y azul; secundarios naranja, verde y violeta.
 * - Luz (RGB, pantalla): primarios rojo, verde y azul; secundarios cian, magenta y amarillo.
 */
export const WHEELS: Record<WheelModel, { name: string; hex: string; role: 'primario' | 'secundario' | 'terciario' }[]> = {
  ryb: [
    { name: 'Rojo', hex: '#e32322', role: 'primario' }, { name: 'Rojo anaranjado', hex: '#ea621f', role: 'terciario' },
    { name: 'Naranja', hex: '#f18e1c', role: 'secundario' }, { name: 'Amarillo anaranjado', hex: '#fdc60b', role: 'terciario' },
    { name: 'Amarillo', hex: '#f4e500', role: 'primario' }, { name: 'Amarillo verdoso', hex: '#8cbb26', role: 'terciario' },
    { name: 'Verde', hex: '#008e5b', role: 'secundario' }, { name: 'Azul verdoso', hex: '#0696bb', role: 'terciario' },
    { name: 'Azul', hex: '#2a71b0', role: 'primario' }, { name: 'Azul violáceo', hex: '#444e99', role: 'terciario' },
    { name: 'Violeta', hex: '#6d398b', role: 'secundario' }, { name: 'Rojo violáceo', hex: '#c4037d', role: 'terciario' },
  ],
  rgb: [
    { name: 'Rojo', hex: '#ff0000', role: 'primario' }, { name: 'Naranja', hex: '#ff8000', role: 'terciario' },
    { name: 'Amarillo', hex: '#ffff00', role: 'secundario' }, { name: 'Lima', hex: '#80ff00', role: 'terciario' },
    { name: 'Verde', hex: '#00ff00', role: 'primario' }, { name: 'Verde primavera', hex: '#00ff80', role: 'terciario' },
    { name: 'Cian', hex: '#00ffff', role: 'secundario' }, { name: 'Azur', hex: '#0080ff', role: 'terciario' },
    { name: 'Azul', hex: '#0000ff', role: 'primario' }, { name: 'Violeta', hex: '#8000ff', role: 'terciario' },
    { name: 'Magenta', hex: '#ff00ff', role: 'secundario' }, { name: 'Rosa', hex: '#ff0080', role: 'terciario' },
  ],
};

/** Mezcla lineal de dos colores (t = 0 → a, 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const A = fromHex(a), B = fromHex(b);
  return toHex(...(A.map((v, i) => Math.round(v + (B[i] - v) * t)) as [number, number, number]));
}

/** Tono girado `deg` grados conservando saturación y brillo. */
export function rotateHue(hex: string, deg: number): string {
  const [h, s, v] = rgbToHsv(...fromHex(hex));
  return toHex(...hsvToRgb((h + deg + 360) % 360, s, v));
}

export interface Harmony { id: string; name: string; colors: string[] }
/** Armonías clásicas a partir de un color (incluido el propio color, primero). */
export function harmonies(hex: string): Harmony[] {
  const [h, s, v] = rgbToHsv(...fromHex(hex));
  const at = (dh: number, ss = s, vv = v) => toHex(...hsvToRgb((h + dh + 360) % 360, Math.min(1, Math.max(0, ss)), Math.min(1, Math.max(0, vv))));
  return [
    { id: 'comp', name: 'Complementario', colors: [hex, at(180)] },
    { id: 'split', name: 'Complementarios divididos', colors: [hex, at(150), at(210)] },
    { id: 'ana', name: 'Análogos', colors: [at(-60), at(-30), hex, at(30), at(60)] },
    { id: 'tri', name: 'Tríada', colors: [hex, at(120), at(240)] },
    { id: 'tet', name: 'Tétrada', colors: [hex, at(90), at(180), at(270)] },
    { id: 'mono', name: 'Monocromático', colors: [at(0, s, v * 0.35), at(0, s, v * 0.65), hex, at(0, s * 0.6, Math.min(1, v * 1.15)), at(0, s * 0.3, Math.min(1, v * 1.3))] },
    { id: 'shades', name: 'Luces y sombras', colors: [mix(hex, '#000000', 0.6), mix(hex, '#000000', 0.3), hex, mix(hex, '#ffffff', 0.35), mix(hex, '#ffffff', 0.7)] },
  ];
}

export const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
