import { keyAt, valueAt, type Prop } from '../../motion/keys';
import { FrameRenderer } from '../../anim/render';
import { browserImageCodec, readProject } from '../../project/format';
import { h, pickFiles, toast } from '../../ui/dom';
import { promptText, confirmDialog } from '../../ui/modal';
import { menu } from '../../ui/motion/util';
import { GENERATORS, genDef, type GenType } from '../generators';
import { vcount } from '../mesh';
import {
  MATERIAL_PRESETS, PRIM_PARAMS, PRIMS, effLocked, objOf, rebuild, type Mat3, type Obj3, type PrimType, type LightType,
} from '../model';
import type { Studio3D } from '../Studio3D';
import { canvasToUrl, fileToDataUrl } from '../textures';
import type { View3D } from '../View3D';
import { I3 } from './icons3';

type Sync = () => void;
const PRIM_ICON: Record<PrimType, string> = { box: I3.cube, sphere: I3.sphere, cylinder: I3.cylinder, cone: I3.cone, torus: I3.torus, plane: I3.plane, capsule: I3.capsule, pyramid: I3.pyramid };
const GEN_ICON: Record<GenType, string> = { stairs: I3.stairs, wall: I3.wall, door: I3.door, window: I3.window, roof: I3.roof, column: I3.column, furniture: I3.sofa, terrain: I3.terrain, tree: I3.tree };

/** Dependencias externas de los paneles (galería de YOSADRAW, dibujo). */
export interface PanelDeps {
  projects: { list(): { id: string; name: string; trashed?: number | null; motion?: unknown; s3d?: unknown; anim?: unknown; rev: number; background?: string | null }[]; read(id: string): Promise<Uint8Array>; get(id: string): { rev: number } | undefined };
  painter: ConstructorParameters<typeof FrameRenderer>[0];
}

/** Dibujo de YOSADRAW (aplanado) como data URL para usarlo de textura. */
export async function drawingToUrl(deps: PanelDeps, id: string): Promise<string> {
  const f = await readProject(await deps.projects.read(id), browserImageCodec);
  const doc = f.doc;
  const k = Math.min(1, 2048 / Math.max(doc.width, doc.height));
  const fr = new FrameRenderer(deps.painter, doc, 128 * 1024 * 1024);
  const c = fr.renderFrame(0, k, document.createElement('canvas'), { background: doc.settings.background !== null, includeReference: false });
  return canvasToUrl(c);
}

// ---------------------------------------------------------------- piezas de interfaz

