import { HEAD, type GLRunner, type Tex, type Uniforms } from './gl';

/* ======================================================================
 * Catálogo de efectos (postprocesado) de YOSADRAW.
 * Cada efecto es una cadena de shaders sobre texturas premultiplicadas.
 * Las medidas espaciales se dan en px de DOCUMENTO y se convierten con
 * `unit` (px de imagen por px de documento): la vista previa en pantalla y
 * la aplicación a resolución completa dan el mismo aspecto.
 * ==================================================================== */

export type Category = 'color' | 'blur' | 'sharpen' | 'stylize' | 'distort' | 'texture';
export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'color', label: 'Color' }, { id: 'blur', label: 'Desenfoque' }, { id: 'sharpen', label: 'Nitidez' },
  { id: 'stylize', label: 'Estilizar' }, { id: 'distort', label: 'Distorsión' }, { id: 'texture', label: 'Textura' },
];

export type Param =
  | { key: string; label: string; type: 'range'; min: number; max: number; step?: number; def: number; unit?: string; spatial?: boolean }
  | { key: string; label: string; type: 'color'; def: string }
  | { key: string; label: string; type: 'select'; options: [string, string][]; def: string }
  | { key: string; label: string; type: 'toggle'; def: boolean };
export type Values = Record<string, number | string | boolean>;

export interface FxCtx {
  gl: GLRunner;
  /** Uniformes comunes del mosaico: u_offset, u_full, u_doc, u_unit. */
  base: Uniforms;
  unit: number;
  /** Ejecuta una pasada con el tamaño de salida de la entrada (o `out`). */
  pass(fs: string, input: Tex, uniforms?: Uniforms, extra?: Record<string, Tex>, out?: { w: number; h: number }, scaleIn?: [number, number]): Tex;
}

export interface EffectDef {
  id: string;
  label: string;
  cat: Category;
  params: Param[];
  /** Px de imagen que el efecto lee fuera de cada píxel (margen entre mosaicos). */
  margin?(v: Values, unit: number): number;
  /** Necesita la imagen entera de una vez (centro, posición global de desplazamientos grandes). */
  global?: boolean;
  run(ctx: FxCtx, input: Tex, v: Values): Tex;
}

// ---------------------------------------------------------------- utilidades

const num = (v: Values, k: string) => Number(v[k]);
export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Efecto de color por píxel: `body` transforma `vec3 c` (sin premultiplicar) y `float a`. */
function point(id: string, label: string, params: Param[], decl: string, body: string, uniforms: (v: Values) => Uniforms): EffectDef {
  const fs = `${HEAD}${decl}
void main() { vec4 s = tx(inPos()); vec3 c = unpm(s); float a = s.a; ${body} o = pm(c, a); }`;
  return { id, label, cat: 'color', params, run: (ctx, input, v) => ctx.pass(fs, input, uniforms(v)) };
}

const COPY = `${HEAD} void main() { o = tx(inPos()); }`;

const GAUSS = `${HEAD}
uniform vec2 u_dir; uniform float u_sigma;
void main() {
  vec2 p = inPos();
  float r = ceil(u_sigma * 3.0);
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (float i = -r; i <= r; i += 1.0) { float w = exp(-0.5 * i * i / (u_sigma * u_sigma)); acc += tx(p + u_dir * i) * w; ws += w; }
  o = acc / ws;
}`;

/**
 * Desenfoque gaussiano separable. Para radios grandes se reduce la imagen
 * a la mitad las veces necesarias (σ ≤ 6 en la escala reducida), se desenfoca
 * y se vuelve a ampliar: coste casi constante aunque el radio sea enorme.
 */
export function gaussian(ctx: FxCtx, t: Tex, sigma: number): Tex {
  if (sigma < 0.35) return ctx.pass(COPY, t);
  const chain: Tex[] = [t];
  let s = sigma, cur = t;
  while (s > 6 && chain.length < 6 && cur.w > 8 && cur.h > 8) {
    cur = ctx.pass(COPY, cur, {}, {}, { w: Math.ceil(cur.w / 2), h: Math.ceil(cur.h / 2) }, [cur.w / Math.ceil(cur.w / 2), cur.h / Math.ceil(cur.h / 2)]);
    chain.push(cur);
    s /= 2;
  }
  // La reducción ya suaviza un poco (≈ σ 0,5 por nivel): se descuenta.
  const levels = chain.length - 1;
  const sEff = Math.max(0.35, Math.sqrt(Math.max(0.1, s * s - (levels ? 0.25 : 0))));
  const h = ctx.pass(GAUSS, cur, { u_dir: [1, 0], u_sigma: sEff });
  const vv = ctx.pass(GAUSS, h, { u_dir: [0, 1], u_sigma: sEff });
  ctx.gl.release(h);
  cur = vv;
  for (let i = levels - 1; i >= 0; i--) {
    const target = chain[i];
    const up = ctx.pass(COPY, cur, {}, {}, { w: target.w, h: target.h }, [cur.w / target.w, cur.h / target.h]);
    ctx.gl.release(cur);
    if (i > 0) ctx.gl.release(chain[i]);
    cur = up;
  }
  return cur;
}

const MIXER = `${HEAD}
uniform sampler2D u_b; uniform float u_mode; uniform float u_k; uniform vec3 u_color; uniform float u_thr;
void main() {
  vec2 p = inPos();
  vec4 a = tx(p), b = texture(u_b, p / u_size);
  if (u_mode < 0.5) {            // nitidez (máscara de enfoque) con umbral
    vec3 ca = unpm(a), cb = unpm(b), d = ca - cb;
    float m = smoothstep(u_thr, u_thr + 0.02, abs(luma(d)));
    o = pm(ca + d * u_k * m, a.a);
  } else if (u_mode < 1.5) {     // resplandor: suma (pantalla) del brillo desenfocado
    vec3 ca = unpm(a), g = b.rgb * u_k;
    o = vec4(clamp(a.rgb + g * (1.0 - a.rgb), 0.0, 1.0), clamp(a.a + luma(g) * (1.0 - a.a), 0.0, 1.0));
  } else {                       // sombra: color con el alfa desenfocado, debajo del original
    vec4 sh = vec4(u_color, 1.0) * (b.a * u_k);
    o = a + sh * (1.0 - a.a);
  }
}`;

// ---------------------------------------------------------------- color

const pct = (key: string, label: string, def = 0, min = -100, max = 100): Param => ({ key, label, type: 'range', min, max, def, unit: '%' });

