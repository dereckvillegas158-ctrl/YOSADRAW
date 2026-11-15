import { Emitter } from '../engine/Emitter';
import { clonePreset, DEFAULT_PRESET, newId, normalizePreset, type BrushPreset } from './BrushPreset';
import { BUILTIN_PRESETS, CATEGORY_ORDER, DEFAULT_BRUSH_ID, DEFAULT_ERASER_ID, FACTORY_VERSION, LEGACY_CATEGORY } from './builtin';
import type { LibraryData, LibraryStorage } from './storage';

/** Cada herramienta de pincel (lápiz, pluma, óleo, borrador…) recuerda su propio pincel. */
export type Slot = string;

export type LibraryEvents = {
  change: void;
  active: { tool: Slot; preset: BrushPreset };
  saved: { ok: boolean; error?: string };
};

export interface ImportResult { added: BrushPreset[]; errors: string[] }

/**
 * Biblioteca de pinceles: crear, duplicar, editar, borrar, restablecer,
 * importar y exportar. Cada cambio se guarda automáticamente.
 * Los presets son inmutables desde fuera: `update` sustituye el objeto, así
 * los trazos ya dibujados conservan los ajustes con los que se hicieron.
 */
export class BrushLibrary extends Emitter<LibraryEvents> {
  private list: BrushPreset[] = [];
  private slots: Record<Slot, string> = { brush: DEFAULT_BRUSH_ID, eraser: DEFAULT_ERASER_ID };
  color = '#1b1530';
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor(private storage: LibraryStorage) { super(); }