export class Rows {
  syncs: Sync[] = [];
  constructor(protected s: Studio3D, protected root: HTMLElement) {}
  sync() { for (const f of this.syncs) f(); }
  sec(title: string, ...kids: (Node | null | false)[]) {
    const d = h('details', { class: 'mo-sec', open: true }, h('summary', null, title), ...kids.filter((k): k is Node => !!k));
    this.root.append(d);
    return d;
  }
  btns(...b: ([string, () => void, string?] | null)[]) { return h('div', { class: 'mo-btnrow' }, ...b.filter((x): x is [string, () => void, string?] => !!x).map(([l, run, title]) => h('button', { type: 'button', class: 'btn sm', title: title ?? l, on: { click: run } }, l))); }
  /** Número animable con rombo de keyframe; arrastrar la etiqueta cambia el valor. */
  num(label: string, get: () => Prop<number> | null, set: (v: number, live: boolean) => void, o: { k?: number; step?: number; unit?: string; min?: number; max?: number; key?: string; keyPath?: () => [string, string] | null } = {}) {
    const s = this.s, k = o.k ?? 1, step = o.step ?? 0.1;
    const input = h('input', { type: 'number', class: 'mo-num', step: String(step * k), 'aria-label': label, 'data-k': o.key ?? label });
    const clamp = (v: number) => Math.max(o.min ?? -Infinity, Math.min(o.max ?? Infinity, v));
    input.addEventListener('change', () => { const v = Number(input.value.replace(',', '.')) / k; if (Number.isFinite(v)) set(clamp(v), false); });
    input.addEventListener('keydown', e => e.stopPropagation());
    const lab = h('label', { class: 'mo-lab', title: `${label}: arrastra a los lados para cambiarlo` }, label);
    lab.addEventListener('pointerdown', e => {
      const p = get(); if (!p) return;
      const v0 = valueAt(p, s.localTime()), x0 = e.clientX;
      let moved = false;
      lab.setPointerCapture(e.pointerId);
      const mv = (ev: PointerEvent) => { const dx = ev.clientX - x0; if (Math.abs(dx) > 2) moved = true; if (moved) set(clamp(v0 + dx * step * (ev.shiftKey ? 10 : 1)), true); };
      const up = () => { lab.removeEventListener('pointermove', mv); lab.removeEventListener('pointerup', up); if (moved) s.commit(label); };
      lab.addEventListener('pointermove', mv); lab.addEventListener('pointerup', up);
    });
    const kb = o.keyPath ? h('button', { type: 'button', class: 'mo-key', 'aria-label': `Keyframe de ${label}`, on: { click: () => { const kp = o.keyPath!(); if (kp) s.toggleKeyPath(kp[0], kp[1]); } } }) : null;
    const row = h('div', { class: 'mo-prop' }, lab, input, o.unit ? h('span', { class: 'mo-unit' }, o.unit) : null, kb);
    const sync = () => {
      const p = get();
      if (!p) return;
      const v = valueAt(p, s.localTime());
      if (document.activeElement !== input) input.value = String(+(v * k).toFixed(step < 0.01 ? 4 : 3));
      if (kb) { const on = !!keyAt(p, s.localTime()), an = !!p.k?.length; kb.innerHTML = on ? I3.diamondFill : I3.diamond; kb.classList.toggle('on', on); kb.classList.toggle('animated', an); kb.title = on ? 'Quitar el keyframe del cabezal' : 'Crear keyframe en el cabezal'; row.classList.toggle('is-anim', an); row.classList.toggle('is-key', on); }
    };
    this.syncs.push(sync); sync();
    return row;
  }
  color(label: string, get: () => Prop<string> | null, set: (v: string, live: boolean) => void, keyPath?: () => [string, string] | null) {
    const s = this.s;
    const input = h('input', { type: 'color', class: 'mo-color', 'aria-label': label });
    input.addEventListener('input', () => set(input.value, true));
    input.addEventListener('change', () => { set(input.value, true); s.commit(label); });
    const kb = keyPath ? h('button', { type: 'button', class: 'mo-key', 'aria-label': `Keyframe de ${label}`, on: { click: () => { const kp = keyPath(); if (kp) s.toggleKeyPath(kp[0], kp[1]); } } }) : null;
    const row = h('div', { class: 'mo-prop' }, h('label', { class: 'mo-lab' }, label), input, kb);
    const sync = () => { const p = get(); if (!p) return; if (document.activeElement !== input) input.value = valueAt(p, s.localTime()); if (kb) { const on = !!keyAt(p, s.localTime()); kb.innerHTML = on ? I3.diamondFill : I3.diamond; kb.classList.toggle('on', on); kb.classList.toggle('animated', !!p.k?.length); } };
    this.syncs.push(sync); sync();
    return row;
  }
  plainNum(label: string, value: number, set: (v: number) => void, o: { min?: number; max?: number; step?: number; unit?: string } = {}) {
    const input = h('input', { type: 'number', class: 'mo-num', value: String(+value.toFixed(4)), step: String(o.step ?? 0.1), 'aria-label': label });
    if (o.min !== undefined) input.min = String(o.min);
    if (o.max !== undefined) input.max = String(o.max);
    input.addEventListener('keydown', e => e.stopPropagation());
    input.addEventListener('change', () => { const v = Number(input.value.replace(',', '.')); if (Number.isFinite(v)) set(Math.max(o.min ?? -Infinity, Math.min(o.max ?? Infinity, v))); });
    return h('div', { class: 'mo-prop' }, h('label', { class: 'mo-lab' }, label), input, o.unit ? h('span', { class: 'mo-unit' }, o.unit) : null);
  }
  range(label: string, value: number, min: number, max: number, step: number, set: (v: number, live: boolean) => void, fmt = (v: number) => String(+v.toFixed(2))) {
    const s = this.s;
    const r = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
    const out = h('span', { class: 'mo-unit' }, fmt(value));
    r.addEventListener('input', () => { out.textContent = fmt(Number(r.value)); set(Number(r.value), true); });
    r.addEventListener('change', () => { set(Number(r.value), true); s.commit(label); });
    return h('div', { class: 'mo-prop' }, h('label', { class: 'mo-lab' }, label), r, out);
  }
  select(label: string, value: string, opts: [string, string][], set: (v: string) => void) {
    const sel = h('select', { class: 'mo-sel', 'aria-label': label }, ...opts.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
    sel.addEventListener('change', () => set(sel.value));
    return h('div', { class: 'mo-prop' }, h('label', { class: 'mo-lab' }, label), sel);
  }
  check(label: string, value: boolean, set: (v: boolean) => void) {
    const cb = h('input', { type: 'checkbox', checked: value });
    cb.addEventListener('change', () => set(cb.checked));
    return h('label', { class: 'mo-prop mo-checkrow' }, cb, h('span', null, label));
  }
  text(label: string, value: string, set: (v: string) => void) {
    const i = h('input', { type: 'text', value, maxlength: '60', 'aria-label': label });
    i.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') i.blur(); });
    i.addEventListener('change', () => set(i.value));
    return h('div', { class: 'mo-prop' }, h('label', { class: 'mo-lab' }, label), i);
  }
}

// ---------------------------------------------------------------- panel «Añadir»

export class AddPanel {
  readonly el = h('div', { class: 'mo-insp-body s3-add' });
  constructor(private s: Studio3D, private ui: { importModel: () => void; house: () => void; picked: () => void }) { this.render(); s.on('tool', () => this.mark()); }
  render() {
    const s = this.s;
    const grid = (items: [string, string, () => void, string][]) => h('div', { class: 's3-grid' }, ...items.map(([icon, label, run, title]) => h('button', { type: 'button', class: 's3-tile', title, on: { click: run } }, h('span', { html: icon }), h('span', null, label))));
    const create = (p: PrimType | { gen: GenType }) => () => { s.createPrim = p; s.setTool('create'); this.mark(); this.ui.picked(); };
    const primTiles = PRIMS.map(p => [PRIM_ICON[p.type], p.label, create(p.type), `${p.label}: haz clic en el visor (o arrastra para dibujar su base y después su altura). Doble clic aquí para ponerlo en el centro.`] as [string, string, () => void, string]);
    const genTiles = GENERATORS.map(g => [GEN_ICON[g.type], g.label, create({ gen: g.type }), g.type === 'wall' ? 'Pared: arrastra en el suelo para dibujarla (largo y dirección); clic = pared de 4 m' : `${g.label}: haz clic en el visor para ponerlo`] as [string, string, () => void, string]);
    const lights: [LightType, string, string][] = [['dir', 'Sol', I3.sun], ['point', 'Puntual', I3.light], ['spot', 'Foco', I3.spot], ['hemi', 'Entorno', I3.sun], ['amb', 'Ambiental', I3.light]];
    const prims = grid(primTiles), gens = grid(genTiles);
    // Doble clic en una primitiva: se crea al momento en el centro.
    [...prims.children].forEach((b, i) => b.addEventListener('dblclick', () => { s.addPrim(PRIMS[i].type); s.setTool('move'); }));
    [...gens.children].forEach((b, i) => b.addEventListener('dblclick', () => { s.addGen(GENERATORS[i].type); s.setTool('move'); }));
    this.el.replaceChildren(
      h('details', { class: 'mo-sec', open: true }, h('summary', null, 'Formas básicas'), prims),
      h('details', { class: 'mo-sec', open: true }, h('summary', null, 'Construir (generadores)'), gens,
        h('div', { class: 'mo-btnrow' }, h('button', { type: 'button', class: 'btn sm primary', title: 'Una casa completa: cuatro paredes con puerta y ventanas, y su tejado (todo editable)', on: { click: () => this.ui.house() } }, h('span', { html: I3.house }), ' Casa de ejemplo'))),
      h('details', { class: 'mo-sec', open: true }, h('summary', null, 'Construir con bloques'),
        h('p', { class: 'ctl-help' }, 'Clic: pone un bloque pegado a la cara que señalas. Mayús + clic: lo quita.'),
        h('div', { class: 'mo-btnrow' },
          h('button', { type: 'button', class: 'btn sm', 'data-tool': 'block', on: { click: () => s.setTool('block') } }, h('span', { html: I3.block }), ' Bloques'),
          (() => { const sel = h('select', { class: 'mo-sel', 'aria-label': 'Forma del bloque' }, ...(['box', 'sphere', 'cylinder', 'cone', 'pyramid'] as PrimType[]).map(t => h('option', { value: t, selected: s.block.prim === t }, PRIMS.find(p => p.type === t)!.label))); sel.addEventListener('change', () => { s.block.prim = sel.value as PrimType; }); return sel; })(),
          (() => { const i = h('input', { type: 'number', class: 'mo-num', value: String(s.block.size), min: '0.05', step: '0.25', 'aria-label': 'Tamaño del bloque' }); i.addEventListener('keydown', e => e.stopPropagation()); i.addEventListener('change', () => { const v = Number(i.value); if (v > 0) s.block.size = v; }); return i; })())),
      h('details', { class: 'mo-sec', open: true }, h('summary', null, 'Luces y cámaras'),
        grid([...lights.map(([t, l, ic]) => [ic, l, () => s.addLight(t), `Añadir luz: ${l}`] as [string, string, () => void, string]), [I3.cam3, 'Cámara', () => s.addCamera(), 'Añadir una cámara (para renderizar y animar el encuadre)']])),
      h('details', { class: 'mo-sec', open: true }, h('summary', null, 'Importar'),
        h('div', { class: 'mo-btnrow' }, h('button', { type: 'button', class: 'btn sm', on: { click: () => this.ui.importModel() } }, 'Modelo 3D (GLB, glTF, OBJ, STL)…'))));
    this.mark();
  }
  private mark() {
    const s = this.s;
    this.el.querySelectorAll('.s3-tile').forEach((b, i) => {
      const p = s.createPrim;
      const on = s.tool === 'create' && (i < PRIMS.length ? p === PRIMS[i].type : typeof p === 'object' && p.gen === GENERATORS[i - PRIMS.length]?.type);
      b.classList.toggle('on', !!on);
    });
    this.el.querySelector('[data-tool="block"]')?.classList.toggle('on', s.tool === 'block');
  }
}

// ---------------------------------------------------------------- jerarquía

export class Hierarchy {
  readonly el: HTMLElement;
  private list = h('div', { class: 's3-tree', role: 'tree', 'aria-label': 'Objetos de la escena' });
  private filter = h('input', { type: 'search', class: 's3-filter', placeholder: 'Buscar objeto…', 'aria-label': 'Buscar objeto' });
  private closed = new Set<string>();
  private lastClick: string | null = null;
  constructor(private s: Studio3D) {
    this.filter.addEventListener('input', () => this.render());
    this.filter.addEventListener('keydown', e => e.stopPropagation());
    const bar = h('div', { class: 's3-treebar' }, this.filter,
      h('button', { type: 'button', class: 'icon xs', title: 'Nueva carpeta (con los elegidos dentro)', 'aria-label': 'Nueva carpeta', html: I3.folder3, on: { click: () => s.group(true) } }),
      h('button', { type: 'button', class: 'icon xs', title: 'Agrupar los elegidos (Ctrl+G)', 'aria-label': 'Agrupar', html: I3.layers3, on: { click: () => s.group() } }));
    this.el = h('div', { class: 's3-hier' }, bar, this.list);
    // Soltar en el hueco: a la raíz.
    this.list.addEventListener('dragover', e => e.preventDefault());
    this.list.addEventListener('drop', e => { if (e.target === this.list) { const id = e.dataTransfer?.getData('text/x-s3obj'); if (id) s.reparent(id, null); } });
    s.on('change', () => this.render());
    s.on('select', () => this.render());
    s.on('open', () => this.render());
  }
  render() {
    const s = this.s;
    if (!s.active) return;
    const sc = s.scene, q = this.filter.value.trim().toLowerCase();
    const rows: HTMLElement[] = [];
    const icon = (o: Obj3) => (o.kind === 'light' ? I3.light : o.kind === 'camera' ? I3.cam3 : o.kind === 'group' ? (o.folder ? I3.folder3 : I3.layers3) : o.gen ? GEN_ICON[o.gen.type] : o.prim ? PRIM_ICON[o.prim.type] : I3.cube);
    const walk = (parent: string | null, depth: number) => {
      for (const o of sc.objects.filter(x => x.parent === parent)) {
        const kids = sc.objects.some(x => x.parent === o.id);
        const match = !q || o.name.toLowerCase().includes(q);
        if (match) rows.push(this.row(o, depth, kids, icon(o)));
        if (kids && (q || !this.closed.has(o.id))) walk(o.id, depth + 1);
      }
    };
    walk(null, 0);
    this.list.replaceChildren(...rows);
    if (!rows.length) this.list.append(h('p', { class: 'ctl-help mo-pad' }, q ? 'Nada coincide.' : 'La escena está vacía: añade formas desde «Añadir».'));
  }
  private row(o: Obj3, depth: number, kids: boolean, icon: string) {
    const s = this.s, sel = s.sel.includes(o.id), act = s.one?.id === o.id;
    const ib = (ic: string, title: string, on: boolean, run: () => void) => h('button', { type: 'button', class: `icon xs${on ? ' on' : ''}`, title, 'aria-label': title, html: ic, on: { click: (e: Event) => { e.stopPropagation(); run(); } } });
    const name = h('span', { class: 's3-tname' }, o.name);
    const row = h('div', { class: `s3-trow${sel ? ' sel' : ''}${act ? ' act' : ''}${o.visible ? '' : ' hid'}${o.locked ? ' lock' : ''}`, role: 'treeitem', 'aria-selected': String(sel), draggable: 'true', style: { paddingLeft: `${6 + depth * 14}px` } },
      kids ? h('button', { type: 'button', class: 'icon xs s3-twist', 'aria-label': 'Desplegar', html: this.closed.has(o.id) ? I3.chevRight : I3.chevDown, on: { click: (e: Event) => { e.stopPropagation(); if (this.closed.has(o.id)) this.closed.delete(o.id); else this.closed.add(o.id); this.render(); } } }) : h('span', { class: 's3-twist' }),
      h('span', { class: 's3-ticon', html: icon }), name,
      o.kind === 'camera' && s.scene.camera === o.id ? h('span', { class: 's3-badge', title: 'Cámara activa' }, '●') : null,
      ib(o.visible ? I3.eye : I3.eyeOff, o.visible ? 'Ocultar' : 'Mostrar', !o.visible, () => s.toggleVis(o.id)),
      ib(o.locked ? I3.lock : I3.unlock, o.locked ? 'Desbloquear' : 'Bloquear', o.locked, () => s.toggleLock(o.id)));
    row.addEventListener('click', e => {
      if (o.locked) { toast('Objeto bloqueado: desbloquéalo para elegirlo.'); return; }
      // Mayús: rango desde el último; Ctrl: suma o quita.
      if (e.shiftKey && this.lastClick) {
        const ids = [...this.list.querySelectorAll<HTMLElement>('.s3-trow')].map(r => r.dataset.id!);
        const a = ids.indexOf(this.lastClick), b = ids.indexOf(o.id);
        if (a >= 0 && b >= 0) { s.select(ids.slice(Math.min(a, b), Math.max(a, b) + 1).filter(id => !s.obj(id)?.locked), true); return; }
      }
      s.select([o.id], e.ctrlKey || e.metaKey);
      this.lastClick = o.id;
    });
    row.dataset.id = o.id;
    name.addEventListener('dblclick', async e => { e.stopPropagation(); const n = await promptText('Renombrar', o.name); if (n) s.rename(o.id, n); });
    row.addEventListener('contextmenu', e => { e.preventDefault(); if (!s.sel.includes(o.id) && !o.locked) s.select([o.id]); objectMenu(s, e.clientX, e.clientY); });
    row.addEventListener('dragstart', e => { e.dataTransfer?.setData('text/x-s3obj', o.id); });
    row.addEventListener('dragover', e => { e.preventDefault(); row.classList.add('drop'); });
    row.addEventListener('dragleave', () => row.classList.remove('drop'));
    row.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation(); row.classList.remove('drop');
      const id = e.dataTransfer?.getData('text/x-s3obj');
      if (!id || id === o.id) return;
      // Sobre un grupo o carpeta: dentro. Sobre otro objeto: al mismo nivel, antes de él.
      if (o.kind === 'group') s.reparent(id, o.id); else s.reparent(id, o.parent, o.id);
    });
    return row;
  }
}

