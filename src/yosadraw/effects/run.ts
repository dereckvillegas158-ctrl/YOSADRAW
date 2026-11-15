import { defaults, type EffectDef, type FxCtx, type Values } from './effects';
import { getGL, HEAD, type Tex, type Uniforms } from './gl';

/** Mezcla final: intensidad del efecto, máscara de selección y alfa bloqueado. */
const FINISH = `${HEAD}
uniform sampler2D u_orig; uniform sampler2D u_mask; uniform float u_mix, u_hasMask, u_keepAlpha;
void main() {
  vec2 p = inPos();
  vec4 r = tx(p), s = texture(u_orig, p / u_size);
  if (u_keepAlpha > 0.5) r = vec4(unpm(r) * s.a, s.a);
  float m = u_mix * (u_hasMask > 0.5 ? texture(u_mask, p / u_size).a : 1.0);
  o = mix(s, r, m);
}`;

export interface ApplyOptions {
  /** Px de imagen por px de documento (1 al aplicar; escala de la vista en la vista previa). */
  unit: number;
  /** Rectángulo del documento en px de la imagen [x, y, w, h]. */
  doc: [number, number, number, number];
  /** Máscara de selección del mismo tamaño que la imagen (alfa = dentro). */
  mask?: HTMLCanvasElement | null;
  /** Conservar el alfa de la imagen original (capa con alfa bloqueado). */
  keepAlpha?: boolean;
  /** Intensidad global del efecto (0..1). */
  mix?: number;
  /** Tamaño máximo de mosaico (px). */
  tile?: number;
  onProgress?(f: number): void;
  /** Cede el hilo entre mosaicos (aplicar) o no (vista previa, un solo mosaico). */
  yieldBetween?: boolean;
  /** Lienzo de salida que se reutiliza (vista previa: sin crear uno nuevo en cada ajuste). */
  into?: HTMLCanvasElement;
}

/**
 * Aplica un efecto a una imagen (canvas 2D) y devuelve otra del mismo tamaño.
 * Imágenes grandes se procesan por mosaicos con un margen igual al alcance
 * del efecto, así no aparecen costuras. Los efectos «globales» (centro,
 * remolino…) usan la imagen entera, reducida si no cabe en una textura.
 */
export async function applyEffect(src: HTMLCanvasElement, def: EffectDef, values: Values, o: ApplyOptions): Promise<HTMLCanvasElement> {
  const gl = getGL();
  const v = { ...defaults(def), ...values };
  const W = src.width, H = src.height;
  const out = o.into ?? document.createElement('canvas');
  if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
  const octx = out.getContext('2d')!;
  // Se limpia una vez y cada mosaico se dibuja encima (sobre transparente, «source-over» copia exacto;
  // «copy» borraría los mosaicos anteriores).
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.globalCompositeOperation = 'source-over';
  octx.globalAlpha = 1;
  octx.clearRect(0, 0, W, H);
  const maxTex = gl.maxTex;
  const tileMax = Math.min(o.tile ?? 2048, maxTex);

  // Efectos globales (centro, remolino…): la imagen entera de una vez, reducida si no cabe.
  if (def.global) {
    const k = Math.min(1, maxTex / Math.max(W, H));
    const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
    const srcK = k < 1 ? scaled(src, w, h) : src;
    const maskK = o.mask ? (k < 1 ? scaled(o.mask, w, h) : o.mask) : null;
    const res = runTile(def, v, srcK, maskK, 0, 0, 0, w, h, { ...o, unit: o.unit * k, doc: o.doc.map(x => x * k) as ApplyOptions['doc'] }, [w, h]);
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(res, 0, 0, w, h, 0, 0, W, H);
    o.onProgress?.(1);
    return out;
  }

  // Mosaicos alineados a 64 px (origen, margen y tamaño): las pirámides de reducción
  // de los desenfoques caen en la misma rejilla global y no aparecen costuras.
  const margin = Math.ceil(Math.max(0, def.margin?.(v, o.unit) ?? 2));
  const m = margin > 0 ? up(margin) : 0;
  let inner = Math.floor((tileMax - 2 * m) / ALIGN) * ALIGN;
  if (inner < 256) inner = 256;
  if (W + 2 * m <= tileMax && H + 2 * m <= tileMax) inner = Math.max(up(W), up(H));
  const tiles: [number, number][] = [];
  for (let y = 0; y < H; y += inner) for (let x = 0; x < W; x += inner) tiles.push([x, y]);
  let done = 0;
  for (const [x, y] of tiles) {
    const iw = Math.min(inner, W - x), ih = Math.min(inner, H - y);
    const res = runTile(def, v, src, o.mask ?? null, x, y, m, up(iw + 2 * m), up(ih + 2 * m), o, [W, H]);
    octx.drawImage(res, m, m, iw, ih, x, y, iw, ih);
    o.onProgress?.(++done / tiles.length);
    if (o.yieldBetween && tiles.length > 1) await new Promise(r => setTimeout(r, 0));
  }
  return out;
}

