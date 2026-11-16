import { MAX_LAYERS, type RefImage } from '../doc/Document';
import type { CanvasEngine } from '../engine';
import type { ToolManager } from '../tools/ToolManager';
import { h, pickFiles, toast } from './dom';

export const IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/gif,image/bmp';

/** Decodifica un archivo de imagen a un canvas (sin premultiplicar ni convertir color), reducido a `maxSide`. */
async function decode(file: Blob, maxSide: number): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }).catch(() => { throw new Error('No se pudo leer la imagen'); });
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height), Math.sqrt(50_000_000 / (bmp.width * bmp.height)));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

const baseName = (f: File | Blob) => ('name' in f && f.name ? f.name.replace(/\.[^.]+$/, '') : 'Imagen').slice(0, 60);

/**
 * Importa una imagen al dibujo como capa nueva encima de la activa: si es más
 * grande que el lienzo se encaja dentro; si no, a su tamaño real y centrada.
 * Se conserva la resolución original (hasta 2× el lienzo) para poder ampliarla
 * después sin perder calidad. Queda seleccionada la herramienta Transformar.
 */
export async function importImageLayer(engine: CanvasEngine, mgr: ToolManager, file: File | Blob) {
  const doc = engine.doc;
  if (doc.layers.length >= MAX_LAYERS) throw new Error(`Máximo ${MAX_LAYERS} capas`);
  const c = await decode(file, Math.min(8192, Math.max(doc.width, doc.height) * 2));
  const fit = Math.min(1, doc.width / c.width, doc.height / c.height);
  const w = c.width * fit, h = c.height * fit;
  const layer = doc.newLayer(baseName(file));
  layer.items = [doc.item({ kind: 'bitmap', image: c, x: (doc.width - w) / 2, y: (doc.height - h) / 2, w, h })];
  engine.exec({ ...doc.cmdAddLayer(doc.activeId, layer), label: 'Importar imagen' });
  mgr.select('transform');
  toast(`Imagen importada en la capa «${layer.name}». Ajústala con Transformar.`, 'ok');
}

export async function pickAndImport(engine: CanvasEngine, mgr: ToolManager) {
  const files = await pickFiles(IMAGE_TYPES, true);
  for (const f of files) {
    try { await importImageLayer(engine, mgr, f); } catch (e) { toast(`${f.name}: ${e instanceof Error ? e.message : String(e)}`, 'error'); }
  }
}

/* =================================================================== referencias */

const MAX_REFS = 6;

/**
 * Ventanas flotantes con imágenes de referencia. Se arrastran por la barra,
 * cambian de tamaño desde la esquina, la imagen se amplía con dos dedos, la
 * rueda o los botones, y se mueve arrastrando. Mantener pulsado (o Alt + clic)
 * toma el color de la referencia. Se guardan con el proyecto.
 */
export class References {
  private wins = new Map<string, HTMLElement>();

  constructor(private engine: CanvasEngine, private onPick: (hex: string) => void) {
    engine.on('document', () => this.render());
    addEventListener('resize', () => { for (const r of this.engine.doc.references) this.place(r); });
  }

  get count() { return this.engine.doc.references.length; }