const color: EffectDef[] = [
  point('hsl', 'Tono / saturación / luminosidad', [
    { key: 'hue', label: 'Tono', type: 'range', min: -180, max: 180, def: 0, unit: '°' }, pct('sat', 'Saturación'), pct('light', 'Luminosidad'),
    { key: 'colorize', label: 'Colorear', type: 'toggle', def: false },
  ], 'uniform float u_hue, u_sat, u_light, u_colorize;', `
    vec3 h = rgb2hsl(c);
    if (u_colorize > 0.5) { h.x = fract(u_hue / 360.0); h.y = clamp(0.5 + u_sat * 0.5, 0.0, 1.0); }
    else { h.x = fract(h.x + u_hue / 360.0); h.y = clamp(h.y * (1.0 + u_sat), 0.0, 1.0); }
    c = hsl2rgb(h);
    c = u_light >= 0.0 ? mix(c, vec3(1.0), u_light) : c * (1.0 + u_light);`,
  v => ({ u_hue: num(v, 'hue'), u_sat: num(v, 'sat') / 100, u_light: num(v, 'light') / 100, u_colorize: v.colorize === true })),

  point('replace', 'Cambiar un tono', [
    { key: 'from', label: 'Tono de origen', type: 'range', min: 0, max: 360, def: 0, unit: '°' },
    { key: 'range', label: 'Rango', type: 'range', min: 5, max: 120, def: 30, unit: '°' },
    { key: 'shift', label: 'Desplazar tono', type: 'range', min: -180, max: 180, def: 120, unit: '°' },
    pct('sat', 'Saturación'), pct('light', 'Luminosidad'),
  ], 'uniform float u_from, u_range, u_shift, u_sat, u_light;', `
    vec3 h = rgb2hsl(c);
    float d = abs(fract(h.x - u_from / 360.0 + 0.5) - 0.5) * 360.0;
    float w = (1.0 - smoothstep(u_range * 0.5, u_range * 0.5 + 12.0, d)) * smoothstep(0.02, 0.12, h.y);
    vec3 n = vec3(fract(h.x + u_shift / 360.0), clamp(h.y * (1.0 + u_sat), 0.0, 1.0), clamp(h.z + u_light * 0.5, 0.0, 1.0));
    c = mix(c, hsl2rgb(n), w);`,
  v => ({ u_from: num(v, 'from'), u_range: num(v, 'range'), u_shift: num(v, 'shift'), u_sat: num(v, 'sat') / 100, u_light: num(v, 'light') / 100 })),

  point('bc', 'Brillo y contraste', [pct('bright', 'Brillo'), pct('contrast', 'Contraste')], 'uniform float u_b, u_c;', `
    c = c + u_b;
    float k = u_c >= 0.0 ? 1.0 / max(0.01, 1.0 - u_c * 0.99) : 1.0 + u_c;
    c = (c - 0.5) * k + 0.5;`,
  v => ({ u_b: num(v, 'bright') / 200, u_c: num(v, 'contrast') / 100 })),

  point('exposure', 'Exposición y gamma', [
    { key: 'ev', label: 'Exposición', type: 'range', min: -4, max: 4, step: 0.05, def: 0, unit: ' EV' },
    { key: 'gamma', label: 'Gamma', type: 'range', min: 0.2, max: 3, step: 0.01, def: 1 },
    pct('offset', 'Desplazamiento', 0, -50, 50),
  ], 'uniform float u_ev, u_g, u_off;', `
    vec3 lin = pow(c, vec3(2.2)) * exp2(u_ev);
    c = pow(clamp(lin, 0.0, 1.0), vec3(1.0 / 2.2));
    c = pow(max(c + u_off, 0.0), vec3(1.0 / u_g));`,
  v => ({ u_ev: num(v, 'ev'), u_g: num(v, 'gamma'), u_off: num(v, 'offset') / 100 })),

  point('levels', 'Niveles', [
    { key: 'inBlack', label: 'Negro de entrada', type: 'range', min: 0, max: 254, def: 0 },
    { key: 'inWhite', label: 'Blanco de entrada', type: 'range', min: 1, max: 255, def: 255 },
    { key: 'gamma', label: 'Medios tonos', type: 'range', min: 0.1, max: 5, step: 0.01, def: 1 },
    { key: 'outBlack', label: 'Negro de salida', type: 'range', min: 0, max: 255, def: 0 },
    { key: 'outWhite', label: 'Blanco de salida', type: 'range', min: 0, max: 255, def: 255 },
  ], 'uniform float u_ib, u_iw, u_g, u_ob, u_ow;', `
    c = clamp((c - u_ib) / max(1e-3, u_iw - u_ib), 0.0, 1.0);
    c = pow(c, vec3(1.0 / u_g));
    c = mix(vec3(u_ob), vec3(u_ow), c);`,
  v => ({ u_ib: num(v, 'inBlack') / 255, u_iw: num(v, 'inWhite') / 255, u_g: num(v, 'gamma'), u_ob: num(v, 'outBlack') / 255, u_ow: num(v, 'outWhite') / 255 })),

  point('balance', 'Equilibrio de color', [
    { key: 'range', label: 'Tonos', type: 'select', options: [['shadows', 'Sombras'], ['mid', 'Medios tonos'], ['high', 'Luces']], def: 'mid' },
    pct('cr', 'Cian ↔ Rojo'), pct('mg', 'Magenta ↔ Verde'), pct('yb', 'Amarillo ↔ Azul'),
    { key: 'keep', label: 'Conservar luminosidad', type: 'toggle', def: true },
  ], 'uniform float u_range, u_keep; uniform vec3 u_d;', `
    float l = luma(c);
    float w = u_range < 0.5 ? 1.0 - smoothstep(0.0, 0.5, l) : u_range < 1.5 ? 1.0 - abs(l - 0.5) * 2.0 : smoothstep(0.5, 1.0, l);
    vec3 n = clamp(c + u_d * w * 0.5, 0.0, 1.0);
    if (u_keep > 0.5) n += luma(c) - luma(n);
    c = n;`,
  v => ({ u_range: v.range === 'shadows' ? 0 : v.range === 'mid' ? 1 : 2, u_keep: v.keep === true, u_d: [num(v, 'cr') / 100, num(v, 'mg') / 100, num(v, 'yb') / 100] })),

  point('temperature', 'Temperatura y tinte', [pct('temp', 'Temperatura'), pct('tint', 'Tinte')], 'uniform float u_t, u_ti;', `
    float l = luma(c);
    c *= vec3(1.0 + u_t * 0.35, 1.0 - u_ti * 0.25, 1.0 - u_t * 0.35);
    c += l - luma(c);`,
  v => ({ u_t: num(v, 'temp') / 100, u_ti: num(v, 'tint') / 100 })),

  point('vibrance', 'Intensidad (vibrance)', [pct('vib', 'Intensidad'), pct('sat', 'Saturación')], 'uniform float u_v, u_s;', `
    float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), sat = mx - mn;
    float l = luma(c);
    c = mix(vec3(l), c, 1.0 + u_v * (1.0 - sat) * 1.5);
    c = mix(vec3(luma(c)), c, 1.0 + u_s);`,
  v => ({ u_v: num(v, 'vib') / 100, u_s: num(v, 'sat') / 100 })),

  point('tint', 'Filtro de color', [
    { key: 'color', label: 'Color', type: 'color', def: '#ff8a3d' },
    pct('amount', 'Intensidad', 50, 0, 100),
    { key: 'mode', label: 'Modo', type: 'select', options: [['multiply', 'Multiplicar'], ['colorize', 'Teñir'], ['overlay', 'Superponer'], ['screen', 'Trama']], def: 'colorize' },
  ], 'uniform vec3 u_col; uniform float u_k, u_mode;', `
    vec3 r;
    if (u_mode < 0.5) r = c * u_col;
    else if (u_mode < 1.5) { vec3 h = rgb2hsl(u_col); r = hsl2rgb(vec3(h.x, h.y, luma(c))); }
    else if (u_mode < 2.5) r = mix(2.0 * c * u_col, 1.0 - 2.0 * (1.0 - c) * (1.0 - u_col), step(0.5, c));
    else r = 1.0 - (1.0 - c) * (1.0 - u_col);
    c = mix(c, r, u_k);`,
  v => ({ u_col: hexRgb(String(v.color)), u_k: num(v, 'amount') / 100, u_mode: ['multiply', 'colorize', 'overlay', 'screen'].indexOf(String(v.mode)) })),

  point('gradmap', 'Mapa de degradado', [
    { key: 'c0', label: 'Sombras', type: 'color', def: '#1b1530' }, { key: 'c1', label: 'Medios', type: 'color', def: '#9d6bff' },
    { key: 'c2', label: 'Luces', type: 'color', def: '#ffe2b0' }, pct('amount', 'Intensidad', 100, 0, 100),
  ], 'uniform vec3 u_c0, u_c1, u_c2; uniform float u_k;', `
    float l = luma(c);
    vec3 r = l < 0.5 ? mix(u_c0, u_c1, l * 2.0) : mix(u_c1, u_c2, l * 2.0 - 1.0);
    c = mix(c, r, u_k);`,
  v => ({ u_c0: hexRgb(String(v.c0)), u_c1: hexRgb(String(v.c1)), u_c2: hexRgb(String(v.c2)), u_k: num(v, 'amount') / 100 })),

  point('gray', 'Blanco y negro', [
    { key: 'mode', label: 'Método', type: 'select', options: [['luma', 'Luminancia'], ['avg', 'Promedio'], ['r', 'Canal rojo'], ['g', 'Canal verde'], ['b', 'Canal azul']], def: 'luma' },
    pct('amount', 'Intensidad', 100, 0, 100),
  ], 'uniform float u_mode, u_k;', `
    float g = u_mode < 0.5 ? luma(c) : u_mode < 1.5 ? (c.r + c.g + c.b) / 3.0 : u_mode < 2.5 ? c.r : u_mode < 3.5 ? c.g : c.b;
    c = mix(c, vec3(g), u_k);`,
  v => ({ u_mode: ['luma', 'avg', 'r', 'g', 'b'].indexOf(String(v.mode)), u_k: num(v, 'amount') / 100 })),

  point('sepia', 'Sepia', [pct('amount', 'Intensidad', 100, 0, 100)], 'uniform float u_k;', `
    vec3 sp = vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131)));
    c = mix(c, sp, u_k);`,
  v => ({ u_k: num(v, 'amount') / 100 })),

  point('invert', 'Invertir', [pct('amount', 'Intensidad', 100, 0, 100)], 'uniform float u_k;', 'c = mix(c, 1.0 - c, u_k);', v => ({ u_k: num(v, 'amount') / 100 })),

  point('posterize', 'Posterizar', [{ key: 'levels', label: 'Niveles', type: 'range', min: 2, max: 32, def: 5 }], 'uniform float u_n;', `
    c = floor(c * (u_n - 1.0) + 0.5) / (u_n - 1.0);`,
  v => ({ u_n: num(v, 'levels') })),

  point('threshold', 'Umbral', [
    { key: 'level', label: 'Umbral', type: 'range', min: 0, max: 255, def: 128 },
    { key: 'soft', label: 'Suavizado', type: 'range', min: 0, max: 64, def: 4 },
    { key: 'dark', label: 'Oscuro', type: 'color', def: '#000000' }, { key: 'light', label: 'Claro', type: 'color', def: '#ffffff' },
  ], 'uniform float u_t, u_s; uniform vec3 u_d, u_l;', `
    float k = smoothstep(u_t - u_s, u_t + u_s + 1e-4, luma(c));
    c = mix(u_d, u_l, k);`,
  v => ({ u_t: num(v, 'level') / 255, u_s: num(v, 'soft') / 255, u_d: hexRgb(String(v.dark)), u_l: hexRgb(String(v.light)) })),
];

