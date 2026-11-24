import { h, pickFiles, toast } from '../../ui/dom';
import { isPhone, openSheet, watchDevice } from '../../ui/Mobile';
import { modal } from '../../ui/modal';
import { menu } from '../../ui/motion/util';
import { genDef } from '../generators';
import { exportModel, importModel, MODEL_ACCEPT, renderVideo, saveFile, canvasPng, sceneAnimated, type ModelFormat } from '../io';
import { defaultTuber, genObject, newObject, type PrimType } from '../model';
import type { Studio3D, Tool3 } from '../Studio3D';
import { View3D, type ViewName } from '../View3D';
import { Assistant } from './Assistant';
import { I3 } from './icons3';
import { AddPanel, Hierarchy, Inspector3, drawingLayersToUrls, drawingToUrl, editMenu, objectMenu, type PanelDeps } from './Panels';
import { Live } from '../live/Live';
import { TuberPanel } from './TuberPanel';
import { setMeterSource } from './LivePanel';
import { LiveGifRecorder, LiveRecorder, REC_SIZES, recDims, type LiveRec, type RecSize } from '../live/recorder';
import { encodeGif } from '../../anim/webexport';
import { fileToDataUrl } from '../textures';
import { confirmDialog } from '../../ui/modal';
import { Timeline3 } from './Timeline3';

export interface UI3Deps extends PanelDeps {
  save(): void; gallery(): void; projectMenu(anchor: HTMLElement): void; name(): string;
  /** Lleva una imagen renderizada al dibujo 2D (como proyecto nuevo; `reference` = capa de referencia para dibujar encima). */
  sendTo2D(c: HTMLCanvasElement, name: string, reference: boolean): Promise<void>;
}

/**
 * Espacio de trabajo de YOSADRAW 3D Studio. En PC: barra superior, herramientas a la
 * izquierda con «Añadir» y la jerarquía, visor central, propiedades a la derecha y
 * línea de tiempo abajo. En el teléfono: visor arriba, línea de tiempo y una barra
 * de acciones que abre los paneles en hojas.
 */
export class UI3D {
  readonly el: HTMLElement;
  readonly view: View3D;
  readonly add: AddPanel;
  readonly hier: Hierarchy;
  readonly insp: Inspector3;
  readonly tl: Timeline3;
  readonly assist: Assistant;
  private nameEl = h('span', { class: 'mo-name' });
  private dirtyEl = h('span', { class: 'dirty-dot', hidden: true, title: 'Cambios sin guardar' });
  private undoBtn: HTMLButtonElement; private redoBtn: HTMLButtonElement;
  private rails = new Map<Tool3, HTMLButtonElement>();
  private leftTabs = h('div', { class: 'mo-tabs', role: 'tablist' });
  private leftBody = h('div', { class: 'mo-leftbody' });
  private leftTab: 'tuber' | 'add' | 'scene' = 'add';
  /** Módulo PNGTuber (proyecto 2D con el motor del 3D Studio). */
  private tuber!: TuberPanel;
  private brand = h('span', { class: 'mo-brand' }, '3D STUDIO');
  private vbar: HTMLElement;
  private editbar: HTMLElement;
  private paintbar: HTMLElement;
  private sceneSel = h('select', { class: 'mo-sel s3-scenesel', 'aria-label': 'Escena' });
  private simple = false;
  private playBtn!: HTMLButtonElement;
  private hud: HTMLElement;
  /** Modo En vivo en marcha (o null). */
  live: Live | null = null;
  private scriptOk = new WeakSet<object>();
  private video: LiveRec | null = null;
  /** Deslizadores de efectos en la barra del modo En vivo (plegados para no tapar la escena). */
  private hudFx = false;
  /** Calidad del vídeo en vivo (se recuerda en este equipo). */
  private recSize: RecSize = (() => { try { const v = localStorage.getItem('yosadraw.s3d.recSize'); return REC_SIZES.some(([k]) => k === v) ? v as RecSize : '1080'; } catch { return '1080' as RecSize; } })();
  /** Para el tutorial: ¿giró la vista? ¿renderizó? */
  private orbits = 0; private renders = 0;