  static async open(storage: LibraryStorage): Promise<BrushLibrary> {
    const lib = new BrushLibrary(storage);
    let data: LibraryData | null = null;
    try { data = await storage.load(); } catch { data = null; }
    if (data && Array.isArray(data.presets) && data.presets.length) {
      const seen = new Set<string>();
      for (const raw of data.presets) {
        const p = normalizePreset(raw);
        if (seen.has(p.id)) p.id = newId();
        seen.add(p.id);
        lib.list.push(Object.freeze(p));
      }
      lib.slots = { ...(data.slots ?? {}), brush: data.activeBrushId, eraser: data.activeEraserId };
      if (typeof data.color === 'string' && /^#[0-9a-f]{6}$/i.test(data.color)) lib.color = data.color;
      if ((data.factory ?? 1) < FACTORY_VERSION) lib.migrate();
    } else {
      lib.list = BUILTIN_PRESETS.map(p => Object.freeze(clonePreset(p)));
    }
    for (const [slot, id] of Object.entries(lib.slots)) if (!lib.get(id)) delete lib.slots[slot];
    if (!lib.slots.brush) lib.slots.brush = lib.list[0].id;
    if (!lib.slots.eraser) lib.slots.eraser = lib.list.find(p => p.category === 'Borradores')?.id ?? lib.list[0].id;
    return lib;
  }

  /**
   * Actualiza una biblioteca guardada con una versión anterior del juego de
   * fábrica: los pinceles de fábrica que conservan su categoría original pasan
   * a la nueva, y se añaden los pinceles nuevos. No toca los cambios del usuario.
   */
  private migrate() {
    const factory = new Map(BUILTIN_PRESETS.map(b => [b.builtinId!, b]));
    this.list = this.list.map(p => {
      const f = p.builtinId ? factory.get(p.builtinId) : undefined;
      if (f && LEGACY_CATEGORY[p.builtinId!] === p.category && f.category !== p.category) return Object.freeze({ ...clonePreset(p), category: f.category });
      return p;
    });
    this.restoreFactory(false);
  }

  get storageKind() { return this.storage.kind; }
  get presets(): readonly BrushPreset[] { return this.list; }
  get(id: string): BrushPreset | undefined { return this.list.find(p => p.id === id); }
  /**
   * Pincel activo de una herramienta. Si la herramienta aún no tiene uno, se
   * usa el primero de sus categorías.
   */
  activeFor(slot: Slot, categories?: string[]): BrushPreset {
    const p = this.get(this.slots[slot]);
    if (p) return p;
    const first = (categories?.length && this.list.find(x => categories.includes(x.category))) || this.list[0];
    this.slots[slot] = first.id;
    return first;
  }
  activeId(slot: Slot) { return this.slots[slot] ?? this.activeFor(slot).id; }

  categories(): string[] {
    const set = new Set(this.list.map(p => p.category));
    return [...CATEGORY_ORDER.filter(c => set.has(c)), ...[...set].filter(c => !CATEGORY_ORDER.includes(c)).sort()];
  }

  setActive(slot: Slot, id: string) {
    const p = this.get(id);
    if (!p) return;
    this.slots[slot] = id;
    this.emit('active', { tool: slot, preset: p });
    this.changed();
  }

  setColor(c: string) { this.color = c; this.scheduleSave(); }

  /** Sustituye un preset (mismo id) por una versión editada. */
  update(edited: BrushPreset): BrushPreset {
    const i = this.list.findIndex(p => p.id === edited.id);
    if (i < 0) throw new Error('El pincel ya no existe en la biblioteca.');
    const next = Object.freeze(normalizePreset({ ...clonePreset(edited), revision: this.list[i].revision + 1 }));
    this.list[i] = next;
    this.emitActiveIfUsed(next);
    this.changed();
    return next;
  }

  add(preset: BrushPreset, afterId?: string): BrushPreset {
    const p = Object.freeze(normalizePreset({ ...clonePreset(preset), id: newId(), builtinId: undefined, revision: 1 }));
    const i = afterId ? this.list.findIndex(x => x.id === afterId) : -1;
    if (i >= 0) this.list.splice(i + 1, 0, p); else this.list.push(p);
    this.changed();
    return p;
  }

  create(category = 'Mis pinceles'): BrushPreset {
    return this.add({ ...clonePreset(DEFAULT_PRESET), name: this.uniqueName('Pincel nuevo'), category });
  }

  duplicate(id: string): BrushPreset | undefined {
    const src = this.get(id);
    if (!src) return;
    return this.add({ ...clonePreset(src), name: this.uniqueName(`${src.name} copia`) }, id);
  }

  remove(id: string): boolean {
    if (this.list.length <= 1) return false;
    const i = this.list.findIndex(p => p.id === id);
    if (i < 0) return false;
    this.list.splice(i, 1);
    for (const [slot, sid] of Object.entries(this.slots)) {
      if (sid !== id) continue;
      const fallback = (slot === 'eraser' && this.list.find(p => p.category === 'Borradores')) || this.list[Math.min(i, this.list.length - 1)];
      this.setActive(slot, fallback.id);
    }
    this.changed();
    return true;
  }

  /** true si es un pincel de fábrica que se ha modificado. */
  isModified(p: BrushPreset): boolean {
    const f = p.builtinId && BUILTIN_PRESETS.find(b => b.builtinId === p.builtinId);
    if (!f) return false;
    const strip = (x: BrushPreset) => JSON.stringify({ ...x, id: '', revision: 0 });
    return strip(f) !== strip(p);
  }

  reset(id: string): BrushPreset | undefined {
    const p = this.get(id);
    const f = p?.builtinId && BUILTIN_PRESETS.find(b => b.builtinId === p.builtinId);
    if (!p || !f) return;
    return this.update({ ...clonePreset(f), id: p.id });
  }

  /** Vuelve a añadir los pinceles de fábrica que falten. Devuelve cuántos. */
  restoreFactory(notify = true): number {
    const have = new Set(this.list.map(p => p.builtinId).filter(Boolean));
    let n = 0;
    for (const b of BUILTIN_PRESETS) if (!have.has(b.builtinId)) {
      this.list.push(Object.freeze({ ...clonePreset(b), id: this.get(b.id) ? newId() : b.id }));
      n++;
    }
    if (n && notify) this.changed();
    return n;
  }

  /* ---------- Importar / exportar ---------- */

  exportJSON(ids?: string[]): string {
    const presets = (ids ? this.list.filter(p => ids.includes(p.id)) : this.list).map(p => clonePreset(p));
    return JSON.stringify({ format: 'yosadraw-brushes', version: 1, exportedAt: new Date().toISOString(), presets }, null, 2);
  }

  /** Acepta un archivo .yosabrush (uno o varios pinceles) o un preset suelto. */
  importJSON(text: string, sourceName = 'archivo'): ImportResult {
    const res: ImportResult = { added: [], errors: [] };
    let data: unknown;
    try { data = JSON.parse(text); } catch { res.errors.push(`${sourceName}: no es un JSON válido.`); return res; }
    const d = data as Record<string, unknown>;
    let items: unknown[];
    if (d && Array.isArray(d.presets)) items = d.presets;
    else if (d && (d.format === 'yosadraw-brush' || d.tip || d.size)) items = [d];
    else if (Array.isArray(data)) items = data;
    else { res.errors.push(`${sourceName}: no contiene pinceles de YOSADRAW.`); return res; }
    items.forEach((raw, i) => {
      if (!raw || typeof raw !== 'object') { res.errors.push(`${sourceName}: el elemento ${i + 1} no es un pincel.`); return; }
      const p = normalizePreset(raw);
      const name = this.get(p.id) || this.list.some(x => x.name === p.name) ? this.uniqueName(p.name) : p.name;
      res.added.push(this.add({ ...p, name, category: (raw as { category?: string }).category ? p.category : 'Importados' }));
    });
    return res;
  }

  private uniqueName(base: string): string {
    const names = new Set(this.list.map(p => p.name));
    if (!names.has(base)) return base;
    for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
  }

  /* ---------- Guardado ---------- */

  private emitActiveIfUsed(p: BrushPreset) {
    for (const [slot, id] of Object.entries(this.slots)) if (id === p.id) this.emit('active', { tool: slot, preset: p });
  }

  private changed() { this.emit('change', undefined); this.scheduleSave(); }

  scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveNow(), 400);
  }

  async saveNow(): Promise<void> {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    try {
      await this.storage.save(this.toData());
      this.emit('saved', { ok: true });
    } catch (e) {
      this.emit('saved', { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  toData(): LibraryData {
    return {
      format: 'yosadraw-library', version: 1, factory: FACTORY_VERSION, presets: this.list.map(p => clonePreset(p)),
      activeBrushId: this.slots.brush, activeEraserId: this.slots.eraser, slots: { ...this.slots }, color: this.color,
    };
  }
}
