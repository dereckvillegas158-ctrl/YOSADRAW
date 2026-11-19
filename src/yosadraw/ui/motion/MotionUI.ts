import { MEDIA_ACCEPT } from '../../motion/media';
import type { ShapeType } from '../../motion/model';
import { h, pickFiles, toast } from '../dom';
import { isPhone, openSheet, watchDevice } from '../Mobile';
import { MCurves } from './MCurves';
import { MI } from './icons';
import { MInspector } from './MInspector';
import { MHistory, MLibrary } from './MLibrary';
import type { MotionStudio, MotionTool } from './MotionStudio';
import { clipMenu, MTimeline } from './MTimeline';
import { MViewer } from './MViewer';
import { comboOf, openMotionShortcuts } from './shortcuts';
import { menu } from './util';

export interface MotionUIDeps {
  save(): void;
  gallery(): void;
  projectMenu(anchor: HTMLElement): void;
  exportVideo(): void;
  name(): string;
}

/**
 * Espacio de trabajo de YOSADRAW MOTION. En PC: barra superior, herramientas a la
 * izquierda, biblioteca/historial, visor central, propiedades a la derecha y línea
 * de tiempo abajo (todos los paneles se redimensionan arrastrando sus bordes). En
 * teléfono y Android: visor arriba, línea de tiempo compacta y una barra de acciones
 * que abre la biblioteca, el texto, las formas, los efectos y las propiedades en hojas.
 */
export class MotionUI {
  readonly el: HTMLElement;
  readonly viewer: MViewer;
  readonly timeline: MTimeline;
  readonly curves: MCurves;
  readonly inspector: MInspector;
  readonly library: MLibrary;
  readonly history: MHistory;
  private nameEl: HTMLElement;
  private dirtyEl: HTMLElement;
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;
  private leftTabs: HTMLElement;
  private leftBody: HTMLElement;
  private rails = new Map<MotionTool, HTMLButtonElement>();
  private banner: HTMLElement;
  private simple = false;