const ALIGN = 64;
const up = (n: number) => Math.ceil(n / ALIGN) * ALIGN;

const tileCanvas = () => document.createElement('canvas').getContext('2d', { willReadFrequently: false })!;
let tileA: CanvasRenderingContext2D | null = null, tileM: CanvasRenderingContext2D | null = null;

/** Recorta (con margen transparente fuera de la imagen) y procesa un mosaico; devuelve el lienzo GL con el resultado. */
function runTile(def: EffectDef, v: Values, src: HTMLCanvasElement, mask: HTMLCanvasElement | null, x: number, y: number, m: number, tw: number, th: number, o: ApplyOptions, full: [number, number]): HTMLCanvasElement {
  const gl = getGL();
  const sx = x - m, sy = y - m;
  let input: Tex, maskTex: Tex | null = null;
  if (m === 0 && x === 0 && y === 0 && tw === src.width && th === src.height) {
    input = gl.upload(src, tw, th);
    if (mask) maskTex = gl.upload(mask, tw, th);
  } else {
    tileA ??= tileCanvas();
    sizeTo(tileA, tw, th);
    tileA.clearRect(0, 0, tw, th);
    tileA.drawImage(src, -sx, -sy);
    input = gl.upload(tileA.canvas, tw, th);
    if (mask) {
      tileM ??= tileCanvas();
      sizeTo(tileM, tw, th);
      tileM.clearRect(0, 0, tw, th);
      tileM.drawImage(mask, -sx, -sy);
      maskTex = gl.upload(tileM.canvas, tw, th);
    }
  }
  const base: Uniforms = { u_offset: [sx, sy], u_full: full, u_doc: o.doc, u_unit: o.unit };
  const ctx: FxCtx = {
    gl, base, unit: o.unit,
    pass: (fs, t, uniforms = {}, extra = {}, outSize, scaleIn) => gl.run(fs, { u_tex: t, ...extra }, { ...uniforms, ...(scaleIn ? { u_scaleIn: scaleIn } : {}) }, outSize ?? { w: t.w, h: t.h }, base),
  };
  const res = def.run(ctx, input, v);
  const fin = gl.run(FINISH, { u_tex: res, u_orig: input, ...(maskTex ? { u_mask: maskTex } : {}) }, { u_mix: o.mix ?? 1, u_hasMask: !!maskTex, u_keepAlpha: !!o.keepAlpha }, { w: tw, h: th }, base);
  gl.present(fin, 0, 0, tw, th);
  gl.release(input, maskTex, res, fin);
  return gl.canvas;
}

function sizeTo(c: CanvasRenderingContext2D, w: number, h: number) { if (c.canvas.width !== w || c.canvas.height !== h) { c.canvas.width = w; c.canvas.height = h; } }

function scaled(src: HTMLCanvasElement, w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);
  return c;
}
