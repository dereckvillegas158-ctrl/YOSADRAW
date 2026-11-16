import type { Layer } from '../doc/Document';
import type { Item, LayerBlend } from '../doc/items';
import { ItemRenderer } from '../doc/ItemRenderer';
import type { Mat } from '../engine/ViewTransform';
import type { CanvasEngine } from '../engine';
import { h, toast } from './dom';

const BLENDS: { value: LayerBlend; label: string }[] = [
  { value: 'normal', label: 'Normal' }, { value: 'multiply', label: 'Multiplicar' }, { value: 'screen', label: 'Trama' },
  { value: 'overlay', label: 'Superponer' }, { value: 'darken', label: 'Oscurecer' }, { value: 'lighten', label: 'Aclarar' },
  { value: 'color-burn', label: 'Subexponer color' }, { value: 'color-dodge', label: 'Sobreexponer color' },
  { value: 'soft-light', label: 'Luz suave' }, { value: 'hard-light', label: 'Luz fuerte' }, { value: 'difference', label: 'Diferencia' },
];

const svg = (b: string) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;
const I = {
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7c1.7 0 3.2-.5 4.5-1.2"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  /** Alfa bloqueado: damero (transparencia) con candado. */
  clip: svg('<path d="M7 4v9a4 4 0 0 0 4 4h9"/><path d="m16.5 13.5 3.5 3.5-3.5 3.5"/>'),
  alpha: svg('<path d="M4 4h6v6H4zM10 10h6v6h-6z" fill="currentColor" stroke="none" opacity=".55"/><rect x="4" y="4" width="12" height="12" rx="1"/><rect x="14" y="15" width="7" height="6" rx="1.2"/><path d="M15.5 15v-1.5a2 2 0 0 1 4 0V15"/>'),
  unlock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  dup: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  up: svg('<path d="m6 14 6-6 6 6"/>'),
  down: svg('<path d="m6 10 6 6 6-6"/>'),
  merge: svg('<path d="M7 4v5a5 5 0 0 0 5 5 5 5 0 0 1 5 5v1M17 4v5a5 5 0 0 1-3 4.6"/><path d="m4 17 3 3 3-3"/>'),
  clear: svg('<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 2.5"/><path d="m9 9 6 6M15 9l-6 6"/>'),
  trash: svg('<path d="M4 7h16M9.5 7V4.8a.8.8 0 0 1 .8-.8h3.4a.8.8 0 0 1 .8.8V7M6.5 7l.8 12.2a1 1 0 0 0 1 .8h7.4a1 1 0 0 0 1-.8L17.5 7"/>'),
};

/** Panel de capas. Cada acción es un comando del historial. */
export class LayersPanel {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private opacity: HTMLInputElement;
  private opacityOut: HTMLOutputElement;
  private blend: HTMLSelectElement;
  private thumbs = new Map<string, HTMLCanvasElement>();
  private thumbTimer = 0;
  private dirtyThumbs = new Set<string>();
  private opacityStart: number | null = null;

  constructor(private engine: CanvasEngine) {
    this.list = h('ul', { class: 'layer-list', role: 'listbox', 'aria-label': 'Capas (la de arriba se dibuja encima)' });
    this.opacity = h('input', { type: 'range', id: 'layer-opacity', min: '0', max: '100', step: '1' });
    this.opacityOut = h('output', { for: 'layer-opacity' });
    this.blend = h('select', { id: 'layer-blend' }, ...BLENDS.map(b => h('option', { value: b.value }, b.label)));
    const btn = (icon: string, label: string, fn: () => void) => h('button', { type: 'button', class: 'icon sm', title: label, 'aria-label': label, html: icon, on: { click: fn } });
    const d = () => engine.doc;
    this.el = h('section', { class: 'block layers', 'aria-labelledby': 'layers-title' },
      h('div', { class: 'lib-head' }, h('h2', { id: 'layers-title' }, 'Capas'),
        h('div', { class: 'lib-actions' },
          btn(I.plus, 'Nueva capa (Ctrl+Mayús+N)', () => engine.addLayer()),
          btn(I.dup, 'Duplicar capa (Ctrl+J)', () => engine.exec(d().cmdDuplicateLayer(d().activeId))),
          btn(I.up, 'Subir capa', () => engine.exec(d().cmdMoveLayer(d().activeId, d().index(d().activeId) + 1))),
          btn(I.down, 'Bajar capa', () => engine.exec(d().cmdMoveLayer(d().activeId, d().index(d().activeId) - 1))),
          btn(I.merge, 'Combinar hacia abajo (Ctrl+E)', () => { if (!engine.exec(d().cmdMergeDown(d().activeId))) toast('No hay capa debajo con la que combinar'); }),
          btn(I.clear, 'Vaciar capa', () => { if (d().active.items.length) engine.exec(d().cmdSetItems(d().activeId, [], 'Vaciar capa')); }),
          btn(I.trash, 'Eliminar capa', () => { if (!engine.exec(d().cmdDeleteLayer(d().activeId))) toast('El documento necesita al menos una capa'); }))),
      h('div', { class: 'layer-props' },
        h('label', { for: 'layer-opacity', class: 'row' }, h('span', null, 'Opacidad'), this.opacityOut), this.opacity,
        h('label', { for: 'layer-blend', class: 'row' }, h('span', null, 'Fusión'), this.blend)),
      this.list);

    this.opacity.addEventListener('input', () => {
      const l = d().active;
      if (this.opacityStart === null) this.opacityStart = l.opacity;
      engine.previewLayerProps(l.id, { opacity: Number(this.opacity.value) / 100 });
      this.syncProps();
    });
    this.opacity.addEventListener('change', () => {
      const l = d().active, from = this.opacityStart ?? l.opacity;
      this.opacityStart = null;
      engine.setLayerProps(l.id, { opacity: Number(this.opacity.value) / 100 }, { opacity: from });
    });
    this.blend.addEventListener('change', () => engine.setLayerProps(d().activeId, { blend: this.blend.value as LayerBlend }));

    engine.on('doc', () => {
      this.render();
      // Capas que ya no existen (borradas u otro documento): fuera su ráster de miniatura.
      for (const id of this.raster.keys()) if (!d().layer(id)) this.raster.delete(id);
      for (const id of this.thumbs.keys()) if (!d().layer(id)) this.thumbs.delete(id);
    });
    engine.on('history', () => { for (const l of d().layers) this.dirtyThumbs.add(l.id); this.scheduleThumbs(); });
    this.render();
    for (const l of d().layers) this.dirtyThumbs.add(l.id);
    this.scheduleThumbs();
  }