/** Menú contextual de objetos (visor y jerarquía). */
export function objectMenu(s: Studio3D, x: number, y: number) {
  const o = s.one, n = s.sel.length;
  if (s.mode === 'edit') { editMenu(s, x, y); return; }
  menu(x, y, n ? (n === 1 ? o!.name : `${n} objetos`) : 'Escena', [
    { label: 'Duplicar (Mayús+D)', disabled: !n, run: () => s.duplicate() },
    { label: 'Copiar (Ctrl+C)', disabled: !n, run: () => s.copyObjects() },
    { label: 'Pegar (Ctrl+V)', run: () => s.pasteObjects() },
    { label: 'Renombrar…', disabled: n !== 1, run: async () => { const t = await promptText('Renombrar', o!.name); if (t) s.rename(o!.id, t); } },
    null,
    { label: 'Editar vértices, aristas y caras (Tab)', disabled: !o?.mesh, run: () => s.enterEdit() },
    o?.prim || o?.gen ? { label: 'Convertir en geometría editable', run: () => s.makeEditable(o.id) } : null,
    { label: 'Suavizar (subdivisión)', disabled: !o?.mesh, run: () => s.subdivide(1, true) },
    { label: o?.smooth ? 'Sombreado plano' : 'Sombreado suave', disabled: !o?.mesh, run: () => s.edit('Sombreado', (_st, sc) => { for (const x2 of s.selected) { const y2 = objOf(sc, x2.id); if (y2) y2.smooth = !o?.smooth; } }) },
    null,
    { label: 'Agrupar (Ctrl+G)', disabled: !n, run: () => s.group() },
    { label: 'Meter en una carpeta nueva', disabled: !n, run: () => s.group(true) },
    { label: 'Desagrupar', disabled: !s.selected.some(z => z.kind === 'group'), run: () => s.ungroup() },
    { label: 'Apoyar en el suelo', disabled: !n, run: () => s.align(1, 'floor') },
    { label: o?.visible === false ? 'Mostrar' : 'Ocultar (H)', disabled: n !== 1, run: () => s.toggleVis(o!.id) },
    { label: o?.locked ? 'Desbloquear' : 'Bloquear', disabled: n !== 1, run: () => s.toggleLock(o!.id) },
    o?.kind === 'camera' ? { label: 'Usar como cámara activa', run: () => s.setCamera(o.id) } : null,
    null,
    { label: 'Keyframe de transformación (I)', disabled: !n, run: () => s.keyTransform() },
    { label: 'Copiar sus keyframes', disabled: n !== 1, run: () => s.copyKeys() },
    { label: 'Pegar keyframes en el cabezal', disabled: !n || !s.hasKeyClip, run: () => s.pasteKeys() },
    null,
    { label: 'Eliminar (Supr)', danger: true, disabled: !n, run: () => s.remove() },
  ]);
}
export function editMenu(s: Studio3D, x: number, y: number) {
  menu(x, y, 'Modelado', [
    { label: 'Extruir (E)', run: () => s.extrude(0.5) },
    { label: 'Extruir cada cara por separado', run: () => s.extrude(0.5, false) },
    { label: 'Inset (I)', run: () => s.inset(0.25) },
    { label: 'Biselar (Ctrl+B)', run: () => s.bevel(0.1) },
    { label: 'Abrir un agujero', run: () => s.hole(0.3) },
    { label: 'Unir dos caras con un túnel (agujero pasante)', run: () => s.bridge() },
    { label: 'Subdividir', run: () => s.subdivide(1, false) },
    { label: 'Suavizar (Catmull-Clark)', run: () => s.subdivide(1, true) },
    { label: 'Fusionar vértices (M)', run: () => s.mergeSel('center') },
    { label: 'Fusionar los que están juntos', run: () => s.mergeSel('distance') },
    { label: 'Empujar hacia fuera', run: () => s.pushVerts(0.1) },
    { label: 'Empujar hacia dentro', run: () => s.pushVerts(-0.1) },
    { label: 'Invertir normales', run: () => s.flipNormals() },
    null,
    { label: 'Elegir todo / nada (A)', run: () => s.editSelectAll() },
    { label: 'Borrar (Supr)', danger: true, run: () => s.deleteGeom() },
    { label: 'Salir del modo edición (Tab)', run: () => s.exitEdit() },
  ]);
}

