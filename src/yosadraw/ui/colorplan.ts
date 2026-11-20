import { fromHex, hsvToRgb, rgbToHsv, toHex, type WheelModel } from './color';
import type { LayerBlend } from '../doc/items';

/**
 * Armonías de color con papeles y proporciones, y colores calculados para usar
 * capas con modo de fusión (sombras con Multiplicar, luces con Trama…). Todo se
 * calcula con las fórmulas reales de cada modo (las mismas que usa el lienzo), así
 * el color que se propone para la capa produce exactamente el resultado indicado.
 */

// ---------------------------------------------------------------- rueda de pintor (RYB)

/** Correspondencia de tonos rueda de pintor (RYB) ↔ luz (RGB), en grados. */
const RYB_RGB: [number, number][] = [[0, 0], [60, 30], [120, 60], [180, 120], [240, 225], [300, 275], [360, 360]];
function interp(x: number, a: 0 | 1, b: 0 | 1) {
  x = ((x % 360) + 360) % 360;
  for (let i = 1; i < RYB_RGB.length; i++) {
    const p = RYB_RGB[i - 1], q = RYB_RGB[i];
    if (x <= q[a]) return p[b] + ((x - p[a]) / (q[a] - p[a] || 1)) * (q[b] - p[b]);
  }
  return x;
}
export const rgbHueToRyb = (h: number) => interp(h, 1, 0);
export const rybHueToRgb = (h: number) => interp(h, 0, 1);

/** Gira el tono `deg` grados en la rueda elegida (en la de pintor, el complementario del rojo es el verde). */
export function rotate(hex: string, deg: number, model: WheelModel, s?: number, v?: number): string {
  const [h, s0, v0] = rgbToHsv(...fromHex(hex));
  const nh = model === 'ryb' ? rybHueToRgb(rgbHueToRyb(h) + deg) : (h + deg + 360) % 360;
  return toHex(...hsvToRgb(nh, clamp01(s ?? s0), clamp01(v ?? v0)));
}
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const mixHex = (a: string, b: string, t: number) => { const A = fromHex(a), B = fromHex(b); return toHex(...(A.map((x, i) => Math.round(x + (B[i] - x) * t)) as [number, number, number])); };

// ---------------------------------------------------------------- esquemas

export type SchemeId = 'comp' | 'split' | 'ana' | 'tri' | 'tet' | 'mono' | 'shades';
export interface SchemeColor { hex: string; role: string; share: number }
export interface Scheme { id: SchemeId; name: string; colors: SchemeColor[]; tips: string[] }

export const SCHEMES: { id: SchemeId; name: string }[] = [
  { id: 'comp', name: 'Complementario' }, { id: 'split', name: 'Divididos' }, { id: 'ana', name: 'Análogos' },
  { id: 'tri', name: 'Tríada' }, { id: 'tet', name: 'Tétrada' }, { id: 'mono', name: 'Monocromático' }, { id: 'shades', name: 'Luces y sombras' },
];

/**
 * Esquema a partir del color base: colores con su papel y la proporción de la
 * imagen que conviene darles (regla 60-30-10 y variantes), con consejos de uso.
 */
