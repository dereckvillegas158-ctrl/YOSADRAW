import { combineBounds } from './util';
import { localBounds, transformItem, type Item, type ItemData, type LayerBlend } from './items';
import { selectionBounds, type Selection } from './Selection';
import { transformAABB, type Mat } from '../engine/ViewTransform';
import type { Animation, Cel } from '../anim/model';
import type { Motion } from '../motion/model';
import type { Studio3 } from '../studio3d/model';
import type { Folder } from './folders';

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  /** Bloquear alfa: lo que se pinta sólo cambia el color de lo que ya hay, nunca la transparencia. */
  alphaLock: boolean;
  opacity: number;
  blend: LayerBlend;
  items: Item[];
  /** Animación: cels de la pista (sin definir = capa estática, igual en todos los fotogramas). */
  cels?: Cel[];
  /** Grupo de pistas. */
  group?: string | null;
  /** Insertar o quitar tiempo en una pista sincronizada desplaza también las demás sincronizadas. */
  sync?: boolean;
  /** Pista de referencia: se ve al animar pero no se exporta. */
  reference?: boolean;
  /** Máscara de recorte: sólo se ve sobre los píxeles de la capa base de debajo (doc/clip.ts). */
  clip?: boolean;
  /** Capa vectorial: los trazos se guardan como líneas editables (nodos, color, grosor). */
  vector?: boolean;
}

/** Cambio deshacible. `layers` = capas cuyo contenido cambia ('structure' = orden/altas/bajas). */
export interface Command {
  label: string;
  layers: string[];
  structure?: boolean;
  selection?: boolean;
  /** Cambia la línea de tiempo (cels, fotograma actual…). */
  anim?: boolean;
  redo(): void;
  undo(): void;
}

export const MAX_LAYERS = 32;

/**
 * Imagen de referencia: ventana flotante sobre el lienzo con una imagen para
 * copiar (no forma parte del dibujo ni de la exportación). Se guarda con el proyecto.
 */
export interface RefImage {
  id: string;
  name: string;
  image: HTMLCanvasElement;
  /** Ventana en fracciones de la pantalla (x, y, ancho, alto). */
  rect: [number, number, number, number];
  /** Zoom y desplazamiento de la imagen dentro de la ventana (px de imagen en el centro). */
  zoom: number;
  pan: [number, number];
  opacity: number;
}

export type DocProfile = 'srgb' | 'p3' | 'gray';

/** Propiedades del documento que se guardan con el proyecto. */
export interface DocSettings {
  /** Color del papel, o null para fondo transparente. */
  background: string | null;
  /** Resolución de impresión (píxeles por pulgada). */
  dpi: number;
  /** Perfil de color de trabajo (se propone al exportar). */
  profile: DocProfile;
}

/**
 * Documento: capas ordenadas (de abajo arriba) con sus elementos, la capa
 * activa y la selección. Toda modificación se hace a través de comandos
 * (`cmd*`), que el historial ejecuta, deshace y rehace.
 */
export class Document {
  layers: Layer[] = [];
  activeId = '';
  selection: Selection | null = null;
  settings: DocSettings = { background: '#ffffff', dpi: 300, profile: 'srgb' };
  /** Imágenes de referencia (no deshacibles, no se exportan). */
  references: RefImage[] = [];
  /** Animación (null = proyecto de dibujo normal). */
  anim: Animation | null = null;
  /** Proyecto de vídeo de YOSADRAW MOTION (null = dibujo o animación). */
  motion: Motion | null = null;
  /** Proyecto 3D de YOSADRAW 3D Studio (null = otro tipo de proyecto). */
  s3d: Studio3 | null = null;
  /** Carpetas de capas (dibujo; en una animación se usan los grupos de pistas). */
  folders: Folder[] = [];
  private nextItem = 1;
  private nextLayer = 1;

  constructor(readonly width: number, readonly height: number, settings?: Partial<DocSettings>) {
    const l = this.newLayer('Capa 1');
    this.layers.push(l);
    this.activeId = l.id;
    if (settings) this.settings = { ...this.settings, ...settings };
  }