// ---------------------------------------------------------------- desenfoque

const MOTION = `${HEAD}
uniform vec2 u_vec; uniform float u_n;
void main() {
  vec2 p = inPos(); vec4 acc = vec4(0.0);
  for (float i = 0.0; i < u_n; i += 1.0) acc += tx(p + u_vec * (i / max(1.0, u_n - 1.0) - 0.5));
  o = acc / u_n;
}`;

const RADIAL = `${HEAD}
uniform vec2 u_c; uniform float u_k, u_n, u_spin;
void main() {
  vec2 g = gpos(), d = g - u_c; vec4 acc = vec4(0.0);
  for (float i = 0.0; i < u_n; i += 1.0) {
    float t = i / max(1.0, u_n - 1.0) - 0.5;
    vec2 q;
    if (u_spin > 0.5) { float a = t * u_k; q = u_c + mat2(cos(a), sin(a), -sin(a), cos(a)) * d; }
    else q = u_c + d * (1.0 - t * u_k);
    acc += tx(q - u_offset);
  }
  o = acc / u_n;
}`;

// Desenfoque de lente: muestras en espiral de ángulo áureo dentro de un disco (bokeh).
const LENS = `${HEAD}
uniform float u_r, u_n, u_bright;
void main() {
  vec2 p = inPos(); vec4 acc = vec4(0.0); float ws = 0.0;
  for (float i = 0.0; i < u_n; i += 1.0) {
    float r = sqrt((i + 0.5) / u_n) * u_r, a = i * 2.39996323;
    vec4 s = tx(p + vec2(cos(a), sin(a)) * r);
    float w = 1.0 + u_bright * pow(luma(unpm(s)), 4.0) * 8.0;
    acc += s * w; ws += w;
  }
  o = acc / ws;
}`;