export function scheme(hex: string, id: SchemeId, model: WheelModel): Scheme {
  const [, s, v] = rgbToHsv(...fromHex(hex));
  const r = (deg: number, ss?: number, vv?: number) => rotate(hex, deg, model, ss, vv);
  // Variante apagada (para fondos amplios sin competir con el color base).
  const muted = (c: string) => { const [hh, ss, vv] = rgbToHsv(...fromHex(c)); return toHex(...hsvToRgb(hh, ss * 0.45, Math.min(1, vv * 0.9 + 0.05))); };
  const name = SCHEMES.find(x => x.id === id)!.name;
  switch (id) {
    case 'comp': {
      const c = r(180);
      return { id, name, colors: [{ hex, role: 'Dominante', share: 60 }, { hex: mixHex(hex, c, 0.35), role: 'Secundario (base neutralizado)', share: 30 }, { hex: c, role: 'Acento', share: 10 }],
        tips: ['Contraste máximo: deja que el color base domine y usa el complementario sólo en lo que quieres que se mire primero.', 'Evita repartirlos a partes iguales: vibran y cansan la vista.', 'Mezclar un poco del complementario apaga el color base sin ensuciarlo (sombras naturales).'] };
    }
    case 'split': return { id, name, colors: [{ hex, role: 'Dominante', share: 60 }, { hex: r(150), role: 'Secundario', share: 30 }, { hex: r(210), role: 'Acento', share: 10 }],
      tips: ['Casi tanto contraste como el complementario, pero más fácil de equilibrar.', 'Buena opción para personajes: base en la ropa grande, secundario en detalles, acento en ojos o luces.'] };
    case 'ana': return { id, name, colors: [{ hex: r(-30), role: 'Apoyo', share: 15 }, { hex, role: 'Dominante', share: 60 }, { hex: r(30), role: 'Apoyo', share: 15 }, { hex: r(60, Math.min(1, s * 1.1)), role: 'Acento', share: 10 }],
      tips: ['Armonía tranquila y natural (paisajes, atmósferas).', 'Diferencia los colores con el valor (claro/oscuro): si todos tienen el mismo brillo la imagen se ve plana.', 'Añade un pequeño acento del lado opuesto de la rueda para dar un punto de interés.'] };
    case 'tri': return { id, name, colors: [{ hex, role: 'Dominante', share: 60 }, { hex: muted(r(120)), role: 'Secundario (apagado)', share: 30 }, { hex: r(240), role: 'Acento', share: 10 }],
      tips: ['Colorida y equilibrada; apaga los dos que no dominan para que no compitan.', 'Funciona muy bien en ilustración infantil y diseño gráfico.'] };
    case 'tet': return { id, name, colors: [{ hex, role: 'Dominante', share: 50 }, { hex: muted(r(90)), role: 'Secundario', share: 25 }, { hex: muted(r(180)), role: 'Terciario', share: 15 }, { hex: r(270), role: 'Acento', share: 10 }],
      tips: ['La más rica y la más difícil: elige uno que mande y baja la saturación del resto.', 'Mantén dos cálidos y dos fríos y reparte la temperatura con intención.'] };
    case 'mono': return { id, name, colors: [{ hex: r(0, s, v * 0.35), role: 'Sombra profunda', share: 15 }, { hex: r(0, s, v * 0.65), role: 'Sombra', share: 25 }, { hex, role: 'Medio (dominante)', share: 40 }, { hex: r(0, s * 0.6, Math.min(1, v * 1.15)), role: 'Luz', share: 15 }, { hex: r(0, s * 0.3, Math.min(1, v * 1.3)), role: 'Brillo', share: 5 }],
      tips: ['Un solo tono con distintos valores: elegante y coherente.', 'El contraste viene sólo del claro/oscuro: comprueba la imagen en blanco y negro.'] };
    case 'shades': return { id, name, colors: [
      { hex: shadowTarget(hex, 0.45), role: 'Sombra oscura', share: 15 }, { hex: shadowTarget(hex, 0.7), role: 'Sombra', share: 25 }, { hex, role: 'Color local', share: 40 },
      { hex: lightTarget(hex, 0.5), role: 'Luz', share: 15 }, { hex: lightTarget(hex, 1), role: 'Brillo', share: 5 }],
      tips: ['Sombras más frías y oscuras; luces más cálidas y algo menos saturadas: así se ven en la realidad (luz de sol, cielo azul).', 'No oscurezcas sólo con negro: apaga el color.'] };
  }
}

// ---------------------------------------------------------------- objetivos de luz y sombra

/** Sombra natural del color: más oscura, algo más saturada y desplazada hacia el azul-violeta (fría). */
export function shadowTarget(hex: string, k = 0.62): string {
  const [h, s, v] = rgbToHsv(...fromHex(hex));
  const toward = (from: number, to: number, t: number) => { let d = ((to - from + 540) % 360) - 180; return (from + d * t + 360) % 360; };
  return toHex(...hsvToRgb(toward(h, 250, 0.18 * (s > 0.05 ? 1 : 0)), clamp01(s * 1.12 + 0.04), clamp01(v * k)));
}
/** Luz natural: más clara, más cálida (hacia el amarillo) y algo menos saturada. */
export function lightTarget(hex: string, k = 0.6): string {
  const [h, s, v] = rgbToHsv(...fromHex(hex));
  const toward = (from: number, to: number, t: number) => { let d = ((to - from + 540) % 360) - 180; return (from + d * t + 360) % 360; };
  return toHex(...hsvToRgb(toward(h, 50, 0.15 * (s > 0.05 ? 1 : 0)), clamp01(s * (1 - 0.35 * k)), clamp01(v + (1 - v) * 0.85 * k + 0.08 * k)));
}