  /** Contadores internos (para guardar y restaurar sin repetir identificadores). */
  get counters() { return { nextItem: this.nextItem, nextLayer: this.nextLayer }; }

  /** Sustituye el contenido completo (al abrir un proyecto). */
  restore(layers: Layer[], activeId: string, selection: Selection | null, counters: { nextItem: number; nextLayer: number }) {
    if (!layers.length) throw new Error('El proyecto no tiene capas');
    this.layers = layers;
    this.activeId = layers.some(l => l.id === activeId) ? activeId : layers[layers.length - 1].id;
    this.selection = selection;
    const maxItem = (items: Item[]): number => items.reduce((m, i) => Math.max(m, i.id, i.kind === 'group' ? maxItem(i.items) : 0), 0);
    this.nextItem = Math.max(counters.nextItem, 1 + Math.max(0, ...layers.map(l => Math.max(maxItem(l.items), ...(l.cels ?? []).map(c => maxItem(c.content.items))))));
    this.nextLayer = Math.max(counters.nextLayer, layers.length + 1);
  }

  /* ---------- Consultas ---------- */
  layer(id: string): Layer | undefined { return this.layers.find(l => l.id === id); }
  get active(): Layer { return this.layer(this.activeId) ?? this.layers[this.layers.length - 1]; }
  index(id: string) { return this.layers.findIndex(l => l.id === id); }

  newLayer(name?: string): Layer {
    const n = this.nextLayer++;
    return { id: `L${n}_${Math.random().toString(36).slice(2, 7)}`, name: name ?? `Capa ${n}`, visible: true, locked: false, alphaLock: false, opacity: 1, blend: 'normal', items: [] };
  }

  /** Crea un elemento con identificador y cajas calculadas. */
  item(data: ItemData, extra: { m?: Mat | null; clip?: Selection | null } = {}): Item {
    let local = localBounds(data, this.width, this.height);
    // Un elemento recortado por una selección no puede salir de ella.
    const sb = extra.clip ? selectionBounds(extra.clip) : null;
    if (sb) local = { minX: Math.max(local.minX, sb.minX), minY: Math.max(local.minY, sb.minY), maxX: Math.min(local.maxX, sb.maxX), maxY: Math.min(local.maxY, sb.maxY) };
    const m = extra.m ?? null;
    return { ...data, id: this.nextItem++, m, clip: extra.clip ?? null, local, bounds: m ? transformAABB(m, local) : local } as Item;
  }

  /**
   * Elemento pintado por una herramienta de pintura (pincel, bote, degradado, formas):
   * si la capa tiene el alfa bloqueado, queda marcado para dibujarse sólo sobre lo existente.
   */
  paintItem(layerId: string, data: ItemData, extra: { m?: Mat | null; clip?: Selection | null } = {}): Item {
    const it = this.item(data, extra);
    if (this.layer(layerId)?.alphaLock) it.lock = true;
    return it;
  }

  /* ---------- Comandos ---------- */

  cmdAddItems(layerId: string, items: Item[], label: string): Command {
    const l = () => this.layer(layerId)!;
    return {
      label, layers: [layerId],
      redo: () => { l().items = [...l().items, ...items]; },
      undo: () => { const ids = new Set(items.map(i => i.id)); l().items = l().items.filter(i => !ids.has(i.id)); },
    };
  }

  /** Sustituye todo el contenido de una capa (transformar, vaciar). */
  cmdSetItems(layerId: string, next: Item[], label: string): Command {
    const before = this.layer(layerId)!.items.slice();
    return {
      label, layers: [layerId],
      redo: () => { this.layer(layerId)!.items = next.slice(); },
      undo: () => { this.layer(layerId)!.items = before.slice(); },
    };
  }

  cmdTransformLayer(layerId: string, t: Mat): Command {
    return this.cmdSetItems(layerId, this.layer(layerId)!.items.map(i => transformItem(i, t)), 'Transformar capa');
  }