const TILT = `${HEAD}
uniform sampler2D u_b; uniform float u_center, u_band, u_fall, u_ang;
void main() {
  vec2 p = inPos(); vec2 g = gpos();
  vec2 n = vec2(-sin(u_ang), cos(u_ang));
  float y0 = u_doc.y + u_center * u_doc.w;
  vec2 c0 = vec2(u_doc.x + u_doc.z * 0.5, y0);
  float d = abs(dot(g - c0, n));
  float k = smoothstep(u_band * 0.5, u_band * 0.5 + u_fall, d);
  o = mix(tx(p), texture(u_b, p / u_size), k);
}`;

const blur: EffectDef[] = [
  {
    id: 'gauss', label: 'Desenfoque gaussiano', cat: 'blur',
    params: [{ key: 'radius', label: 'Radio', type: 'range', min: 0, max: 200, step: 0.5, def: 8, unit: ' px', spatial: true }],
    margin: (v, u) => num(v, 'radius') * u * 3 + 4,
    run: (ctx, t, v) => gaussian(ctx, t, num(v, 'radius') * ctx.unit),
  },
  {
    id: 'motion', label: 'Desenfoque de movimiento', cat: 'blur',
    params: [{ key: 'dist', label: 'Distancia', type: 'range', min: 0, max: 400, def: 40, unit: ' px', spatial: true }, { key: 'angle', label: 'Ángulo', type: 'range', min: -180, max: 180, def: 0, unit: '°' }],
    margin: (v, u) => num(v, 'dist') * u / 2 + 4,
    run: (ctx, t, v) => {
      const d = num(v, 'dist') * ctx.unit, a = (num(v, 'angle') * Math.PI) / 180;
      const n = Math.min(96, Math.max(2, Math.ceil(d / 1.5)));
      // Dos pasadas encadenadas: con pocas muestras por pasada el resultado es continuo.
      const vec = [Math.cos(a) * d, Math.sin(a) * d];
      const n1 = Math.ceil(Math.sqrt(n * 2));
      const a1 = ctx.pass(MOTION, t, { u_vec: vec, u_n: n1 });
      const a2 = ctx.pass(MOTION, a1, { u_vec: [vec[0] / n1, vec[1] / n1], u_n: Math.max(2, Math.ceil(n / n1) + 1) });
      ctx.gl.release(a1);
      return a2;
    },
  },
  {
    id: 'zoom', label: 'Desenfoque radial (zoom)', cat: 'blur', global: true,
    params: [pct('amount', 'Intensidad', 20, 0, 100), pct('cx', 'Centro X', 50, 0, 100), pct('cy', 'Centro Y', 50, 0, 100)],
    run: (ctx, t, v) => {
      const doc = ctx.base.u_doc as number[];
      const c = [doc[0] + doc[2] * num(v, 'cx') / 100, doc[1] + doc[3] * num(v, 'cy') / 100];
      const k = num(v, 'amount') / 100 * 0.6;
      const r1 = ctx.pass(RADIAL, t, { u_c: c, u_k: k, u_n: 24, u_spin: 0 });
      const r2 = ctx.pass(RADIAL, r1, { u_c: c, u_k: k / 24, u_n: 8, u_spin: 0 });
      ctx.gl.release(r1);
      return r2;
    },
  },
  {
    id: 'spin', label: 'Desenfoque giratorio', cat: 'blur', global: true,
    params: [{ key: 'angle', label: 'Ángulo', type: 'range', min: 0, max: 90, def: 12, unit: '°' }, pct('cx', 'Centro X', 50, 0, 100), pct('cy', 'Centro Y', 50, 0, 100)],
    run: (ctx, t, v) => {
      const doc = ctx.base.u_doc as number[];
      const c = [doc[0] + doc[2] * num(v, 'cx') / 100, doc[1] + doc[3] * num(v, 'cy') / 100];
      const k = (num(v, 'angle') * Math.PI) / 180;
      const r1 = ctx.pass(RADIAL, t, { u_c: c, u_k: k, u_n: 24, u_spin: 1 });
      const r2 = ctx.pass(RADIAL, r1, { u_c: c, u_k: k / 24, u_n: 8, u_spin: 1 });
      ctx.gl.release(r1);
      return r2;
    },
  },
  {
    id: 'lens', label: 'Desenfoque de lente (bokeh)', cat: 'blur',
    params: [{ key: 'radius', label: 'Radio', type: 'range', min: 0, max: 120, step: 0.5, def: 12, unit: ' px', spatial: true }, pct('bright', 'Brillo de los reflejos', 40, 0, 100)],
    margin: (v, u) => num(v, 'radius') * u + 4,
    run: (ctx, t, v) => {
      const r = num(v, 'radius') * ctx.unit;
      if (r < 0.5) return ctx.pass(COPY, t);
      // Radios grandes: a media o cuarta resolución (el disco es suave de todos modos).
      const f = r > 48 ? 4 : r > 16 ? 2 : 1;
      let src = t;
      if (f > 1) src = ctx.pass(COPY, t, {}, {}, { w: Math.ceil(t.w / f), h: Math.ceil(t.h / f) }, [t.w / Math.ceil(t.w / f), t.h / Math.ceil(t.h / f)]);
      const b = ctx.pass(LENS, src, { u_r: r / f, u_n: Math.min(160, Math.max(24, Math.ceil((r / f) ** 2 * 0.9))), u_bright: num(v, 'bright') / 100 });
      if (f === 1) return b;
      ctx.gl.release(src);
      const up = ctx.pass(COPY, b, {}, {}, { w: t.w, h: t.h }, [b.w / t.w, b.h / t.h]);
      ctx.gl.release(b);
      return up;
    },
  },
  {
    id: 'tiltshift', label: 'Miniatura (tilt-shift)', cat: 'blur',
    params: [pct('center', 'Posición de la franja', 55, 0, 100), pct('band', 'Ancho nítido', 20, 0, 100), pct('fall', 'Transición', 20, 1, 100),
      { key: 'radius', label: 'Desenfoque', type: 'range', min: 0, max: 60, step: 0.5, def: 10, unit: ' px', spatial: true }, { key: 'angle', label: 'Ángulo', type: 'range', min: -90, max: 90, def: 0, unit: '°' }],
    margin: (v, u) => num(v, 'radius') * u * 3 + 4,
    run: (ctx, t, v) => {
      const b = gaussian(ctx, t, num(v, 'radius') * ctx.unit);
      const doc = ctx.base.u_doc as number[];
      const r = ctx.pass(TILT, t, { u_center: num(v, 'center') / 100, u_band: num(v, 'band') / 100 * doc[3], u_fall: num(v, 'fall') / 100 * doc[3] * 0.5 + 1, u_ang: (num(v, 'angle') * Math.PI) / 180 }, { u_b: b });
      ctx.gl.release(b);
      return r;
    },
  },
];

// ---------------------------------------------------------------- nitidez

