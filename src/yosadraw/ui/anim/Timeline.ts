import type { Layer } from '../../doc/Document';
import { clipEnd, clipSpan } from '../../anim/audio';
import * as M from '../../anim/model';
import { h, toast } from '../dom';
import { promptText } from '../modal';
import type { AnimStudio, CelRef } from './AnimStudio';
import { TI } from './icons';

type Row =
  | { kind: 'group'; y: number; hgt: number; g: M.TrackGroup }
  | { kind: 'track'; y: number; hgt: number; l: Layer }
  | { kind: 'lane'; y: number; hgt: number; lane: M.AudioLane };

const RULER = 28, GROUP_H = 22, TRACK_H = 30, LANE_H = 58;

type Drag =
  | { kind: 'scrub' }
  | { kind: 'range'; from: number }
  | { kind: 'marker'; id: string; frame: number }
  | { kind: 'cels'; refs: CelRef[]; x0: number; y0: number; dF: number; dT: number; row: number; moved: boolean }
  | { kind: 'len'; ref: CelRef; start: number; len: number }
  | { kind: 'clip'; id: string; x0: number; dx: number; lane: string; laneTo: string; edge: 'move' | 'l' | 'r' }
  | { kind: 'pan'; x0: number; y0: number; sx: number; sy: number };

/** Menú contextual sencillo (se cierra al elegir, al pulsar fuera o con Esc). */
export function contextMenu(x: number, y: number, items: ({ label: string; run: () => void; disabled?: boolean; danger?: boolean } | null)[]) {
  document.querySelector('.menu.tl-menu')?.remove();
  const close = () => { menu.remove(); removeEventListener('pointerdown', outside, true); };
  const outside = (e: Event) => { if (!menu.contains(e.target as Node)) close(); };
  const menu = h('div', { class: 'menu tl-menu', role: 'menu', on: { keydown: (e: Event) => { if ((e as KeyboardEvent).key === 'Escape') { e.stopPropagation(); close(); } } } },
    ...items.map(it => (it ? h('button', { type: 'button', role: 'menuitem', class: it.danger ? 'danger' : '', disabled: !!it.disabled, on: { click: () => { close(); it.run(); } } }, it.label) : h('div', { class: 'menu-sep', role: 'separator' }))));
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
  addEventListener('pointerdown', outside, true);
  (menu.querySelector('button:not([disabled])') as HTMLElement | null)?.focus();
}

const timecode = (f: number, fps: number) => {
  const s = Math.floor(f / fps), ff = f % fps;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
};

/**
 * Línea de tiempo (panel inferior): barra de transporte y edición, cabeceras de
 * pistas y grupos, y una rejilla dibujada en canvas (escala a miles de fotogramas
 * sin crear miles de nodos) con cels, exposiciones, claves, papel cebolla,
 * intervalo, marcadores, clips de audio con forma de onda, diálogos y bocas.
 */
export class Timeline {
  readonly el: HTMLElement;
  private canvas = h('canvas', { class: 'tl-canvas', tabindex: '0', 'aria-label': 'Fotogramas' });
  private heads = h('div', { class: 'tl-heads' });
  private headsInner = h('div', { class: 'tl-heads-inner' });
  private grid = h('div', { class: 'tl-grid' });
  private hbar = h('input', { type: 'range', class: 'tl-hscroll', min: '0', max: '0', value: '0', 'aria-label': 'Desplazar la línea de tiempo' });
  private rows: Row[] = [];
  private fw = 16;
  private sx = 0;
  private sy = 0;
  private drag: Drag | null = null;
  private req = 0;
  private frameIn = h('input', { type: 'number', class: 'tl-frame', min: '1', value: '1', 'aria-label': 'Fotograma actual' });
  private tc = h('span', { class: 'tl-tc mono' });
  private lenIn = h('input', { type: 'number', class: 'tl-len', min: '1', max: String(M.MAX_FRAMES), 'aria-label': 'Duración en fotogramas' });
  private fpsSel = h('select', { class: 'tl-fps', 'aria-label': 'Fotogramas por segundo' }, ...M.FPS_OPTIONS.map(f => h('option', { value: String(f) }, `${f} fps`)));
  private playBtn!: HTMLButtonElement;
  private loopBtn!: HTMLButtonElement;
  private onionBtn!: HTMLButtonElement;
  private stats = h('span', { class: 'tl-stats mono', title: 'Fotogramas por segundo reales de la reproducción y fotogramas saltados' });
  private headSig = '';

