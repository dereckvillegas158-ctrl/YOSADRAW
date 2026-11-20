import { Document, MAX_LAYERS } from '../doc/Document';
import type { CanvasEngine } from '../engine';
import { IDENTITY } from '../engine/ViewTransform';
import type { EffectDef, Values } from './effects';
import { applyEffect } from './run';

export type FxTarget = { layer: string } | 'all';

/**
 * Recorta un resultado del tamaño del documento a lo que de verdad tiene contenido
 * (alfa > 0). Un efecto sobre un dibujo pequeño ya no deja una imagen de todo el
 * documento: ocupa menos memoria y se repinta mucho más rápido.
 */
export function cropToContent(c: HTMLCanvasElement): { image: HTMLCanvasElement; x: number; y: number; w: number; h: number } | null {
  const W = c.width, H = c.height;
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    const row = y * W * 4;
    let first = -1, last = -1;
    for (let x = 0; x < W; x++) if (d[row + x * 4 + 3]) { first = x; break; }
    if (first < 0) continue;
    for (let x = W - 1; x >= first; x--) if (d[row + x * 4 + 3]) { last = x; break; }
    if (first < x0) x0 = first; if (last > x1) x1 = last;
    if (y < y0) y0 = y; y1 = y;
  }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w * h > W * H * 0.85) return { image: c, x: 0, y: 0, w: W, h: H };
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  out.getContext('2d')!.drawImage(c, x0, y0, w, h, 0, 0, w, h);
  return { image: out, x: x0, y: y0, w, h };
}

/**
 * Aplica un efecto a resolución de documento como un único paso deshacible.
 * - Capa: su contenido se sustituye por el resultado (respeta selección y alfa bloqueado).
 * - Lienzo: la composición de las capas visibles se procesa en una capa nueva
 *   «Efecto · …» encima, y las capas de origen se ocultan (no se pierde nada).
 */
export async function applyToDocument(engine: CanvasEngine, def: EffectDef, values: Values, mix: number, target: FxTarget, onProgress?: (f: number) => void): Promise<void> {
  const doc = engine.doc;
  const W = doc.width, H = doc.height;
  const sel = doc.selection;
  const mask = sel ? engine.items.selectionMask(sel, IDENTITY, 1, W, H) : null;
  if (target === 'all') {
    const visible = doc.layers.filter(l => l.visible);
    if (!visible.length) throw new Error('No hay capas visibles');
    if (doc.layers.length >= MAX_LAYERS) throw new Error(`Máximo ${MAX_LAYERS} capas: combina o borra alguna antes`);
    const src = engine.rasterizeVisible();
    onProgress?.(0.1);
    const res = await applyEffect(src, def, values, { unit: 1, doc: [0, 0, W, H], mask, mix, yieldBetween: true, onProgress: f => onProgress?.(0.1 + f * 0.9) });
    const layer = doc.newLayer(`Efecto · ${def.label}`);
    const cut = cropToContent(res);
    layer.items = cut ? [doc.item({ kind: 'bitmap', ...cut })] : [];
    const top = doc.layers[doc.layers.length - 1];
    engine.exec(Document.group(`Efecto: ${def.label}`, [doc.cmdAddLayer(top.id, layer), ...visible.map(l => doc.cmdLayerProps(l.id, { visible: false }))]));
    return;
  }
  const l = doc.layer(target.layer);
  if (!l) throw new Error('La capa ya no existe');
  if (!l.visible) throw new Error('La capa está oculta');
  if (l.locked) throw new Error('La capa está bloqueada');
  const src = engine.rasterize([l], 1);
  onProgress?.(0.1);
  const res = await applyEffect(src, def, values, { unit: 1, doc: [0, 0, W, H], mask, keepAlpha: l.alphaLock, mix, yieldBetween: true, onProgress: f => onProgress?.(0.1 + f * 0.9) });
  const cut = cropToContent(res);
  engine.exec(doc.cmdSetItems(l.id, cut ? [doc.item({ kind: 'bitmap', ...cut })] : [], `Efecto: ${def.label}`));
}