  cmdAddLayer(above?: string, layer = this.newLayer()): Command {
    const prevActive = this.activeId;
    return {
      label: 'Nueva capa', layers: [layer.id], structure: true,
      redo: () => {
        const i = above ? this.index(above) : this.layers.length - 1;
        // Una capa nueva sobre otra de una carpeta entra en esa carpeta.
        if (layer.group === undefined && above) layer.group = this.layer(above)?.group ?? null;
        this.layers.splice(i + 1, 0, layer); this.activeId = layer.id;
      },
      undo: () => { this.layers = this.layers.filter(l => l !== layer); this.activeId = prevActive; },
    };
  }

  /**
   * Cambio de estructura con deshacer: orden de capas, carpetas y pertenencia. `fn`
   * modifica el documento; si devuelve false, no hay cambio.
   */
  cmdStructure(label: string, fn: () => boolean | void): Command | null {
    const snap = () => ({ layers: this.layers.slice(), groups: this.layers.map(l => l.group ?? null), folders: this.folders.map(f => ({ ...f })), groupsAnim: this.anim?.groups.map(g => ({ ...g })), activeId: this.activeId });
    const before = snap();
    if (fn() === false) return null;
    const after = snap();
    const apply = (s: ReturnType<typeof snap>) => {
      this.layers = s.layers.slice();
      s.layers.forEach((l, i) => { l.group = s.groups[i]; });
      this.folders = s.folders.map(f => ({ ...f }));
      if (this.anim && s.groupsAnim) this.anim.groups = s.groupsAnim.map(g => ({ ...g }));
      this.activeId = s.activeId;
    };
    return { label, layers: [...new Set([...before.layers, ...after.layers].map(l => l.id))], structure: true, redo: () => apply(after), undo: () => apply(before) };
  }

  cmdDuplicateLayer(id: string): Command {
    const src = this.layer(id)!;
    const copy: Layer = {
      ...src, id: this.newLayer().id, name: `${src.name} copia`, items: src.items.slice(),
      // Cada cel duplicado tiene su propio contenido (editar la copia no cambia el original).
      cels: src.cels?.map(c => ({ ...c, id: `${c.id}d${Math.random().toString(36).slice(2, 6)}`, content: { items: c.content.items.slice() } })),
    };
    if (copy.cels && this.anim) copy.items = copy.cels.find(c => this.anim!.current >= c.start && this.anim!.current < c.start + c.length)?.content.items ?? [];
    return { ...this.cmdAddLayer(id, copy), label: 'Duplicar capa' };
  }

  cmdDeleteLayer(id: string): Command | null {
    if (this.layers.length <= 1) return null;
    const i = this.index(id), layer = this.layers[i], prevActive = this.activeId;
    return {
      label: 'Eliminar capa', layers: [id], structure: true,
      redo: () => { this.layers.splice(this.index(id), 1); if (this.activeId === id) this.activeId = this.layers[Math.max(0, i - 1)].id; },
      undo: () => { this.layers.splice(i, 0, layer); this.activeId = prevActive; },
    };
  }

  cmdMoveLayer(id: string, to: number): Command | null {
    const from = this.index(id);
    to = Math.max(0, Math.min(this.layers.length - 1, to));
    if (from < 0 || from === to) return null;
    const move = (a: number, b: number) => { const [l] = this.layers.splice(a, 1); this.layers.splice(b, 0, l); };
    return { label: 'Mover capa', layers: [id], structure: true, redo: () => move(from, to), undo: () => move(to, from) };
  }

  cmdLayerProps(id: string, patch: Partial<Pick<Layer, 'name' | 'visible' | 'locked' | 'alphaLock' | 'opacity' | 'blend' | 'clip'>>, label = 'Propiedades de capa'): Command {
    const l = this.layer(id)!;
    const before = Object.fromEntries(Object.keys(patch).map(k => [k, (l as unknown as Record<string, unknown>)[k]])) as typeof patch;
    return {
      label, layers: [id], structure: true,
      redo: () => Object.assign(this.layer(id)!, patch),
      undo: () => Object.assign(this.layer(id)!, before),
    };
  }