  private syncProps() {
    const l = this.engine.doc.active;
    this.opacity.value = String(Math.round(l.opacity * 100));
    this.opacity.style.setProperty('--fill', `${this.opacity.value}%`);
    this.opacityOut.textContent = `${this.opacity.value}%`;
    this.blend.value = l.blend;
    const locked = l.locked;
    this.opacity.disabled = locked; this.blend.disabled = locked;
  }

  private thumb(id: string): HTMLCanvasElement {
    let c = this.thumbs.get(id);
    if (!c) { c = h('canvas', { width: '56', height: '42' }); this.thumbs.set(id, c); this.dirtyThumbs.add(id); }
    return c;
  }

  /**
   * Miniaturas de capa incrementales: cada capa guarda un ráster pequeño y qué
   * elementos tiene ya dibujados. Un trazo nuevo sólo pinta ese trazo; deshacer
   * u otros cambios rehacen la miniatura por tandas sin bloquear la interfaz.
   * Antes se rasterizaban todas las capas enteras tras cada trazo.
   */
  private raster = new Map<string, { canvas: HTMLCanvasElement; count: number; last: Item | null; first: Item | null; doc: object }>();
  private renderer: { r: ItemRenderer; doc: object } | null = null;
  private thumbRun = 0;

  private scheduleThumbs() {
    clearTimeout(this.thumbTimer);
    this.thumbTimer = window.setTimeout(() => {
      if (this.engine.isDrawing) { this.scheduleThumbs(); return; }
      void this.updateThumbs();
    }, 250);
  }