// ---------------------------------------------------------------- propiedades

export class Inspector3 extends Rows {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private tab: 'obj' | 'mat' | 'scene' = 'obj';
  private matSel: string | null = null;
  private tabs: HTMLElement;
  constructor(s: Studio3D, private view: View3D, private deps: PanelDeps & { renderDialog: () => void }) {
    const body = h('div', { class: 'mo-insp-body' });
    super(s, body);
    this.body = body;
    this.tabs = h('div', { class: 'mo-tabs', role: 'tablist' });
    this.el = h('div', { class: 'mo-inspector' }, this.tabs, this.body);
    s.on('select', () => this.render());
    s.on('open', () => this.render());
    s.on('mode', () => this.render());
    s.on('change', l => { if (l) this.render(); else this.sync(); });
    s.on('time', () => { if (!s.playing) this.sync(); });
  }
  setTab(t: 'obj' | 'mat' | 'scene') { this.tab = t; this.render(); }
  render() {
    const s = this.s;
    if (!s.active) return;
    const scroll = this.body.scrollTop;
    this.syncs = [];
    this.tabs.replaceChildren(...([['obj', 'Objeto'], ['mat', 'Material'], ['scene', 'Escena y render']] as const).map(([id, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(this.tab === id), on: { click: () => this.setTab(id) } }, l)));
    this.body.replaceChildren();
    if (this.tab === 'obj') this.objPanel();
    else if (this.tab === 'mat') this.matPanel();
    else this.scenePanel();
    this.body.scrollTop = scroll;
  }

  // ---------------------------------------------------------------- objeto