const sharpen: EffectDef[] = [
  {
    id: 'unsharp', label: 'Enfocar (máscara de enfoque)', cat: 'sharpen',
    params: [pct('amount', 'Cantidad', 80, 0, 500), { key: 'radius', label: 'Radio', type: 'range', min: 0.3, max: 30, step: 0.1, def: 1.5, unit: ' px', spatial: true }, { key: 'thr', label: 'Umbral', type: 'range', min: 0, max: 64, def: 2 }],
    margin: (v, u) => num(v, 'radius') * u * 3 + 4,
    run: (ctx, t, v) => {
      const b = gaussian(ctx, t, num(v, 'radius') * ctx.unit);
      const r = ctx.pass(MIXER, t, { u_mode: 0, u_k: num(v, 'amount') / 100, u_thr: num(v, 'thr') / 255 }, { u_b: b });
      ctx.gl.release(b);
      return r;
    },
  },
  {
    id: 'clarity', label: 'Claridad (contraste local)', cat: 'sharpen',
    params: [pct('amount', 'Cantidad', 40, 0, 200), { key: 'radius', label: 'Radio', type: 'range', min: 5, max: 120, def: 30, unit: ' px', spatial: true }],
    margin: (v, u) => num(v, 'radius') * u * 3 + 4,
    run: (ctx, t, v) => {
      const b = gaussian(ctx, t, num(v, 'radius') * ctx.unit);
      const r = ctx.pass(MIXER, t, { u_mode: 0, u_k: num(v, 'amount') / 100, u_thr: 0 }, { u_b: b });
      ctx.gl.release(b);
      return r;
    },
  },
];

// ---------------------------------------------------------------- estilizar

const CHROMA = `${HEAD}
uniform float u_k, u_radial, u_ang; uniform vec2 u_c;
void main() {
  vec2 g = gpos(), p = inPos();
  vec2 d = u_radial > 0.5 ? (g - u_c) / max(1.0, length(u_doc.zw) * 0.5) * u_k : vec2(cos(u_ang), sin(u_ang)) * u_k;
  vec4 r = tx(p + d), gg = tx(p), b = tx(p - d);
  // Cada canal desplazado con su propio alfa; el alfa final es el mayor.
  float a = max(r.a, max(gg.a, b.a));
  o = vec4(r.r, gg.g, b.b, a);
}`;

const THRESH = `${HEAD}
uniform float u_t;
void main() { vec4 s = tx(inPos()); vec3 c = unpm(s); float k = smoothstep(u_t, u_t + 0.15, luma(c)); o = s * k; }`;

const VIGNETTE = `${HEAD}
uniform float u_k, u_vsize, u_soft, u_round; uniform vec3 u_col;
void main() {
  vec4 s = tx(inPos());
  vec2 q = (gpos() - u_doc.xy) / u_doc.zw - 0.5;
  if (u_round > 0.5) q.x *= u_doc.z / u_doc.w;
  float d = length(q) * 2.0;
  float v = smoothstep(u_vsize, u_vsize + u_soft, d) * u_k;
  vec3 c = mix(unpm(s), u_col, v);
  o = pm(c, s.a);
}`;

const HALFTONE = `${HEAD}
uniform float u_cell, u_ang, u_color;
float dotAt(vec2 g, float ang, float v) {
  mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  vec2 q = R * g / u_cell, f = fract(q) - 0.5;
  float r = sqrt(clamp(v, 0.0, 1.0)) * 0.7071;
  return 1.0 - smoothstep(r - 0.06, r + 0.06, length(f));
}
void main() {
  vec4 s = tx(inPos()); vec3 c = unpm(s); vec2 g = gpos();
  vec3 res;
  if (u_color > 0.5) {
    vec3 cmy = 1.0 - c; float k = min(cmy.x, min(cmy.y, cmy.z));
    vec3 cmy2 = (cmy - k) / max(1e-3, 1.0 - k);
    float C = dotAt(g, u_ang + 0.2618, cmy2.x * (1.0 - k)), M = dotAt(g, u_ang + 1.309, cmy2.y * (1.0 - k)), Y = dotAt(g, u_ang, cmy2.z * (1.0 - k)), K = dotAt(g, u_ang + 0.7854, k);
    res = (1.0 - vec3(C, M, Y)) * (1.0 - K);
  } else res = vec3(1.0 - dotAt(g, u_ang + 0.7854, 1.0 - luma(c)));
  o = pm(res, s.a);
}`;

const PIXEL = `${HEAD}
uniform float u_cell;
void main() {
  vec2 g = gpos(), cellOrigin = floor((g - u_doc.xy) / u_cell) * u_cell + u_doc.xy;
  vec4 acc = vec4(0.0);
  for (float y = 0.25; y < 1.0; y += 0.5) for (float x = 0.25; x < 1.0; x += 0.5) acc += tx(cellOrigin + vec2(x, y) * u_cell - u_offset);
  o = acc / 4.0;
}`;

const EDGES = `${HEAD}
uniform float u_k, u_inv, u_mode;
void main() {
  vec2 p = inPos();
  float tl = luma(tx(p + vec2(-1, -1)).rgb), t = luma(tx(p + vec2(0, -1)).rgb), tr = luma(tx(p + vec2(1, -1)).rgb);
  float l = luma(tx(p + vec2(-1, 0)).rgb), r = luma(tx(p + vec2(1, 0)).rgb);
  float bl = luma(tx(p + vec2(-1, 1)).rgb), b = luma(tx(p + vec2(0, 1)).rgb), br = luma(tx(p + vec2(1, 1)).rgb);
  float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br, gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
  vec4 s = tx(p);
  if (u_mode > 0.5) { // relieve
    float e = (gx * cos(u_inv) + gy * sin(u_inv)) * u_k;
    o = pm(vec3(0.5 + e), max(s.a, 0.0));
    return;
  }
  float e = clamp(length(vec2(gx, gy)) * u_k, 0.0, 1.0);
  float a = max(s.a, e);
  o = vec4(vec3(u_inv > 0.5 ? 1.0 - e : e) * a, a);
}`;

const GLITCH = `${HEAD}
uniform float u_k, u_block, u_seed;
void main() {
  vec2 g = gpos(), p = inPos();
  float row = floor((g.y - u_doc.y) / u_block);
  float h = hash(vec2(row, u_seed)), h2 = hash(vec2(row * 1.7, u_seed + 3.1));
  float shift = h > 0.65 ? (h2 - 0.5) * u_k * 4.0 : 0.0;
  vec2 q = p + vec2(shift, 0.0);
  vec4 r = tx(q + vec2(u_k, 0.0)), gg = tx(q), b = tx(q - vec2(u_k, 0.0));
  o = vec4(r.r, gg.g, b.b, max(r.a, max(gg.a, b.a)));
}`;