  constructor(private s: Studio3D, private deps: UI3Deps) {
    this.view = new View3D(s);
    this.add = new AddPanel(s, { importModel: () => void this.importPick(), card: src => void this.addCard(src), house: () => { this.closeSheet(); this.house(); }, picked: () => { if (this.simple) { this.closeSheet(); toast('Toca el suelo del visor para ponerlo'); } } });
    this.hier = new Hierarchy(s);
    this.insp = new Inspector3(s, this.view, { ...deps, renderDialog: () => this.renderDialog(), play: () => void this.play() });
    this.tuber = new TuberPanel(s, { card: src => void this.addCard(src), play: () => void this.play(), pick: k => this.insp.pickArt(k), frame: () => this.frame2D() });
    this.tl = new Timeline3(s);
    this.assist = new Assistant(s, () => { s.prefs.assistant = false; s.deps.persist(); this.syncAssist(); });
    this.view.onContext = (x, y) => objectMenu(s, x, y);
    this.view.controls.addEventListener('end', () => { this.orbits++; s.emitView(); });

    const ib = (icon: string, title: string, run: (e: MouseEvent) => void, cls = 'icon') => h('button', { type: 'button', class: cls, title, 'aria-label': title, html: icon, on: { click: run as EventListener } });
    this.undoBtn = ib(I3.undo, 'Deshacer (Ctrl+Z)', () => s.undo());
    this.redoBtn = ib(I3.redo, 'Rehacer (Ctrl+Mayús+Z)', () => s.redo());
    this.sceneSel.addEventListener('change', () => { if (this.sceneSel.value === '+') { s.addScene(); return; } s.openScene(this.sceneSel.value); });
    const chip = h('button', { type: 'button', class: 'mo-chipbtn', title: 'Proyecto', on: { click: (e: Event) => deps.projectMenu(e.currentTarget as HTMLElement) } }, this.brand, this.nameEl, this.dirtyEl);
    const top = h('header', { class: 'mo-top' },
      ib(I3.grid, 'Galería', () => deps.gallery()), chip, ib(I3.save, 'Guardar (Ctrl+S)', () => deps.save()),
      h('span', { class: 'mo-sep' }), this.undoBtn, this.redoBtn, h('span', { class: 'mo-sep' }), this.sceneSel,
      h('div', { class: 'mo-spacer' }),
      ib(I3.help, 'Asistente 3D y tutorial «Tu primera casa»', e => this.helpMenu(e)),
      ib(I3.keyboard, 'Atajos de teclado', () => this.shortcuts(), 'icon mo-pconly'),
      h('button', { type: 'button', class: 'btn sm', title: 'Exportar el modelo (GLB, glTF, OBJ, STL)', on: { click: (e: Event) => this.exportMenu(e as MouseEvent) } }, 'Exportar'),
      this.playBtn = h('button', { type: 'button', class: 'btn s3-playbtn', html: '▶ <span>En vivo</span>', title: 'Ejecutar la escena en vivo: física, personajes, reglas y efectos (F5)', on: { click: () => void this.play() } }),
      h('button', { type: 'button', class: 'btn primary s3-renderbtn', html: `${I3.render} <span>Render</span>`, title: 'Renderizar imagen o animación (F12)', on: { click: () => this.renderDialog() } }));

    // Herramientas (izquierda).
    const tool = (id: Tool3, icon: string, title: string) => { const b = ib(icon, title, () => s.setTool(id), 'icon mo-tool'); this.rails.set(id, b); return b; };
    const navBtn = ib(I3.hand, 'Navegar con el botón izquierdo (N): girar la vista; Mayús = desplazar', () => { this.view.navigate = !this.view.navigate; navBtn.classList.toggle('on', this.view.navigate); }, 'icon mo-tool');
    const editBtn = ib(I3.vert, 'Modo edición: vértices, aristas y caras (Tab)', () => s.toggleEdit(), 'icon mo-tool s3-editbtn');
    const rail = h('nav', { class: 'mo-rail s3-rail', 'aria-label': 'Herramientas' },
      tool('select', I3.select, 'Seleccionar (Q): clic o rectángulo'), tool('move', I3.move, 'Mover (G)'), tool('rotate', I3.rotate, 'Rotar (R)'), tool('scale', I3.scale, 'Escalar (S)'),
      h('span', { class: 'mo-railsep' }), tool('create', I3.cube, 'Crear (C): clic o arrastrar en el suelo'), tool('block', I3.block, 'Bloques (B)'), tool('paint', I3.paint, 'Pintar sobre el modelo (P)'),
      h('span', { class: 'mo-railsep' }), editBtn, navBtn);
    const left = h('aside', { class: 'mo-left s3-left', 'aria-label': 'Añadir y escena' }, this.leftTabs, this.leftBody);
    const right = h('aside', { class: 'mo-right', 'aria-label': 'Propiedades' }, this.insp.el);

    // Barra del visor: vistas, modo de sombreado, cuadrícula, imán.
    const vb = (label: string, title: string, run: () => void, cls = 'btn xs') => h('button', { type: 'button', class: cls, title, on: { click: run } }, label);
    const view = (v: ViewName, label: string, key: string) => vb(label, `Vista ${label.toLowerCase()} (${key})`, () => this.view.setView(v));
    const shade = (m: 'solid' | 'wire' | 'material' | 'render', label: string) => { const b = vb(label, `Ver: ${label}`, () => s.setShading(m)); b.dataset.shade = m; return b; };
    const snapBtn = h('button', { type: 'button', class: 'icon sm', title: 'Ajuste magnético a la cuadrícula (Mayús+S)', 'aria-label': 'Ajuste magnético', html: I3.magnet, on: { click: () => { s.snap = !s.snap; this.syncBars(); s.setTool(s.tool); } } });
    const gridBtn = h('button', { type: 'button', class: 'icon sm', title: 'Cuadrícula', 'aria-label': 'Cuadrícula', html: I3.grid3, on: { click: () => { this.view.showGrid = !this.view.showGrid; this.view.sync(); this.syncBars(); } } });
    const axesBtn = h('button', { type: 'button', class: 'icon sm', title: 'Ejes X, Y, Z', 'aria-label': 'Ejes', html: I3.axes, on: { click: () => { this.view.showAxes = !this.view.showAxes; this.view.sync(); this.syncBars(); } } });
    const helpBtn = h('button', { type: 'button', class: 'icon sm', title: 'Guías: luces y cámaras', 'aria-label': 'Guías', html: I3.light, on: { click: () => { this.view.showHelpers = !this.view.showHelpers; this.view.sync(); this.syncBars(); } } });
    const axis = (a: 'x' | 'y' | 'z') => { const b = vb(a.toUpperCase(), `Limitar al eje ${a.toUpperCase()} (${a.toUpperCase()})`, () => s.setAxis(a), `btn xs s3-axis s3-axis-${a}`); b.dataset.axis = a; return b; };
    this.vbar = h('div', { class: 's3-vbar' },
      h('div', { class: 's3-vgroup' }, view('persp', 'Persp.', '5'), view('front', 'Frente', '1'), view('right', 'Lado', '3'), view('top', 'Arriba', '7'), vb('Orto', 'Perspectiva / ortográfica (5)', () => this.view.setOrtho(!this.view.isOrtho), 'btn xs s3-ortho'), vb('Cámara', 'Ver por la cámara de la escena (0)', () => this.view.lookThrough(), 'btn xs s3-camview')),
      h('div', { class: 's3-vgroup' }, h('button', { type: 'button', class: 'icon sm', title: 'Encuadrar lo elegido (F)', 'aria-label': 'Encuadrar lo elegido', html: I3.frame, on: { click: () => this.view.frameSelected() } }), h('button', { type: 'button', class: 'icon sm', title: 'Ver toda la escena (Inicio)', 'aria-label': 'Ver toda la escena', html: I3.fit, on: { click: () => this.view.frameAll() } })),
      h('div', { class: 's3-vgroup' }, shade('solid', 'Sólido'), shade('wire', 'Alámbrico'), shade('material', 'Materiales'), shade('render', 'Render')),
      h('div', { class: 's3-vgroup' }, snapBtn, gridBtn, axesBtn, helpBtn, axis('x'), axis('y'), axis('z')));
    const ebtn = (icon: string, label: string, title: string, run: () => void) => h('button', { type: 'button', class: 'btn xs', title, on: { click: run } }, h('span', { html: icon }), ` ${label}`);
    const selb = (m: 'vert' | 'edge' | 'face', icon: string, title: string) => { const b = h('button', { type: 'button', class: 'icon sm', title, 'aria-label': title, html: icon, on: { click: () => s.setSelMode(m) } }); b.dataset.sm = m; return b; };
    this.editbar = h('div', { class: 's3-editbar', hidden: true },
      h('div', { class: 's3-vgroup' }, selb('vert', I3.vert, 'Vértices (1)'), selb('edge', I3.edge, 'Aristas (2)'), selb('face', I3.face, 'Caras (3)')),
      h('div', { class: 's3-vgroup' }, ebtn(I3.extrude, 'Extruir', 'Extruir lo elegido (E)', () => s.extrude(0.5)), ebtn(I3.inset, 'Inset', 'Inset (I)', () => s.inset(0.25)), ebtn(I3.bevel, 'Biselar', 'Biselar aristas (Ctrl+B)', () => s.bevel(0.1)),
        ebtn(I3.subdiv, 'Suavizar', 'Subdividir y suavizar', () => s.subdivide(1, true)), ebtn(I3.merge, 'Fusionar', 'Fusionar vértices (M)', () => s.mergeSel()), ebtn(I3.hole, 'Agujero', 'Abrir un agujero en las caras elegidas', () => s.hole(0.3)), ebtn(I3.bridge, 'Túnel', 'Unir dos caras opuestas con un túnel (agujero pasante)', () => s.bridge())),
      h('div', { class: 's3-vgroup' }, h('button', { type: 'button', class: 'btn xs', on: { click: (e: Event) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); editMenu(s, r.left, r.bottom); } } }, 'Más…'), h('button', { type: 'button', class: 'btn xs primary', title: 'Volver al modo objeto (Tab)', on: { click: () => s.exitEdit() } }, 'Objeto')));
    const pc = h('input', { type: 'color', value: s.paint.color, 'aria-label': 'Color del pincel' });
    pc.addEventListener('input', () => { s.paint.color = pc.value; });
    const ps = h('input', { type: 'range', min: '2', max: '200', value: String(s.paint.size), 'aria-label': 'Tamaño del pincel' });
    ps.addEventListener('input', () => { s.paint.size = Number(ps.value); });
    const po = h('input', { type: 'range', min: '5', max: '100', value: '100', 'aria-label': 'Opacidad del pincel' });
    po.addEventListener('input', () => { s.paint.opacity = Number(po.value) / 100; });
    this.paintbar = h('div', { class: 's3-paintbar', hidden: true }, h('span', { html: I3.paint }), h('label', null, 'Color ', pc), h('label', null, 'Tamaño ', ps), h('label', null, 'Opacidad ', po), h('span', { class: 'mo-unit' }, 'Pinta sobre el objeto: la textura cambia en vivo.'));
    this.hud = h('div', { class: 's3-livehud', hidden: true });
    const center = h('div', { class: 'mo-center s3-center' }, this.vbar, this.editbar, this.paintbar, h('div', { class: 's3-viewwrap' }, this.view.el, this.assist.el, this.hud));
    const split = (side: 'l' | 'r' | 'b') => {
      const el = h('div', { class: `mo-split mo-split-${side}`, 'aria-hidden': 'true' });
      el.addEventListener('pointerdown', e => {
        el.setPointerCapture(e.pointerId);
        const x0 = e.clientX, y0 = e.clientY, p = s.prefs, v0 = side === 'l' ? p.leftW : side === 'r' ? p.rightW : p.tlH;
        const mv = (ev: PointerEvent) => {
          if (side === 'l') p.leftW = Math.max(180, Math.min(480, v0 + ev.clientX - x0));
          else if (side === 'r') p.rightW = Math.max(240, Math.min(520, v0 - (ev.clientX - x0)));
          else p.tlH = Math.max(90, Math.min(innerHeight - 300, v0 - (ev.clientY - y0)));
          this.applySizes();
        };
        const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); s.deps.persist(); };
        el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
      });
      return el;
    };
    const main = h('div', { class: 'mo-main' }, rail, left, split('l'), center, split('r'), right);
    const act = (icon: string, label: string, run: () => void) => h('button', { type: 'button', class: 'mo-act', on: { click: run } }, h('span', { html: icon }), h('span', null, label));
    const phoneBar = h('nav', { class: 'mo-phonebar', 'aria-label': 'Acciones' },
      act(I3.cube, 'Añadir', () => this.sheet('Añadir', this.add.el)),
      act(I3.layers3, 'Escena', () => { this.hier.render(); this.sheet('Escena', this.hier.el); }),
      act(I3.edit, 'Propiedades', () => { this.insp.setTab('obj'); this.sheet('Propiedades', this.insp.el); }),
      act(I3.paint, 'Material', () => { this.insp.setTab('mat'); this.sheet('Material', this.insp.el); }),
      act(I3.move, 'Mover', () => s.setTool('move')), act(I3.rotate, 'Rotar', () => s.setTool('rotate')), act(I3.scale, 'Escalar', () => s.setTool('scale')),
      act(I3.vert, 'Editar', () => s.toggleEdit()), act(I3.render, 'Render', () => this.renderDialog()),
      act(I3.more, 'Más', () => this.phoneMore()));
    this.el = h('div', { class: 'mo-root s3-root', role: 'application', 'aria-label': 'YOSADRAW 3D Studio', hidden: true }, top, main, split('b'), h('div', { class: 'mo-bottom' }, this.tl.el), phoneBar);
    this.renderLeft();

    s.on('tool', () => this.syncBars());
    s.on('mode', () => this.syncBars());
    s.on('select', () => this.syncBars());
    s.on('view', () => this.syncBars());
    s.on('change', () => { this.syncTop(); this.syncBars(); });
    s.on('open', on => { this.el.hidden = !on; if (on) { this.layout(); this.applyKind(); this.syncTop(); this.syncBars(); this.syncAssist(); s.setTool('move'); this.checkDrawings(); if (!s.prefs.tutorialSeen && !this.isTuber) { s.prefs.tutorialSeen = true; s.deps.persist(); toast('¿Primera vez en 3D? Pulsa ? (arriba) para el tutorial «Tu primera casa».', 'info', { label: 'Empezar', run: () => this.tutorial() }); } } });
    watchDevice(() => this.layout());
    window.addEventListener('focus', () => { if (s.active) this.checkDrawings(); });
  }

  // ---------------------------------------------------------------- disposición

  private layout() {
    this.simple = isPhone() || document.documentElement.classList.contains('android');
    this.el.classList.toggle('mo-simple', this.simple);
    if (!this.simple) {
      const right = this.el.querySelector('.mo-right')!;
      if (!right.contains(this.insp.el)) right.append(this.insp.el);
      this.renderLeft();
    }
    this.applySizes();
  }
  private applySizes() {
    const p = this.s.prefs;
    this.el.style.setProperty('--mo-left', `${p.leftW}px`);
    this.el.style.setProperty('--mo-right', `${p.rightW}px`);
    this.el.style.setProperty('--mo-tl', `${p.tlH}px`);
  }
  private renderLeft() {
    const t = this.leftTab;
    const tabs: ['tuber' | 'add' | 'scene', string][] = this.isTuber ? [['tuber', 'PNGTuber'], ['add', 'Añadir'], ['scene', 'Escena']] : [['add', 'Añadir'], ['scene', 'Escena']];
    this.leftTabs.replaceChildren(...tabs.map(([id, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(t === id), on: { click: () => { this.leftTab = id; this.renderLeft(); } } }, l)));
    this.leftBody.replaceChildren(t === 'tuber' ? this.tuber.el : t === 'add' ? this.add.el : this.hier.el);
    if (t === 'scene') this.hier.render();
    if (t === 'tuber') this.tuber.render();
  }
  get isTuber() { return this.s.active && this.s.s.kind === 'tuber'; }
  /** PNGTuber: vista plana de frente con los personajes encuadrados. */
  private frame2D() {
    this.view.setView('front');
    const chars = this.s.scene.objects.filter(o => o.card && !o.part);
    if (chars.length) { const prev = this.s.sel; this.s.select(chars.map(o => o.id)); this.view.frameSelected(); this.s.select(prev); }
    else this.view.frameAll();
  }
  /** Al abrir: módulo PNGTuber (2D) o 3D Studio. */
  private applyKind() {
    const t = this.isTuber;
    this.el.classList.toggle('s3-tuber', t);
    this.brand.textContent = t ? 'PNGTUBER' : '3D STUDIO';
    this.leftTab = t ? 'tuber' : this.leftTab === 'tuber' ? 'add' : this.leftTab;
    this.renderLeft();
    if (t) { if (this.s.prefs.shading !== 'render') this.s.setShading('render'); this.frame2D(); }
  }
  private sheetClose: (() => void) | null = null;
  private closeSheet() { this.sheetClose?.(); this.sheetClose = null; }
  private sheet(title: string, el: HTMLElement) { openSheet(title, close => { this.sheetClose = close; return [h('div', { class: 'mo-sheetbody' }, el)]; }); }
  private syncAssist() { this.assist.el.hidden = !this.s.prefs.assistant || this.isTuber; this.assist.render(); }
  private syncTop() {
    const s = this.s, hs = s.hist;
    if (!hs) return;
    this.nameEl.textContent = this.deps.name();
    this.undoBtn.disabled = !hs.undoStack.length; this.redoBtn.disabled = !hs.redoStack.length;
    const u = hs.undoStack[hs.undoStack.length - 1], r = hs.redoStack[hs.redoStack.length - 1];
    this.undoBtn.title = u ? `Deshacer: ${u.label} (Ctrl+Z)` : 'Deshacer';
    this.redoBtn.title = r ? `Rehacer: ${r.label} (Ctrl+Mayús+Z)` : 'Rehacer';
    this.sceneSel.replaceChildren(...s.s.scenes.map(x => h('option', { value: x.id, selected: x.id === s.scene.id }, x.name)), h('option', { value: '+' }, '+ Nueva escena'));
  }
  setDirty(dirty: boolean, name: string) { this.dirtyEl.hidden = !dirty; this.nameEl.textContent = name; }
  private syncBars() {
    const s = this.s;
    if (!s.active) return;
    for (const [id, b] of this.rails) { b.classList.toggle('on', s.tool === id); b.setAttribute('aria-pressed', String(s.tool === id)); }
    this.el.querySelector('.s3-editbtn')?.classList.toggle('on', s.mode === 'edit');
    this.editbar.hidden = s.mode !== 'edit';
    this.paintbar.hidden = s.tool !== 'paint';
    this.vbar.querySelectorAll<HTMLElement>('[data-shade]').forEach(b => b.classList.toggle('on', b.dataset.shade === s.prefs.shading));
    this.vbar.querySelectorAll<HTMLElement>('[data-axis]').forEach(b => b.classList.toggle('on', b.dataset.axis === s.axis));
    this.vbar.querySelector('.s3-ortho')?.classList.toggle('on', this.view.isOrtho);
    this.vbar.querySelector('.s3-camview')?.classList.toggle('on', this.view.throughCamera);
    const [snap, grid, axes, helpers] = [...this.vbar.querySelectorAll('.s3-vgroup:last-child .icon')];
    snap?.classList.toggle('on', s.snap && s.s.grid.snap); grid?.classList.toggle('on', this.view.showGrid); axes?.classList.toggle('on', this.view.showAxes); helpers?.classList.toggle('on', this.view.showHelpers);
    this.editbar.querySelectorAll<HTMLElement>('[data-sm]').forEach(b => b.classList.toggle('on', b.dataset.sm === s.selMode));
    this.el.classList.toggle('mo-autokey', s.prefs.autoKey);
  }

  // ---------------------------------------------------------------- acciones

  /** Casa de ejemplo: cuatro paredes (puerta y ventanas), tejado y suelo, en un grupo. */
  house() {
    const s = this.s;
    const L = 6, D = 5, T = 0.2, H = 2.6;
    let gid = '';
    s.edit('Casa de ejemplo', (st, sc) => {
      const mats = (t: Parameters<typeof genObject>[0]) => genDef(t).mats.map(n => s.matByName(st, n));
      const g = newObject('group', 'Casa'); gid = g.id; sc.objects.push(g);
      const wall = (name: string, x: number, z: number, ry: number, len: number, p: Record<string, number>) => { const o = genObject('wall', mats('wall'), [x, 0, z], { length: len, height: H, thick: T, ...p }); o.name = name; o.tf.ry.v = ry; o.parent = g.id; sc.objects.push(o); };
      wall('Pared delantera', 0, D / 2, 0, L, { door: 1, windows: 2 });
      wall('Pared trasera', 0, -D / 2, 0, L, { door: 0, windows: 2 });
      wall('Pared izquierda', -L / 2 + T / 2, 0, 90, D - T, { door: 0, windows: 1 });
      wall('Pared derecha', L / 2 - T / 2, 0, 90, D - T, { door: 0, windows: 1 });
      const roof = genObject('roof', mats('roof'), [0, H, 0], { w: L, d: D, h: 1.8, overhang: 0.35 }); roof.name = 'Tejado'; roof.parent = g.id; sc.objects.push(roof);
      const door = genObject('door', mats('door'), [0, 0, D / 2 + 0.02], { w: 0.88, h: 2.03 }); door.name = 'Puerta'; door.parent = g.id; sc.objects.push(door);
    });
    s.select([gid]);
    this.view.frameSelected();
    toast('Casa creada: cada pared, el tejado y la puerta se pueden cambiar en «Objeto» (doble clic para elegir una pieza).', 'ok');
  }
  private async importPick() {
    const [f] = await pickFiles(MODEL_ACCEPT, false);
    if (!f) return;
    try { const n = await importModel(this.s, f); this.view.frameSelected(); toast(`«${f.name}» importado: ${n} ${n === 1 ? 'pieza editable' : 'piezas editables'}`, 'ok'); }
    catch (e) { toast(`No se pudo importar: ${e instanceof Error ? e.message : String(e)}`, 'error'); }
  }
  private exportMenu(e: MouseEvent) {
    const s = this.s, base = this.deps.name().replace(/[\\/:*?"<>|]+/g, '_') || 'modelo';
    const go = (fmt: ModelFormat, sel: boolean) => async () => {
      try { const r = await exportModel(s, this.view, fmt, sel, base); toast(`Exportado: ${r.name} (${(r.size / 1024).toFixed(0)} KB)`, 'ok'); }
      catch (err) { toast(err instanceof Error ? err.message : String(err), 'error'); }
    };
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu(r.left, r.bottom, 'Exportar modelo', [
      { label: 'GLB (binario, con materiales, texturas y animación)', run: go('glb', false) },
      { label: 'glTF (JSON)', run: go('gltf', false) },
      { label: 'OBJ (+ .mtl)', run: go('obj', false) },
      { label: 'STL (impresión 3D)', run: go('stl', false) },
      null,
      { label: 'GLB sólo de lo elegido', disabled: !s.sel.length, run: go('glb', true) },
      { label: 'STL sólo de lo elegido', disabled: !s.sel.length, run: go('stl', true) },
    ]);
  }
  private helpMenu(e: MouseEvent) {
    const s = this.s, r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu(r.left, r.bottom, 'Ayuda', [
      { label: s.prefs.assistant ? 'Ocultar el Asistente 3D' : 'Mostrar el Asistente 3D', run: () => { s.prefs.assistant = !s.prefs.assistant; s.deps.persist(); this.syncAssist(); } },
      { label: 'Tutorial: Tu primera casa', run: () => this.tutorial() },
      { label: 'Atajos de teclado', run: () => this.shortcuts() },
    ]);
  }
  tutorial() {
    const s = this.s;
    s.prefs.assistant = true; s.deps.persist();
    this.assist.el.hidden = false;
    const o0 = this.orbits, r0 = this.renders;
    this.assist.startTutorial({ orbited: () => this.orbits > o0, rendered: () => this.renders > r0 });
  }
  private phoneMore() {
    const s = this.s;
    menu(0, 0, 'Más', [
      { label: 'Duplicar', disabled: !s.sel.length, run: () => s.duplicate() },
      { label: 'Eliminar', disabled: !s.sel.length, run: () => s.remove() },
      { label: 'Crear forma (toca el suelo)', run: () => s.setTool('create') },
      { label: 'Bloques', run: () => s.setTool('block') },
      { label: 'Pintar sobre el modelo', run: () => s.setTool('paint') },
      { label: 'Encuadrar lo elegido', run: () => this.view.frameSelected() },
      { label: 'Ver toda la escena', run: () => this.view.frameAll() },
      { label: 'Ver por la cámara', run: () => this.view.lookThrough() },
      { label: 'Escena y render…', run: () => { this.insp.setTab('scene'); this.sheet('Escena y render', this.insp.el); } },
      { label: 'Keyframe de transformación', disabled: !s.sel.length, run: () => s.keyTransform() },
      { label: s.playing ? 'Pausa' : 'Reproducir', run: () => s.toggle() },
      { label: 'Tutorial: Tu primera casa', run: () => this.tutorial() },
    ]);
  }
  /** Avisa si un dibujo usado como textura cambió en la galería. */
  private checkDrawings() {
    const ids = this.insp.outdatedDrawings();
    if (ids.length) toast(`${ids.length === 1 ? 'Un dibujo usado como textura cambió' : `${ids.length} dibujos usados como textura cambiaron`}.`, 'info', { label: 'Actualizar', run: () => { for (const id of ids) void this.insp.refreshDrawing(id); } });
  }

  // ---------------------------------------------------------------- modo En vivo

  /** Ejecuta la escena en vivo (o la para). */
  async play() {
    const s = this.s;
    if (this.live?.running) { await this.stopLive(); return; }
    const code = s.scene.script?.trim();
    let runScript = !!code;
    // El programa es código: la primera vez en este proyecto se pregunta antes de ejecutarlo.
    if (code && s.doc && !this.scriptOk.has(s.doc)) {
      runScript = await confirmDialog('Programa de la escena', 'Esta escena tiene un programa (JavaScript). Ejecútalo sólo si confías en quien lo escribió. ¿Ejecutarlo?', 'Ejecutar');
      if (runScript) this.scriptOk.add(s.doc);
    }
    const live = new Live(s, this.view);
    this.live = live;
    live.onState = () => this.syncHud();
    live.onLog = l => this.hudLog(l.msg, l.error);
    live.onToggleUi = () => this.toggleClean();
    setMeterSource(() => (live.running ? { level: live.audio.level, talking: live.audio.talking } : null));
    live.onRecordKey = () => { if (this.video) this.stopVideo(); else this.startVideo(); this.renderHud(); };
    live.start(runScript);
    this.el.classList.add('s3-playing');
    this.renderHud();
    this.view.el.focus?.();
    if (!live.bodyCount && !(s.scene.rules?.length) && !code) toast('Consejo: en Objeto → «Física y control» haz los objetos dinámicos o personajes para que se muevan y se puedan agarrar.');
  }
  private async stopLive() {
    const live = this.live;
    if (!live) return;
    if (this.video) this.stopVideo();
    live.stop();
  }
  private async afterStop() {
    const live = this.live;
    if (!live) return;
    // Esc también termina (y guarda) el vídeo que se estaba grabando.
    if (this.video) this.stopVideo();
    this.el.classList.remove('s3-playing', 's3-clean');
    this.hud.hidden = true;
    this.playBtn.innerHTML = '▶ <span>En vivo</span>';
    if (live.recording) {
      const save = await confirmDialog('Grabación en vivo', '¿Guardar lo que has grabado como keyframes? (Después lo puedes renderizar a vídeo o seguir editándolo.)', 'Guardar keyframes');
      const n = live.stopRec(save);
      if (n) toast(`Grabación guardada: ${n} keyframes`, 'ok');
    }
    this.live = null;
    this.syncTop();
  }
  private renderHud() {
    const s = this.s, live = this.live!;
    const b = (label: string, title: string, run: () => void, cls = 'btn sm') => h('button', { type: 'button', class: cls, title, on: { click: run } }, label);
    const slow = h('select', { class: 'mo-sel', 'aria-label': 'Velocidad', title: 'Cámara lenta' }, ...[[1, '1×'], [0.5, '½×'], [0.25, '¼×'], [2, '2×']].map(([v, l]) => h('option', { value: String(v) }, String(l))));
    slow.addEventListener('change', () => { live.timescale = Number(slow.value); });
    const recSel = h('select', { class: 'mo-sel', 'aria-label': 'Calidad del vídeo', title: 'Calidad del vídeo en vivo' }, ...REC_SIZES.map(([v, l]) => h('option', { value: v, selected: v === this.recSize }, l)));
    recSel.addEventListener('change', () => { this.recSize = recSel.value as RecSize; try { localStorage.setItem('yosadraw.s3d.recSize', this.recSize); } catch { /* sin almacenamiento */ } });
    const slider = (k: 'godrays' | 'bloom' | 'chroma' | 'glitch' | 'tintAmt' | 'squiggle' | 'ink', label: string, max: number) => {
      const r = h('input', { type: 'range', min: '0', max: String(max), step: '0.01', value: String(live.fx[k]), 'aria-label': label, title: label });
      r.addEventListener('input', () => { live.fx[k] = Number(r.value); });
      r.addEventListener('change', () => s.setFx({ [k]: Number(r.value) }));
      return h('label', null, label, r);
    };
    this.hud.replaceChildren(
      h('div', { class: 's3-hudrow' },
        b('■ Parar', 'Parar (Esc)', () => void this.stopLive(), 'btn sm primary'),
        b(live.paused ? '▶ Seguir' : '❚❚ Pausa', 'Pausa', () => { live.togglePause(); this.renderHud(); }),
        b(live.recording ? '● Grabando…' : '● Grabar keyframes', 'Graba lo que pasa (física y personajes) para guardarlo como animación', () => { if (live.recording) void this.saveRec(); else live.startRec(); this.renderHud(); }, `btn sm${live.recording ? ' s3-rec' : ''}`),
        b(this.video ? '⏺ Parar vídeo' : '⏺ Grabar vídeo', 'Graba en vídeo lo que se ve, con los efectos (F9)', () => { if (this.video) this.stopVideo(); else this.startVideo(); this.renderHud(); }, `btn sm${this.video ? ' s3-rec' : ''}`),
        this.video ? null : b('⏺ Grabar sin interfaz', 'Oculta la interfaz y empieza a grabar el vídeo (H vuelve a mostrarla, F9 para)', () => { this.toggleClean(true); this.startVideo(); this.renderHud(); }),
        this.video ? null : recSel,
        b(live.audio.micOn ? '🎤 Micrófono: sí' : '🎤 Micrófono', 'Tu voz mueve a los personajes PNGTuber (boca, rebote, sucesos de audio)', () => void live.audio.useMic(!live.audio.micOn).then(ok => { if (!ok) toast('No se pudo usar el micrófono (permiso denegado o no hay micrófono).', 'error'); this.renderHud(); }), `btn sm${live.audio.micOn ? ' primary' : ''}`),
        h('span', { class: 's3-hudmeter', title: 'Nivel del audio' }, h('i')),
        b(this.hudFx ? '✨ Efectos ▴' : '✨ Efectos ▾', 'Mostrar u ocultar los deslizadores de efectos', () => { this.hudFx = !this.hudFx; this.renderHud(); }, `btn sm${this.hudFx ? ' primary' : ''}`),
        slow, b('⛶ Ocultar interfaz', 'Ocultar la interfaz para jugar con la escena a pantalla completa (H)', () => this.toggleClean()), h('span', { class: 's3-fps' })),
      h('div', { class: 's3-hudrow s3-hudmin' }, b('■', 'Parar (Esc)', () => void this.stopLive(), 'btn sm primary'),
        b(this.video ? '⏹ Parar vídeo' : '⏺ Grabar', this.video ? 'Parar la grabación (F9)' : 'Grabar vídeo sin la interfaz (F9)', () => { if (this.video) this.stopVideo(); else this.startVideo(); this.renderHud(); }, `btn sm${this.video ? ' s3-rec' : ''}`),
        h('span', { class: 's3-rectime' }),
        b('Mostrar interfaz (H)', 'Volver a ver los paneles', () => this.toggleClean())),
      h('div', { class: 's3-hudrow s3-actors', hidden: true }),
      h('div', { class: 's3-hudrow s3-hudfx', hidden: !this.hudFx }, slider('godrays', 'Luz volumétrica', 2), slider('bloom', 'Resplandor', 3), slider('chroma', 'Aberración', 3), slider('glitch', 'Glitch', 1), slider('tintAmt', 'Tinte', 1), slider('squiggle', 'Squiggle', 1), slider('ink', 'Tinta', 1)),
      h('div', { class: 's3-hudlog' }),
      h('div', { class: 's3-hudhelp' }, 'Arrastra lo dinámico para agarrarlo y sacudirlo (rueda: acercar o alejar) · arrastra en el suelo para guiar a los personajes «hacia el ratón» · Espacio: saltar · botón central: girar la vista · Esc: parar'));
    this.hud.hidden = false;
    this.syncHud();
  }
  private syncHud() {
    const live = this.live;
    if (!live) return;
    if (!live.running) { void this.afterStop(); return; }
    this.playBtn.innerHTML = live.running ? '■ <span>Parar</span>' : '▶ <span>En vivo</span>';
    const fps = this.hud.querySelector('.s3-fps');
    if (fps && !fps.hasAttribute('data-tick')) { fps.setAttribute('data-tick', ''); const tick = () => { if (!this.live?.running || !fps.isConnected) return; fps.textContent = `${this.view.fps ? `${Math.round(this.view.fps)} FPS · ` : ''}${live.bodyCount} cuerpos · ${live.time.toFixed(1)} s`; const hm = this.hud.querySelector<HTMLElement>('.s3-hudmeter i'); if (hm) { hm.style.width = `${Math.round(Math.min(1, live.audio.level) * 100)}%`; hm.parentElement!.classList.toggle('on', live.audio.talking); hm.parentElement!.hidden = !live.audio.active; } const rt = this.hud.querySelector('.s3-rectime'); if (rt) { const v = this.video; rt.textContent = v ? `● ${Math.floor(v.seconds / 60)}:${String(Math.floor(v.seconds % 60)).padStart(2, '0')}` : ''; } setTimeout(tick, 500); }; tick(); }
    // Actores: quién se controla (clic en uno para elegirlo; en el activo, para soltarlo).
    const bar = this.hud.querySelector<HTMLElement>('.s3-actors');
    if (bar) {
      const list = live.actors();
      bar.hidden = !list.length;
      bar.replaceChildren(...(list.length ? [h('span', { class: 'mo-unit' }, 'Actores:')] : []), ...list.map(a => h('button', { type: 'button', class: `btn sm${a.active ? ' primary' : ''}`, title: a.active ? 'Soltar el control' : `Controlar a «${a.name}» (${a.keys})`, on: { click: () => live.selectActor(a.active ? null : a.id) } }, `${a.keys} · ${a.name}`)));
      if (list.length && !list.some(a => a.active)) bar.append(h('span', { class: 'mo-unit' }, 'pulsa su tecla para controlarlo'));
    }
  }
  /** Ocultar la interfaz en vivo (sólo la escena, a pantalla completa) o volver a mostrarla. */
  private toggleClean(force?: boolean) {
    if (!this.live?.running) return;
    this.el.classList.toggle('s3-clean', force);
    this.view.el.focus?.();
  }
  private hudLog(msg: string, error = false) {
    const el = this.hud.querySelector('.s3-hudlog');
    if (!el) return;
    el.append(h('div', { class: error ? 's3-err' : '' }, msg));
    while (el.children.length > 4) el.firstChild!.remove();
  }
  private async saveRec() {
    const live = this.live;
    if (!live) return;
    const n = live.stopRec(true);
    toast(n ? `Grabación guardada como ${n} keyframes (se puede deshacer)` : 'No se grabó ningún movimiento.', n ? 'ok' : 'info');
  }
  /**
   * Graba en vídeo lo que se ve en vivo: a un lienzo propio de tamaño fijo (no se
   * estropea al ocultar la interfaz ni al cambiar el tamaño de la ventana) y con el
   * visor dibujando a la resolución del vídeo mientras dura la grabación.
   */
  private startVideo() {
    const live = this.live;
    if (!live?.running || this.video) return;
    if (!LiveRecorder.supported()) { toast('Este sistema no puede grabar vídeo en vivo: graba keyframes y usa Render → animación.', 'error'); return; }
    const cv = this.view.renderer.domElement as HTMLCanvasElement;
    // Forma del vídeo: la de lo que se ve al empezar (pantalla completa si la interfaz está oculta).
    const box = this.view.el.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    const dims = recDims(this.recSize, box.width / Math.max(1, box.height), { w: box.width * dpr, h: box.height * dpr });
    const fps = Math.max(24, Math.min(60, this.s.fps));
    let rec: LiveRec;
    if (this.recSize === 'gif') {
      // GIF: fotogramas pequeños y, al parar, el codificador GIF del módulo de animación.
      rec = new LiveGifRecorder(box.width / Math.max(1, box.height), (frames, w, h, gfps) => void (async () => {
        if (!frames.length) return;
        toast(`Creando el GIF (${frames.length} fotogramas)…`);
        const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d')!;
        const data = await encodeGif({ width: w, height: h, fps: gfps, frames: frames.length, frame: k => { g.putImageData(frames[k], 0, 0); return c; }, loop: true, alpha: false });
        if (!data) return;
        const name = `${this.deps.name()}-en-vivo.gif`;
        await saveFile(name, data);
        toast(`GIF guardado: ${name} (${w} × ${h})`, 'ok');
      })(), cv);
      live.onFrame = () => { rec.frame(cv); if ((rec as LiveGifRecorder).full) { this.stopVideo(); this.renderHud(); toast('GIF: se alcanzó el máximo de 40 s'); } };
      this.video = rec;
      toast('Grabando GIF (F9 para parar)');
      return;
    }
    try {
      rec = new LiveRecorder(dims.w, dims.h, fps, async (blob, mime) => {
        const name = `${this.deps.name()}-en-vivo.${mime.includes('mp4') ? 'mp4' : 'webm'}`;
        await saveFile(name, new Uint8Array(await blob.arrayBuffer()));
        toast(`Vídeo guardado: ${name} (${dims.w} × ${dims.h})`, 'ok');
      }, cv, live.audio.recordable());
    } catch (e) { toast(`No se pudo grabar: ${e instanceof Error ? e.message : String(e)}`, 'error'); return; }
    this.view.setRecordHeight(dims.h);
    live.onFrame = () => rec.frame(cv);
    this.video = rec;
    toast(`Grabando vídeo a ${dims.w} × ${dims.h}, ${fps} fps (F9 para parar)`);
  }
  private stopVideo() {
    const v = this.video;
    if (!v) return;
    this.video = null;
    if (this.live) this.live.onFrame = () => {};
    v.stop();
    this.view.setRecordHeight(0);
  }
  /** Dibujo de YOSADRAW o imagen como cartel 3D (recibe luces, sombras y efectos). */
  private async addCard(src: 'drawing' | 'image' | 'layers' | 'tuber' | 'stage') {
    const s = this.s;
    const aspectOf = (url: string) => new Promise<number>(res => { const im = new Image(); im.onload = () => res(im.naturalWidth / Math.max(1, im.naturalHeight)); im.onerror = () => res(1); im.src = url; });
    if (src === 'stage') { s.tuberStage(); this.view.sync(); this.view.lookThrough(); toast('Escenario PNGTuber listo: añade tu personaje y pulsa En vivo', 'ok'); return; }
    if (src === 'image' || src === 'tuber') {
      const [f] = await pickFiles('image/png,image/jpeg,image/webp,image/gif', false);
      if (!f) return;
      const url = await fileToDataUrl(f);
      const o = s.addCard(url, f.name.replace(/\.[^.]+$/, '') || 'Imagen', await aspectOf(url));
      if (src === 'tuber') { s.setCard(o.id, c => { c.tuber = defaultTuber(); }, 'Personaje PNGTuber'); toast('Personaje PNGTuber: en Objeto → «PNGTuber» pon su boca abierta y ojos cerrados', 'ok'); }
      this.view.frameSelected();
      return;
    }
    const list = this.deps.projects.list().filter(e => !e.trashed && !e.motion && !e.s3d).slice(0, 30);
    if (!list.length) { toast('No tienes dibujos en la galería.'); return; }
    if (src === 'layers') {
      menu(innerWidth / 2, innerHeight / 3, 'Personaje por capas', list.map(e => ({ label: e.name, run: async () => {
        try {
          toast('Separando las capas del dibujo…');
          const r = await drawingLayersToUrls(this.deps, e.id);
          if (!r.layers.length) { toast('El dibujo no tiene capas con contenido.', 'error'); return; }
          s.addLayeredCharacter(e.name, r.layers, r.aspect, { id: e.id, rev: e.rev });
          this.closeSheet(); this.view.frameSelected();
          toast(`«${e.name}»: ${r.layers.length} partes (la de abajo es el cuerpo; las demás se balancean)`, 'ok');
        } catch (err) { toast(err instanceof Error ? err.message : String(err), 'error'); }
      } })));
      return;
    }
    menu(innerWidth / 2, innerHeight / 3, 'Dibujo en 3D', list.map(e => ({ label: e.name, run: async () => {
      try { toast('Preparando el dibujo…'); const url = await drawingToUrl(this.deps, e.id); s.addCard(url, e.name, await aspectOf(url), { id: e.id, rev: e.rev }); this.closeSheet(); this.view.frameSelected(); toast(`«${e.name}» está en la escena: recibe luces, sombras y efectos`, 'ok'); }
      catch (err) { toast(err instanceof Error ? err.message : String(err), 'error'); }
    } })));
  }

  // ---------------------------------------------------------------- render

  renderDialog() {
    const s = this.s, r = s.s.render;
    const prev = h('div', { class: 's3-renderprev' }, h('p', { class: 'ctl-help' }, `Cámara: ${s.scene.camera ? s.obj(s.scene.camera)?.name : 'la vista (la escena no tiene cámara)'} · ${r.w} × ${r.h} px. Cambia el tamaño, la calidad y las sombras en «Escena y render».`));
    const status = h('p', { class: 'ax-note' });
    let last: HTMLCanvasElement | null = null;
    const anim = sceneAnimated(s);
    const fmt = h('select', { class: 'mo-sel', 'aria-label': 'Formato de la animación' }, h('option', { value: 'mp4' }, 'MP4 (vídeo)'), h('option', { value: 'gif' }, 'GIF animado'));
    void modal<string>({
      title: 'Render', wide: true, className: 's3-renderdlg',
      body: [prev, status,
        h('div', { class: 'mo-btnrow' },
          h('button', { type: 'button', class: 'btn primary', on: { click: () => { status.textContent = 'Renderizando…'; requestAnimationFrame(() => { try { const t0 = performance.now(); last = this.view.renderImage(r.w, r.h, { quality: r.quality, shadows: r.shadows, transparent: r.transparent || s.scene.env.transparent }); this.renders++; s.emitView(); prev.replaceChildren(last); last.className = 's3-renderimg'; status.textContent = `Imagen de ${r.w} × ${r.h} en ${Math.round(performance.now() - t0)} ms.`; } catch (e) { status.textContent = `No se pudo renderizar: ${e instanceof Error ? e.message : String(e)}`; } }); } } }, 'Renderizar imagen'),
          h('button', { type: 'button', class: 'btn', on: { click: async () => { if (!last) { toast('Renderiza antes la imagen.'); return; } const n = `${this.deps.name()}-render.png`; await saveFile(n, await canvasPng(last)); toast(`Guardado: ${n}`, 'ok'); } } }, 'Guardar PNG'),
          h('button', { type: 'button', class: 'btn', title: 'Proyecto de dibujo nuevo con el render como capa', on: { click: async () => { if (!last) { toast('Renderiza antes la imagen.'); return; } await this.deps.sendTo2D(last, `${this.deps.name()} (render)`, false); } } }, 'Enviar al lienzo 2D'),
          h('button', { type: 'button', class: 'btn', title: 'Proyecto de dibujo nuevo con el render como capa de referencia (bloqueada y semitransparente) y una capa encima para dibujar', on: { click: async () => { if (!last) { toast('Renderiza antes la imagen.'); return; } await this.deps.sendTo2D(last, `${this.deps.name()} (referencia 3D)`, true); } } }, 'Dibujar encima (referencia)')),
        h('h3', { class: 's3-h3' }, 'Animación'),
        h('p', { class: 'ctl-help' }, anim ? `${Math.round(s.scene.dur * s.fps)} fotogramas a ${s.fps} fps (${s.scene.dur} s) con la cámara activa.` : 'La escena no tiene keyframes: anima algo (tecla I) para exportar un vídeo.'),
        h('div', { class: 'mo-btnrow' }, fmt, h('button', { type: 'button', class: 'btn', disabled: !anim, on: { click: (e: Event) => void this.renderAnim(fmt.value as 'mp4' | 'gif', status, e.currentTarget as HTMLButtonElement) } }, 'Renderizar animación'))],
      actions: [{ label: 'Cerrar', value: 'ok', kind: 'ghost' }],
    });
  }
  private async renderAnim(format: 'mp4' | 'gif', status: HTMLElement, btn: HTMLButtonElement) {
    const s = this.s, r = s.s.render;
    let cancel = false;
    btn.disabled = true;
    const stop = h('button', { type: 'button', class: 'btn sm', on: { click: () => { cancel = true; } } }, 'Cancelar');
    status.replaceChildren('Preparando…', stop);
    try {
      const k = format === 'gif' ? Math.min(1, 640 / Math.max(r.w, r.h)) : 1;
      const data = await renderVideo(s, this.view, { format, w: Math.round(r.w * k), h: Math.round(r.h * k), quality: format === 'gif' ? 1 : r.quality, shadows: r.shadows, transparent: r.transparent, progress: (i, n) => { status.firstChild!.textContent = `Fotograma ${i} / ${n} `; }, cancelled: () => cancel });
      if (!data) { status.textContent = 'Cancelado.'; return; }
      const n = `${this.deps.name()}.${format}`;
      await saveFile(n, data);
      this.renders++;
      status.textContent = `Guardado: ${n} (${(data.length / 1e6).toFixed(1)} MB)`;
    } catch (e) { status.textContent = `No se pudo: ${e instanceof Error ? e.message : String(e)}`; }
    finally { btn.disabled = false; }
  }

  private shortcuts() {
    const rows: [string, string][] = [
      ['Q · G · R · S', 'Seleccionar · Mover · Rotar · Escalar'], ['C · B · P', 'Crear forma · Bloques · Pintar'], ['X · Y · Z', 'Limitar al eje (otra vez: libre)'], ['Mayús + S', 'Ajuste magnético a la cuadrícula'],
      ['Tab', 'Modo edición / objeto'], ['1 · 2 · 3', 'Vértices · Aristas · Caras (modo edición); vistas en modo objeto: 1 frente, 3 lado, 7 arriba, 5 orto, 0 cámara'],
      ['E · I · Ctrl+B · M', 'Extruir · Inset · Biselar · Fusionar (modo edición)'], ['A', 'Elegir todo'], ['Supr', 'Eliminar'], ['Mayús + D · Ctrl + D', 'Duplicar'], ['Ctrl + C / V', 'Copiar / pegar objetos'],
      ['Ctrl + G · Ctrl + Mayús + G', 'Agrupar · Desagrupar'], ['H · Alt + H', 'Ocultar · Mostrar todo'], ['F · Inicio', 'Encuadrar lo elegido · Ver todo'], ['N', 'Navegar con el botón izquierdo'],
      ['Rueda · botón central · Mayús + central · Alt + clic', 'Zoom · Girar · Desplazar · Girar'], ['I · Alt + I · J · K', 'Keyframe · Quitar keyframes · Keyframe anterior / siguiente'], ['Espacio · ← →', 'Reproducir · Fotograma'],
      ['Ctrl + Z · Ctrl + Mayús + Z', 'Deshacer · Rehacer'], ['Ctrl + S · F12', 'Guardar · Render'],
    ];
    void modal({ title: 'Atajos de YOSADRAW 3D Studio', wide: true, body: [h('div', { class: 'mo-keys' }, ...rows.map(([k, l]) => h('div', { class: 'mo-keyrow' }, h('span', null, l), h('kbd', null, k))))], actions: [{ label: 'Cerrar', value: 'ok', kind: 'primary' }] });
  }

  // ---------------------------------------------------------------- teclado

  handleKey(e: KeyboardEvent): boolean {
    const s = this.s, v = this.view;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key, ctrl = e.ctrlKey || e.metaKey, edit = s.mode === 'edit';
    if (ctrl) {
      if (k === 'z' && e.shiftKey) { s.redo(); return true; }
      if (k === 'z') { s.undo(); return true; }
      if (k === 'y') { s.redo(); return true; }
      if (k === 's') { this.deps.save(); return true; }
      if (k === 'c') { s.copyObjects(); return true; }
      if (k === 'v') { s.pasteObjects(); return true; }
      if (k === 'd') { s.duplicate(); return true; }
      if (k === 'g' && e.shiftKey) { s.ungroup(); return true; }
      if (k === 'g') { s.group(); return true; }
      if (k === 'b' && edit) { s.bevel(0.1); return true; }
      if (k === 'a') { s.selectAll(); return true; }
      return false;
    }
    if (e.altKey) {
      if (k === 'i') { s.removeKeysNow(); return true; }
      if (k === 'h') { s.edit('Mostrar todo', (_st, sc) => { for (const o of sc.objects) o.visible = true; }); return true; }
      return false;
    }
    const views: Record<string, ViewName> = { 1: 'front', 3: 'right', 7: 'top', 0: 'camera' };
    switch (k) {
      case 'F5': void this.play(); return true;
      case 'Tab': s.toggleEdit(); return true;
      case ' ': s.toggle(); return true;
      case 'ArrowLeft': s.step(-1); return true;
      case 'ArrowRight': s.step(1); return true;
      case 'Delete': case 'Backspace': s.remove(); return true;
      case 'Escape': if (s.tool === 'create' || s.tool === 'block' || s.tool === 'paint') s.setTool('move'); else if (edit) s.exitEdit(); else s.select([]); return true;
      case 'F12': this.renderDialog(); return true;
      case 'Home': v.frameAll(); return true;
      case 'f': v.frameSelected(); return true;
      case 'q': s.setTool('select'); return true;
      case 'g': s.setTool('move'); return true;
      case 'r': s.setTool('rotate'); return true;
      case 's': if (e.shiftKey) { s.snap = !s.snap; s.setTool(s.tool); toast(s.snap ? 'Ajuste a la cuadrícula activado' : 'Ajuste desactivado'); } else s.setTool('scale'); return true;
      case 'c': s.setTool('create'); return true;
      case 'b': s.setTool('block'); return true;
      case 'p': s.setTool('paint'); return true;
      case 'n': v.navigate = !v.navigate; toast(v.navigate ? 'Navegar: el botón izquierdo gira la vista (Mayús = desplazar)' : 'Navegar desactivado'); return true;
      case 'x': case 'y': case 'z': s.setAxis(k); return true;
      case 'a': s.selectAll(); return true;
      case 'd': if (e.shiftKey) { s.duplicate(); return true; } return false;
      case 'h': for (const o of s.selected) s.toggleVis(o.id); return true;
      case 'j': s.jumpKey(-1); return true;
      case 'k': s.jumpKey(1); return true;
      case 'e': if (edit) { s.extrude(0.5); return true; } return false;
      case 'm': if (edit) { s.mergeSel(); return true; } return false;
      case 'i': if (edit) s.inset(0.25); else s.keyTransform(); return true;
      case '5': v.setOrtho(!v.isOrtho); return true;
      default: break;
    }
    if (edit && (k === '1' || k === '2' || k === '3')) { s.setSelMode(k === '1' ? 'vert' : k === '2' ? 'edge' : 'face'); return true; }
    if (views[k]) { v.setView(views[k]); return true; }
    return false;
  }
}
export type { PrimType };