  private objPanel() {
    const s = this.s, objs = s.selected, o = s.one;
    if (!o) {
      this.sec('Sin selección', h('p', { class: 'ctl-help' }, 'Haz clic en un objeto del visor o de la lista para ver y cambiar sus propiedades. Para añadir, usa el panel «Añadir» o la herramienta Crear.'));
      return;
    }
    if (s.mode === 'edit') { this.editPanel(o); return; }
    const id = o.id;
    const ob = () => s.obj(id) ?? null;
    this.sec(objs.length > 1 ? `${objs.length} objetos (activo: ${o.name})` : o.name,
      this.text('Nombre', o.name, v => s.rename(id, v)),
      o.mesh ? h('p', { class: 'ctl-help' }, `${vcount(o.mesh)} vértices · ${o.mesh.f.length} caras${o.prim ? ' · primitiva (medidas editables)' : o.gen ? ' · generador (parámetros editables)' : ' · geometría editable'}`) : null);
    if (o.kind !== 'group' || !o.folder) {
      const tf = (k: keyof Obj3['tf'], label: string, unit: string, step: number) => this.num(label, () => ob()?.tf[k] ?? null, (v, live) => s.setTf(id, k, v, live), { step, unit, keyPath: () => [id, `tf.${k}`] });
      this.sec('Transformación',
        tf('px', 'Posición X', 'm', 0.05), tf('py', 'Posición Y', 'm', 0.05), tf('pz', 'Posición Z', 'm', 0.05),
        tf('rx', 'Rotación X', '°', 1), tf('ry', 'Rotación Y', '°', 1), tf('rz', 'Rotación Z', '°', 1),
        tf('sx', 'Escala X', '', 0.01), tf('sy', 'Escala Y', '', 0.01), tf('sz', 'Escala Z', '', 0.01),
        this.btns(['Escala uniforme…', async () => { const v = await promptText('Escala uniforme', '1', { label: 'Multiplica la escala en X, Y y Z' }); const k = Number(v?.replace(',', '.')); if (k > 0) s.edit('Escalar', (_st, sc) => { for (const x of s.roots()) { const y = objOf(sc, x.id)!; for (const a of ['sx', 'sy', 'sz'] as const) s.setP(y.tf[a], valueAt(y.tf[a], s.localTime()) * k); } }); }],
          ['Restablecer', () => s.edit('Restablecer', (_st, sc) => { for (const x of s.roots()) { const y = objOf(sc, x.id)!; for (const a of ['rx', 'ry', 'rz'] as const) { delete y.tf[a].k; y.tf[a].v = 0; } for (const a of ['sx', 'sy', 'sz'] as const) { delete y.tf[a].k; y.tf[a].v = 1; } } })], ['Apoyar en el suelo', () => s.align(1, 'floor')]),
        o.kind === 'mesh' ? this.num('Opacidad', () => ob()?.opacity ?? null, (v, live) => { const fn = () => { const x = ob(); if (x) s.setP(x.opacity, v); }; if (live) s.live(fn); else s.edit('Opacidad', fn); }, { k: 100, step: 0.01, unit: '%', min: 0, max: 1, keyPath: () => [id, 'opacity'] }) : null);
    }
    if (o.prim) {
      const pp = PRIM_PARAMS[o.prim.type];
      this.sec(`Medidas (${PRIMS.find(p => p.type === o.prim!.type)!.label})`,
        ...pp.map(p => this.plainNum(p.label, o.prim!.p[p.key], v => s.setPrimParam(id, p.key, p.int ? Math.round(v) : v), { min: p.min, step: p.step, unit: p.int ? '' : 'm' })),
        this.btns(['Convertir en editable', () => s.makeEditable(id), 'Para modelar sus vértices, aristas y caras (las medidas dejan de ser editables)']));
    }
    if (o.gen) {
      const def = genDef(o.gen.type);
      this.sec(`Generador: ${def.label}`,
        ...def.params.map(p => p.opts ? this.select(p.label, String(o.gen!.p[p.key]), p.opts.map(([v, l]) => [String(v), l]), v => s.setPrimParam(id, p.key, Number(v)))
          : this.range(p.label, o.gen!.p[p.key], p.min, p.max, p.step, (v, live) => s.setPrimParam(id, p.key, v, live))),
        this.btns(['Convertir en editable', () => s.makeEditable(id), 'Geometría editable: ya no se regenera con los parámetros'], ['Restablecer', () => s.edit('Restablecer generador', (_st, sc) => { const x = objOf(sc, id); if (x?.gen) { x.gen.p = Object.fromEntries(def.params.map(p => [p.key, p.def])); rebuild(x); } })]));
    }
    if (o.kind === 'mesh') this.sec('Aspecto',
      this.check('Sombreado suave', !!o.smooth, v => s.edit('Sombreado', (_st, sc) => { const x = objOf(sc, id); if (x) x.smooth = v; })),
      this.check('Proyecta sombras', o.castShadow !== false, v => s.edit('Sombras', (_st, sc) => { const x = objOf(sc, id); if (x) x.castShadow = v; })),
      this.btns(['Editar geometría (Tab)', () => s.enterEdit()], ['Suavizar', () => s.subdivide(1, true), 'Subdivisión Catmull-Clark: más caras y formas redondeadas']));
    if (o.light) this.lightPanel(o);
    if (o.cam) this.camPanel(o);
    if (objs.length > 1) this.alignPanel();
    this.sec('Objeto', this.btns(['Duplicar', () => s.duplicate()], ['Agrupar', () => s.group()], o.kind === 'group' ? ['Desagrupar', () => s.ungroup()] : null, ['Eliminar', () => s.remove()]));
  }
  private lightPanel(o: Obj3) {
    const s = this.s, id = o.id, L = () => s.obj(id)?.light ?? null;
    this.sec('Luz',
      this.select('Tipo', o.light!.type, [['dir', 'Direccional (sol)'], ['point', 'Puntual (bombilla)'], ['spot', 'Foco'], ['amb', 'Ambiental'], ['hemi', 'De entorno (cielo y suelo)']], v => s.edit('Tipo de luz', (_st, sc) => { const x = objOf(sc, id); if (x?.light) x.light.type = v as LightType; })),
      this.color('Color', () => L()?.color ?? null, (v, live) => { const fn = () => { const l = L(); if (l) s.setP(l.color, v); }; if (live) s.live(fn); else s.edit('Color de la luz', fn); }, () => [id, 'light.color']),
      this.num('Intensidad', () => L()?.intensity ?? null, (v, live) => { const fn = () => { const l = L(); if (l) s.setP(l.intensity, v); }; if (live) s.live(fn); else s.edit('Intensidad', fn); }, { step: 0.1, min: 0, keyPath: () => [id, 'light.intensity'] }),
      o.light!.type === 'spot' ? this.num('Apertura', () => L()?.angle ?? null, (v, live) => { const fn = () => { const l = L(); if (l) s.setP(l.angle, v); }; if (live) s.live(fn); else s.edit('Apertura', fn); }, { step: 1, unit: '°', min: 1, max: 89, keyPath: () => [id, 'light.angle'] }) : null,
      o.light!.type === 'point' || o.light!.type === 'spot' ? this.plainNum('Alcance (0 = sin límite)', o.light!.dist, v => s.edit('Alcance', (_st, sc) => { const x = objOf(sc, id); if (x?.light) x.light.dist = Math.max(0, v); }), { min: 0, step: 0.5, unit: 'm' }) : null,
      o.light!.type === 'hemi' ? (() => { const i = h('input', { type: 'color', class: 'mo-color', value: o.light!.ground }); i.addEventListener('change', () => s.edit('Color del suelo', (_st, sc) => { const x = objOf(sc, id); if (x?.light) x.light.ground = i.value; })); return h('div', { class: 'mo-prop' }, h('label', { class: 'mo-lab' }, 'Color del suelo'), i); })() : null,
      o.light!.type !== 'amb' && o.light!.type !== 'hemi' ? this.check('Sombras', o.light!.shadow, v => s.edit('Sombras', (_st, sc) => { const x = objOf(sc, id); if (x?.light) x.light.shadow = v; })) : null,
      h('p', { class: 'ctl-help' }, 'Las luces se ven en los modos Materiales y Render (botones de arriba del visor). La dirección del sol y del foco es la rotación.'));
  }
  private camPanel(o: Obj3) {
    const s = this.s, id = o.id, C = () => s.obj(id)?.cam ?? null;
    const focal = (fov: number) => 18 / Math.tan((fov * Math.PI) / 360);
    this.sec('Cámara',
      this.num('Campo de visión', () => C()?.fov ?? null, (v, live) => { const fn = () => { const c = C(); if (c) s.setP(c.fov, v); }; if (live) s.live(fn); else s.edit('Campo de visión', fn); }, { step: 1, unit: '°', min: 5, max: 150, keyPath: () => [id, 'cam.fov'] }),
      this.plainNum('Distancia focal', +focal(valueAt(o.cam!.fov, s.localTime())).toFixed(1), v => { const fov = (2 * Math.atan(18 / Math.max(1, v)) * 180) / Math.PI; s.edit('Distancia focal', (_st, sc) => { const x = objOf(sc, id); if (x?.cam) s.setP(x.cam.fov, +fov.toFixed(3)); }); }, { min: 4, step: 1, unit: 'mm' }),
      this.btns(s.scene.camera === id ? null : ['Usar como cámara activa', () => s.setCamera(id)], ['Ver por la cámara', () => { if (s.scene.camera !== id) s.setCamera(id); this.view.lookThrough(); }], ['Colocar donde miro', () => { if (s.scene.camera !== id) s.setCamera(id); this.view.cameraToView(); }]),
      h('p', { class: 'ctl-help' }, `Relación de aspecto: la del render (${s.s.render.w} × ${s.s.render.h}, pestaña «Escena y render»). Anima su posición, rotación y campo de visión con los rombos.`));
  }
  private alignPanel() {
    const s = this.s;
    const ax = (a: 0 | 1 | 2, n: string) => h('div', { class: 'mo-btnrow' }, h('span', { class: 'mo-unit' }, n),
      ...([['min', 'Mín.'], ['center', 'Centro'], ['max', 'Máx.']] as const).map(([how, l]) => h('button', { type: 'button', class: 'btn xs', title: `Alinear en ${n} con el objeto activo (${l.toLowerCase()})`, on: { click: () => s.align(a, how) } }, l)),
      h('button', { type: 'button', class: 'btn xs', title: `Repartir en ${n} a la misma distancia`, on: { click: () => s.distribute(a) } }, 'Repartir'));
    this.sec('Alinear (respecto al activo)', ax(0, 'X'), ax(1, 'Y'), ax(2, 'Z'), this.btns(['Todos al suelo', () => s.align(1, 'floor')]));
  }
  private editPanel(o: Obj3) {
    const s = this.s;
    const amt = h('input', { type: 'number', class: 'mo-num', value: '0.5', step: '0.05', 'aria-label': 'Cantidad' });
    amt.addEventListener('keydown', e => e.stopPropagation());
    const a = () => Number(amt.value.replace(',', '.')) || 0.5;
    const mode = (m: 'vert' | 'edge' | 'face', l: string, ic: string) => h('button', { type: 'button', class: `btn sm${s.selMode === m ? ' on' : ''}`, on: { click: () => s.setSelMode(m) } }, h('span', { html: ic }), ` ${l}`);
    this.sec(`Modo edición: ${o.name}`,
      h('div', { class: 'mo-btnrow' }, mode('vert', 'Vértices (1)', I3.vert), mode('edge', 'Aristas (2)', I3.edge), mode('face', 'Caras (3)', I3.face)),
      h('p', { class: 'ctl-help' }, `${s.editCount ? `${s.editCount} elegidos. ` : ''}Clic para elegir, Mayús + clic para sumar, arrastra en vacío para un rectángulo. Mueve, gira o escala lo elegido con el gizmo.`),
      h('div', { class: 'mo-prop' }, h('label', { class: 'mo-lab', title: 'Distancia al extruir y empujar, ancho del bisel, tamaño del inset/agujero (0..1)' }, 'Cantidad'), amt),
      this.btns(['Extruir', () => s.extrude(a())], ['Extruir caras sueltas', () => s.extrude(a(), false)], ['Inset', () => s.inset(Math.min(0.95, a()))], ['Biselar', () => s.bevel(a() / 4)]),
      this.btns(['Agujero', () => s.hole(Math.min(0.95, a()))], ['Agujero pasante (2 caras)', () => s.bridge()], ['Subdividir', () => s.subdivide(1, false)], ['Suavizar', () => s.subdivide(1, true)]),
      this.btns(['Fusionar', () => s.mergeSel('center')], ['Empujar', () => s.pushVerts(a() / 5)], ['Invertir normales', () => s.flipNormals()], ['Borrar', () => s.deleteGeom()]),
      this.btns(['Elegir todo (A)', () => s.editSelectAll()], ['Material a las caras elegidas', () => this.setTab('mat')], ['Salir (Tab)', () => s.exitEdit()]));
  }

