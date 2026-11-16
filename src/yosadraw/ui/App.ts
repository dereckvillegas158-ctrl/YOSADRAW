import type { BrushLibrary } from '../brush/BrushLibrary';
import type { SettingsStorage } from '../brush/storage';
import type { StrokePainter } from '../brush/StrokePainter';
import type { CanvasEngine } from '../engine';
import { ToolManager } from '../tools/ToolManager';
import { BrushStudio } from './BrushStudio';
import { ColorPanel } from './ColorPanel';
import { ExportDialog } from './ExportDialog';
import { EFFECTS_ICON, EffectsPanel } from './EffectsPanel';
import { openCustomize, openShortcuts } from './dialogs';
import { h, toast } from './dom';
import { ICONS } from './icons';
import { LayersPanel } from './LayersPanel';
import { LibraryPanel } from './LibraryPanel';
import type { ProjectLibrary } from '../project/library';
import { DEFAULT_SESSION_PREFS, ProjectSession, type SessionPrefs } from '../project/session';
import { Document } from '../doc/Document';
import { Gallery, GI, normalizeGalleryPrefs } from './Gallery';
import { closeTopOverlay, dragToClose, isPhone, normalizeTouch, openMore, QuickSliders, type TouchPrefs, watchDevice } from './Mobile';
import { PropertiesBar } from './PropertiesBar';
import { PhoneDock } from './PhoneDock';
import { IMAGE_TYPES, importImageLayer, pickAndImport, References } from './Images';
import { AnimStudio } from './anim/AnimStudio';
import { PhoneAnim } from './anim/PhoneAnim';
import { AnimPanel, onionPopover, qualityPopover } from './anim/AnimPanel';
import { Timeline } from './anim/Timeline';
import { AnimExport, normalizeAnimExport, type AnimExportPrefs } from './anim/AnimExport';
import { drawGuide, guideOverlay, openTween, openXSheet } from './anim/dialogs';
import type { PreviewQuality } from '../anim/player';
import * as animModel from '../anim/model';
import { Thumbnails } from './thumbnails';
import { normalizeLayout, Toolbar } from './Toolbar';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export interface AppDeps { engine: CanvasEngine; lib: BrushLibrary; painter: StrokePainter; settings: SettingsStorage; saved: Record<string, unknown> | null; projects: ProjectLibrary }

/**
 * Capa de interfaz de YOSADRAW: conecta barra de herramientas, propiedades,
 * paneles y teclado con el gestor de herramientas y el motor. No dibuja nada
 * por su cuenta.
 */
