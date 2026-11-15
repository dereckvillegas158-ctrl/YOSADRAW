import { Document, MAX_LAYERS } from '../doc/Document';
import type { CanvasEngine } from '../engine';
import { IDENTITY } from '../engine/ViewTransform';
import type { EffectDef, Values } from './effects';
import { applyEffect } from './run';

export type FxTarget = { layer: string } | 'all';

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
    layer.items = [doc.item({ kind: 'bitmap', image: res, x: 0, y: 0, w: W, h: H })];
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
  const item = doc.item({ kind: 'bitmap', image: res, x: 0, y: 0, w: W, h: H });
  engine.exec(doc.cmdSetItems(l.id, [item], `Efecto: ${def.label}`));
}