  /** Fusiona la capa con la de debajo conservando su opacidad y fusión (sin rasterizar). */
  cmdMergeDown(id: string): Command | null {
    const i = this.index(id);
    if (i <= 0) return null;
    const upper = this.layers[i], lower = this.layers[i - 1];
    // Las pistas animadas no se combinan (cada fotograma tiene su propio dibujo).
    if (upper.cels || lower.cels) return null;
    const lowerItems = lower.items.slice(), prevActive = this.activeId;
    // Una capa con recorte sobre su base se combina como grupo «sobre lo que ya hay» (source-atop):
    // conserva el recorte dentro de la capa resultante.
    const clipped = !!upper.clip && !lower.clip;
    // Borrados («clear», borrador), alfa bloqueado o trazos con fusión dependen de lo que hay
    // debajo dentro de la capa: sueltos en la de abajo borrarían o teñirían su relleno.
    // Entonces la capa de arriba entra como grupo aislado (se ve exactamente igual que antes).
    const selfContained = upper.items.every(it => it.kind !== 'clear' && !it.lock
      && !(it.kind === 'stroke' && (it.stroke.tool === 'eraser' || it.stroke.preset.render.blend !== 'normal')));
    const content: Item[] = upper.opacity === 1 && upper.blend === 'normal' && !clipped && selfContained
      ? upper.items.slice()
      : [Object.assign(this.item({ kind: 'group', items: upper.items.slice(), opacity: upper.opacity, blend: upper.blend }), clipped ? { lock: true } : {})];
    return {
      label: 'Combinar hacia abajo', layers: [upper.id, lower.id], structure: true,
      redo: () => { lower.items = [...lowerItems, ...content]; this.layers.splice(this.index(upper.id), 1); this.activeId = lower.id; },
      undo: () => { lower.items = lowerItems.slice(); this.layers.splice(this.index(lower.id) + 1, 0, upper); this.activeId = prevActive; },
    };
  }

  cmdSelection(next: Selection | null, label = 'Selección'): Command {
    const before = this.selection;
    return { label, layers: [], selection: true, redo: () => { this.selection = next; }, undo: () => { this.selection = before; } };
  }

  /** Varios comandos como uno solo. */
  static group(label: string, cmds: (Command | null)[]): Command {
    const list = cmds.filter((c): c is Command => !!c);
    return {
      label,
      layers: [...new Set(list.flatMap(c => c.layers))],
      structure: list.some(c => c.structure), selection: list.some(c => c.selection),
      redo: () => list.forEach(c => c.redo()),
      undo: () => [...list].reverse().forEach(c => c.undo()),
    };
  }

  /** Caja de todo el contenido de una capa. */
  contentBounds(id: string) { return combineBounds(this.layer(id)!.items.filter(i => i.kind !== 'clear').map(i => i.bounds)); }
}

/** Historial de comandos. */
export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  constructor(public limit = 300) {}

  exec(cmd: Command): Command {
    cmd.redo();
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    return cmd;
  }
  undo(): Command | undefined { const c = this.undoStack.pop(); if (c) { c.undo(); this.redoStack.push(c); } return c; }
  redo(): Command | undefined { const c = this.redoStack.pop(); if (c) { c.redo(); this.undoStack.push(c); } return c; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get undoDepth() { return this.undoStack.length; }
  get redoDepth() { return this.redoStack.length; }
  get peekUndo(): Command | undefined { return this.undoStack[this.undoStack.length - 1]; }
  get peekRedo(): Command | undefined { return this.redoStack[this.redoStack.length - 1]; }
  get nextUndo() { return this.undoStack[this.undoStack.length - 1]?.label; }
  get nextRedo() { return this.redoStack[this.redoStack.length - 1]?.label; }
}
