import type { Document, Layer } from './Document';
import type { LayerBlend } from './items';

/**
 * Carpetas de capas. Una carpeta agrupa capas seguidas (campo `group` de cada capa):
 * se ocultan, bloquean y componen juntas — sus capas se mezclan entre sí en un
 * lienzo aparte y el resultado entra con la opacidad y el modo de fusión de la
 * carpeta (igual que en Photoshop o Procreate). En una animación las carpetas son
 * los grupos de pistas de la línea de tiempo.
 */
export interface Folder { id: string; name: string; visible: boolean; locked: boolean; opacity: number; collapsed: boolean; blend?: LayerBlend }

export const groupsOf = (doc: Document): Folder[] => doc.anim?.groups ?? doc.folders;
export const folderOf = (doc: Document, l: Layer): Folder | null => (l.group ? groupsOf(doc).find(g => g.id === l.group) ?? null : null);
export const layerVisible = (doc: Document, l: Layer) => l.visible && (folderOf(doc, l)?.visible ?? true);
export const layerLocked = (doc: Document, l: Layer) => l.locked || (folderOf(doc, l)?.locked ?? false);

/**
 * Compone capas respetando las carpetas: `draw(l, g)` dibuja la capa en `g` con su
 * opacidad y fusión; las de una carpeta van a un lienzo aparte que luego entra en
 * `main` con la opacidad y la fusión de la carpeta.
 */
export function composeFolders(doc: Document, layers: Layer[], main: CanvasRenderingContext2D, draw: (l: Layer, g: CanvasRenderingContext2D) => void, blendOp: (b: LayerBlend) => GlobalCompositeOperation) {
  const W = main.canvas.width, H = main.canvas.height;
  let i = 0;
  let buf: CanvasRenderingContext2D | null = null;
  while (i < layers.length) {
    const f = folderOf(doc, layers[i]);
    if (!f) { draw(layers[i++], main); continue; }
    if (!buf) { const c = document.createElement('canvas'); c.width = W; c.height = H; buf = c.getContext('2d')!; }
    buf.setTransform(1, 0, 0, 1, 0, 0); buf.globalAlpha = 1; buf.globalCompositeOperation = 'source-over';
    buf.clearRect(0, 0, W, H);
    while (i < layers.length && folderOf(doc, layers[i]) === f) draw(layers[i++], buf);
    if (!f.visible) continue;
    main.save();
    main.setTransform(1, 0, 0, 1, 0, 0);
    main.globalAlpha = f.opacity;
    main.globalCompositeOperation = blendOp(f.blend ?? 'normal');
    main.drawImage(buf.canvas, 0, 0);
    main.restore();
  }
}

// ---------------------------------------------------------------- comandos de carpetas

const last = <T>(a: T[]): T | null => (a.length ? a[a.length - 1] : null);
const fid = () => `F${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** Capas de una carpeta (de abajo arriba). */
export const membersOf = (doc: Document, id: string) => doc.layers.filter(l => l.group === id);

/** Mueve la capa `l` justo encima de la posición `i` (índice en doc.layers sin contarla). */
function placeAt(doc: Document, l: Layer, above: Layer | null) {
  doc.layers = doc.layers.filter(x => x !== l);
  const i = above ? doc.layers.indexOf(above) + 1 : 0;
  doc.layers.splice(i, 0, l);
}

/** Nueva carpeta con la capa indicada dentro (o vacía si la capa ya está en otra). */
export function cmdNewFolder(doc: Document, layerId: string, name?: string) {
  return doc.cmdStructure('Nueva carpeta', () => {
    const l = doc.layer(layerId);
    if (!l) return false;
    const list = groupsOf(doc);
    const f: Folder = { id: fid(), name: name ?? `Carpeta ${list.length + 1}`, visible: true, locked: false, opacity: 1, collapsed: false, blend: 'normal' };
    list.push(f);
    l.group = f.id;
    return true;
  });
}

/** Mete la capa en la carpeta (encima de sus capas) o la saca (null: encima de la carpeta). */
export function cmdLayerToFolder(doc: Document, layerId: string, folderId: string | null) {
  return doc.cmdStructure(folderId ? 'Meter en la carpeta' : 'Sacar de la carpeta', () => {
    const l = doc.layer(layerId);
    if (!l || (l.group ?? null) === folderId) return false;
    const prev = l.group ?? null;
    if (folderId) {
      const top = last(membersOf(doc, folderId));
      l.group = folderId;
      if (top) placeAt(doc, l, top);
    } else {
      const top = prev ? last(membersOf(doc, prev).filter(x => x !== l)) : null;
      l.group = null;
      if (top) placeAt(doc, l, top);
    }
    doc.activeId = l.id;
    return true;
  });
}

/**
 * Subir o bajar la capa activa respetando las carpetas: en el borde de una carpeta
 * primero sale de ella (o entra en la de al lado) sin cambiar de sitio.
 */
export function cmdMoveLayerFolders(doc: Document, layerId: string, dir: 1 | -1) {
  return doc.cmdStructure(dir > 0 ? 'Subir capa' : 'Bajar capa', () => {
    const i = doc.index(layerId), l = doc.layers[i], n = doc.layers[i + dir];
    if (!l) return false;
    const g = l.group ?? null, ng = n?.group ?? null;
    if (g && ng !== g) { l.group = null; return true; } // sale de su carpeta
    if (!g && ng) { l.group = ng; return true; }         // entra en la carpeta vecina
    if (!n) return false;
    doc.layers[i] = n; doc.layers[i + dir] = l;
    return true;
  });
}

export function cmdFolderProps(doc: Document, id: string, patch: Partial<Folder>, label = 'Propiedades de la carpeta') {
  return doc.cmdStructure(label, () => {
    const f = groupsOf(doc).find(x => x.id === id);
    if (!f) return false;
    Object.assign(f, patch);
    return true;
  });
}

/** Elimina la carpeta: `withLayers` borra también sus capas (si queda alguna capa en el documento). */
export function cmdDeleteFolder(doc: Document, id: string, withLayers: boolean) {
  return doc.cmdStructure(withLayers ? 'Eliminar carpeta y capas' : 'Desagrupar carpeta', () => {
    const list = groupsOf(doc), i = list.findIndex(f => f.id === id);
    if (i < 0) return false;
    const mem = membersOf(doc, id);
    if (withLayers && mem.length >= doc.layers.length) return false;
    list.splice(i, 1);
    if (withLayers) {
      doc.layers = doc.layers.filter(l => !mem.includes(l));
      if (!doc.layer(doc.activeId)) doc.activeId = doc.layers[doc.layers.length - 1].id;
    } else for (const l of mem) l.group = null;
    return true;
  });
}