  constructor(private s: AnimStudio, actions: { onionSettings: (anchor: HTMLElement) => void; tween: () => void; xsheet: () => void; exportAnim: () => void; guide: () => void; quality: (anchor: HTMLElement) => void; resize: (dy: number, done: boolean) => void }) {
    const b = (icon: string, title: string, run: () => void, cls = '') => h('button', { type: 'button', class: `icon sm tl-btn ${cls}`, title, 'aria-label': title, html: icon, on: { click: run } }) as HTMLButtonElement;
    const sep = () => h('span', { class: 'tl-sep', 'aria-hidden': 'true' });
    this.playBtn = b(TI.play, 'Reproducir / pausa (Ctrl+Intro)', () => s.player.toggle(), 'tl-play');
    this.loopBtn = b(TI.loop, 'Repetir en bucle', () => s.run(() => M.cmdAnimSettings(s.doc, { loop: !s.anim!.loop }, 'Bucle')));
    this.onionBtn = b(TI.onion, 'Papel cebolla (O) · clic derecho: ajustes', () => s.run(() => M.cmdAnimSettings(s.doc, { onion: { enabled: !s.anim!.onion.enabled } }, 'Papel cebolla')));
    this.onionBtn.addEventListener('contextmenu', e => { e.preventDefault(); actions.onionSettings(this.onionBtn); });
    const onionCfg = b(TI.gear, 'Ajustes del papel cebolla', () => actions.onionSettings(onionCfg));
    const quality = b(TI.quality, 'Calidad de reproducción', () => actions.quality(quality));
    const resize = h('div', { class: 'tl-resize', title: 'Arrastra para cambiar la altura', 'aria-hidden': 'true' });
    let y0 = 0;
    resize.addEventListener('pointerdown', e => { y0 = e.clientY; resize.setPointerCapture(e.pointerId); });
    resize.addEventListener('pointermove', e => { if (resize.hasPointerCapture(e.pointerId)) { actions.resize(y0 - e.clientY, false); y0 = e.clientY; } });
    resize.addEventListener('pointerup', () => actions.resize(0, true));

    this.frameIn.addEventListener('change', () => s.go(Number(this.frameIn.value) - 1));
    this.lenIn.addEventListener('change', () => s.run(() => M.cmdAnimSettings(s.doc, { length: Number(this.lenIn.value) }, 'Duración de la animación')));
    this.fpsSel.addEventListener('change', () => s.run(() => M.cmdAnimSettings(s.doc, { fps: Number(this.fpsSel.value) }, 'Fotogramas por segundo')));
    const zoom = h('input', { type: 'range', class: 'tl-zoom', min: '4', max: '48', value: String(this.fw), title: 'Zoom de la línea de tiempo', 'aria-label': 'Zoom de la línea de tiempo' });
    zoom.addEventListener('input', () => { this.setZoom(Number(zoom.value)); });

    const bar = h('div', { class: 'tl-bar', role: 'toolbar', 'aria-label': 'Línea de tiempo' },
      b(TI.first, 'Primer fotograma (Inicio)', () => s.go(M.playRange(s.anim!)[0])),
      b(TI.prevKey, 'Clave o marcador anterior (Alt+Mayús+←)', () => s.stepKey(-1)),
      b(TI.prev, 'Fotograma anterior (,)', () => s.step(-1)),
      this.playBtn,
      b(TI.next, 'Fotograma siguiente (.)', () => s.step(1)),
      b(TI.nextKey, 'Clave o marcador siguiente (Alt+Mayús+→)', () => s.stepKey(1)),
      b(TI.last, 'Último fotograma (Fin)', () => s.go(M.playRange(s.anim!)[1])),
      this.loopBtn, sep(),
      h('label', { class: 'tl-field' }, this.frameIn, h('span', { class: 'tl-of' })), this.tc, sep(),
      this.fpsSel, h('label', { class: 'tl-field', title: 'Duración total' }, this.lenIn, h('span', null, 'f')), sep(),
      b(TI.add, 'Nuevo fotograma (Ctrl+Alt+F)', () => s.newFrame(false)),
      b(TI.dup, 'Duplicar fotograma (Ctrl+Alt+D)', () => s.newFrame(true)),
      b(TI.trash, 'Eliminar fotograma (Supr en la línea de tiempo)', () => s.deleteFrames(false)),
      b(TI.key, 'Fotograma clave / intermedio (Ctrl+Alt+K; K en la línea de tiempo)', () => s.toggleKey()),
      b(TI.hold, 'Alargar exposición +1 (Ctrl+Alt+→)', () => s.insertTime(1)),
      b(TI.unhold, 'Acortar exposición −1 (Ctrl+Alt+←)', () => s.insertTime(-1)), sep(),
      this.onionBtn, onionCfg, sep(),
      b(TI.tween, 'Interpolar movimiento…', () => actions.tween()),
      b(TI.guide, 'Guía de movimiento: dibújala en el lienzo', () => actions.guide()),
      b(TI.sheet, 'Hoja de exposición (X-sheet)…', () => actions.xsheet()),
      b(TI.marker, 'Añadir marcador (M en la línea de tiempo)', () => this.addMarker()),
      b(TI.audio, 'Importar audio (MP3, WAV, OGG, FLAC, AAC)…', () => void s.importAudio()),
      b(TI.images, 'Importar imágenes como fotogramas… (clic derecho: como referencia)', () => void s.importSequence()),
      sep(), quality, this.stats,
      h('span', { class: 'tl-spacer' }), zoom,
      h('button', { type: 'button', class: 'btn sm primary tl-export', on: { click: () => actions.exportAnim() }, html: `${TI.export}<span>Exportar animación</span>` }));
    bar.querySelectorAll('.tl-btn')[bar.querySelectorAll('.tl-btn').length - 1]?.addEventListener('contextmenu', e => { e.preventDefault(); void s.importSequence(undefined, true); });

    this.heads.append(h('div', { class: 'tl-heads-top' },
      h('button', { type: 'button', class: 'btn sm ghost', title: 'Nueva pista animada', on: { click: () => s.newTrack(true) }, html: `${TI.add}<span>Pista</span>` }),
      h('button', { type: 'button', class: 'btn sm ghost', title: 'Nueva capa estática (fondo)', on: { click: () => s.newTrack(false) } }, 'Fondo'),
      h('button', { type: 'button', class: 'btn sm ghost', title: 'Nueva pista de audio', on: { click: () => this.addLane() }, html: `${TI.audio}` })), this.headsInner);
    this.grid.append(this.canvas, this.hbar);
    this.el = h('section', { class: 'timeline', 'aria-label': 'Línea de tiempo', 'data-ui': '' }, resize, bar, h('div', { class: 'tl-body' }, this.heads, this.grid));

    this.hbar.addEventListener('input', () => { this.sx = Number(this.hbar.value); this.invalidate(); });
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', () => { this.drag = null; this.invalidate(); });
    this.canvas.addEventListener('dblclick', this.onDbl);
    this.canvas.addEventListener('contextmenu', this.onContext);
    this.canvas.addEventListener('keydown', this.onKey);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.heads.addEventListener('wheel', this.onWheel, { passive: false });
    new ResizeObserver(() => this.invalidate()).observe(this.grid);
    s.on('change', () => this.update());
    s.on('audio', () => this.invalidate());
    // La barra de caché avanza mientras se precalienta.
    setInterval(() => { if (this.el.isConnected && this.s.anim && !this.s.player.playing && document.visibilityState === 'visible') this.invalidate(); }, 700);
    s.player.on('state', p => { this.playBtn.innerHTML = p ? TI.pause : TI.play; this.playBtn.classList.toggle('on', p); this.stats.textContent = ''; });
    s.player.on('frame', () => { this.follow(); this.updateBar(); this.invalidate(); });
    s.player.on('stats', st => { this.stats.textContent = `${st.fps.toFixed(1)} fps${st.dropped ? ` · ${st.dropped} saltados` : ''}`; });
    // Soltar audio o imágenes sobre la línea de tiempo.
    this.el.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); this.el.classList.add('drop'); } });
    this.el.addEventListener('dragleave', () => this.el.classList.remove('drop'));
    this.el.addEventListener('drop', e => {
      this.el.classList.remove('drop');
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      const audio = files.filter(f => f.type.startsWith('audio/') || /\.(mp3|wav|ogg|oga|flac|aac|m4a|opus)$/i.test(f.name));
      const images = files.filter(f => f.type.startsWith('image/'));
      if (audio.length) void s.importAudio(audio);
      if (images.length) void s.importSequence(images, e.altKey);
    });
  }

  setZoom(fw: number) {
    const a = this.s.anim;
    const center = a ? a.current : 0;
    const px = center * this.fw - this.sx;
    this.fw = Math.max(4, Math.min(48, fw));
    this.sx = Math.max(0, center * this.fw - px);
    this.invalidate();
  }

  /** Mantiene el cabezal a la vista mientras se reproduce o se navega. */
  private follow() {
    const a = this.s.anim;
    if (!a) return;
    const W = this.canvas.clientWidth, x = a.current * this.fw - this.sx;
    if (x < 0 || x > W - this.fw * 2) { this.sx = Math.max(0, a.current * this.fw - W * 0.25); this.hbar.value = String(this.sx); }
  }

  update() {
    const a = this.s.anim;
    if (!a) return;
    this.buildRows();
    this.updateBar();
    if (!this.drag) this.follow();
    this.invalidate();
  }

  private updateBar() {
    const a = this.s.anim!;
    if (document.activeElement !== this.frameIn) this.frameIn.value = String(a.current + 1);
    this.frameIn.max = String(a.length);
    (this.frameIn.nextElementSibling as HTMLElement).textContent = `/ ${a.length}`;
    this.tc.textContent = timecode(a.current, a.fps);
    if (document.activeElement !== this.lenIn) this.lenIn.value = String(a.length);
    if (!M.FPS_OPTIONS.includes(a.fps as never) && !this.fpsSel.querySelector(`option[value="${a.fps}"]`)) this.fpsSel.append(h('option', { value: String(a.fps) }, `${a.fps} fps`));
    this.fpsSel.value = String(a.fps);
    this.loopBtn.classList.toggle('on', a.loop);
    this.onionBtn.classList.toggle('on', a.onion.enabled);
  }

  // ---------------------------------------------------------------- filas y cabeceras

  private buildRows() {
    const doc = this.s.doc, a = doc.anim!;
    const rows: Row[] = [];
    let y = 0;
    const seen = new Set<string>();
    for (const l of [...doc.layers].reverse()) {
      const g = M.groupOf(doc, l);
      if (g && !seen.has(g.id)) { seen.add(g.id); rows.push({ kind: 'group', y, hgt: GROUP_H, g }); y += GROUP_H; }
      if (g?.collapsed) continue;
      rows.push({ kind: 'track', y, hgt: TRACK_H, l }); y += TRACK_H;
    }
    for (const lane of a.lanes) { rows.push({ kind: 'lane', y, hgt: LANE_H, lane }); y += LANE_H; }
    this.rows = rows;
    const sig = JSON.stringify(rows.map(r => r.kind === 'track' ? [r.l.id, r.l.name, r.l.visible, r.l.locked, !!r.l.cels, !!r.l.sync, !!r.l.reference, doc.activeId === r.l.id, r.l.group] : r.kind === 'group' ? [r.g.id, r.g.name, r.g.visible, r.g.locked, r.g.collapsed] : [r.lane.id, r.lane.name, r.lane.muted, r.lane.solo, r.lane.volume]));
    if (sig !== this.headSig) { this.headSig = sig; this.buildHeads(); }
  }

  private buildHeads() {
    const s = this.s, doc = s.doc;
    const tog = (on: boolean, iconOn: string, iconOff: string, title: string, run: () => void, cls = '') =>
      h('button', { type: 'button', class: `icon xs tl-tog ${on ? 'on' : ''} ${cls}`, title, 'aria-label': title, 'aria-pressed': String(on), html: on ? iconOn : iconOff, on: { click: (e: Event) => { e.stopPropagation(); run(); } } });
    const nodes = this.rows.map(r => {
      if (r.kind === 'group') {
        const g = r.g;
        return h('div', { class: 'tl-head tl-head-group', style: { height: `${r.hgt}px` }, on: { contextmenu: (e: Event) => { e.preventDefault(); this.groupMenu(g, e as MouseEvent); } } },
          tog(!g.collapsed, TI.chevDown, TI.chevRight, g.collapsed ? 'Desplegar grupo' : 'Plegar grupo', () => s.run(() => M.cmdGroupProps(doc, g.id, { collapsed: !g.collapsed }))),
          tog(g.visible, TI.eye, TI.eyeOff, 'Mostrar u ocultar el grupo', () => s.run(() => M.cmdGroupProps(doc, g.id, { visible: !g.visible }))),
          tog(g.locked, TI.lock, TI.unlock, 'Bloquear el grupo', () => s.run(() => M.cmdGroupProps(doc, g.id, { locked: !g.locked }))),
          h('span', { class: 'tl-name', title: g.name, on: { dblclick: () => void this.renameGroup(g) } }, g.name));
      }
      if (r.kind === 'track') {
        const l = r.l;
        const el = h('div', {
          class: `tl-head tl-head-track ${doc.activeId === l.id ? 'active' : ''} ${l.group ? 'in-group' : ''} ${l.reference ? 'ref' : ''}`, style: { height: `${r.hgt}px` },
          on: { pointerdown: () => this.s.engine.setActiveLayer(l.id), contextmenu: (e: Event) => { e.preventDefault(); this.trackMenu(l, e as MouseEvent); } },
        },
        tog(l.visible, TI.eye, TI.eyeOff, 'Mostrar u ocultar', () => s.engine.setLayerProps(l.id, { visible: !l.visible })),
        tog(l.locked, TI.lock, TI.unlock, 'Bloquear', () => s.engine.setLayerProps(l.id, { locked: !l.locked })),
        h('span', { class: 'tl-name', title: `${l.name}${l.cels ? '' : ' · estática'}${l.reference ? ' · referencia (no se exporta)' : ''}`, on: { dblclick: () => void this.renameLayer(l) } }, l.name),
        l.cels ? tog(!!l.sync, TI.sync, TI.sync, 'Sincronizar: insertar o quitar tiempo aquí desplaza también las demás pistas sincronizadas', () => s.run(() => M.cmdTrackProps(doc, l.id, { sync: !l.sync })), 'dim-off')
          : h('button', { type: 'button', class: 'btn xs tl-animate', title: 'Dar fotogramas a esta capa', on: { click: (e: Event) => { e.stopPropagation(); s.makeAnimated(l.id); } } }, 'Animar'),
        tog(!!l.reference, TI.ref, TI.ref, 'Pista de referencia (se ve al animar, no se exporta)', () => s.run(() => M.cmdTrackProps(doc, l.id, { reference: !l.reference })), 'dim-off'));
        return el;
      }
      const lane = r.lane;
      const vol = h('input', { type: 'range', min: '0', max: '2', step: '0.01', value: String(lane.volume), class: 'tl-vol', title: `Volumen de la pista ${Math.round(lane.volume * 100)} %`, 'aria-label': 'Volumen de la pista' });
      vol.addEventListener('change', () => s.run(() => M.cmdAnimEdit(doc, 'Volumen de la pista', a => { const x = a.lanes.find(q => q.id === lane.id); if (!x) return false; x.volume = Number(vol.value); return true; })));
      return h('div', { class: 'tl-head tl-head-lane', style: { height: `${r.hgt}px` }, on: { contextmenu: (e: Event) => { e.preventDefault(); this.laneMenu(lane, e as MouseEvent); } } },
        h('span', { class: 'tl-lane-icon', html: TI.audio }),
        h('span', { class: 'tl-name', title: lane.name, on: { dblclick: () => void this.renameLane(lane) } }, lane.name),
        tog(lane.muted, TI.mute, TI.speaker, 'Silenciar la pista', () => s.run(() => M.cmdAnimEdit(doc, 'Silenciar pista', a => { const x = a.lanes.find(q => q.id === lane.id)!; x.muted = !x.muted; }))),
        tog(lane.solo, TI.solo, TI.solo, 'Solo: oír sólo esta pista', () => s.run(() => M.cmdAnimEdit(doc, 'Solo', a => { const x = a.lanes.find(q => q.id === lane.id)!; x.solo = !x.solo; })), 'dim-off'),
        vol);
    });
    this.headsInner.replaceChildren(...nodes);
  }

  private async renameLayer(l: Layer) { const n = await promptText('Renombrar pista', l.name); if (n) this.s.engine.setLayerProps(l.id, { name: n }); }
  private async renameGroup(g: M.TrackGroup) { const n = await promptText('Renombrar grupo', g.name); if (n) this.s.run(() => M.cmdGroupProps(this.s.doc, g.id, { name: n })); }
  private async renameLane(lane: M.AudioLane) {
    const n = await promptText('Renombrar pista de audio', lane.name);
    if (n) this.s.run(() => M.cmdAnimEdit(this.s.doc, 'Renombrar pista de audio', a => { a.lanes.find(x => x.id === lane.id)!.name = n; }));
  }
  private addLane() {
    this.s.run(() => M.cmdAnimEdit(this.s.doc, 'Nueva pista de audio', a => { a.lanes.push({ id: M.uid('au'), name: `Audio ${a.lanes.length + 1}`, volume: 1, muted: false, solo: false }); }));
  }

  private trackMenu(l: Layer, e: MouseEvent) {
    const s = this.s, doc = s.doc, groups = doc.anim!.groups;
    const i = doc.index(l.id);
    contextMenu(e.clientX, e.clientY, [
      { label: 'Renombrar…', run: () => void this.renameLayer(l) },
      l.cels ? { label: 'Volver estática (conserva el fotograma actual)', run: () => s.makeStatic(l.id) } : { label: 'Animar capa', run: () => s.makeAnimated(l.id) },
      l.cels ? { label: 'Exponer en unos', run: () => { s.engine.setActiveLayer(l.id); s.retime(1); } } : null,
      l.cels ? { label: 'Exponer en doses', run: () => { s.engine.setActiveLayer(l.id); s.retime(2); } } : null,
      l.cels ? { label: 'Exponer en treses', run: () => { s.engine.setActiveLayer(l.id); s.retime(3); } } : null,
      null,
      { label: 'Subir pista', disabled: i >= doc.layers.length - 1, run: () => s.engine.exec(doc.cmdMoveLayer(l.id, i + 1)) },
      { label: 'Bajar pista', disabled: i <= 0, run: () => s.engine.exec(doc.cmdMoveLayer(l.id, i - 1)) },
      { label: 'Duplicar pista', run: () => s.engine.exec(doc.cmdDuplicateLayer(l.id)) },
      null,
      { label: 'Nuevo grupo con esta pista', run: async () => { const n = await promptText('Nombre del grupo', `Grupo ${groups.length + 1}`); if (n) s.run(() => M.cmdGroupTracks(doc, [l.id], n)); } },
      ...groups.filter(g => g.id !== l.group).map(g => ({ label: `Mover al grupo «${g.name}»`, run: () => s.run(() => M.cmdTrackProps(doc, l.id, { group: g.id })) })),
      l.group ? { label: 'Sacar del grupo', run: () => s.run(() => M.cmdTrackProps(doc, l.id, { group: null })) } : null,
      null,
      { label: 'Eliminar pista', danger: true, disabled: doc.layers.length <= 1, run: () => s.engine.exec(doc.cmdDeleteLayer(l.id)) },
    ]);
  }

  private groupMenu(g: M.TrackGroup, e: MouseEvent) {
    const s = this.s;
    contextMenu(e.clientX, e.clientY, [
      { label: 'Renombrar…', run: () => void this.renameGroup(g) },
      { label: `Opacidad del grupo (${Math.round(g.opacity * 100)} %)…`, run: async () => { const v = await promptText('Opacidad del grupo (%)', String(Math.round(g.opacity * 100))); if (v !== null) s.run(() => M.cmdGroupProps(s.doc, g.id, { opacity: Math.min(1, Math.max(0, Number(v) / 100 || 0)) })); } },
      { label: 'Desagrupar', run: () => s.run(() => M.cmdUngroup(s.doc, g.id)) },
    ]);
  }

  private laneMenu(lane: M.AudioLane, e: MouseEvent) {
    const s = this.s;
    contextMenu(e.clientX, e.clientY, [
      { label: 'Importar audio aquí…', run: () => void s.importAudio() },
      { label: 'Renombrar…', run: () => void this.renameLane(lane) },
      { label: 'Eliminar pista de audio (y sus clips)', danger: true, disabled: s.anim!.lanes.length <= 1, run: () => s.run(() => M.cmdAnimEdit(s.doc, 'Eliminar pista de audio', a => { a.lanes = a.lanes.filter(x => x.id !== lane.id); a.audio = a.audio.filter(c => c.lane !== lane.id); })) },
    ]);
  }

  private async addMarker() {
    const a = this.s.anim!;
    const name = await promptText('Nuevo marcador', `Marcador ${a.markers.length + 1}`, { ok: 'Añadir' });
    if (name) this.s.run(() => M.cmdMarker(this.s.doc, { add: { frame: a.current, name, color: '#ffcc33' } }));
  }

  // ---------------------------------------------------------------- dibujo

  invalidate() { if (!this.req) this.req = requestAnimationFrame(() => { this.req = 0; this.draw(); }); }

  private colors() {
    const cs = getComputedStyle(this.el);
    const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
    return { bg: v('--surface', '#14111d'), bg2: v('--surface-2', '#1b1727'), line: v('--line', '#2c2640'), fg: v('--fg', '#ece8f6'), muted: v('--muted', '#9a92b3'), accent: v('--accent', '#9d6bff') };
  }

  private draw() {
    const a = this.s.anim;
    if (!a || !this.el.isConnected) return;
    const c = this.canvas, d = Math.min(2, devicePixelRatio || 1);
    const W = Math.max(1, this.grid.clientWidth), H = Math.max(1, this.grid.clientHeight - 14);
    if (c.width !== Math.round(W * d) || c.height !== Math.round(H * d)) { c.width = Math.round(W * d); c.height = Math.round(H * d); c.style.width = `${W}px`; c.style.height = `${H}px`; }
    const total = (a.length + 40) * this.fw;
    this.hbar.max = String(Math.max(0, total - W));
    this.sx = Math.min(this.sx, Math.max(0, total - W));
    if (document.activeElement !== this.hbar) this.hbar.value = String(this.sx);
    const contentH = this.rows.reduce((m, r) => Math.max(m, r.y + r.hgt), 0);
    this.sy = Math.max(0, Math.min(this.sy, contentH - (H - RULER)));
    this.headsInner.style.transform = `translateY(${-this.sy}px)`;

    const g = c.getContext('2d')!, col = this.colors(), fw = this.fw;
    g.setTransform(d, 0, 0, d, 0, 0);
    g.fillStyle = col.bg; g.fillRect(0, 0, W, H);
    const f0 = Math.max(0, Math.floor(this.sx / fw)), f1 = Math.min(a.length + 40, Math.ceil((this.sx + W) / fw));
    const X = (f: number) => f * fw - this.sx;
    const [r0, r1] = M.playRange(a);

    // Filas
    g.save();
    g.beginPath(); g.rect(0, RULER, W, H - RULER); g.clip();
    for (const r of this.rows) {
      const y = RULER + r.y - this.sy;
      if (y > H || y + r.hgt < RULER) continue;
      if (r.kind === 'group') { g.fillStyle = 'rgba(157,107,255,0.10)'; g.fillRect(0, y, W, r.hgt); }
      else if (r.kind === 'track') this.drawTrack(g, r.l, y, r.hgt, f0, f1, X, col);
      else this.drawLane(g, r.lane, y, r.hgt, W, col);
      g.fillStyle = col.line; g.fillRect(0, y + r.hgt - 1, W, 1);
    }
    // Fuera de la duración
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(X(a.length), RULER, W, H);
    // Fuera del intervalo
    if (a.range) { g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, RULER, X(r0), H); g.fillRect(X(r1 + 1), RULER, W, H); }
    g.restore();

    // Regla
    g.fillStyle = col.bg2; g.fillRect(0, 0, W, RULER);
    g.fillStyle = col.line; g.fillRect(0, RULER - 1, W, 1);
    const every = fw >= 24 ? 1 : fw >= 12 ? 2 : fw >= 7 ? 5 : 10;
    g.font = '10px system-ui, sans-serif'; g.textBaseline = 'middle';
    for (let f = f0; f <= f1; f++) {
      const x = X(f), sec = f % a.fps === 0;
      g.fillStyle = sec ? col.muted : col.line;
      g.fillRect(Math.round(x), sec ? 12 : 20, 1, sec ? RULER - 12 : RULER - 20);
      if ((f + 1) % every === 0 || f === 0) { g.fillStyle = sec ? col.fg : col.muted; g.fillText(String(f + 1), x + 2, 19); }
      if (sec && f > 0) { g.fillStyle = col.accent; g.fillText(`${f / a.fps}s`, x + 2, 6); }
    }
    if (a.range) { g.fillStyle = 'rgba(157,107,255,0.55)'; g.fillRect(X(r0), RULER - 4, X(r1 + 1) - X(r0), 3); }
    // Fotogramas ya preparados para reproducir en tiempo real (caché de dibujos).
    const sc = this.s.player.renderScale, ref = this.s.player.showReference;
    g.fillStyle = 'rgba(95,211,165,0.85)';
    for (let f = f0; f <= Math.min(f1, a.length - 1); f++) if (this.s.frames.ready(f, sc, ref)) g.fillRect(X(f), RULER - 2, fw, 2);
    for (const m of a.markers) {
      const x = X(m.frame);
      if (x < -60 || x > W) continue;
      g.fillStyle = m.color;
      g.beginPath(); g.moveTo(x, 1); g.lineTo(x + 9, 1); g.lineTo(x + 9, 8); g.lineTo(x + 4, 11); g.lineTo(x, 8); g.closePath(); g.fill();
      g.fillStyle = col.fg; g.fillText(m.name, x + 12, 6);
      g.fillStyle = m.color; g.globalAlpha = 0.35; g.fillRect(x, RULER, 1, H); g.globalAlpha = 1;
    }
    // Cabezal
    const px = X(a.current);
    g.fillStyle = 'rgba(157,107,255,0.18)'; g.fillRect(px, RULER, fw, H);
    g.fillStyle = col.accent; g.fillRect(px + fw / 2 - 1, 0, 2, H);
    g.beginPath(); g.moveTo(px + fw / 2 - 6, 0); g.lineTo(px + fw / 2 + 6, 0); g.lineTo(px + fw / 2, 8); g.closePath(); g.fill();
  }

  private drawTrack(g: CanvasRenderingContext2D, l: Layer, y: number, hh: number, f0: number, f1: number, X: (f: number) => number, col: ReturnType<Timeline['colors']>) {
    const s = this.s, doc = s.doc, a = doc.anim!, fw = this.fw;
    const active = doc.activeId === l.id;
    if (active) { g.fillStyle = 'rgba(157,107,255,0.07)'; g.fillRect(0, y, X(f1) + fw, hh); }
    const dim = !M.effectiveVisible(doc, l) ? 0.35 : 1;
    // Columnas de fotograma
    g.fillStyle = col.line;
    if (fw >= 8) for (let f = f0; f <= f1; f++) g.fillRect(Math.round(X(f)), y + hh - 6, 1, 5);
    if (!l.cels) {
      // Capa estática: una banda en toda la duración.
      g.globalAlpha = 0.5 * dim;
      g.fillStyle = col.bg2; g.fillRect(X(0) + 1, y + 6, X(a.length) - X(0) - 2, hh - 12);
      g.globalAlpha = dim;
      g.fillStyle = col.muted; g.font = '10px system-ui, sans-serif'; g.fillText('estática (igual en todos los fotogramas)', Math.max(4, X(0) + 6), y + hh / 2);
      g.globalAlpha = 1;
      return;
    }
    const drag = this.drag?.kind === 'cels' && this.drag.moved ? this.drag : null;
    const lenDrag = this.drag?.kind === 'len' ? this.drag : null;
    const onionCels = new Set<string>();
    if (a.onion.enabled && (active || a.onion.allTracks)) {
      const cur = M.celAt(l, a.current);
      const prev = l.cels.filter(c => c.start < (cur ? cur.start : a.current + 1) && c !== cur);
      const next = l.cels.filter(c => c.start > a.current && c !== cur);
      prev.slice(-a.onion.before).forEach(c => onionCels.add(`b${c.id}`));
      next.slice(0, a.onion.after).forEach(c => onionCels.add(`a${c.id}`));
    }
    for (const c of l.cels) {
      if (M.celEnd(c) < f0 || c.start > f1) continue;
      const selected = s.sel.has(c.id);
      let start = c.start, len = c.length;
      if (lenDrag && lenDrag.ref.cel === c.id) len = lenDrag.len;
      const x = X(start) + 1, w = len * fw - 2;
      g.globalAlpha = (drag && selected ? 0.35 : 1) * dim;
      g.fillStyle = c.key ? 'rgba(157,107,255,0.85)' : 'rgba(157,107,255,0.42)';
      if (l.reference) g.fillStyle = 'rgba(120,170,200,0.55)';
      this.round(g, x, y + 4, w, hh - 8, 5); g.fill();
      if (selected) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; this.round(g, x, y + 4, w, hh - 8, 5); g.stroke(); }
      if (onionCels.has(`b${c.id}`) || onionCels.has(`a${c.id}`)) { g.fillStyle = onionCels.has(`b${c.id}`) ? a.onion.colorBefore : a.onion.colorAfter; g.fillRect(x + 2, y + hh - 8, Math.max(2, w - 4), 2); }
      // Punto de dibujo (clave lleno, intermedio hueco) y línea de exposición.
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(x + Math.min(7, fw / 2), y + hh / 2, 3, 0, Math.PI * 2);
      if (c.key) g.fill(); else { g.strokeStyle = '#fff'; g.lineWidth = 1.2; g.stroke(); }
      if (len > 1 && w > 18) { g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(x + 12, y + hh / 2 - 0.5, w - 16, 1); }
      if (c.label && w > 22) { g.fillStyle = '#fff'; g.font = 'bold 10px system-ui, sans-serif'; g.fillText(c.label, x + 14, y + hh / 2 - 6); }
      if (!c.content.items.length && w > 30) { g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = '9px system-ui, sans-serif'; g.fillText('vacío', x + 14, y + hh / 2 + 7); }
      g.globalAlpha = 1;
    }
    if (drag) {
      // Vista previa del arrastre.
      const row = this.rows.findIndex(r => r.kind === 'track' && r.l === l);
      for (const ref of drag.refs) {
        const from = doc.layer(ref.layer)!, c = from.cels?.find(x => x.id === ref.cel);
        if (!c) continue;
        const target = doc.layers[doc.index(from.id) + drag.dT];
        if (target !== l || row < 0) continue;
        g.strokeStyle = '#fff'; g.setLineDash([4, 3]); g.lineWidth = 1.5;
        this.round(g, X(c.start + drag.dF) + 1, y + 4, c.length * fw - 2, hh - 8, 5); g.stroke(); g.setLineDash([]);
      }
    }
  }

  private drawLane(g: CanvasRenderingContext2D, lane: M.AudioLane, y: number, hh: number, W: number, col: ReturnType<Timeline['colors']>) {
    const s = this.s, a = s.anim!, fps = a.fps, fw = this.fw;
    const drag = this.drag?.kind === 'clip' ? this.drag : null;
    for (const c of a.audio) {
      let offset = c.offset, trimS = c.trimStart, trimE = c.trimEnd, laneId = c.lane;
      if (drag && drag.id === c.id) {
        const dt = drag.dx / fw / fps;
        if (drag.edge === 'move') { offset = Math.max(0, c.offset + dt); laneId = drag.laneTo; }
        else if (drag.edge === 'l') { const k = Math.max(-c.trimStart, Math.min(clipSpan(c) - 0.05, dt)); trimS += k; offset += k; }
        else trimE = Math.max(0, Math.min(c.duration - trimS - 0.05, c.trimEnd - dt));
      }
      if (laneId !== lane.id) continue;
      const span = Math.max(0, c.duration - trimS - trimE);
      const x = offset * fps * fw - this.sx, w = span * fps * fw;
      if (x > W || x + w < 0) continue;
      const sel = s.selectedClip === c.id;
      g.fillStyle = c.muted || lane.muted ? 'rgba(120,110,140,0.35)' : 'rgba(64,196,160,0.28)';
      this.round(g, x, y + 3, w, hh - 6, 5); g.fill();
      if (sel) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; this.round(g, x, y + 3, w, hh - 6, 5); g.stroke(); }
      // Forma de onda
      const buf = s.audio.buffer(c);
      if (buf) {
        const peaks = s.audio.peaks(buf), rate = 200;
        const mid = y + hh / 2 + 4, amp = (hh - 22) / 2;
        g.fillStyle = c.muted ? 'rgba(200,200,220,0.4)' : 'rgba(120,240,200,0.9)';
        const x0 = Math.max(0, Math.floor(x)), x1 = Math.min(W, Math.ceil(x + w));
        for (let px = x0; px < x1; px++) {
          const t0 = trimS + ((px - x) / (fps * fw)), t1 = trimS + ((px + 1 - x) / (fps * fw));
          let m = 0;
          for (let i = Math.floor(t0 * rate); i <= Math.min(peaks.length - 1, Math.floor(t1 * rate)); i++) if (peaks[i] > m) m = peaks[i];
          const hgt = Math.max(0.5, m * amp * c.volume);
          g.fillRect(px, mid - hgt, 1, hgt * 2);
        }
      } else { g.fillStyle = col.muted; g.fillText('decodificando…', x + 6, y + hh / 2); }
      g.fillStyle = col.fg; g.font = '10px system-ui, sans-serif';
      g.fillText(c.name, Math.max(x, 0) + 6, y + 11);
      // Diálogos y bocas
      g.font = 'bold 9px system-ui, sans-serif';
      for (const dl of c.dialogue) {
        const dx = dl.start * fw - this.sx, dw = (dl.end - dl.start + 1) * fw;
        g.fillStyle = 'rgba(255,204,51,0.25)'; g.fillRect(dx, y + hh - 14, dw, 11);
        g.fillStyle = '#ffd866'; g.fillText(dl.text.slice(0, Math.max(1, Math.floor(dw / 6))), dx + 2, y + hh - 8);
      }
      if (fw >= 8) for (const mk of c.mouth) { const mx = mk.frame * fw - this.sx; if (mx < -10 || mx > W) continue; g.fillStyle = '#fff'; g.fillText(mk.shape, mx + 2, y + 22); }
      // Asas de recorte
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fillRect(x + 1, y + hh / 2 - 8, 3, 16); g.fillRect(x + w - 4, y + hh / 2 - 8, 3, 16);
    }
  }

  private round(g: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number, r: number) {
    g.beginPath();
    g.roundRect(x, y, Math.max(1, w), hh, Math.min(r, w / 2, hh / 2));
  }

  // ---------------------------------------------------------------- entrada

  /** Posición del puntero relativa al canvas (no se usa offsetX/Y: depende del destino del evento). */
  private local(e: MouseEvent) { const r = this.canvas.getBoundingClientRect(); return { offsetX: e.clientX - r.left, offsetY: e.clientY - r.top }; }

  private hit(e: { offsetX: number; offsetY: number }) {
    const a = this.s.anim!, fw = this.fw;
    const frame = Math.max(0, Math.floor((e.offsetX + this.sx) / fw));
    if (e.offsetY < RULER) {
      const m = a.markers.find(mk => { const x = mk.frame * fw - this.sx; return e.offsetX >= x - 2 && e.offsetX <= x + 11 && e.offsetY <= 12; });
      return { zone: 'ruler' as const, frame, marker: m ?? null };
    }
    const yy = e.offsetY - RULER + this.sy;
    const ri = this.rows.findIndex(r => yy >= r.y && yy < r.y + r.hgt);
    const row = this.rows[ri];
    if (!row) return { zone: 'none' as const, frame };
    if (row.kind === 'track') {
      const c = row.l.cels?.find(x => frame >= x.start && frame < M.celEnd(x)) ?? null;
      const edge = c && Math.abs(e.offsetX - (M.celEnd(c) * fw - this.sx)) <= Math.max(3, Math.min(6, fw / 3));
      return { zone: 'track' as const, frame, row: ri, l: row.l, cel: c, edge: !!edge };
    }
    if (row.kind === 'lane') {
      const t = (e.offsetX + this.sx) / fw / a.fps;
      const clip = a.audio.find(c => c.lane === row.lane.id && t >= c.offset && t <= clipEnd(c)) ?? null;
      let edge: 'move' | 'l' | 'r' = 'move';
      if (clip) {
        const xl = clip.offset * a.fps * fw - this.sx, xr = clipEnd(clip) * a.fps * fw - this.sx;
        if (e.offsetX - xl < 7) edge = 'l'; else if (xr - e.offsetX < 7) edge = 'r';
      }
      return { zone: 'lane' as const, frame, row: ri, lane: row.lane, clip, edge };
    }
    return { zone: 'group' as const, frame, row: ri, g: row.g };
  }

  private onDown = (ev: PointerEvent) => {
    const e = { ...this.local(ev), button: ev.button, pointerId: ev.pointerId, clientX: ev.clientX, clientY: ev.clientY, shiftKey: ev.shiftKey, altKey: ev.altKey, ctrlKey: ev.ctrlKey, metaKey: ev.metaKey };
    if (e.button === 2) return;
    const s = this.s, a = s.anim;
    if (!a) return;
    this.canvas.focus();
    if (e.button === 1) { this.drag = { kind: 'pan', x0: e.clientX, y0: e.clientY, sx: this.sx, sy: this.sy }; this.canvas.setPointerCapture(e.pointerId); return; }
    const hit = this.hit(e);
    this.canvas.setPointerCapture(e.pointerId);
    if (s.player.playing) s.player.pause();
    if (hit.zone === 'ruler') {
      if (hit.marker) { this.drag = { kind: 'marker', id: hit.marker.id, frame: hit.marker.frame }; return; }
      if (e.shiftKey) { this.drag = { kind: 'range', from: hit.frame }; return; }
      this.drag = { kind: 'scrub' };
      s.go(hit.frame);
      return;
    }
    if (hit.zone === 'track') {
      s.engine.setActiveLayer(hit.l.id);
      if (hit.cel && hit.edge) { this.drag = { kind: 'len', ref: { layer: hit.l.id, cel: hit.cel.id }, start: hit.cel.start, len: hit.cel.length }; return; }
      s.go(hit.frame);
      if (hit.cel) {
        const ref = { layer: hit.l.id, cel: hit.cel.id };
        if (e.ctrlKey || e.metaKey) { if (s.sel.has(ref.cel)) s.sel.delete(ref.cel); else s.sel.set(ref.cel, ref.layer); s.touch(); }
        else if (e.shiftKey && s.sel.size) {
          // Selección de rango en la pista.
          const firstSel = hit.l.cels!.filter(c => s.sel.has(c.id)).map(c => c.start);
          const lo = Math.min(hit.cel.start, ...firstSel), hi = Math.max(hit.cel.start, ...firstSel);
          s.select(hit.l.cels!.filter(c => c.start >= lo && c.start <= hi).map(c => ({ layer: hit.l.id, cel: c.id })), true);
        } else if (!s.sel.has(ref.cel)) s.select([ref]);
        this.drag = { kind: 'cels', refs: s.selection(), x0: e.offsetX, y0: e.offsetY, dF: 0, dT: 0, row: hit.row, moved: false };
      } else s.select([]);
      this.invalidate();
      return;
    }
    if (hit.zone === 'lane') {
      s.selectedClip = hit.clip?.id ?? null;
      s.touch();
      if (hit.clip) this.drag = { kind: 'clip', id: hit.clip.id, x0: e.offsetX, dx: 0, lane: hit.lane.id, laneTo: hit.lane.id, edge: hit.edge };
      else s.go(hit.frame);
      this.invalidate();
    }
  };

  private onMove = (ev: PointerEvent) => {
    const e = { ...this.local(ev), button: ev.button, pointerId: ev.pointerId, clientX: ev.clientX, clientY: ev.clientY, shiftKey: ev.shiftKey, altKey: ev.altKey, ctrlKey: ev.ctrlKey, metaKey: ev.metaKey };
    const s = this.s, a = s.anim, dr = this.drag;
    if (!a) return;
    if (!dr) {
      const hit = this.hit(e);
      this.canvas.style.cursor = (hit.zone === 'track' && hit.edge) || (hit.zone === 'lane' && hit.clip && hit.edge !== 'move') ? 'ew-resize' : hit.zone === 'ruler' ? (hit.marker ? 'grab' : 'col-resize') : 'default';
      return;
    }
    const frame = Math.max(0, Math.floor((e.offsetX + this.sx) / this.fw));
    switch (dr.kind) {
      case 'pan': this.sx = Math.max(0, dr.sx - (e.clientX - dr.x0)); this.sy = Math.max(0, dr.sy - (e.clientY - dr.y0)); break;
      case 'scrub': s.go(frame); break;
      case 'range': break;
      case 'marker': dr.frame = Math.min(a.length - 1, frame); break;
      case 'len': dr.len = Math.max(1, Math.round((e.offsetX + this.sx) / this.fw) - dr.start); break;
      case 'cels': {
        dr.dF = Math.round((e.offsetX - dr.x0) / this.fw);
        const yy = e.offsetY - RULER + this.sy;
        const ri = this.rows.findIndex(r => yy >= r.y && yy < r.y + r.hgt);
        const tracks = this.rows.map((r, i) => (r.kind === 'track' ? i : -1)).filter(i => i >= 0);
        const from = tracks.indexOf(dr.row), to = tracks.indexOf(ri);
        // Las filas van de arriba abajo; en el documento, arriba = índice mayor.
        if (to >= 0 && from >= 0) dr.dT = from - to;
        dr.moved = dr.moved || Math.abs(e.offsetX - dr.x0) > 3 || dr.dT !== 0;
        break;
      }
      case 'clip': {
        dr.dx = e.offsetX - dr.x0;
        // Al arrastrar, el clip se ajusta a fotogramas enteros.
        dr.dx = Math.round(dr.dx / this.fw) * this.fw;
        if (dr.edge === 'move') {
          const yy = e.offsetY - RULER + this.sy;
          const r = this.rows.find(q => yy >= q.y && yy < q.y + q.hgt);
          if (r?.kind === 'lane') dr.laneTo = r.lane.id;
        }
        break;
      }
    }
    this.invalidate();
  };

  private onUp = (ev: PointerEvent) => {
    const e = { ...this.local(ev), button: ev.button, pointerId: ev.pointerId, clientX: ev.clientX, clientY: ev.clientY, shiftKey: ev.shiftKey, altKey: ev.altKey, ctrlKey: ev.ctrlKey, metaKey: ev.metaKey };
    const s = this.s, a = s.anim, dr = this.drag;
    this.drag = null;
    if (!a || !dr) return;
    const frame = Math.max(0, Math.min(a.length - 1, Math.floor((e.offsetX + this.sx) / this.fw)));
    if (dr.kind === 'range') s.run(() => M.cmdAnimSettings(s.doc, { range: dr.from === frame ? null : [dr.from, frame] }, dr.from === frame ? 'Quitar intervalo' : 'Intervalo de reproducción'));
    else if (dr.kind === 'marker') s.run(() => M.cmdMarker(s.doc, { update: dr.id, patch: { frame: dr.frame } }));
    else if (dr.kind === 'len') { const c = s.doc.layer(dr.ref.layer)?.cels?.find(x => x.id === dr.ref.cel); if (c && c.length !== dr.len) s.setLength(dr.ref, dr.len); }
    else if (dr.kind === 'cels' && dr.moved && (dr.dF || dr.dT || e.altKey)) s.move(dr.refs, dr.dF, dr.dT, e.altKey);
    else if (dr.kind === 'clip' && (dr.dx || dr.laneTo !== dr.lane)) {
      const dt = dr.dx / this.fw / a.fps;
      s.editClip(dr.id, dr.edge === 'move' ? 'Mover audio' : 'Recortar audio', c => {
        if (dr.edge === 'move') { c.offset = Math.max(0, c.offset + dt); c.lane = dr.laneTo; }
        else if (dr.edge === 'l') { const k = Math.max(-c.trimStart, Math.min(clipSpan(c) - 0.05, dt)); c.trimStart += k; c.offset += k; }
        else c.trimEnd = Math.max(0, Math.min(c.duration - c.trimStart - 0.05, c.trimEnd - dt));
      });
    }
    this.invalidate();
  };

  private onDbl = (e: MouseEvent) => {
    const s = this.s, hit = this.hit(this.local(e));
    if (hit.zone === 'ruler') { if (hit.marker) { const m = hit.marker; void promptText('Renombrar marcador', m.name).then(n => { if (n) s.run(() => M.cmdMarker(s.doc, { update: m.id, patch: { name: n } })); }); } else { s.go(hit.frame); void this.addMarker(); } return; }
    if (hit.zone === 'track' && !hit.cel && hit.l.cels) { s.go(hit.frame); s.run(() => M.cmdNewFrame(s.doc, hit.l.id)); }
    if (hit.zone === 'track' && !hit.l.cels) s.makeAnimated(hit.l.id);
  };

  private onContext = (e: MouseEvent) => {
    e.preventDefault();
    const s = this.s, hit = this.hit(this.local(e));
    if (hit.zone === 'ruler') {
      const a = s.anim!;
      contextMenu(e.clientX, e.clientY, [
        hit.marker ? { label: `Quitar marcador «${hit.marker.name}»`, danger: true, run: () => s.run(() => M.cmdMarker(s.doc, { remove: hit.marker!.id })) } : { label: 'Añadir marcador aquí…', run: () => { s.go(hit.frame); void this.addMarker(); } },
        { label: 'Inicio del intervalo aquí', run: () => s.run(() => M.cmdAnimSettings(s.doc, { range: [hit.frame, a.range ? a.range[1] : a.length - 1] }, 'Intervalo')) },
        { label: 'Fin del intervalo aquí', run: () => s.run(() => M.cmdAnimSettings(s.doc, { range: [a.range ? a.range[0] : 0, hit.frame] }, 'Intervalo')) },
        { label: 'Quitar intervalo', disabled: !a.range, run: () => s.run(() => M.cmdAnimSettings(s.doc, { range: null }, 'Quitar intervalo')) },
        { label: 'Duración = hasta aquí', run: () => s.run(() => M.cmdAnimSettings(s.doc, { length: hit.frame + 1 }, 'Duración de la animación')) },
      ]);
      return;
    }
    if (hit.zone === 'track') {
      s.engine.setActiveLayer(hit.l.id);
      s.go(hit.frame);
      if (hit.cel && !s.sel.has(hit.cel.id)) s.select([{ layer: hit.l.id, cel: hit.cel.id }]);
      if (!hit.l.cels) { this.trackMenu(hit.l, e); return; }
      const c = hit.cel;
      contextMenu(e.clientX, e.clientY, [
        { label: 'Nuevo fotograma', run: () => s.newFrame(false) },
        { label: 'Duplicar fotograma', disabled: !c, run: () => s.newFrame(true) },
        null,
        { label: 'Copiar', disabled: !c, run: () => s.copy() },
        { label: 'Cortar', disabled: !c, run: () => s.cut() },
        { label: 'Pegar', disabled: !s.clipboard, run: () => s.paste() },
        null,
        { label: c?.key ? 'Marcar como intermedio' : 'Marcar como clave', disabled: !c, run: () => s.toggleKey() },
        { label: 'Etiqueta (p. ej. boca A…X)…', disabled: !c, run: async () => { const t = await promptText('Etiqueta del dibujo', c!.label, { max: 24 }); if (t !== null) s.run(() => M.cmdCelProps(s.doc, hit.l.id, c!.id, { label: t.trim() })); } },
        { label: 'Duración…', disabled: !c, run: async () => { const t = await promptText('Duración en fotogramas', String(c!.length)); if (t) s.setLength({ layer: hit.l.id, cel: c!.id }, Number(t)); } },
        null,
        { label: 'Eliminar', danger: true, disabled: !c, run: () => s.deleteFrames(false) },
        { label: 'Eliminar y cerrar el hueco', danger: true, disabled: !c, run: () => s.deleteFrames(true) },
      ]);
      return;
    }
    if (hit.zone === 'lane') {
      if (!hit.clip) { this.laneMenu(hit.lane, e); return; }
      const c = hit.clip;
      s.selectedClip = c.id; s.touch();
      contextMenu(e.clientX, e.clientY, [
        { label: c.muted ? 'Activar sonido' : 'Silenciar clip', run: () => s.editClip(c.id, 'Silenciar clip', x => { x.muted = !x.muted; }) },
        { label: 'Empezar en el fotograma actual', run: () => s.editClip(c.id, 'Mover audio', (x, a) => { x.offset = a.current / a.fps; }) },
        { label: 'Quitar recortes', run: () => s.editClip(c.id, 'Quitar recortes', x => { x.offset -= x.trimStart; x.trimStart = 0; x.trimEnd = 0; x.offset = Math.max(0, x.offset); }) },
        { label: 'Sincronización labial automática', run: () => void s.autoLipSync(c.id) },
        null,
        { label: 'Eliminar clip', danger: true, run: () => s.run(() => M.cmdAnimEdit(s.doc, 'Eliminar audio', a => { a.audio = a.audio.filter(x => x.id !== c.id); })) },
      ]);
    }
  };

  private onKey = (e: KeyboardEvent) => {
    const s = this.s, k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    const done = () => { e.preventDefault(); e.stopPropagation(); };
    if ((k === 'delete' || k === 'backspace') && !mod) { s.deleteFrames(e.shiftKey); done(); }
    else if (mod && k === 'c') { s.copy(); done(); }
    else if (mod && k === 'x') { s.cut(); done(); }
    else if (mod && k === 'v') { s.paste(); done(); }
    else if (mod && k === 'a') { const l = s.active; if (l.cels) s.select(l.cels.map(c => ({ layer: l.id, cel: c.id }))); done(); }
    else if (!mod && k === 'k') { s.toggleKey(); done(); }
    else if (!mod && k === 'm') { void this.addMarker(); done(); }
    else if (!mod && k === 'arrowleft') { s.step(-1); done(); }
    else if (!mod && k === 'arrowright') { s.step(1); done(); }
    else if (!mod && k === 'arrowup' || !mod && k === 'arrowdown') {
      const i = s.doc.index(s.doc.activeId) + (k === 'arrowup' ? 1 : -1);
      const l = s.doc.layers[i];
      if (l) s.engine.setActiveLayer(l.id);
      done();
    } else if (k === 'escape') { s.select([]); done(); }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) { this.setZoom(this.fw * Math.exp(-e.deltaY * 0.004)); return; }
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) this.sx = Math.max(0, this.sx + (e.deltaX || e.deltaY));
    else this.sy = Math.max(0, this.sy + e.deltaY);
    this.invalidate();
  };

  /** Informa de un problema sin bloquear. */
  notice(m: string) { toast(m); }
}