  // ---------------------------------------------------------------- materiales

  private matPanel() {
    const s = this.s, o = s.one;
    if (o?.mats?.length) {
      const opts: [string, string][] = s.s.materials.map(m => [m.id, m.name]);
      this.sec(s.mode === 'edit' ? 'Materiales del objeto (las caras elegidas reciben el que pulses en la biblioteca)' : `Materiales de «${o.name}»`,
        ...o.mats.map((mid, i) => h('div', { class: 'mo-prop' }, h('label', { class: 'mo-lab' }, o.mats!.length > 1 ? `Ranura ${i + 1}` : 'Material'),
          (() => { const sel = h('select', { class: 'mo-sel' }, ...opts.map(([v, l]) => h('option', { value: v, selected: v === mid }, l))); sel.addEventListener('change', () => s.assignMat(sel.value, i)); return sel; })(),
          h('button', { type: 'button', class: 'btn xs', on: { click: () => { this.matSel = mid; this.render(); } } }, 'Editar'))));
    }
    const m = s.mat(this.matSel ?? '') ?? (o?.mats?.[0] ? s.mat(o.mats[0]) : undefined) ?? s.s.materials[0];
    this.matSel = m.id;
    this.matEditor(m);
    this.library();
  }
  private matEditor(m: Mat3) {
    const s = this.s, id = m.id, M = () => s.mat(id) ?? null;
    const o = s.one;
    const animKey = (k: string) => (o?.mats?.[0] === id ? [o.id, `mat.${k}`] as [string, string] : null);
    const tex = m.tex ? s.s.textures.find(t => t.id === m.tex) : null;
    const texSel = this.select('Textura', m.tex ? 'img' : m.proc ?? '', [['', 'Ninguna'], ['wood', 'Madera'], ['bark', 'Corteza'], ['stone', 'Piedra'], ['marble', 'Mármol'], ['brick', 'Ladrillo'], ['tiles', 'Tejas'], ['grass', 'Hierba'], ['fabric', 'Tela'], ...(m.tex ? [['img', `Imagen: ${tex?.name ?? ''}`] as [string, string]] : [])],
      v => { if (v === 'img') return; s.setMat(id, x => { x.proc = v || null; x.tex = null; }, 'Textura'); });
    this.sec(`Material: ${m.name}`,
      this.text('Nombre', m.name, v => s.setMat(id, x => { x.name = v.trim().slice(0, 60) || x.name; }, 'Renombrar material')),
      this.color('Color', () => M()?.color ?? null, (v, live) => s.setMatProp(id, 'color', v, live), () => animKey('color')),
      this.num('Rugosidad', () => M()?.rough ?? null, (v, live) => s.setMatProp(id, 'rough', v, live), { step: 0.01, min: 0, max: 1, keyPath: () => animKey('rough') }),
      this.num('Metálico', () => M()?.metal ?? null, (v, live) => s.setMatProp(id, 'metal', v, live), { step: 0.01, min: 0, max: 1, keyPath: () => animKey('metal') }),
      this.num('Opacidad', () => M()?.opacity ?? null, (v, live) => s.setMatProp(id, 'opacity', v, live), { k: 100, step: 0.01, unit: '%', min: 0, max: 1, keyPath: () => animKey('opacity') }),
      this.color('Emisión (brillo propio)', () => M()?.emissive ?? null, (v, live) => s.setMatProp(id, 'emissive', v, live), () => animKey('emissive')),
      this.num('Intensidad de emisión', () => M()?.emissiveI ?? null, (v, live) => s.setMatProp(id, 'emissiveI', v, live), { step: 0.1, min: 0, keyPath: () => animKey('emissiveI') }),
      this.check('Estilizado (dibujo animado)', m.toon, v => s.setMat(id, x => { x.toon = v; }, 'Estilizado')),
      texSel,
      this.plainNum('Repetir textura', m.texScale, v => s.setMat(id, x => { x.texScale = Math.max(0.01, v); }, 'Repetición'), { min: 0.01, step: 0.25 }),
      this.btns(['Imagen…', () => void this.texFromFile(id)], ['Dibujo de YOSADRAW…', () => void this.texFromDrawing(id)], tex?.project ? ['Actualizar desde el dibujo', () => void this.refreshDrawing(id)] : null, m.tex ? ['Quitar imagen', () => s.setMat(id, x => { x.tex = null; }, 'Quitar textura')] : null),
      this.btns(['Pintar sobre el modelo', () => { s.setTool('paint'); toast('Pinta sobre el objeto en el visor (cambia color y tamaño arriba)'); }, 'Pinta directamente en la textura y míralo en vivo']),
      this.btns(['Aplicar a lo elegido', () => s.assignMat(id)], ['Nuevo', () => { this.matSel = s.newMat().id; this.render(); }], ['Duplicar', () => { this.matSel = s.newMat(m).id; this.render(); }], [m.fav ? '★ Favorito' : '☆ Favorito', () => s.toggleFav(id)], ['Borrar', () => s.removeMat(id)]));
  }
  private library() {
    const s = this.s;
    const groups = [...new Set(MATERIAL_PRESETS.map(p => p.group))];
    const sw = (color: string, label: string, run: () => void, title: string) => h('button', { type: 'button', class: 's3-swatch', title, on: { click: run } }, h('span', { class: 's3-swc', style: { background: color } }), h('span', null, label));
    const apply = (m: Mat3) => { this.matSel = m.id; if (s.selected.some(o => o.mesh)) s.assignMat(m.id); else this.render(); };
    const inProj = s.s.materials;
    this.sec('Materiales del proyecto', h('div', { class: 's3-swatches' }, ...inProj.map(m => sw(m.color.v, m.name, () => apply(m), `${m.name}: aplicar a lo elegido`))));
    if (s.prefs.favMats.length) this.sec('Favoritos', h('div', { class: 's3-swatches' }, ...s.prefs.favMats.map((f, i) => sw(f.color.v, f.name, () => { const ex = inProj.find(x => x.name === f.name); const m = ex ?? s.addFavMat(i); if (m) apply(m); }, `${f.name} (favorito)`))));
    this.sec('Biblioteca', ...groups.map(g => h('div', null, h('span', { class: 'mo-unit' }, g), h('div', { class: 's3-swatches' }, ...MATERIAL_PRESETS.filter(p => p.group === g).map(p => sw(p.o?.color ?? '#ccc', p.name, () => { const ex = inProj.find(x => x.name === p.name); apply(ex ?? s.addPresetMat(p.name)); }, `${p.name}: aplicar a lo elegido`))))));
  }
  private async texFromFile(id: string) {
    const [f] = await pickFiles('image/png,image/jpeg,image/webp,image/gif', false);
    if (!f) return;
    try { this.s.setTexture(id, await fileToDataUrl(f), f.name.replace(/\.[^.]+$/, '')); toast('Textura aplicada', 'ok'); } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); }
  }
  private async texFromDrawing(id: string) {
    const list = this.deps.projects.list().filter(e => !e.trashed && !e.motion && !e.s3d).slice(0, 30);
    if (!list.length) { toast('No tienes dibujos en la galería.'); return; }
    const r = (document.activeElement as HTMLElement | null)?.getBoundingClientRect();
    menu(r?.left ?? innerWidth / 2, r?.bottom ?? innerHeight / 2, 'Dibujo como textura', list.map(e => ({ label: e.name, run: async () => {
      try { toast('Preparando el dibujo…'); this.s.setTexture(id, await drawingToUrl(this.deps, e.id), e.name, { id: e.id, rev: e.rev }); toast(`«${e.name}» es la textura: si editas el dibujo, pulsa «Actualizar desde el dibujo»`, 'ok'); }
      catch (err) { toast(err instanceof Error ? err.message : String(err), 'error'); }
    } })));
  }
  async refreshDrawing(id: string) {
    const s = this.s, m = s.mat(id), t = m?.tex ? s.s.textures.find(x => x.id === m.tex) : null;
    if (!t?.project) return;
    try { const src = await drawingToUrl(this.deps, t.project.id); s.edit('Actualizar textura', st => { const nid = `${t.id}r${Date.now().toString(36)}`; st.textures.push({ id: nid, name: t.name, src, project: { id: t.project!.id, rev: this.deps.projects.get(t.project!.id)?.rev ?? t.project!.rev } }); const x = st.materials.find(y => y.id === id); if (x) x.tex = nid; }); toast('Textura actualizada con el dibujo', 'ok'); }
    catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); }
  }
  /** Texturas de dibujos que cambiaron en la galería desde que se usaron. */
  outdatedDrawings(): string[] {
    const s = this.s;
    return s.s.materials.filter(m => { const t = m.tex ? s.s.textures.find(x => x.id === m.tex) : null; return !!t?.project && (this.deps.projects.get(t.project.id)?.rev ?? t.project.rev) !== t.project.rev; }).map(m => m.id);
  }

  // ---------------------------------------------------------------- escena y render

  private scenePanel() {
    const s = this.s, sc = s.scene, env = sc.env, r = s.s.render;
    const setEnv = (label: string, fn: (e: typeof env) => void, live = false) => { const f = () => fn(s.scene.env); if (live) s.live(f); else s.edit(label, f); };
    this.sec('Escenas',
      ...s.s.scenes.map(x => h('div', { class: `mo-comprow${x.id === sc.id ? ' on' : ''}` },
        h('button', { type: 'button', class: 'btn sm ghost', on: { click: () => s.openScene(x.id) } }, `${x.id === sc.id ? '● ' : ''}${x.name}`),
        h('span', { class: 'mo-unit' }, `${x.objects.length} objetos`),
        h('button', { type: 'button', class: 'icon xs', title: 'Renombrar', 'aria-label': 'Renombrar escena', html: I3.edit, on: { click: async () => { const n = await promptText('Renombrar escena', x.name); if (n) s.renameScene(x.id, n); } } }),
        s.s.scenes.length > 1 ? h('button', { type: 'button', class: 'icon xs', title: 'Eliminar escena', 'aria-label': 'Eliminar escena', html: I3.trash, on: { click: async () => { if (await confirmDialog('Eliminar escena', `Se elimina «${x.name}» con sus objetos.`, 'Eliminar', true)) s.removeScene(x.id); } } }) : null)),
      this.btns(['Nueva escena', () => s.addScene()], ['Duplicar esta', () => s.addScene(true)]),
      this.btns(['Guardar como plantilla…', async () => { const n = await promptText('Nombre de la plantilla', sc.name); if (n) s.saveTemplate(n); }]),
      s.prefs.templates.length ? this.select('Usar plantilla', '', [['', 'Elegir…'], ...s.prefs.templates.map(t => [t.id, t.name] as [string, string])], v => { if (v) s.useTemplate(v); }) : null);
    this.sec('Entorno',
      (() => { const i = h('input', { type: 'color', class: 'mo-color', value: env.bg }); i.addEventListener('change', () => setEnv('Fondo', e => { e.bg = i.value; })); return h('div', { class: 'mo-prop' }, h('label', { class: 'mo-lab' }, 'Fondo'), i); })(),
      this.check('Fondo transparente (al renderizar)', env.transparent, v => setEnv('Fondo transparente', e => { e.transparent = v; })),
      this.range('Iluminación de entorno', env.envLight, 0, 3, 0.05, (v, live) => setEnv('Entorno', e => { e.envLight = v; }, live)),
      this.range('Exposición', env.exposure, 0.1, 3, 0.05, (v, live) => setEnv('Exposición', e => { e.exposure = v; }, live)),
      this.range('Niebla', env.fog, 0, 1, 0.01, (v, live) => setEnv('Niebla', e => { e.fog = v; }, live)));
    const g = s.s.grid;
    this.sec('Cuadrícula',
      this.plainNum('Tamaño de la cuadrícula', g.size, v => s.edit('Cuadrícula', st => { st.grid.size = Math.max(0.01, v); }), { min: 0.01, step: 0.05, unit: 'm' }),
      this.check('Ajuste magnético a la cuadrícula', g.snap, v => s.edit('Ajuste', st => { st.grid.snap = v; })),
      this.check('Mostrar cuadrícula', g.show, v => s.edit('Cuadrícula', st => { st.grid.show = v; })),
      this.check('Mostrar ejes', g.axes, v => s.edit('Ejes', st => { st.grid.axes = v; })));
    const aspect = (w: number, hh: number) => s.edit('Tamaño del render', st => { st.render.w = w; st.render.h = hh; });
    this.sec('Render',
      this.select('Formato', '', [['', `${r.w} × ${r.h}`], ['1920x1080', 'Full HD 16:9'], ['1280x720', 'HD 16:9'], ['3840x2160', '4K 16:9'], ['1080x1920', 'Vertical 9:16'], ['1080x1080', 'Cuadrado 1:1'], ['1080x1350', 'Retrato 4:5'], ['2048x2048', 'Textura 2048']], v => { if (v) { const [w, hh] = v.split('x').map(Number); aspect(w, hh); } }),
      this.plainNum('Ancho', r.w, v => aspect(Math.round(Math.max(16, Math.min(8192, v))), r.h), { min: 16, max: 8192, step: 1, unit: 'px' }),
      this.plainNum('Alto', r.h, v => aspect(r.w, Math.round(Math.max(16, Math.min(8192, v)))), { min: 16, max: 8192, step: 1, unit: 'px' }),
      this.select('Calidad', String(r.quality), [['1', 'Rápida'], ['2', 'Buena (antialiasing ×1,5)'], ['3', 'Máxima (×2)']], v => s.edit('Calidad', st => { st.render.quality = Number(v) as 1; })),
      this.select('Sombras', String(r.shadows), [['0', 'Sin sombras'], ['1', 'Básicas'], ['2', 'Buenas'], ['3', 'Muy nítidas']], v => s.edit('Sombras', st => { st.render.shadows = Number(v) as 1; })),
      this.check('Fondo transparente', r.transparent, v => s.edit('Transparente', st => { st.render.transparent = v; })),
      this.btns(['Renderizar…', () => this.deps.renderDialog()]));
    this.sec('Animación',
      this.plainNum('Duración', sc.dur, v => s.setDuration(v), { min: 0.1, step: 0.5, unit: 's' }),
      this.select('FPS', String(sc.fps), [12, 24, 25, 30, 48, 50, 60].map(f => [String(f), `${f} fps`] as [string, string]), v => s.setFps(Number(v))));
  }
}
export { effLocked };