  constructor(private s: MotionStudio, private deps: MotionUIDeps) {
    this.viewer = new MViewer(s);
    this.timeline = new MTimeline(s);
    this.curves = new MCurves(s);
    this.inspector = new MInspector(s);
    this.library = new MLibrary(s);
    this.history = new MHistory(s);
    this.timeline.onCurves = () => this.showCurves(true);
    this.curves.onBack = () => this.showCurves(false);

    const ib = (icon: string, title: string, run: (e: MouseEvent) => void, cls = 'icon') => h('button', { type: 'button', class: cls, title, 'aria-label': title, html: icon, on: { click: run as EventListener } });
    this.nameEl = h('span', { class: 'mo-name' });
    this.dirtyEl = h('span', { class: 'dirty-dot', hidden: true, title: 'Cambios sin guardar' });
    this.undoBtn = ib(MI.undo, `Deshacer${s.keys.hint('undo')}`, () => s.undo());
    this.redoBtn = ib(MI.redo, `Rehacer${s.keys.hint('redo')}`, () => s.redo());
    const chip = h('button', { type: 'button', class: 'mo-chipbtn', title: 'Proyecto', on: { click: (e: Event) => deps.projectMenu(e.currentTarget as HTMLElement) } }, h('span', { class: 'mo-brand' }, 'MOTION'), this.nameEl, this.dirtyEl);
    const top = h('header', { class: 'mo-top' },
      ib(MI.grid, 'Galería', () => deps.gallery()), chip, ib(MI.save, `Guardar${s.keys.hint('save')}`, () => deps.save()),
      h('span', { class: 'mo-sep' }), this.undoBtn, this.redoBtn,
      h('div', { class: 'mo-spacer' }),
      ib(MI.keyboard, 'Atajos de teclado', () => openMotionShortcuts(s.keys, () => s.deps.persist()), 'icon mo-pconly'),
      h('button', { type: 'button', class: 'btn primary mo-export', html: `${MI.export} <span>Exportar</span>`, title: `Exportar vídeo${s.keys.hint('export')}`, on: { click: () => deps.exportVideo() } }));

    // Herramientas (PC).
    const tool = (id: MotionTool, icon: string, title: string) => { const b = ib(icon, title, () => s.setTool(id), 'icon mo-tool'); this.rails.set(id, b); return b; };
    const shapeBtn = tool('shape', MI.shape, `Formas: arrastra en el visor${s.keys.hint('tool-shape')} (clic derecho: elegir forma)`);
    shapeBtn.addEventListener('contextmenu', e => { e.preventDefault(); this.shapeMenu(e.clientX, e.clientY); });
    const rail = h('nav', { class: 'mo-rail', 'aria-label': 'Herramientas' },
      tool('select', MI.select, `Seleccionar y transformar${s.keys.hint('tool-select')}`),
      tool('razor', MI.razor, `Cortar clips${s.keys.hint('tool-razor')}`),
      tool('text', MI.text, `Texto: clic en el visor${s.keys.hint('tool-text')}`),
      shapeBtn,
      tool('mask', MI.mask, `Máscara: arrastra sobre el clip elegido${s.keys.hint('tool-mask')}`),
      h('span', { class: 'mo-railsep' }),
      ib(MI.solid, 'Sólido de color', () => s.addSolid(), 'icon mo-tool'),
      ib(MI.comp, 'Nueva composición anidada', () => s.addComposition(), 'icon mo-tool'),
      ib(MI.import, `Importar medios${s.keys.hint('import')}`, () => void this.importPick(), 'icon mo-tool'));

    // Panel izquierdo: medios / historial.
    this.leftBody = h('div', { class: 'mo-leftbody' });
    this.leftTabs = h('div', { class: 'mo-tabs', role: 'tablist' });
    const left = h('aside', { class: 'mo-left', 'aria-label': 'Biblioteca' }, this.leftTabs, this.leftBody);
    const right = h('aside', { class: 'mo-right', 'aria-label': 'Propiedades' }, this.inspector.el);
    this.banner = h('div', { class: 'mo-banner', hidden: true });
    const center = h('div', { class: 'mo-center' }, this.banner, this.viewer.el);
    const split = (side: 'l' | 'r' | 'b') => {
      const el = h('div', { class: `mo-split mo-split-${side}`, 'aria-hidden': 'true' });
      el.addEventListener('pointerdown', e => {
        el.setPointerCapture(e.pointerId);
        const x0 = e.clientX, y0 = e.clientY, p = s.prefs, v0 = side === 'l' ? p.leftW : side === 'r' ? p.rightW : p.tlH;
        const mv = (ev: PointerEvent) => {
          if (side === 'l') p.leftW = Math.max(180, Math.min(520, v0 + ev.clientX - x0));
          else if (side === 'r') p.rightW = Math.max(240, Math.min(560, v0 - (ev.clientX - x0)));
          else p.tlH = Math.max(150, Math.min(innerHeight - 260, v0 - (ev.clientY - y0)));
          this.applySizes();
        };
        const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); s.deps.persist(); };
        el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
      });
      return el;
    };
    const main = h('div', { class: 'mo-main' }, rail, left, split('l'), center, split('r'), right);
    const bottom = h('div', { class: 'mo-bottom' }, this.timeline.el, this.curves.el);
    // Teléfono: barra de acciones.
    const act = (icon: string, label: string, run: () => void) => h('button', { type: 'button', class: 'mo-act', on: { click: run } }, h('span', { html: icon }), h('span', null, label));
    const phoneBar = h('nav', { class: 'mo-phonebar', 'aria-label': 'Acciones' },
      act(MI.import, 'Medios', () => this.sheet('Medios', this.library.el)),
      act(MI.text, 'Texto', () => s.addText()),
      act(MI.shape, 'Formas', () => this.shapeMenu(0, 0)),
      act(MI.edit, 'Editar', () => { if (!s.sel.size) { toast('Toca un clip en la línea de tiempo.'); return; } this.inspector.setTab('clip'); this.sheet('Propiedades', this.inspector.el); }),
      act(MI.fx, 'Efectos', () => { if (!s.one) { toast('Toca un clip en la línea de tiempo.'); return; } this.inspector.setTab('fx'); this.sheet('Efectos', this.inspector.el); }),
      act(MI.key, 'Animar', () => { if (!s.one) { toast('Toca un clip en la línea de tiempo.'); return; } this.inspector.setTab('anim'); this.sheet('Animar', this.inspector.el); }),
      act(MI.split, 'Dividir', () => s.split()),
      act(MI.trash, 'Borrar', () => s.remove()),
      act(MI.more, 'Más', () => this.phoneMore()));
    this.el = h('div', { class: 'mo-root', role: 'application', 'aria-label': 'YOSADRAW MOTION', hidden: true },
      top, main, split('b'), bottom, phoneBar);
    this.el.addEventListener('mo-edit-text', e => { this.inspector.setTab('clip'); s.select([(e as CustomEvent<string>).detail]); if (this.simple) this.sheet('Texto', this.inspector.el); setTimeout(() => this.inspector.el.dispatchEvent(new Event('mo-focus-text'))); });
    this.el.addEventListener('mo-curves', () => { if (!this.simple) this.showCurves(true); });
    this.renderLeft();

    s.on('tool', t => { for (const [id, b] of this.rails) { b.classList.toggle('on', id === t); b.setAttribute('aria-pressed', String(id === t)); } });
    s.on('change', () => { this.syncTop(); this.showBanner(); });
    s.on('media', () => this.showBanner());
    s.on('open', on => { this.el.hidden = !on; if (on) { this.layout(); this.syncTop(); this.showBanner(); s.setTool('select'); } });
    watchDevice(() => this.layout());
  }

  // ---------------------------------------------------------------- disposición

  private layout() {
    const simple = isPhone() || document.documentElement.classList.contains('android');
    this.simple = simple;
    this.el.classList.toggle('mo-simple', simple);
    // En el modo simple el panel de medios y el inspector viven en hojas.
    if (!simple) {
      if (!this.leftBody.contains(this.library.el) && !this.leftBody.contains(this.history.el)) this.renderLeft();
      const right = this.el.querySelector('.mo-right')!;
      if (!right.contains(this.inspector.el)) right.append(this.inspector.el);
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
    const s = this.s;
    const tab = s.prefs.leftTab === 'history' ? 'history' : 'media';
    this.leftTabs.replaceChildren(...([['media', 'Medios'], ['history', 'Historial']] as const).map(([id, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === id), on: { click: () => { s.prefs.leftTab = id; s.deps.persist(); this.renderLeft(); } } }, l)));
    this.leftBody.replaceChildren(tab === 'media' ? this.library.el : this.history.el);
    if (tab === 'media') this.library.render(); else this.history.render();
  }

  private showCurves(on: boolean) {
    this.timeline.el.hidden = on;
    this.curves.show(on);
    if (!on) this.timeline.draw();
  }

  private sheet(title: string, el: HTMLElement) {
    if (el === this.library.el) this.library.render(); else this.inspector.render();
    openSheet(title, () => [h('div', { class: 'mo-sheetbody' }, el)]);
  }

  private shapeMenu(x: number, y: number) {
    const s = this.s;
    const pick = (shape: ShapeType) => () => { s.shape = shape; if (this.simple) s.addShape(shape); else s.setTool('shape'); };
    menu(x || innerWidth / 2, y || innerHeight / 2, 'Formas', [
      { label: 'Rectángulo', run: pick('rect') }, { label: 'Elipse', run: pick('ellipse') }, { label: 'Polígono', run: pick('polygon') },
      { label: 'Estrella', run: pick('star') }, { label: 'Línea', run: pick('line') }, { label: 'Flecha', run: pick('arrow') },
      { label: 'Sólido de color (pantalla completa)', run: () => s.addSolid() },
    ]);
  }

  private phoneMore() {
    const s = this.s;
    menu(0, 0, 'Más', [
      s.sel.size ? { label: 'Acciones del clip…', run: () => clipMenu(s, innerWidth / 2, innerHeight / 2) } : null,
      { label: 'Composición y cámara…', run: () => { s.select([]); this.sheet('Composición', this.inspector.el); } },
      { label: 'Historial…', run: () => { this.history.render(); openSheet('Historial', () => [h('div', { class: 'mo-sheetbody' }, this.history.el)]); } },
      { label: 'Añadir marcador', run: () => s.addMarker() },
      { label: 'Añadir pista de vídeo', run: () => s.addTrack('visual') },
      { label: 'Añadir pista de audio', run: () => s.addTrack('audio') },
      { label: s.m.snap ? 'Desactivar ajuste magnético' : 'Activar ajuste magnético', run: () => this.timeline.toggle('snap') },
      { label: 'Ver toda la línea de tiempo', run: () => this.timeline.zoomFit() },
    ]);
  }

  private async importPick() {
    const f = await pickFiles(MEDIA_ACCEPT, true);
    if (f.length) await this.s.importFiles(f);
  }

  private syncTop() {
    const s = this.s;
    const hs = s.hist;
    this.nameEl.textContent = this.deps.name();
    this.undoBtn.disabled = !hs?.undoStack.length;
    this.redoBtn.disabled = !hs?.redoStack.length;
    const u = hs?.undoStack[hs.undoStack.length - 1], r = hs?.redoStack[hs.redoStack.length - 1];
    this.undoBtn.title = u ? `Deshacer: ${u.label}${s.keys.hint('undo')}` : 'Deshacer';
    this.redoBtn.title = r ? `Rehacer: ${r.label}${s.keys.hint('redo')}` : 'Rehacer';
  }
  /** Estado de guardado (lo llama la app). */
  setDirty(dirty: boolean, name: string) { this.dirtyEl.hidden = !dirty; this.nameEl.textContent = name; }

  private showBanner() {
    const s = this.s;
    if (!s.active) return;
    const n = s.m.media.filter(m => s.media.missing.has(m.id)).length;
    this.banner.hidden = !n;
    if (n) this.banner.replaceChildren(h('span', null, `Faltan ${n} ${n === 1 ? 'archivo de medios' : 'archivos de medios'} (se ven en rojo). `), h('button', { type: 'button', class: 'btn xs', on: { click: () => { s.prefs.leftTab = 'media'; this.renderLeft(); if (this.simple) this.sheet('Medios', this.library.el); } } }, 'Volver a vincular…'));
  }

  // ---------------------------------------------------------------- teclado

  /** Atajos del editor de vídeo. Devuelve true si la tecla se usó. */
  handleKey(e: KeyboardEvent): boolean {
    const s = this.s;
    const a = s.keys.action(comboOf(e));
    if (!a) return false;
    const run: Record<string, () => void> = {
      play: () => s.player.toggle(), 'prev-frame': () => s.step(-1), 'next-frame': () => s.step(1),
      'prev-sec': () => s.step(-s.fps), 'next-sec': () => s.step(s.fps), 'prev-edit': () => s.jumpEdit(-1), 'next-edit': () => s.jumpEdit(1),
      home: () => s.seek(0), end: () => s.seek(s.comp.dur),
      loop: () => { s.prefs.loop = !s.prefs.loop; s.player.opts.loop = s.prefs.loop; this.viewer.sync(); toast(s.prefs.loop ? 'Repetir activado' : 'Repetir desactivado'); },
      'range-in': () => s.setRange('in'), 'range-out': () => s.setRange('out'), 'range-clear': () => s.setRange('clear'),
      'tool-select': () => s.setTool('select'), 'tool-razor': () => s.setTool('razor'), 'tool-text': () => s.setTool('text'), 'tool-shape': () => s.setTool('shape'), 'tool-mask': () => s.setTool('mask'),
      split: () => s.split(), delete: () => s.remove(), 'ripple-delete': () => s.remove(true), duplicate: () => s.duplicate(),
      copy: () => s.copy(), cut: () => s.copy(true), paste: () => s.paste(), 'copy-attrs': () => s.copyAttributes(), 'paste-attrs': () => s.pasteAttributes(),
      'select-all': () => s.select(s.comp.clips.map(c => c.id)), deselect: () => { s.select([]); s.setTool('select'); },
      group: () => s.group(), precompose: () => s.precompose(), 'nudge-l': () => s.nudge(-1), 'nudge-r': () => s.nudge(1),
      'trim-start': () => s.trimTo('l'), 'trim-end': () => s.trimTo('r'),
      keyframe: () => s.keyTransform(), 'prev-key': () => s.jumpKey(-1), 'next-key': () => s.jumpKey(1),
      marker: () => s.addMarker(), snap: () => this.timeline.toggle('snap'), ripple: () => this.timeline.toggle('ripple'),
      'zoom-in': () => this.timeline.setZoom(this.timeline.pps * 1.5), 'zoom-out': () => this.timeline.setZoom(this.timeline.pps / 1.5), 'zoom-fit': () => this.timeline.zoomFit(),
      curves: () => this.showCurves(this.curves.el.hidden),
      undo: () => s.undo(), redo: () => s.redo(), redo2: () => s.redo(), save: () => this.deps.save(), import: () => void this.importPick(), export: () => this.deps.exportVideo(),
    };
    const fn = run[a];
    if (!fn) return false;
    fn();
    return true;
  }
}
