/**
 * Filtros de YOSADRAW MOTION: «looks» listos hechos con los efectos de YOSADRAW
 * (se añaden a la pila del clip y se pueden ajustar o quitar uno a uno).
 */
export interface FilterDef { id: string; label: string; fx: { fx: string; p: Record<string, number | string | boolean> }[] }

export const FILTERS: FilterDef[] = [
  { id: 'cine', label: 'Cine', fx: [{ fx: 'balance', p: { range: 'shadows', cr: -18, mg: 0, yb: 22 } }, { fx: 'balance', p: { range: 'high', cr: 16, mg: 0, yb: -14 } }, { fx: 'bc', p: { contrast: 12 } }, { fx: 'vignette', p: { amount: 35 } }] },
  { id: 'vintage', label: 'Vintage', fx: [{ fx: 'sepia', p: { amount: 35 } }, { fx: 'levels', p: { outBlack: 30, outWhite: 235 } }, { fx: 'noise', p: { amount: 12 } }, { fx: 'vignette', p: { amount: 45 } }] },
  { id: 'bn', label: 'Blanco y negro', fx: [{ fx: 'gray', p: {} }] },
  { id: 'noir', label: 'Noir', fx: [{ fx: 'gray', p: {} }, { fx: 'bc', p: { contrast: 45, bright: -8 } }, { fx: 'vignette', p: { amount: 70, size: 45 } }] },
  { id: 'calido', label: 'Cálido', fx: [{ fx: 'temperature', p: { temp: 35, tint: 5 } }, { fx: 'vibrance', p: { vib: 15 } }] },
  { id: 'frio', label: 'Frío', fx: [{ fx: 'temperature', p: { temp: -35, tint: -5 } }, { fx: 'bc', p: { contrast: 8 } }] },
  { id: 'vivido', label: 'Vívido', fx: [{ fx: 'vibrance', p: { vib: 45, sat: 10 } }, { fx: 'bc', p: { contrast: 15 } }] },
  { id: 'desvaido', label: 'Desvaído', fx: [{ fx: 'levels', p: { outBlack: 45 } }, { fx: 'hsl', p: { sat: -30 } }] },
  { id: 'pastel', label: 'Pastel', fx: [{ fx: 'hsl', p: { sat: -35, light: 18 } }, { fx: 'temperature', p: { temp: 10, tint: 10 } }] },
  { id: 'dramatico', label: 'Dramático', fx: [{ fx: 'clarity', p: {} }, { fx: 'bc', p: { contrast: 30, bright: -5 } }, { fx: 'vignette', p: { amount: 55 } }] },
  { id: 'atardecer', label: 'Atardecer', fx: [{ fx: 'gradmap', p: { c0: '#2b1055', c1: '#d6456b', c2: '#ffd36b', amount: 55 } }] },
  { id: 'neon', label: 'Neón', fx: [{ fx: 'vibrance', p: { vib: 60, sat: 25 } }, { fx: 'glow', p: {} }] },
  { id: 'vhs', label: 'VHS retro', fx: [{ fx: 'chroma', p: {} }, { fx: 'scanlines', p: {} }, { fx: 'noise', p: { amount: 18 } }] },
  { id: 'comic', label: 'Cómic', fx: [{ fx: 'posterize', p: { levels: 6 } }, { fx: 'halftone', p: { cell: 6 } }] },
  { id: 'duo', label: 'Duotono violeta', fx: [{ fx: 'duotone', p: { dark: '#1b1530', light: '#c3a5ff' } }] },
  { id: 'polaroid', label: 'Polaroid', fx: [{ fx: 'temperature', p: { temp: 18, tint: -6 } }, { fx: 'levels', p: { outBlack: 22, outWhite: 245 } }, { fx: 'vignette', p: { amount: 25 } }] },
  { id: 'sepia', label: 'Sepia', fx: [{ fx: 'sepia', p: { amount: 100 } }] },
  { id: 'teal', label: 'Verde azulado', fx: [{ fx: 'balance', p: { range: 'mid', cr: -20, mg: -6, yb: 10 } }, { fx: 'vibrance', p: { vib: 10 } }] },
  { id: 'solar', label: 'Solarizado', fx: [{ fx: 'solarize', p: {} }] },
  { id: 'nocturno', label: 'Nocturno', fx: [{ fx: 'temperature', p: { temp: -50, tint: 10 } }, { fx: 'exposure', p: { ev: -0.8 } }, { fx: 'noise', p: { amount: 8 } }] },
  // 1.9.0
  { id: 'teal-orange', label: 'Teal y naranja', fx: [{ fx: 'balance', p: { range: 'shadows', cr: -30, mg: 0, yb: 30 } }, { fx: 'balance', p: { range: 'high', cr: 28, mg: 0, yb: -25 } }, { fx: 'vibrance', p: { vib: 20 } }] },
  { id: 'bleach', label: 'Bleach bypass', fx: [{ fx: 'hsl', p: { sat: -55 } }, { fx: 'bc', p: { contrast: 35 } }, { fx: 'clarity', p: {} }] },
  { id: 'cyberpunk', label: 'Cyberpunk', fx: [{ fx: 'duotone', p: { dark: '#1a0f3d', light: '#ff4fd8', contrast: 15 } }, { fx: 'glow', p: { thr: 55, amount: 90 } }, { fx: 'chroma', p: {} }] },
  { id: 'matte', label: 'Mate', fx: [{ fx: 'levels', p: { outBlack: 38, outWhite: 238 } }, { fx: 'bc', p: { contrast: -8 } }, { fx: 'hsl', p: { sat: -12 } }] },
  { id: 'golden', label: 'Hora dorada', fx: [{ fx: 'temperature', p: { temp: 45, tint: 8 } }, { fx: 'lightleak', p: { color: '#ffb347', amount: 55, cx: 85, cy: 10 } }, { fx: 'vibrance', p: { vib: 15 } }] },
  { id: 'moon', label: 'Luz de luna', fx: [{ fx: 'temperature', p: { temp: -60, tint: 5 } }, { fx: 'hsl', p: { sat: -40 } }, { fx: 'exposure', p: { ev: -0.6 } }, { fx: 'vignette', p: { amount: 50 } }] },
  { id: 'retro70', label: 'Retro años 70', fx: [{ fx: 'temperature', p: { temp: 30, tint: 15 } }, { fx: 'levels', p: { outBlack: 30, outWhite: 230 } }, { fx: 'hsl', p: { sat: -15 } }, { fx: 'noise', p: { amount: 14 } }] },
  { id: 'lomo', label: 'Lomo', fx: [{ fx: 'vibrance', p: { vib: 50, sat: 15 } }, { fx: 'bc', p: { contrast: 30 } }, { fx: 'vignette', p: { amount: 85, size: 40 } }] },
  { id: 'infrared', label: 'Infrarrojo', fx: [{ fx: 'channels', p: { order: 'grb' } }, { fx: 'hsl', p: { hue: 160, sat: 10 } }, { fx: 'bc', p: { contrast: 15 } }] },
  { id: 'popart', label: 'Pop art', fx: [{ fx: 'posterize', p: { levels: 4 } }, { fx: 'vibrance', p: { vib: 80, sat: 40 } }, { fx: 'halftone', p: { cell: 8 } }] },
  { id: 'thermal', label: 'Cámara térmica', fx: [{ fx: 'gradmap', p: { c0: '#0b0b5c', c1: '#e8296b', c2: '#ffe45c', amount: 100 } }] },
  { id: 'ice', label: 'Hielo', fx: [{ fx: 'temperature', p: { temp: -45 } }, { fx: 'levels', p: { outBlack: 20 } }, { fx: 'glow', p: { thr: 70, amount: 50 } }] },
  { id: 'fire', label: 'Fuego', fx: [{ fx: 'gradmap', p: { c0: '#1a0500', c1: '#e8461d', c2: '#ffd36b', amount: 70 } }, { fx: 'glow', p: { thr: 60, amount: 70 } }] },
  { id: 'dream', label: 'Sueño', fx: [{ fx: 'glow', p: { thr: 40, amount: 80, radius: 40 } }, { fx: 'hsl', p: { sat: -20, light: 10 } }, { fx: 'temperature', p: { tint: 15 } }] },
  { id: 'ink', label: 'Tinta china', fx: [{ fx: 'sketch', p: { amount: 220, shade: 70 } }, { fx: 'bc', p: { contrast: 25 } }] },
  { id: 'oldfilm', label: 'Película antigua', fx: [{ fx: 'sepia', p: { amount: 70 } }, { fx: 'noise', p: { amount: 25, size: 2 } }, { fx: 'vignette', p: { amount: 70 } }, { fx: 'scanlines', p: {} }] },
];