export function mountApp({ engine, lib, painter, settings, saved, projects }: AppDeps) {
  const thumbs = new Thumbnails(painter);
  const studio = new BrushStudio(lib, painter, thumbs);
  let exportOpts: unknown = saved?.export;
  const exportDialog = new ExportDialog(engine, exportOpts, o => { exportOpts = o; save(); });
  let fxPrefs: unknown = saved?.effects;
  const effects = new EffectsPanel(engine, fxPrefs, p => { fxPrefs = p; save(); });
  const mgr = new ToolManager(engine, lib, {
    openBrushStudio: p => studio.show(p, mgr.colors.primary), notify: (m, k) => toast(m, k), openExport: () => void exportDialog.show(),
    openEffects: () => { if (effects.open) effects.close(); else effects.show(); },
    project: a => void projectAction(a),
    importImage: () => void pickAndImport(engine, mgr),
    addReference: () => void refs.add(),
    anim: id => animAction(id),
  });
  mgr.load((saved?.tools as Record<string, unknown>) ?? null);
  let layout = normalizeLayout(saved?.toolbar);
  let tab = typeof saved?.tab === 'string' ? saved.tab : 'layers';
  let touch: TouchPrefs = normalizeTouch(saved?.touch);
  // Animación (PC): altura de la línea de tiempo, ancho del panel, reproducción y exportación.
  const ap = (saved?.anim ?? {}) as Record<string, unknown>;
  const animPrefs = {
    tlHeight: typeof ap.tlHeight === 'number' ? Math.min(700, Math.max(140, ap.tlHeight)) : 270,
    panelW: typeof ap.panelW === 'number' ? Math.min(620, Math.max(260, ap.panelW)) : 320,
    quality: ([1, 0.5, 0.25].includes(ap.quality as number) ? ap.quality : 1) as PreviewQuality,
    showRef: ap.showRef !== false, scrub: ap.scrub !== false,
    export: normalizeAnimExport(ap.export) as AnimExportPrefs,
  };
  const applyTouch = () => {
    engine.fingerMode = touch.finger; engine.holdToPick = touch.hold;
    Object.assign(engine.inputTuning, { touchBoost: touch.touchBoost, penBoost: touch.penBoost, fingerPressure: touch.fingerPressure, cleanup: touch.cleanup });
  };
  applyTouch();

  // ---------- Guardado de preferencias ----------
  const snapshot = () => ({ version: 1, tools: mgr.toJSON(), toolbar: layout, tab, export: exportOpts, touch, effects: fxPrefs, anim: animPrefs, gallery: gallery.prefs, session: { autoSave: session.prefs.autoSave, autoSaveMinutes: session.prefs.autoSaveMinutes } });
  let saveTimer = 0;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void settings.save(snapshot()), 500);
  };
  mgr.onChange = save;

  // ---------- Barra de herramientas y propiedades ----------
  const toolbar = new Toolbar(mgr, layout, l => { layout = l; save(); });
  $('toolbar-host').append(toolbar.el);
  const props = new PropertiesBar(mgr, lib, thumbs);
  $('props-host').append(props.el);

  // ---------- Panel lateral con pestañas ----------
  const layers = new LayersPanel(engine);
  const color = new ColorPanel(mgr);
  const library = new LibraryPanel(lib, thumbs);
  // YOSADRAW ANIMATE: controlador, pestaña de propiedades y (más abajo) línea de tiempo.
  const anim = new AnimStudio(engine, mgr, painter);
  anim.player.quality = animPrefs.quality;
  anim.player.showReference = animPrefs.showRef;
  anim.scrubAudio = animPrefs.scrub;
  const animPanel = new AnimPanel(anim, { drawGuide: () => drawGuide(anim) });
  const tabs = [
    { id: 'layers', label: 'Capas', el: layers.el },
    { id: 'color', label: 'Color', el: color.el },
    { id: 'brushes', label: 'Pinceles', el: library.el },
    { id: 'anim', label: 'Animación', el: animPanel.el },
  ];
  const tabButtons = tabs.map(t => h('button', { type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-controls': `pane-${t.id}`, on: { click: () => showTab(t.id) } }, t.label));
  const panes = tabs.map(t => h('div', { role: 'tabpanel', id: `pane-${t.id}`, 'aria-labelledby': `tab-${t.id}`, class: 'pane' }, t.el));
  const grip = h('div', { class: 'sheet-grip panel-grip', 'aria-hidden': 'true' });
  // Panel derecho redimensionable (PC): se arrastra su borde.
  const resizer = h('div', { class: 'panel-resizer', title: 'Arrastra para cambiar el ancho', 'aria-hidden': 'true' });
  const applyPanelW = () => document.documentElement.style.setProperty('--panel-w', `${animPrefs.panelW}px`);
  applyPanelW();
  resizer.addEventListener('pointerdown', e => { resizer.setPointerCapture(e.pointerId); resizer.classList.add('active'); });
  resizer.addEventListener('pointermove', e => {
    if (!resizer.hasPointerCapture(e.pointerId)) return;
    const r = $('panel').getBoundingClientRect();
    const right = document.body.classList.contains('toolbar-right');
    animPrefs.panelW = Math.round(Math.min(620, Math.max(260, right ? e.clientX - r.left : r.right - e.clientX)));
    applyPanelW();
  });
  resizer.addEventListener('pointerup', () => { resizer.classList.remove('active'); save(); });
  $('panel').append(resizer, grip, h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Paneles' }, ...tabButtons), ...panes);
  const setPanel = (open: boolean) => {
    document.body.classList.toggle('panel-open', open);
    $('panel-toggle').setAttribute('aria-expanded', String(open));
  };
  // En el teléfono el panel es una hoja: se cierra tocando fuera o deslizando el asa hacia abajo.
  $('panel-scrim').addEventListener('pointerdown', () => setPanel(false));
  dragToClose($('panel'), grip, () => setPanel(false));
  function showTab(id: string) {
    tab = id;
    tabs.forEach((t, i) => { tabButtons[i].setAttribute('aria-selected', String(t.id === id)); panes[i].hidden = t.id !== id; });
    save();
  }
  showTab(tabs.some(t => t.id === tab) ? tab : 'layers');

  // El panel de pinceles elige el pincel de la última herramienta de pincel usada.
  const syncLibraryTarget = () => {
    const t = mgr.current;
    if (t.brushCategories) library.setTarget(t.id, t.label, t.brushCategories);
  };
  mgr.on('tool', syncLibraryTarget);
  library.onEdit = p => studio.show(p, mgr.colors.primary);
  studio.onSaved = (p, isNew) => { if (isNew && mgr.current.brushCategories) lib.setActive(mgr.current.id, p.id); };
  mgr.on('colors', c => library.setColor(c.primary));
  library.setColor(mgr.colors.primary);
  painter.tips.images.onReady(() => { thumbs.invalidate(); library.render(); props.render(); });

  engine.on('picked', hex => { mgr.setColors(hex, mgr.colors.secondary); toast(`Color tomado: ${hex}`, 'ok'); });
  engine.on('notice', m => toast(m));

  // ---------- Barra superior ----------
  const icon = (id: string, key: keyof typeof ICONS) => { $(id).innerHTML = ICONS[key]; };
  icon('undo', 'undo'); icon('redo', 'redo'); icon('zoom-in', 'zoomIn'); icon('zoom-out', 'zoomOut'); icon('fit', 'fit');
  icon('rot-left', 'rotL'); icon('rot-right', 'rotR'); icon('panel-toggle', 'sliders'); icon('keys-btn', 'keyboard'); icon('customize-btn', 'layout');
  icon('more-btn', 'more');
  $('export-btn').insertAdjacentHTML('afterbegin', ICONS.export);
  $('export-btn').addEventListener('click', () => void exportDialog.show());
  $('undo').addEventListener('click', () => engine.undo());
  $('redo').addEventListener('click', () => engine.redo());
  $('zoom-in').addEventListener('click', () => engine.zoomBy(1.5));
  $('zoom-out').addEventListener('click', () => engine.zoomBy(1 / 1.5));
  $('zoom-value').addEventListener('click', () => engine.zoomTo(1));
  $('fit').addEventListener('click', () => engine.fit());
  $('rot-left').addEventListener('click', () => engine.rotateBy(-15));
  $('rot-right').addEventListener('click', () => engine.rotateBy(15));
  $('rot-value').addEventListener('click', () => engine.setRotation(0));
  const customize = () => openCustomize(mgr, layout, l => { layout = l; toolbar.setLayout(l); save(); });
  $('keys-btn').addEventListener('click', () => openShortcuts(mgr, save));
  $('customize-btn').addEventListener('click', customize);
  $('panel-toggle').addEventListener('click', () => setPanel(!document.body.classList.contains('panel-open')));
  // Color actual en la barra superior: abre el panel de color.
  const colorDot = $('color-btn').querySelector<HTMLElement>('.color-dot')!;
  const showColor = () => { colorDot.style.background = mgr.colors.primary; $('color-btn').title = `Color ${mgr.colors.primary}`; };
  mgr.on('colors', showColor);
  showColor();
  $('color-btn').addEventListener('click', () => {
    const open = document.body.classList.contains('panel-open') && tab === 'color';
    if (!open) showTab('color');
    setPanel(!open);
  });

  // ---------- Táctil y teléfono ----------
  const quick = new QuickSliders(mgr, () => touch);
  $('canvas-host').append(quick.el);
  const setTouch = (p: TouchPrefs) => { touch = p; applyTouch(); quick.render(); save(); };
  const more = () => openMore({
    engine, prefs: () => touch, setPrefs: setTouch, openCustomize: customize, openShortcuts: () => openShortcuts(mgr, save), openEffects: () => effects.show(),
    actions: [
      { label: 'Guardar', run: () => void projectAction('save') },
      { label: 'Exportar…', run: () => void exportDialog.show() },
      { label: 'Efectos…', run: () => effects.show() },
      { label: 'Importar imagen…', run: () => void pickAndImport(engine, mgr) },
      { label: 'Imagen de referencia…', run: () => void refs.add() },
      ...(engine.doc.references.length ? [{ label: document.body.classList.contains('refs-hidden') ? 'Mostrar referencias' : 'Ocultar referencias', run: () => refs.toggleAll() }] : []),
    ],
  });
  $('more-btn').addEventListener('click', more);
  // Teléfono: dock simplificado (herramientas · pincel · borrador · ajustes · capas · color · más).
  const dock = new PhoneDock({
    mgr, props, propsHome: $('props-host'), openMore: more,
    openPanel: t => { const open = document.body.classList.contains('panel-open') && tab === t; if (!open) showTab(t); setPanel(!open); },
  });
  $('workspace').append(dock.el);

  // ---------- Imágenes: referencias e importación ----------
  const refs = new References(engine, hex => { mgr.setColors(hex, mgr.colors.secondary); toast(`Color tomado de la referencia: ${hex}`, 'ok'); });
  const isImage = (f: File) => IMAGE_TYPES.split(',').includes(f.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name);
  // Arrastrar imágenes al lienzo: se importan como capa (con Alt, como referencia).
  const host = $('canvas-host');
  host.addEventListener('dragover', e => { if (gallery.visible || ![...(e.dataTransfer?.items ?? [])].some(i => i.kind === 'file')) return; e.preventDefault(); host.classList.add('drop-target'); });
  host.addEventListener('dragleave', () => host.classList.remove('drop-target'));
  host.addEventListener('drop', e => {
    host.classList.remove('drop-target');
    const files = [...(e.dataTransfer?.files ?? [])].filter(isImage);
    if (gallery.visible || !files.length) return;
    e.preventDefault();
    void (async () => { for (const f of files) { try { if (e.altKey) await refs.add(f); else await importImageLayer(engine, mgr, f); } catch (err) { toast(err instanceof Error ? err.message : String(err), 'error'); } } })();
  });
  // Pegar una imagen (Ctrl+V) la importa como capa.
  window.addEventListener('paste', e => {
    const t = e.target as HTMLElement;
    if (gallery.visible || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.closest?.('.dialog-backdrop')) return;
    const f = [...(e.clipboardData?.files ?? [])].find(isImage);
    if (!f) return;
    e.preventDefault();
    importImageLayer(engine, mgr, f).catch(err => toast(err instanceof Error ? err.message : String(err), 'error'));
  });
  // Al pasar a teléfono el panel empieza cerrado (es una hoja sobre el lienzo).
  watchDevice(() => { if (isPhone()) setPanel(false); });
  // Extremo borrador del lápiz: borrador mientras se usa; al levantarlo vuelve la herramienta anterior.
  let beforeEraser: string | null = null;
  engine.on('stylusEraser', on => {
    if (on && mgr.current.id !== 'eraser') { beforeEraser = mgr.current.id; mgr.select('eraser'); }
    else if (!on && beforeEraser) { const id = beforeEraser; beforeEraser = null; setTimeout(() => mgr.select(id), 0); }
  });

  const undoBtn = $<HTMLButtonElement>('undo'), redoBtn = $<HTMLButtonElement>('redo');
  const showHistory = () => {
    const hs = engine.historyState;
    undoBtn.disabled = !hs.canUndo;
    redoBtn.disabled = !hs.canRedo;
    undoBtn.title = hs.undoLabel ? `Deshacer: ${hs.undoLabel} (Ctrl+Z)` : 'Deshacer (Ctrl+Z)';
    redoBtn.title = hs.redoLabel ? `Rehacer: ${hs.redoLabel} (Ctrl+Mayús+Z)` : 'Rehacer (Ctrl+Mayús+Z)';
    $('st-hist').textContent = `${hs.undoDepth} / ${hs.redoDepth}`;
    $('empty-hint').hidden = hs.undoDepth > 0 || engine.doc.layers.some(l => l.items.length);
  };
  engine.on('history', showHistory);
  showHistory();

  let viewReq = 0;
  const showView = () => {
    if (viewReq) return;
    viewReq = requestAnimationFrame(() => {
      viewReq = 0;
      const pct = engine.view.scale * 100;
      $('zoom-value').textContent = `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
      let deg = Math.round((engine.view.rotation * 180) / Math.PI);
      if (deg === -180) deg = 180;
      $('rot-value').textContent = `${deg}°`;
    });
  };
  engine.on('view', showView);
  showView();

  // ---------- Estado ----------
  $('st-doc').textContent = `${engine.docWidth} × ${engine.docHeight} px`;
  engine.on('pointer', p => {
    if (!p) { $('st-pos').textContent = '–'; return; }
    $('st-pos').textContent = p.inside ? `${Math.round(p.x)}, ${Math.round(p.y)}` : 'fuera';
    $('st-pressure').textContent = p.type === 'pen' ? p.pressure.toFixed(2) : p.type === 'mouse' ? 'ratón' : 'táctil';
    $('st-tilt').textContent = p.type === 'pen' ? `${Math.round(p.tilt)}°` : '–';
  });
  engine.on('stats', s => {
    $('st-items').textContent = `${s.layers} capas · ${s.items} elementos`;
    $('st-render').textContent = `${s.renderMs.toFixed(1)} ms${s.progressive ? ' (por lotes)' : ''}`;
  });
  const android = document.documentElement.classList.contains('android');
  const where = lib.storageKind === 'desktop' ? (android ? 'en este dispositivo' : 'en este equipo') : lib.storageKind === 'browser' ? 'en el navegador' : 'solo en esta sesión';
  $('st-save').textContent = `Biblioteca ${where}`;
  lib.on('saved', r => {
    $('st-save').textContent = r.ok ? `Guardado ${where} · ${new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}` : 'Error al guardar';
    if (!r.ok) toast(r.error ?? 'No se pudo guardar la biblioteca', 'error');
  });

  // ---------- Proyectos y galería ----------
  const session = new ProjectSession(engine, projects, undefined, (m, k) => toast(m, k));
  const sp = (saved?.session ?? {}) as Partial<SessionPrefs>;
  session.prefs = { autoSave: sp.autoSave !== false, autoSaveMinutes: typeof sp.autoSaveMinutes === 'number' && sp.autoSaveMinutes >= 1 ? Math.min(30, sp.autoSaveMinutes) : DEFAULT_SESSION_PREFS.autoSaveMinutes };
  const gallery = new Gallery(projects, session, {
    showEditor: () => { gallery.hide(); requestAnimationFrame(() => engine.element.focus?.()); },
    openExport: () => void exportDialog.show(),
    persist: save,
  }, normalizeGalleryPrefs(saved?.gallery));
  document.body.append(gallery.el);
  // Al cambiar de documento, la herramienta en curso aplica lo pendiente sobre el documento que se va.
  session.beforeLoad = () => mgr.resetForDocument();
  engine.on('document', d => {
    $('st-doc').textContent = `${d.width} × ${d.height} px`;
    exportDialog.adoptProject({ name: session.entry?.name ?? 'Dibujo', dpi: d.settings.dpi, profile: d.settings.profile, background: d.settings.background });
  });
  /** Lienzo vacío mientras no hay proyecto abierto (libera la memoria del anterior). */
  const blank = () => engine.loadDocument(new Document(1024, 768));
  async function toGallery() {
    if (!(await gallery.confirmLeave())) return;
    session.close();
    mgr.resetForDocument();
    blank();
    gallery.show();
  }
  async function projectAction(a: 'save' | 'saveAs' | 'new' | 'gallery') {
    if (gallery.visible) { if (a === 'new') void gallery.newProject(); return; }
    if (a === 'save') { mgr.resetForDocument(); await gallery.save(); }
    else if (a === 'saveAs') { mgr.resetForDocument(); await gallery.saveAs(); }
    else if (a === 'new') await gallery.newProject();
    else await toGallery();
  }
  $('gallery-btn').innerHTML = GI.grid;
  $('save-btn').innerHTML = GI.save;
  $('fx-btn').innerHTML = EFFECTS_ICON;
  $('fx-btn').addEventListener('click', () => { if (effects.open) effects.close(); else effects.show(); });
  $('gallery-btn').addEventListener('click', () => void toGallery());
  $('save-btn').addEventListener('click', () => void projectAction('save'));
  let lastName = '';
  const showSession = () => {
    const st = session.state;
    const name = st.entry?.name ?? 'Sin título';
    if (st.entry && name !== lastName) { if (lastName) exportDialog.setName(name); lastName = name; }
    $('project-name').textContent = name;
    $('dirty-dot').hidden = !st.dirty;
    $('project-chip').title = `${name}${st.dirty ? ' · cambios sin guardar' : ' · guardado'}`;
    const sb = $<HTMLButtonElement>('save-btn');
    sb.classList.toggle('saving', st.saving);
    sb.classList.toggle('dirty', st.dirty);
    sb.title = st.saving ? 'Guardando…' : st.dirty ? 'Guardar (Ctrl+S) · hay cambios sin guardar' : 'Guardado (Ctrl+S)';
    document.title = st.entry ? `${st.dirty ? '• ' : ''}${name} — YOSADRAW` : 'YOSADRAW';
    $('st-save').textContent = st.saving ? 'Guardando…' : st.dirty ? (st.recoveredAt ? `Sin guardar · recuperación ${new Date(st.recoveredAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}` : 'Sin guardar') : st.entry ? `Guardado ${new Date(st.lastSaved).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}` : '';
  };
  session.on('state', showSession);
  showSession();
  $('project-chip').addEventListener('click', () => {
    const e = session.entry;
    if (!e) return;
    const anchor = $('project-chip');
    const items: [string, () => void][] = [
      ['Guardar', () => void projectAction('save')], ['Guardar como…', () => void projectAction('saveAs')],
      ['Renombrar…', () => void gallery.renameOpen()], ['Historial de versiones…', () => void gallery.versions(projects.get(e.id)!)],
      ['Información', () => void gallery.info(projects.get(e.id)!)], ['Exportar imagen…', () => void exportDialog.show()],
      ['Importar imagen como capa…', () => void pickAndImport(engine, mgr)], ['Añadir imagen de referencia…', () => void refs.add()],
      ['Exportar archivo .yosa', () => void (session.dirty ? gallery.save() : Promise.resolve(true)).then(ok => { if (ok) void gallery.exportNative(projects.get(e.id)!); })],
      [session.prefs.autoSave ? 'Desactivar guardado automático' : 'Activar guardado automático', () => { session.prefs.autoSave = !session.prefs.autoSave; save(); toast(session.prefs.autoSave ? `Guardado automático cada ${session.prefs.autoSaveMinutes} min` : 'Guardado automático desactivado (se siguen haciendo copias de recuperación)', 'ok'); }],
      ['Volver a la galería', () => void toGallery()],
    ];
    gallery.popupMenu(anchor, e.name, items.map(([label, run]) => ({ label, run })));
  });
  // Al pasar a segundo plano (otra pestaña, minimizar): copia de recuperación inmediata.
  document.addEventListener('visibilitychange', () => { if (document.hidden) void session.flushRecovery(); });
  // ---------- Animación (PC) ----------
  const animExport = new AnimExport(anim, animPrefs.export, p => { animPrefs.export = p; save(); }, () => session.entry?.name ?? 'Animación');
  const applyTlHeight = () => document.documentElement.style.setProperty('--tl-h', `${animPrefs.tlHeight}px`);
  applyTlHeight();
  const timeline = new Timeline(anim, {
    onionSettings: el => onionPopover(anim, el),
    quality: el => qualityPopover(anim, el, () => { animPrefs.quality = anim.player.quality; animPrefs.showRef = anim.player.showReference; animPrefs.scrub = anim.scrubAudio; save(); }),
    tween: () => void openTween(anim),
    xsheet: () => openXSheet(anim),
    exportAnim: () => void animExport.show(),
    guide: () => drawGuide(anim),
    resize: (dy, done) => { if (dy) { animPrefs.tlHeight = Math.min(Math.round(innerHeight * 0.7), Math.max(140, animPrefs.tlHeight + dy)); applyTlHeight(); } if (done) save(); },
  });
  $('timeline-host').append(timeline.el);
  engine.overlays.push(guideOverlay(anim));
  // Teléfono y Android: animación simplificada (fotogramas en cuadrados sobre el lienzo).
  let phoneAnim: PhoneAnim | null = null;
  function setAnimMode() {
    const has = !!engine.doc.anim;
    const android = document.documentElement.classList.contains('android');
    const simple = has && (isPhone() || android);
    const on = has && !simple;
    document.body.classList.toggle('anim-mode', on);
    document.body.classList.toggle('anim-phone', simple);
    if (simple && !phoneAnim) { phoneAnim = new PhoneAnim(anim, () => session.entry?.name ?? 'Animación'); $('canvas-host').append(phoneAnim.el); }
    if (simple) phoneAnim!.render();
    const btn = document.getElementById('tab-anim');
    if (btn) btn.hidden = !on;
    if (!on && tab === 'anim') showTab('layers');
    if (on) timeline.update();
  }
  engine.on('document', setAnimMode);
  watchDevice(setAnimMode);
  setAnimMode();
  function animAction(id: string) {
    if (!engine.doc.anim || gallery.visible) return;
    switch (id) {
      case 'play': anim.player.toggle(); break;
      case 'prev': anim.step(-1); break;
      case 'next': anim.step(1); break;
      case 'prev-cel': anim.stepCel(-1); break;
      case 'next-cel': anim.stepCel(1); break;
      case 'prev-key': anim.stepKey(-1); break;
      case 'next-key': anim.stepKey(1); break;
      case 'first': anim.go(0); break;
      case 'last': anim.go(engine.doc.anim.length - 1); break;
      case 'new': anim.newFrame(false); break;
      case 'dup': anim.newFrame(true); break;
      case 'hold': anim.insertTime(1); break;
      case 'unhold': anim.insertTime(-1); break;
      case 'key': anim.toggleKey(); break;
      case 'onion': anim.run(() => animModel.cmdAnimSettings(engine.doc, { onion: { enabled: !engine.doc.anim!.onion.enabled } }, 'Papel cebolla')); break;
      case 'xsheet': openXSheet(anim); break;
      case 'export': void animExport.show(); break;
    }
  }
  // La pista activa cambia el papel cebolla (sólo se ve el de la pista activa).
  let lastActive = '';
  engine.on('doc', () => { if (engine.doc.anim && engine.doc.activeId !== lastActive) { lastActive = engine.doc.activeId; engine.refreshOnion(); } });

  // Sin proyecto abierto se empieza en la galería.
  blank();
  gallery.show();

  // ---------- Teclado ----------
  window.addEventListener('keydown', e => {
    const t = e.target as HTMLElement;
    // Esc con el foco fuera de un diálogo (p. ej. tras pulsar un botón que desaparece): cierra lo de encima.
    if (e.key === 'Escape' && !studio.open && !t.closest('.dialog-backdrop, .studio-backdrop, .menu, .popover') && closeTopOverlay()) { e.preventDefault(); return; }
    if (studio.open || exportDialog.open || t.closest('.dialog-backdrop, .menu, .popover, .fx-panel')) return;
    if (gallery.visible) { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') e.preventDefault(); return; }
    if (t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'color'].includes(t.type))) return;
    if (t instanceof HTMLSelectElement && e.key.startsWith('Arrow')) return;
    if (e.code === 'Space') { e.preventDefault(); engine.setSpacePan(true); return; }
    if (t instanceof HTMLInputElement && t.type === 'range' && e.key.startsWith('Arrow')) return;
    if (mgr.handleKey(e)) { e.preventDefault(); e.stopPropagation(); }
  });
  window.addEventListener('keyup', e => { if (e.code === 'Space') { e.preventDefault(); engine.setSpacePan(false); } });
  window.addEventListener('blur', () => engine.setSpacePan(false));
  window.addEventListener('yosadraw:persist', () => { clearTimeout(saveTimer); void settings.save(snapshot()); });
  window.addEventListener('beforeunload', e => {
    void lib.saveNow();
    void settings.save(snapshot());
    // Cambios sin guardar: copia de recuperación y aviso (el escritorio muestra su propio diálogo).
    if (session.dirty) { void session.flushRecovery(); e.preventDefault(); e.returnValue = ''; }
  });

  mgr.select(mgr.current.id);
  syncLibraryTarget();
  return { mgr, anim, timeline, animExport, animPanel, refs, dock, studio, toolbar, props, layers, color, library, thumbs, exportDialog, effects, closeTopOverlay, quick, session, gallery, projects, toGallery };
}