// ---------------------------------------------------------------- modos de fusión (W3C, por canal 0..1)

export type SuggestMode = Extract<LayerBlend, 'multiply' | 'screen' | 'overlay' | 'color-dodge' | 'soft-light'>;
const B: Record<SuggestMode, (b: number, s: number) => number> = {
  multiply: (b, s) => b * s,
  screen: (b, s) => b + s - b * s,
  overlay: (b, s) => (b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)),
  'color-dodge': (b, s) => (b === 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s))),
  'soft-light': (b, s) => {
    if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
    const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
    return b + (2 * s - 1) * (d - b);
  },
};
/** Resultado de pintar `layer` con ese modo sobre `base` (opacidad 100 %). */
export function blend(mode: SuggestMode, base: string, layer: string): string {
  const b = fromHex(base), s = fromHex(layer);
  return toHex(...(b.map((x, i) => Math.round(B[mode](x / 255, s[i] / 255) * 255)) as [number, number, number]));
}
/**
 * Color de capa que convierte `base` en `target` con ese modo (por canal; si el
 * objetivo no es alcanzable en algún canal, el más cercano posible). Se resuelve por
 * bisección: todos los modos son monótonos en el color de la capa.
 */
export function solveLayer(mode: SuggestMode, base: string, target: string): string {
  const b = fromHex(base), t = fromHex(target);
  const out = b.map((x, i) => {
    const bb = x / 255, tt = t[i] / 255, f = (s: number) => B[mode](bb, s);
    let lo = 0, hi = 1;
    const up = f(1) >= f(0);
    for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if ((f(m) < tt) === up) lo = m; else hi = m; }
    return Math.round(((lo + hi) / 2) * 255);
  }) as [number, number, number];
  return toHex(...out);
}

export interface LayerTip { mode: SuggestMode; name: string; use: string; target: string; layer: string; result: string; how: string; layerName: string }

/**
 * Sugerencias de capas para colorear a partir del color base (lo que ya está pintado
 * debajo) y del esquema elegido (para la luz de ambiente y el rebote).
 */
export function layerTips(base: string, sc: Scheme): LayerTip[] {
  const accent = sc.colors.find(c => c.role.startsWith('Acento'))?.hex ?? rotate(base, 180, 'ryb');
  const mk = (mode: SuggestMode, name: string, layerName: string, use: string, target: string, how: string): LayerTip => {
    const layer = solveLayer(mode, base, target);
    return { mode, name, layerName, use, target, layer, result: blend(mode, base, layer), how };
  };
  return [
    mk('multiply', 'Multiplicar', 'Sombras', 'Sombras', shadowTarget(base),
      'Crea una capa Multiplicar encima del color base y pinta las zonas de sombra con este color: donde se superpone, el color base se convierte exactamente en la sombra fría indicada. Multiplicar sólo oscurece: el blanco no cambia nada.'),
    mk('screen', 'Trama', 'Luces', 'Luces', lightTarget(base),
      'Capa Trama encima: pinta las zonas iluminadas con este color y el base se aclara hacia una luz cálida. Trama sólo aclara: el negro no cambia nada.'),
    mk('overlay', 'Superponer', 'Ambiente', 'Ambiente y unificar', mixHex(base, accent, 0.28),
      'Capa Superponer (con poca opacidad si quieres): tiñe todo hacia el color de ambiente del esquema conservando luces y sombras. Ideal para unificar ilustraciones con muchos colores.'),
    mk('soft-light', 'Luz suave', 'Luz rebotada', 'Luz rebotada', mixHex(base, accent, 0.15),
      'Capa Luz suave: un toque del color de acento en los bordes de las sombras, como la luz que rebota en objetos cercanos. Es el más sutil.'),
    mk('color-dodge', 'Sobreexponer color', 'Brillos', 'Brillos intensos', lightTarget(base, 1),
      'Capa Sobreexponer color para destellos, reflejos y brillos de metal o agua: con este color el base llega al brillo indicado. Úsalo poco: quema rápido.'),
  ];
}