  private async updateThumbs() {
    const run = ++this.thumbRun;
    const doc = this.engine.doc;
    if (this.renderer?.doc !== doc) this.renderer = { r: new ItemRenderer(this.engine.painter, doc.width, doc.height), doc };
    const renderer = this.renderer.r;
    let slice = performance.now();
    for (const id of [...this.dirtyThumbs]) {
      const l = doc.layer(id), c = this.thumbs.get(id);
      this.dirtyThumbs.delete(id);
      if (!l || !c) continue;
      const k = Math.min(c.width / doc.width, c.height / doc.height) * 2;
      let st = this.raster.get(id);
      if (!st || st.doc !== doc) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(doc.width * k)); canvas.height = Math.max(1, Math.round(doc.height * k));
        st = { canvas, count: 0, last: null, first: null, doc };
        this.raster.set(id, st);
      }
      const items = l.items;
      // ¿Sólo se añadieron elementos encima? Entonces basta con pintar los nuevos.
      const additive = st.count <= items.length && (st.count === 0 ? st.first === null : items[st.count - 1] === st.last && items[0] === st.first);
      if (additive && st.count === items.length) { this.blitThumb(c, st.canvas, doc, k); continue; }
      const g = st.canvas.getContext('2d')!;
      let from = st.count;
      if (!additive) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, st.canvas.width, st.canvas.height); from = 0; }
      const V: Mat = [k, 0, 0, k, 0, 0];
      for (let i = from; i < items.length; i++) {
        renderer.renderItem(g, items[i], V, 1);
        if (performance.now() - slice > 8) {
          await new Promise(r => setTimeout(r, 0));
          slice = performance.now();
          // Cambió algo mientras tanto: se vuelve a empezar con el estado nuevo.
          if (run !== this.thumbRun || this.engine.doc !== doc || l.items !== items) { st.count = 0; st.last = st.first = null; this.dirtyThumbs.add(id); this.scheduleThumbs(); return; }
        }
      }
      st.count = items.length; st.last = items[items.length - 1] ?? null; st.first = items[0] ?? null;
      this.blitThumb(c, st.canvas, doc, k);
    }
  }

  private blitThumb(c: HTMLCanvasElement, src: HTMLCanvasElement, doc: { width: number; height: number }, k2: number) {
    const k = k2 / 2;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(src, (c.width - doc.width * k) / 2, (c.height - doc.height * k) / 2, doc.width * k, doc.height * k);
  }

  private row(l: Layer, active: boolean): HTMLElement {
    const d = this.engine.doc, e = this.engine;
    const name = h('span', { class: 'layer-name', title: 'Doble clic para renombrar' }, l.name);
    name.addEventListener('dblclick', ev => {
      ev.stopPropagation();
      const input = h('input', { type: 'text', class: 'rename', value: l.name, maxlength: '40', 'aria-label': 'Nombre de la capa' });
      const done = (save: boolean) => { if (save && input.value.trim() && input.value.trim() !== l.name) e.setLayerProps(l.id, { name: input.value.trim() }); else this.render(); };
      input.addEventListener('keydown', k => { k.stopPropagation(); if (k.key === 'Enter') done(true); if (k.key === 'Escape') done(false); });
      input.addEventListener('blur', () => done(true));
      name.replaceWith(input);
      input.focus(); input.select();
    });
    const vis = h('button', { type: 'button', class: 'icon sm', 'aria-pressed': String(l.visible), title: l.visible ? 'Ocultar capa' : 'Mostrar capa', 'aria-label': l.visible ? `Ocultar ${l.name}` : `Mostrar ${l.name}`, html: l.visible ? I.eye : I.eyeOff, on: { click: (ev: Event) => { ev.stopPropagation(); e.setLayerProps(l.id, { visible: !l.visible }, undefined); } } });
    const alpha = h('button', {
      type: 'button', class: 'icon sm alpha-lock', 'aria-pressed': String(l.alphaLock), title: l.alphaLock ? 'Desbloquear alfa (/)' : 'Bloquear alfa: pintar sólo sobre lo que ya hay (/)',
      'aria-label': l.alphaLock ? `Desbloquear alfa de ${l.name}` : `Bloquear alfa de ${l.name}`, html: I.alpha,
      on: { click: (ev: Event) => { ev.stopPropagation(); e.setLayerProps(l.id, { alphaLock: !l.alphaLock }); } },
    });
    // Máscara de recorte: la capa sólo se ve sobre los píxeles de la capa de debajo.
    const clipBtn = h('button', {
      type: 'button', class: 'icon sm clip-btn', 'aria-pressed': String(!!l.clip), disabled: d.layers.indexOf(l) === 0 && !l.clip,
      title: l.clip ? 'Quitar máscara de recorte (Ctrl+Alt+G)' : 'Máscara de recorte: ver esta capa sólo sobre la de debajo (Ctrl+Alt+G)',
      'aria-label': l.clip ? `Quitar recorte de ${l.name}` : `Recortar ${l.name} a la capa de debajo`, html: I.clip,
      on: { click: (ev: Event) => { ev.stopPropagation(); e.setLayerProps(l.id, { clip: !l.clip }); } },
    });
    const lock = h('button', { type: 'button', class: 'icon sm', 'aria-pressed': String(l.locked), title: l.locked ? 'Desbloquear capa' : 'Bloquear capa', 'aria-label': l.locked ? `Desbloquear ${l.name}` : `Bloquear ${l.name}`, html: l.locked ? I.lock : I.unlock, on: { click: (ev: Event) => { ev.stopPropagation(); e.setLayerProps(l.id, { locked: !l.locked }); } } });
    return h('li', {
      class: `layer-row${l.visible ? '' : ' hidden-layer'}${l.clip ? ' clipped' : ''}`, role: 'option', tabindex: '0', 'aria-selected': String(active),
      on: {
        click: () => e.setActiveLayer(l.id),
        keydown: (ev: Event) => { const k = (ev as KeyboardEvent).key; if (k === 'Enter' || k === ' ') { ev.preventDefault(); e.setActiveLayer(l.id); } },
      },
    }, vis, h('span', { class: 'layer-thumb' }, this.thumb(l.id)), h('span', { class: 'layer-meta' }, name, h('span', { class: 'layer-sub' }, `${Math.round(l.opacity * 100)}% · ${BLENDS.find(b => b.value === l.blend)?.label}${l.clip ? ' · recorte' : ''}${l.alphaLock ? ' · alfa bloqueado' : ''}${l.items.length ? '' : ' · vacía'}`)), clipBtn, alpha, lock);
    void d;
  }

  render() {
    const d = this.engine.doc;
    const ids = new Set(d.layers.map(l => l.id));
    for (const id of [...this.thumbs.keys()]) if (!ids.has(id)) this.thumbs.delete(id);
    this.list.replaceChildren(...[...d.layers].reverse().map(l => this.row(l, l.id === d.activeId)));
    this.syncProps();
    this.scheduleThumbs();
  }
}
