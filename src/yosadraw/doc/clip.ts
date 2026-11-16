import type { Layer } from './Document';

/**
 * Máscara de recorte de capas (como en Procreate o Clip Studio): una capa con
 * `clip` sólo se ve donde hay píxeles de su capa base, la primera capa sin
 * recorte que tiene debajo. Varias capas seguidas con recorte comparten la misma
 * base. Si la base está oculta, también se ocultan las recortadas; una capa con
 * recorte sin nada debajo se ve normal. La opacidad y la fusión de cada capa se
 * aplican después, como siempre.
 */
export function clipBaseOf(layers: readonly Layer[], l: Layer): Layer | null {
  if (!l.clip) return null;
  for (let i = layers.indexOf(l) - 1; i >= 0; i--) if (!layers[i].clip) return layers[i];
  return null;
}

/** ¿Hay capas recortadas sobre esta (es base de alguna)? */
export function hasClipped(layers: readonly Layer[], l: Layer): boolean {
  const i = layers.indexOf(l);
  return !l.clip && i >= 0 && i + 1 < layers.length && !!layers[i + 1].clip;
}

/** Una capa recortada cuya base está oculta no se ve. */
export function clipHidden(layers: readonly Layer[], l: Layer, visible: (b: Layer) => boolean = b => b.visible): boolean {
  const b = clipBaseOf(layers, l);
  return !!b && !visible(b);
}

/** Deja en `ctx` (lienzo entero) sólo lo que cae sobre los píxeles de `base` (mismo tamaño y posición). */
export function maskTo(ctx: CanvasRenderingContext2D, base: CanvasImageSource, dx = 0, dy = 0) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(base, dx, dy);
  ctx.restore();
}

/** Copia de un lienzo (para conservar la imagen de una base mientras se componen las demás). */
export function copyCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}

/**
 * Para bucles que componen capas de abajo arriba sobre un lienzo temporal por capa:
 * `prepare(l, ctx)` recorta la imagen recién pintada en `ctx` si la capa tiene recorte
 * (o la guarda si es base de otras) y dice si hay que dibujarla.
 */
export class ClipComposer {
  private bases = new Map<Layer, HTMLCanvasElement>();
  constructor(private layers: readonly Layer[], private visible: (l: Layer) => boolean = l => l.visible) {}
  prepare(l: Layer, ctx: CanvasRenderingContext2D): boolean {
    if (hasClipped(this.layers, l)) this.bases.set(l, copyCanvas(ctx.canvas));
    const b = clipBaseOf(this.layers, l);
    if (!b) return true;
    if (!this.visible(b)) return false;
    const img = this.bases.get(b);
    // Base vacía o no pintada (sin elementos): no queda nada visible de la recortada.
    if (!img) return false;
    maskTo(ctx, img);
    return true;
  }
}