const SCAN = `${HEAD}
uniform float u_k, u_period, u_curve;
void main() {
  vec4 s = tx(inPos()); vec3 c = unpm(s);
  float y = (gpos().y - u_doc.y) / u_period;
  float line = 0.5 + 0.5 * cos(y * 6.2831853);
  c *= 1.0 - u_k * line * 0.7;
  vec2 q = (gpos() - u_doc.xy) / u_doc.zw - 0.5;
  c *= 1.0 - u_curve * dot(q, q) * 1.6;
  o = pm(c, s.a);
}`;

// Kuwahara de 4 cuadrantes: aspecto de pintura al óleo conservando bordes.
const KUWA = `${HEAD}
uniform float u_r;
void main() {
  vec2 p = inPos();
  vec3 m[4]; vec3 s2[4]; float wa[4];
  for (int k = 0; k < 4; k++) { m[k] = vec3(0.0); s2[k] = vec3(0.0); wa[k] = 0.0; }
  vec4 acc = vec4(0.0);
  for (float y = -u_r; y <= u_r; y += 1.0) for (float x = -u_r; x <= u_r; x += 1.0) {
    vec4 s = tx(p + vec2(x, y)); vec3 c = unpm(s);
    int k = (x <= 0.0 ? 0 : 1) + (y <= 0.0 ? 0 : 2);
    m[k] += c; s2[k] += c * c; wa[k] += 1.0; acc.a += s.a;
  }
  float best = 1e9; vec3 res = vec3(0.0);
  for (int k = 0; k < 4; k++) {
    vec3 mu = m[k] / wa[k], v = s2[k] / wa[k] - mu * mu;
    float sv = v.r + v.g + v.b;
    if (sv < best) { best = sv; res = mu; }
  }
  o = pm(res, tx(p).a);
}`;

// Contorno de la silueta (dilatación del alfa por pasos decrecientes).
const DILATE = `${HEAD}
uniform float u_step;
void main() {
  vec2 p = inPos(); float a = tx(p).a;
  for (float y = -1.0; y <= 1.0; y += 1.0) for (float x = -1.0; x <= 1.0; x += 1.0) {
    vec2 d = vec2(x, y); if (x != 0.0 && y != 0.0) d *= 0.7071;
    a = max(a, tx(p + d * u_step).a);
  }
  o = vec4(a);
}`;
const OUTLINE = `${HEAD}
uniform sampler2D u_b; uniform vec3 u_col; uniform float u_k;
void main() {
  vec2 p = inPos(); vec4 s = tx(p); float ring = texture(u_b, p / u_size).a * u_k;
  vec4 line = vec4(u_col, 1.0) * ring;
  o = s + line * (1.0 - s.a);
}`;

