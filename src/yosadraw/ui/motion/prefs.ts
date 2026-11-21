/** Preferencias del editor de vídeo (módulo ligero: la app las lee al arrancar sin cargar el editor). */
export interface MotionPrefs {
  leftW: number; rightW: number; tlH: number;
  quality: 'auto' | 1 | 0.5 | 0.25;
  proxies: boolean; ripple: boolean; loop: boolean;
  keys: Record<string, string>;
  leftTab: string;
  export: unknown;
  /** Auto Keyframe: cambiar una propiedad crea su keyframe en el cabezal aunque no esté animada. */
  autoKey: boolean;
  /** Sincronizar: un rombo crea o quita el keyframe en todos los clips elegidos a la vez. */
  keySync: boolean;
  /** Línea de tiempo: sólo las propiedades con keyframes en las filas desplegadas. */
  onlyAnimated: boolean;
  /** Paneles visibles (PC). */
  showLeft: boolean; showRight: boolean;
  /** Animación rápida: últimos ajustes. */
  quick: { len: number; intensity: number; ease: string; dir: string };
}
export function normalizeMotionPrefs(v: unknown): MotionPrefs {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const n = (x: unknown, d: number, lo: number, hi: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d);
  return {
    leftW: n(o.leftW, 260, 180, 520), rightW: n(o.rightW, 320, 240, 560), tlH: n(o.tlH, 280, 150, 800),
    quality: ([1, 0.5, 0.25] as unknown[]).includes(o.quality) ? o.quality as 1 : 'auto',
    proxies: o.proxies !== false, ripple: o.ripple === true, loop: o.loop !== false,
    keys: o.keys && typeof o.keys === 'object' ? { ...(o.keys as Record<string, string>) } : {},
    leftTab: typeof o.leftTab === 'string' ? o.leftTab : 'media',
    export: o.export,
    autoKey: o.autoKey === true, keySync: o.keySync !== false, onlyAnimated: o.onlyAnimated !== false,
    showLeft: o.showLeft !== false, showRight: o.showRight !== false,
    quick: (() => { const q = (o.quick && typeof o.quick === 'object' ? o.quick : {}) as Record<string, unknown>; return { len: n(q.len, 0.8, 0.05, 30), intensity: n(q.intensity, 1, 0, 5), ease: typeof q.ease === 'string' ? q.ease : 'preset', dir: typeof q.dir === 'string' ? q.dir : 'left' }; })(),
  };
}