  async add(file?: File | Blob) {
    const doc = this.engine.doc;
    if (doc.references.length >= MAX_REFS) { toast(`Máximo ${MAX_REFS} referencias`, 'error'); return; }
    const f = file ?? (await pickFiles(IMAGE_TYPES))[0];
    if (!f) return;
    let image: HTMLCanvasElement;
    try { image = await decode(f, 2560); } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); return; }
    const phone = document.documentElement.classList.contains('phone');
    const n = doc.references.length;
    const ref: RefImage = {
      id: `ref${Date.now().toString(36)}${n}`, name: baseName(f), image,
      rect: phone ? [0.36 - n * 0.03, 0.1 + n * 0.03, 0.6, 0.3] : [0.62 - n * 0.03, 0.14 + n * 0.04, 0.3, 0.38],
      zoom: 0, pan: [image.width / 2, image.height / 2], opacity: 1,
    };
    doc.references.push(ref);
    this.engine.markChanged();
    this.render();
  }

  remove(id: string) {
    const doc = this.engine.doc;
    doc.references = doc.references.filter(r => r.id !== id);
    this.engine.markChanged();
    this.render();
  }

  /** Muestra u oculta todas (sin borrarlas). */
  toggleAll() { document.body.classList.toggle('refs-hidden'); }

  render() {
    const refs = this.engine.doc.references;
    for (const [id, el] of this.wins) if (!refs.some(r => r.id === id)) { el.remove(); this.wins.delete(id); }
    for (const r of refs) { if (!this.wins.has(r.id)) this.wins.set(r.id, this.build(r)); this.place(r); }
  }

  private place(r: RefImage) {
    const el = this.wins.get(r.id);
    if (!el) return;
    const W = innerWidth, H = innerHeight;
    let [x, y, w, hh] = r.rect;
    w = Math.max(140 / W, Math.min(1, w)); hh = Math.max(110 / H, Math.min(1, hh));
    x = Math.min(Math.max(0, x), 1 - Math.min(w, 60 / W)); y = Math.min(Math.max(0, y), 1 - 40 / H);
    Object.assign(el.style, { left: `${x * W}px`, top: `${y * H}px`, width: `${w * W}px`, height: `${hh * H}px`, opacity: String(r.opacity) });
    this.drawImage(r);
  }

  private drawImage(r: RefImage) {
    const el = this.wins.get(r.id);
    const view = el?.querySelector('canvas');
    if (!el || !view) return;
    const box = view.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.max(1, Math.round(box.width * dpr)), H = Math.max(1, Math.round(box.height * dpr));
    if (view.width !== W || view.height !== H) { view.width = W; view.height = H; }
    // zoom 0 = encajar
    const fit = Math.min(box.width / r.image.width, box.height / r.image.height);
    if (!(r.zoom > 0)) { r.zoom = fit; r.pan = [r.image.width / 2, r.image.height / 2]; }
    const g = view.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    g.imageSmoothingQuality = 'high';
    g.setTransform(dpr * r.zoom, 0, 0, dpr * r.zoom, dpr * (box.width / 2 - r.pan[0] * r.zoom), dpr * (box.height / 2 - r.pan[1] * r.zoom));
    g.drawImage(r.image, 0, 0);
  }

  private build(r: RefImage): HTMLElement {
    const save = () => this.engine.markChanged();
    const view = h('canvas', { class: 'ref-view' });
    const opacityBtn = h('button', { type: 'button', class: 'icon sm', title: 'Transparencia de la ventana', 'aria-label': 'Transparencia', html: '◐' });
    opacityBtn.addEventListener('click', () => { const o = [1, 0.75, 0.5, 0.3]; r.opacity = o[(o.findIndex(v => Math.abs(v - r.opacity) < 0.01) + 1) % o.length]; this.place(r); save(); });
    const zoomBy = (k: number) => { r.zoom = Math.min(40, Math.max(0.02, (r.zoom || 1) * k)); this.drawImage(r); save(); };
    const head = h('div', { class: 'ref-head' },
      h('span', { class: 'ref-name', title: r.name }, r.name),
      h('button', { type: 'button', class: 'icon sm', title: 'Alejar', 'aria-label': 'Alejar', html: '−', on: { click: () => zoomBy(1 / 1.4) } }),
      h('button', { type: 'button', class: 'icon sm', title: 'Acercar', 'aria-label': 'Acercar', html: '+', on: { click: () => zoomBy(1.4) } }),
      h('button', { type: 'button', class: 'icon sm', title: 'Encajar', 'aria-label': 'Encajar', html: '⤢', on: { click: () => { r.zoom = 0; this.drawImage(r); save(); } } }),
      opacityBtn,
      h('button', { type: 'button', class: 'icon sm ref-close', title: 'Quitar referencia', 'aria-label': 'Quitar referencia', html: '×', on: { click: () => this.remove(r.id) } }));
    const grip = h('div', { class: 'ref-grip', 'aria-hidden': 'true' });
    const el = h('div', { class: 'ref-win', 'data-ui': '', role: 'dialog', 'aria-label': `Referencia: ${r.name}` }, head, view, grip);
    document.body.append(el);

    // Mover la ventana desde la barra.
    drag(head, (dx, dy) => { r.rect = [r.rect[0] + dx / innerWidth, r.rect[1] + dy / innerHeight, r.rect[2], r.rect[3]]; this.place(r); }, save, t => !(t as HTMLElement).closest('button'));
    // Cambiar el tamaño desde la esquina.
    drag(grip, (dx, dy) => { r.rect = [r.rect[0], r.rect[1], r.rect[2] + dx / innerWidth, r.rect[3] + dy / innerHeight]; this.place(r); }, save);

    // Imagen: arrastrar = mover, dos dedos = zoom, rueda = zoom, mantener pulsado / Alt+clic = tomar color.
    const pts = new Map<number, { x: number; y: number }>();
    let pinch: { d: number; zoom: number } | null = null, hold = 0, moved = false;
    const pick = (cx: number, cy: number) => {
      const b = view.getBoundingClientRect();
      const ix = Math.floor(r.pan[0] + (cx - b.left - b.width / 2) / r.zoom), iy = Math.floor(r.pan[1] + (cy - b.top - b.height / 2) / r.zoom);
      if (ix < 0 || iy < 0 || ix >= r.image.width || iy >= r.image.height) return;
      const d = r.image.getContext('2d')!.getImageData(ix, iy, 1, 1).data;
      if (d[3] < 10) return;
      this.onPick(`#${[d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('')}`);
    };
    view.addEventListener('pointerdown', e => {
      view.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = false;
      if (e.altKey) { pick(e.clientX, e.clientY); return; }
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: r.zoom };
        clearTimeout(hold);
      } else hold = window.setTimeout(() => { if (!moved) pick(e.clientX, e.clientY); }, 500);
    });
    view.addEventListener('pointermove', e => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) { moved = true; clearTimeout(hold); }
      prev.x = e.clientX; prev.y = e.clientY;
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        r.zoom = Math.min(40, Math.max(0.02, pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.d)));
      } else if (pts.size === 1) { r.pan = [r.pan[0] - dx / r.zoom, r.pan[1] - dy / r.zoom]; }
      this.drawImage(r);
    });
    const up = (e: PointerEvent) => {
      if (!pts.delete(e.pointerId)) return;
      clearTimeout(hold);
      if (pts.size < 2) pinch = null;
      if (moved && !pts.size) save();
    };
    view.addEventListener('pointerup', up);
    view.addEventListener('pointercancel', up);
    view.addEventListener('wheel', e => {
      e.preventDefault();
      r.zoom = Math.min(40, Math.max(0.02, (r.zoom || 1) * Math.exp(-e.deltaY * 0.0015)));
      this.drawImage(r);
    }, { passive: false });
    view.addEventListener('dblclick', () => { r.zoom = 0; this.drawImage(r); save(); });
    view.addEventListener('contextmenu', e => e.preventDefault());
    return el;
  }
}

/** Arrastre con puntero (mueve en px de pantalla); `end` al soltar. */
function drag(el: HTMLElement, move: (dx: number, dy: number) => void, end: () => void, accept: (t: EventTarget | null) => boolean = () => true) {
  let id = -1, x = 0, y = 0;
  el.addEventListener('pointerdown', e => { if (!accept(e.target)) return; id = e.pointerId; x = e.clientX; y = e.clientY; el.setPointerCapture(id); e.preventDefault(); });
  el.addEventListener('pointermove', e => { if (e.pointerId !== id) return; move(e.clientX - x, e.clientY - y); x = e.clientX; y = e.clientY; });
  const up = (e: PointerEvent) => { if (e.pointerId !== id) return; id = -1; end(); };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}