const stylize: EffectDef[] = [
  {
    id: 'chroma', label: 'Aberración cromática', cat: 'stylize',
    params: [{ key: 'amount', label: 'Desplazamiento', type: 'range', min: 0, max: 60, step: 0.5, def: 6, unit: ' px', spatial: true },
      { key: 'mode', label: 'Tipo', type: 'select', options: [['radial', 'Radial (lente)'], ['linear', 'Lineal']], def: 'radial' },
      { key: 'angle', label: 'Ángulo (lineal)', type: 'range', min: -180, max: 180, def: 0, unit: '°' }],
    margin: (v, u) => num(v, 'amount') * u + 4,
    run: (ctx, t, v) => {
      const doc = ctx.base.u_doc as number[];
      return ctx.pass(CHROMA, t, { u_k: num(v, 'amount') * ctx.unit, u_radial: v.mode === 'radial', u_ang: (num(v, 'angle') * Math.PI) / 180, u_c: [doc[0] + doc[2] / 2, doc[1] + doc[3] / 2] });
    },
  },
  {
    id: 'glow', label: 'Resplandor (bloom)', cat: 'stylize',
    params: [pct('thr', 'Umbral', 60, 0, 100), pct('amount', 'Intensidad', 80, 0, 300), { key: 'radius', label: 'Radio', type: 'range', min: 1, max: 150, def: 24, unit: ' px', spatial: true }],
    margin: (v, u) => num(v, 'radius') * u * 3 + 4,
    run: (ctx, t, v) => {
      const bright = ctx.pass(THRESH, t, { u_t: num(v, 'thr') / 100 });
      const b = gaussian(ctx, bright, num(v, 'radius') * ctx.unit);
      ctx.gl.release(bright);
      const r = ctx.pass(MIXER, t, { u_mode: 1, u_k: num(v, 'amount') / 100 }, { u_b: b });
      ctx.gl.release(b);
      return r;
    },
  },
  {
    id: 'shadow', label: 'Sombra paralela', cat: 'stylize',
    params: [{ key: 'dist', label: 'Distancia', type: 'range', min: 0, max: 200, def: 16, unit: ' px', spatial: true }, { key: 'angle', label: 'Ángulo', type: 'range', min: -180, max: 180, def: 45, unit: '°' },
      { key: 'radius', label: 'Desenfoque', type: 'range', min: 0, max: 80, def: 10, unit: ' px', spatial: true }, { key: 'color', label: 'Color', type: 'color', def: '#000000' }, pct('opacity', 'Opacidad', 60, 0, 100)],
    margin: (v, u) => (num(v, 'dist') + num(v, 'radius') * 3) * u + 4,
    run: (ctx, t, v) => {
      const a = (num(v, 'angle') * Math.PI) / 180, d = num(v, 'dist') * ctx.unit;
      const moved = ctx.pass(`${HEAD} uniform vec2 u_d; void main() { o = tx(inPos() - u_d); }`, t, { u_d: [Math.cos(a) * d, Math.sin(a) * d] });
      const b = gaussian(ctx, moved, num(v, 'radius') * ctx.unit);
      ctx.gl.release(moved);
      const r = ctx.pass(MIXER, t, { u_mode: 2, u_k: num(v, 'opacity') / 100, u_color: hexRgb(String(v.color)) }, { u_b: b });
      ctx.gl.release(b);
      return r;
    },
  },
  {
    id: 'outline', label: 'Contorno (borde exterior)', cat: 'stylize',
    params: [{ key: 'width', label: 'Grosor', type: 'range', min: 1, max: 60, def: 6, unit: ' px', spatial: true }, { key: 'color', label: 'Color', type: 'color', def: '#ffffff' }, pct('opacity', 'Opacidad', 100, 0, 100)],
    margin: (v, u) => num(v, 'width') * u + 4,
    run: (ctx, t, v) => {
      let r = num(v, 'width') * ctx.unit, cur = ctx.pass(COPY, t);
      // Pasos 1/2, 1/4… del radio: forma casi circular en log2(r) pasadas.
      const steps: number[] = [];
      while (r > 0.75) { const s = Math.max(1, Math.ceil(r / 2)); steps.push(s); r -= s; }
      for (const s of steps) { const n = ctx.pass(DILATE, cur, { u_step: s }); ctx.gl.release(cur); cur = n; }
      const out = ctx.pass(OUTLINE, t, { u_col: hexRgb(String(v.color)), u_k: num(v, 'opacity') / 100 }, { u_b: cur });
      ctx.gl.release(cur);
      return out;
    },
  },
  {
    id: 'vignette', label: 'Viñeta', cat: 'stylize',
    params: [pct('amount', 'Intensidad', 60, 0, 100), pct('size', 'Tamaño', 55, 0, 150), pct('soft', 'Suavidad', 60, 1, 150), { key: 'color', label: 'Color', type: 'color', def: '#000000' }, { key: 'round', label: 'Circular', type: 'toggle', def: false }],
    run: (ctx, t, v) => ctx.pass(VIGNETTE, t, { u_k: num(v, 'amount') / 100, u_vsize: num(v, 'size') / 100, u_soft: num(v, 'soft') / 100, u_col: hexRgb(String(v.color)), u_round: v.round === true }),
  },
  {
    id: 'halftone', label: 'Semitono (trama de cómic)', cat: 'stylize',
    params: [{ key: 'cell', label: 'Tamaño del punto', type: 'range', min: 2, max: 80, def: 10, unit: ' px', spatial: true }, { key: 'angle', label: 'Ángulo', type: 'range', min: 0, max: 90, def: 15, unit: '°' }, { key: 'color', label: 'Color (CMYK)', type: 'toggle', def: true }],
    run: (ctx, t, v) => ctx.pass(HALFTONE, t, { u_cell: Math.max(1.5, num(v, 'cell') * ctx.unit), u_ang: (num(v, 'angle') * Math.PI) / 180, u_color: v.color === true }),
  },
  {
    id: 'pixelate', label: 'Pixelar (mosaico)', cat: 'stylize',
    params: [{ key: 'cell', label: 'Tamaño de celda', type: 'range', min: 2, max: 200, def: 16, unit: ' px', spatial: true }],
    margin: (v, u) => num(v, 'cell') * u + 4,
    run: (ctx, t, v) => ctx.pass(PIXEL, t, { u_cell: Math.max(1, num(v, 'cell') * ctx.unit) }),
  },
  {
    id: 'edges', label: 'Detectar bordes', cat: 'stylize',
    params: [pct('amount', 'Intensidad', 100, 10, 400), { key: 'invert', label: 'Línea oscura sobre claro', type: 'toggle', def: true }],
    margin: () => 3,
    run: (ctx, t, v) => ctx.pass(EDGES, t, { u_k: num(v, 'amount') / 100, u_inv: v.invert === true, u_mode: 0 }),
  },
  {
    id: 'emboss', label: 'Relieve', cat: 'stylize',
    params: [pct('amount', 'Intensidad', 100, 10, 400), { key: 'angle', label: 'Luz', type: 'range', min: -180, max: 180, def: 135, unit: '°' }],
    margin: () => 3,
    run: (ctx, t, v) => ctx.pass(EDGES, t, { u_k: num(v, 'amount') / 100, u_inv: (num(v, 'angle') * Math.PI) / 180, u_mode: 1 }),
  },
  {
    id: 'kuwahara', label: 'Pintura al óleo', cat: 'stylize',
    params: [{ key: 'radius', label: 'Pincelada', type: 'range', min: 1, max: 12, def: 4, unit: ' px', spatial: true }],
    margin: (v, u) => { const r = num(v, 'radius') * u; return (r > 6 ? Math.ceil(r / 6) * 7 : r) + 8; },
    run: (ctx, t, v) => {
      const r = num(v, 'radius') * ctx.unit;
      // Radio grande: a menor resolución (la pincelada es más gruesa de todos modos).
      const f = r > 6 ? Math.ceil(r / 6) : 1;
      if (f === 1) return ctx.pass(KUWA, t, { u_r: Math.max(1, Math.round(r)) });
      const small = ctx.pass(COPY, t, {}, {}, { w: Math.ceil(t.w / f), h: Math.ceil(t.h / f) }, [t.w / Math.ceil(t.w / f), t.h / Math.ceil(t.h / f)]);
      const k = ctx.pass(KUWA, small, { u_r: 6 });
      ctx.gl.release(small);
      const up = ctx.pass(COPY, k, {}, {}, { w: t.w, h: t.h }, [k.w / t.w, k.h / t.h]);
      ctx.gl.release(k);
      return up;
    },
  },
  {
    id: 'glitch', label: 'Glitch', cat: 'stylize',
    params: [{ key: 'amount', label: 'Intensidad', type: 'range', min: 0, max: 60, def: 8, unit: ' px', spatial: true }, { key: 'block', label: 'Alto de franja', type: 'range', min: 2, max: 200, def: 24, unit: ' px', spatial: true }, { key: 'seed', label: 'Variación', type: 'range', min: 0, max: 100, def: 7 }],
    margin: (v, u) => num(v, 'amount') * u * 3 + 4,
    run: (ctx, t, v) => ctx.pass(GLITCH, t, { u_k: num(v, 'amount') * ctx.unit, u_block: Math.max(1, num(v, 'block') * ctx.unit), u_seed: num(v, 'seed') }),
  },
  {
    id: 'scanlines', label: 'Pantalla CRT', cat: 'stylize',
    params: [{ key: 'period', label: 'Separación de líneas', type: 'range', min: 2, max: 40, def: 6, unit: ' px', spatial: true }, pct('amount', 'Intensidad', 50, 0, 100), pct('curve', 'Oscurecer bordes', 40, 0, 100)],
    run: (ctx, t, v) => ctx.pass(SCAN, t, { u_k: num(v, 'amount') / 100, u_period: Math.max(1.5, num(v, 'period') * ctx.unit), u_curve: num(v, 'curve') / 100 }),
  },
];

// ---------------------------------------------------------------- distorsión

const DISTORT = `${HEAD}
uniform float u_mode, u_a, u_b, u_c; uniform vec2 u_ctr;
void main() {
  vec2 g = gpos(), q = g;
  if (u_mode < 0.5) {            // ondas
    vec2 dir = vec2(cos(u_c), sin(u_c)), n = vec2(-dir.y, dir.x);
    q = g + n * sin(dot(g - u_doc.xy, dir) / u_b * 6.2831853) * u_a;
  } else if (u_mode < 1.5) {     // remolino
    vec2 d = g - u_ctr; float r = length(d);
    float k = max(0.0, 1.0 - r / u_b); float ang = u_a * k * k;
    q = u_ctr + mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * d;
  } else {                       // abultar / pellizcar
    vec2 d = g - u_ctr; float r = length(d);
    if (r < u_b) { float t = r / u_b; float f = pow(t, 1.0 + u_a) / max(t, 1e-4); q = u_ctr + d * mix(1.0, f, 1.0); }
  }
  o = tx(q - u_offset);
}`;

