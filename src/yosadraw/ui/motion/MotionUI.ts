import { MEDIA_ACCEPT } from '../../motion/media';
import type { ShapeType } from '../../motion/model';
import { h, pickFiles, toast } from '../dom';
import { isPhone, openSheet, watchDevice } from '../Mobile';
import { MCurves } from './MCurves';
import { MI } from './icons';
import { MInspector } from './MInspector';
import { MHistory, MLibrary } from './MLibrary';
import { MBrowser } from './MBrowser';
import type { MotionStudio, MotionTool } from './MotionStudio';
import { clipMenu, keyEditItems, keySelectItems, MTimeline } from './MTimeline';
import { MViewer } from './MViewer';
import { comboOf, keyLabel, MOTION_ACTIONS, openMotionShortcuts } from './shortcuts';
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
  readonly browser: MBrowser;
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
    this.browser = new MBrowser(s);
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
      h('button', { type: 'button', class: 'btn sm ghost mo-pconly mo-palbtn', title: `Buscar herramientas y acciones${s.keys.hint('palette')}`, html: `${MI.search} <span>Buscar acción…</span>`, on: { click: () => this.palette() } }),
      ib(MI.folder, `Mostrar / ocultar la biblioteca${s.keys.hint('toggle-left')}`, () => this.togglePanel('left'), 'icon mo-pconly'),
      ib(MI.edit, `Mostrar / ocultar las propiedades${s.keys.hint('toggle-right')}`, () => this.togglePanel('right'), 'icon mo-pconly'),
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
      act(MI.fx, 'Efectos', () => this.browse('filters')),
      act(MI.key, 'Animar', () => { if (!s.one) { toast('Toca un clip en la línea de tiempo.'); return; } this.inspector.setTab('anim'); this.sheet('Animar', this.inspector.el); }),
      act(MI.keyCopy, 'Keyframes', () => this.keyframesMenu()),
      act(MI.split, 'Dividir', () => s.split()),
      act(MI.trash, 'Borrar', () => s.remove()),
      act(MI.more, 'Más', () => this.phoneMore()));
    this.el = h('div', { class: 'mo-root', role: 'application', 'aria-label': 'YOSADRAW MOTION', hidden: true },
      top, main, split('b'), bottom, phoneBar);
    this.el.addEventListener('mo-edit-text', e => { this.inspector.setTab('clip'); s.select([(e as CustomEvent<string>).detail]); if (this.simple) this.sheet('Texto', this.inspector.el); setTimeout(() => this.inspector.el.dispatchEvent(new Event('mo-focus-text'))); });
    this.el.addEventListener('mo-browse', e => this.browse((e as CustomEvent<'filters' | 'anims'>).detail));
    this.el.addEventListener('mo-curves', () => { if (!this.simple) this.showCurves(true); });
    this.renderLeft();

    s.on('tool', t => { for (const [id, b] of this.rails) { b.classList.toggle('on', id === t); b.setAttribute('aria-pressed', String(id === t)); } });
    s.on('change', () => { this.syncTop(); this.showBanner(); });
    s.on('select', () => { this.el.classList.toggle('mo-autokey', s.autoKey); });
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

  /** Muestra u oculta el panel izquierdo (biblioteca) o derecho (propiedades). */
  togglePanel(side: 'left' | 'right') {
    const p = this.s.prefs;
    if (side === 'left') p.showLeft = !p.showLeft; else p.showRight = !p.showRight;
    this.s.deps.persist();
    this.applySizes();
  }

  private applySizes() {
    const p = this.s.prefs;
    this.el.classList.toggle('mo-noleft', !p.showLeft && !this.simple);
    this.el.classList.toggle('mo-noright', !p.showRight && !this.simple);
    this.el.classList.toggle('mo-autokey', p.autoKey);
    this.el.style.setProperty('--mo-left', `${p.leftW}px`);
    this.el.style.setProperty('--mo-right', `${p.rightW}px`);
    this.el.style.setProperty('--mo-tl', `${p.tlH}px`);
  }

  private renderLeft() {
    const s = this.s;
    const tab = (['history', 'browser'] as string[]).includes(s.prefs.leftTab) ? s.prefs.leftTab as 'history' | 'browser' : 'media';
    this.leftTabs.replaceChildren(...([['media', 'Medios'], ['browser', 'Efectos'], ['history', 'Historial']] as const).map(([id, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === id), on: { click: () => { s.prefs.leftTab = id; s.deps.persist(); this.renderLeft(); } } }, l)));
    this.leftBody.replaceChildren(tab === 'media' ? this.library.el : tab === 'browser' ? this.browser.el : this.history.el);
    if (tab === 'media') this.library.render(); else if (tab === 'browser') this.browser.show(); else this.history.render();
  }

  /** Abre el explorador de filtros, transiciones, efectos y animaciones. */
  browse(tab: 'filters' | 'transitions' | 'effects' | 'anims' = 'filters') {
    if (this.simple) { this.browser.show(tab); openSheet('Efectos y animaciones', () => [h('div', { class: 'mo-sheetbody' }, this.browser.el)]); return; }
    this.s.prefs.leftTab = 'browser';
    this.renderLeft();
    this.browser.show(tab);
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

  /** Copiar, pegar y editar keyframes sin teclado (teléfono). */
  private keyframesMenu() {
    const s = this.s, n = s.keyCount;
    menu(0, 0, n ? `Keyframes · ${n} ${n === 1 ? 'elegido' : 'elegidos'}` : 'Keyframes', [
      { label: 'Crear keyframe en el cabezal', disabled: !s.sel.size, run: () => s.addKeysNow() },
      { label: 'Quitar los keyframes del cabezal', disabled: !s.sel.size, run: () => s.removeKeysNow() },
      { label: s.autoKey ? '✓ Auto Keyframe (cada cambio crea keyframe)' : 'Auto Keyframe (cada cambio crea keyframe)', run: () => s.setAutoKey(!s.autoKey) },
      { label: s.keySync ? '✓ Sincronizar en los clips elegidos' : 'Sincronizar en los clips elegidos', run: () => s.setKeySync(!s.keySync) },
      ...keySelectItems(s),
      ...keyEditItems(s),
      { label: 'Suavizar automáticamente', run: () => s.smoothSel() },
      { label: 'Keyframe de transformación en el cabezal', disabled: !s.sel.size, run: () => s.keyTransform() },
      { label: 'Ir al keyframe anterior', run: () => s.jumpKey(-1) },
      { label: 'Ir al keyframe siguiente', run: () => s.jumpKey(1) },
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
    // Vista previa de pegado: Intro pega en el cabezal, Esc cancela.
    if (s.pastePreviewOn && (e.key === 'Enter' || e.key === 'Escape')) { if (e.key === 'Enter') s.pasteKeyframes(); else s.cancelPastePreview(); return true; }
    const a = s.keys.action(comboOf(e));
    if (!a) return false;
    return this.run(a);
  }

  /** Ejecuta una acción del editor por su id (atajos, paleta de acciones). */
  run(a: string): boolean {
    const s = this.s;
    const run: Record<string, () => void> = {
      play: () => s.player.toggle(), 'prev-frame': () => s.step(-1), 'next-frame': () => s.step(1),
      'prev-sec': () => s.step(-s.fps), 'next-sec': () => s.step(s.fps), 'prev-edit': () => s.jumpEdit(-1), 'next-edit': () => s.jumpEdit(1),
      home: () => s.seek(0), end: () => s.seek(s.comp.dur),
      loop: () => { s.prefs.loop = !s.prefs.loop; s.player.opts.loop = s.prefs.loop; this.viewer.sync(); toast(s.prefs.loop ? 'Repetir activado' : 'Repetir desactivado'); },
      'range-in': () => s.setRange('in'), 'range-out': () => s.setRange('out'), 'range-clear': () => s.setRange('clear'),
      'tool-select': () => s.setTool('select'), 'tool-razor': () => s.setTool('razor'), 'tool-text': () => s.setTool('text'), 'tool-shape': () => s.setTool('shape'), 'tool-mask': () => s.setTool('mask'),
      split: () => s.split(), delete: () => s.remove(), 'ripple-delete': () => s.remove(true), duplicate: () => s.duplicate(),
      copy: () => s.copy(), cut: () => s.copy(true), paste: () => s.paste(), 'copy-attrs': () => s.copyAttributes(), 'paste-attrs': () => s.pasteAttributes(),
      'select-all': () => (s.hasKeySel || (s.focus && s.sel.size) ? s.selectAllKeys() : s.select(s.comp.clips.map(c => c.id))),
      'key-all': () => s.selectAllKeys(), 'key-playhead': () => s.selectKeysAtPlayhead(), 'key-to-playhead': () => s.keysToPlayhead(),
      'key-dup': () => s.duplicateKeys(), 'key-reverse': () => s.reverseKeys(), 'key-nudge-l10': () => s.nudgeKeys(-10), 'key-nudge-r10': () => s.nudgeKeys(10),
      'key-multi': () => { s.keyMulti = !s.keyMulti; s.keysChanged(); toast(s.keyMulti ? 'Selección múltiple de keyframes activada' : 'Selección múltiple desactivada'); }, deselect: () => { if (s.pastePreviewOn) { s.cancelPastePreview(); return; } if (s.hasKeySel) { s.clearKeys(); return; } s.select([]); s.setTool('select'); },
      group: () => s.group(), precompose: () => s.precompose(), 'nudge-l': () => s.nudge(-1), 'nudge-r': () => s.nudge(1),
      'trim-start': () => s.trimTo('l'), 'trim-end': () => s.trimTo('r'),
      keyframe: () => s.addKeysNow(), 'key-remove': () => s.removeKeysNow(), 'key-transform': () => s.keyTransform(), 'prev-key': () => s.jumpKey(-1), 'next-key': () => s.jumpKey(1),
      'auto-key': () => s.setAutoKey(!s.autoKey), 'key-sync': () => s.setKeySync(!s.keySync),
      'paste-preview': () => s.beginPastePreview(), 'paste-orig': () => s.pasteKeyframes(undefined, 'orig'),
      'ease-inout': () => s.applyEase({ e: 'inout' }, 'Curva Ease In-Out'), 'ease-in': () => s.applyEase({ e: 'in' }, 'Curva Ease In'), 'ease-out': () => s.applyEase({ e: 'out' }, 'Curva Ease Out'),
      'ease-linear': () => s.applyEase({ e: 'linear' }, 'Curva lineal'), 'ease-hold': () => s.applyEase({ e: 'hold' }, 'Curva constante'),
      'key-smooth': () => s.smoothSel(), 'key-invert-ease': () => s.invertCurves(), 'key-copy-ease': () => s.copyEase(), 'key-paste-ease': () => s.pasteEase(),
      'key-repeat': () => s.repeatSel(1, 0), 'key-repeat-back': () => s.repeatSel(1, 0, { dir: -1 }), 'key-loop': () => s.repeatSel('fill', 0), 'key-pingpong': () => s.repeatSel('fill', 0, { pingpong: true }),
      'key-align': () => s.alignKeys(), 'key-freeze': () => s.freezeAnim(),
      'center-playhead': () => this.timeline.centerPlayhead(), 'expand-all': () => this.timeline.expandAll(true), 'collapse-all': () => this.timeline.expandAll(false),
      'find-layer': () => this.timeline.focusSearch(), palette: () => this.palette(), 'toggle-left': () => this.togglePanel('left'), 'toggle-right': () => this.togglePanel('right'),
      'add-adjust': () => s.addAdjustment(), 'toggle-guide': () => s.toggleGuide(),
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

  /** Paleta de acciones: escribe para buscar cualquier herramienta o acción del editor y pulsa Intro. */
  palette() {
    const s = this.s;
    document.querySelector('.mo-palette')?.remove();
    const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const input = h('input', { type: 'search', class: 'mo-palinput', placeholder: 'Buscar acción (p. ej. «keyframe», «bucle», «curva», «capa»)…', 'aria-label': 'Buscar acción' });
    const list = h('div', { class: 'mo-pallist', role: 'listbox' });
    let items: typeof MOTION_ACTIONS = [], cur = 0;
    const close = () => { wrap.remove(); };
    const exec = (id: string) => { close(); this.run(id); };
    const render = () => {
      const q = norm(input.value.trim());
      items = MOTION_ACTIONS.filter(a => !q || q.split(/\s+/).every(w => norm(`${a.label} ${a.group} ${a.id}`).includes(w))).slice(0, 60);
      cur = Math.min(cur, Math.max(0, items.length - 1));
      list.replaceChildren(...items.map((a, i) => {
        const b = h('button', { type: 'button', role: 'option', class: `mo-palitem${i === cur ? ' on' : ''}`, 'aria-selected': String(i === cur), on: { click: () => exec(a.id) } },
          h('span', null, a.label), h('span', { class: 'mo-palgroup' }, a.group), h('kbd', null, keyLabel(s.keys.key(a.id)) || ''));
        return b;
      }));
      if (!items.length) list.append(h('p', { class: 'ctl-help' }, 'Nada coincide.'));
      list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    };
    input.addEventListener('input', () => { cur = 0; render(); });
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); cur = Math.min(items.length - 1, cur + 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); cur = Math.max(0, cur - 1); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (items[cur]) exec(items[cur].id); }
    });
    const wrap = h('div', { class: 'mo-palette', role: 'dialog', 'aria-label': 'Buscar acciones', on: { pointerdown: (e: Event) => { if (e.target === wrap) close(); } } }, h('div', { class: 'mo-palbox' }, input, list));
    this.el.append(wrap);
    render();
    input.focus();
  }
}