const distort: EffectDef[] = [
  {
    id: 'wave', label: 'Ondas', cat: 'distort',
    params: [{ key: 'amp', label: 'Amplitud', type: 'range', min: 0, max: 100, def: 10, unit: ' px', spatial: true }, { key: 'len', label: 'Longitud de onda', type: 'range', min: 4, max: 800, def: 120, unit: ' px', spatial: true }, { key: 'angle', label: 'Dirección', type: 'range', min: -180, max: 180, def: 0, unit: '°' }],
    margin: (v, u) => num(v, 'amp') * u + 4,
    run: (ctx, t, v) => ctx.pass(DISTORT, t, { u_mode: 0, u_a: num(v, 'amp') * ctx.unit, u_b: Math.max(2, num(v, 'len') * ctx.unit), u_c: (num(v, 'angle') * Math.PI) / 180 }),
  },
  {
    id: 'twirl', label: 'Remolino', cat: 'distort', global: true,
    params: [{ key: 'angle', label: 'Giro', type: 'range', min: -720, max: 720, def: 180, unit: '°' }, pct('radius', 'Radio', 50, 1, 100), pct('cx', 'Centro X', 50, 0, 100), pct('cy', 'Centro Y', 50, 0, 100)],
    run: (ctx, t, v) => {
      const d = ctx.base.u_doc as number[];
      return ctx.pass(DISTORT, t, { u_mode: 1, u_a: (num(v, 'angle') * Math.PI) / 180, u_b: Math.max(1, num(v, 'radius') / 100 * Math.min(d[2], d[3])), u_ctr: [d[0] + d[2] * num(v, 'cx') / 100, d[1] + d[3] * num(v, 'cy') / 100] });
    },
  },
  {
    id: 'bulge', label: 'Abultar / pellizcar', cat: 'distort', global: true,
    params: [pct('amount', 'Intensidad (− pellizca)', 50, -90, 90), pct('radius', 'Radio', 40, 1, 100), pct('cx', 'Centro X', 50, 0, 100), pct('cy', 'Centro Y', 50, 0, 100)],
    run: (ctx, t, v) => {
      const d = ctx.base.u_doc as number[];
      return ctx.pass(DISTORT, t, { u_mode: 2, u_a: num(v, 'amount') / 100, u_b: Math.max(1, num(v, 'radius') / 100 * Math.min(d[2], d[3])), u_ctr: [d[0] + d[2] * num(v, 'cx') / 100, d[1] + d[3] * num(v, 'cy') / 100] });
    },
  },
];

// ---------------------------------------------------------------- textura

const NOISE = `${HEAD}
uniform float u_k, u_grain, u_mono, u_seed;
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash(i + u_seed), b = hash(i + vec2(1, 0) + u_seed), c = hash(i + vec2(0, 1) + u_seed), d = hash(i + vec2(1, 1) + u_seed);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
void main() {
  vec4 s = tx(inPos()); vec3 c = unpm(s);
  vec2 g = (gpos() - u_doc.xy) / u_grain;
  vec3 n = u_mono > 0.5 ? vec3(vnoise(g)) : vec3(vnoise(g), vnoise(g + 17.3), vnoise(g + 41.7));
  // Grano más visible en los medios tonos, como en la película.
  float w = 1.0 - abs(luma(c) - 0.5) * 1.2;
  c += (n - 0.5) * u_k * w;
  o = pm(c, s.a);
}`;

const DITHER = `${HEAD}
uniform float u_n, u_scale;
float bayer(vec2 p) { // 4×4
  int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0));
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[y * 4 + x]) + 0.5) / 16.0;
}
void main() {
  vec4 s = tx(inPos()); vec3 c = unpm(s);
  float t = bayer(floor((gpos() - u_doc.xy) / u_scale)) - 0.5;
  c = floor(c * (u_n - 1.0) + 0.5 + t) / (u_n - 1.0);
  o = pm(c, s.a);
}`;

const PAPER = `${HEAD}
uniform float u_k, u_scale;
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec4 s = tx(inPos()); vec3 c = unpm(s);
  vec2 g = (gpos() - u_doc.xy) / u_scale;
  float n = vnoise(g) * 0.5 + vnoise(g * 2.1) * 0.3 + vnoise(g * 4.3) * 0.2;
  // Relieve del papel: la pintura se acumula en los valles.
  c *= 1.0 - u_k * (n - 0.5) * 0.6;
  o = pm(c, s.a);
}`;

const texture: EffectDef[] = [
  {
    id: 'noise', label: 'Ruido / grano', cat: 'texture',
    params: [pct('amount', 'Cantidad', 20, 0, 100), { key: 'size', label: 'Tamaño del grano', type: 'range', min: 0.5, max: 20, step: 0.1, def: 1.5, unit: ' px', spatial: true }, { key: 'mono', label: 'Monocromo', type: 'toggle', def: true }, { key: 'seed', label: 'Variación', type: 'range', min: 0, max: 100, def: 0 }],
    run: (ctx, t, v) => ctx.pass(NOISE, t, { u_k: num(v, 'amount') / 100, u_grain: Math.max(0.3, num(v, 'size') * ctx.unit), u_mono: v.mono === true, u_seed: num(v, 'seed') * 13.1 }),
  },
  {
    id: 'dither', label: 'Tramado (dither)', cat: 'texture',
    params: [{ key: 'levels', label: 'Niveles por canal', type: 'range', min: 2, max: 16, def: 4 }, { key: 'scale', label: 'Tamaño de la trama', type: 'range', min: 1, max: 16, def: 2, unit: ' px', spatial: true }],
    run: (ctx, t, v) => ctx.pass(DITHER, t, { u_n: num(v, 'levels'), u_scale: Math.max(1, num(v, 'scale') * ctx.unit) }),
  },
  {
    id: 'paper', label: 'Textura de papel', cat: 'texture',
    params: [pct('amount', 'Intensidad', 35, 0, 100), { key: 'scale', label: 'Escala', type: 'range', min: 2, max: 60, def: 8, unit: ' px', spatial: true }],
    run: (ctx, t, v) => ctx.pass(PAPER, t, { u_k: num(v, 'amount') / 100, u_scale: Math.max(1, num(v, 'scale') * ctx.unit) }),
  },
];

export const EFFECTS: EffectDef[] = [...color, ...blur, ...sharpen, ...stylize, ...distort, ...texture];
export const effectById = (id: string) => EFFECTS.find(e => e.id === id);
export function defaults(e: EffectDef): Values { return Object.fromEntries(e.params.map(p => [p.key, p.def])); }
