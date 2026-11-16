import type { StrokePainter } from '../../brush/StrokePainter';
import type { Command, Layer } from '../../doc/Document';
import { Document, MAX_LAYERS } from '../../doc/Document';
import type { CanvasEngine } from '../../engine';
import { Emitter } from '../../engine/Emitter';
import type { ToolManager } from '../../tools/ToolManager';
import { AUDIO_ACCEPT, AUDIO_MIME, AudioEngine, mouthTimeline } from '../../anim/audio';
import * as M from '../../anim/model';
import { Player } from '../../anim/player';
import { FrameRenderer } from '../../anim/render';
import { pickFiles, toast } from '../dom';

export type CelRef = { layer: string; cel: string };

/**
 * Controlador de YOSADRAW ANIMATE: une el motor de dibujo, la línea de tiempo,
 * el panel de propiedades, el reproductor y el audio. Toda edición pasa por los
 * comandos de `anim/model` y el historial del motor (Ctrl+Z deshace también la
 * línea de tiempo, y deshacer un trazo lleva al fotograma donde se hizo).
 */
export class AnimStudio extends Emitter<{ change: void; selection: void; audio: void }> {
  readonly frames: FrameRenderer;
  readonly audio = new AudioEngine();
  readonly player: Player;
  /** Cels seleccionados (id del cel → id de su capa). */
  readonly sel = new Map<string, string>();
  selectedClip: string | null = null;
  clipboard: M.CelClipboard | null = null;
  /** Arrastrar el cabezal hace sonar el audio. */
  scrubAudio = true;

  constructor(readonly engine: CanvasEngine, readonly mgr: ToolManager, painter: StrokePainter) {
    super();
    // Caché de reproducción: una cuarta parte de la memoria del equipo (entre 384 MB y 1,5 GB).
    const gb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
    this.frames = new FrameRenderer(painter, engine.doc, Math.min(1536, Math.max(384, gb * 256)) * 1024 * 1024);
    this.player = new Player(engine, this.frames, this.audio);
    painter.tips.images.onReady(() => this.frames.clear());
    engine.on('document', d => {
      this.player.pause();
      this.frames.reset(d);
      this.sel.clear();
      this.selectedClip = null;
      if (d.anim) void this.decodeAll();
      this.emit('change', undefined);
    });
    engine.on('history', () => { this.pruneSelection(); this.emit('change', undefined); });
    engine.on('frame', () => this.emit('change', undefined));
    engine.on('doc', () => this.emit('change', undefined));
  }

  get doc() { return this.engine.doc; }
  get anim(): M.Animation | null { return this.engine.doc.anim; }
  get active(): Layer { return this.doc.active; }

  /** Ejecuta un comando de animación; si no se puede, avisa. */
  run(make: () => Command | null, fail?: string): boolean {
    if (!this.anim) return false;
    if (this.player.playing) this.player.pause();
    M.capture(this.doc);
    let c: Command | null;
    try { c = make(); } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); return false; }
    if (!c) { if (fail) toast(fail); return false; }
    return this.engine.exec(c);
  }

  // ---------------------------------------------------------------- navegación

  go(f: number) {
    const a = this.anim;
    if (!a) return;
    const before = a.current;
    this.engine.setFrame(f);
    if (this.scrubAudio && a.current !== before && !this.player.playing) this.audio.scrub(a, a.current / a.fps, 1 / a.fps);
  }
  step(d: number) {
    const a = this.anim;
    if (!a) return;
    const [r0, r1] = M.playRange(a);
    let f = a.current + d;
    if (a.loop && f > r1) f = r0;
    if (a.loop && f < r0) f = r1;
    this.go(f);
  }
  /** Siguiente / anterior dibujo de la pista activa. */
  stepCel(d: 1 | -1) {
    const a = this.anim, l = this.active;
    if (!a || !l.cels?.length) return this.step(d);
    const cur = M.celAt(l, a.current);
    const list = l.cels;
    const target = d > 0 ? list.find(c => c.start > a.current) : [...list].reverse().find(c => (cur ? c.start < cur.start : c.start < a.current));
    if (target) this.go(target.start);
  }
  /** Siguiente / anterior fotograma clave (en cualquier pista animada) o marcador. */
  stepKey(d: 1 | -1) {
    const a = this.anim;
    if (!a) return;
    const stops = new Set<number>(a.markers.map(m => m.frame));
    for (const l of this.doc.layers) for (const c of l.cels ?? []) if (c.key) stops.add(c.start);
    const sorted = [...stops].sort((x, y) => x - y);
    const t = d > 0 ? sorted.find(f => f > a.current) : [...sorted].reverse().find(f => f < a.current);
    if (t !== undefined) this.go(t);
  }

  // ---------------------------------------------------------------- selección

  private pruneSelection() {
    for (const [cel, layer] of this.sel) if (!this.doc.layer(layer)?.cels?.some(c => c.id === cel)) this.sel.delete(cel);
    if (this.selectedClip && !this.anim?.audio.some(c => c.id === this.selectedClip)) this.selectedClip = null;
  }
  selection(): CelRef[] { return [...this.sel].map(([cel, layer]) => ({ layer, cel })); }
  /** Selección o, si no hay, el cel del fotograma actual en la pista activa. */
  targets(): CelRef[] {
    const s = this.selection();
    if (s.length) return s;
    const c = this.anim && M.celAt(this.active, this.anim.current);
    return c ? [{ layer: this.active.id, cel: c.id }] : [];
  }
  /** Avisa a la interfaz de que cambió la selección. */
  touch() { this.emit('selection', undefined); this.emit('change', undefined); }
  select(refs: CelRef[], add = false) {
    if (!add) this.sel.clear();
    for (const r of refs) this.sel.set(r.cel, r.layer);
    this.emit('selection', undefined);
    this.emit('change', undefined);
  }

  // ---------------------------------------------------------------- acciones de fotogramas

  /** La pista activa ha de ser animada (si es estática se ofrece convertirla). */
  private animatedActive(): Layer | null {
    const l = this.active;
    if (l.cels) return l;
    toast(`«${l.name}» es una capa estática (igual en todos los fotogramas). Usa «Animar capa» en su pista para darle fotogramas.`);
    return null;
  }
  newFrame(copy = false) { const l = this.animatedActive(); if (l) this.run(() => M.cmdNewFrame(this.doc, l.id, copy), copy ? 'No hay dibujo que duplicar en este fotograma' : undefined); }
  deleteFrames(ripple = false) { const t = this.targets(); if (t.length) this.run(() => M.cmdDeleteCels(this.doc, t, ripple)); else toast('No hay ningún dibujo en este fotograma'); this.sel.clear(); }
  toggleKey() {
    const t = this.targets();
    if (!t.length) return;
    const first = this.doc.layer(t[0].layer)!.cels!.find(c => c.id === t[0].cel)!;
    const key = !first.key;
    this.run(() => M.cmdAnimEdit(this.doc, key ? 'Marcar como clave' : 'Marcar como intermedio', () => {
      for (const r of t) { const l = this.doc.layer(r.layer)!; l.cels = l.cels!.map(c => (c.id === r.cel ? { ...c, key } : c)); }
    }));
  }
  insertTime(n: number) { const l = this.animatedActive(); if (l) this.run(() => M.cmdInsertTime(this.doc, l.id, n)); }
  setLength(ref: CelRef, len: number) { this.run(() => M.cmdSetLength(this.doc, ref.layer, ref.cel, len)); }
  retime(n: number) { const l = this.animatedActive(); if (l) this.run(() => M.cmdRetime(this.doc, l.id, n), 'La pista no tiene dibujos'); }
  copy() {
    const t = this.targets();
    this.clipboard = M.copyCels(this.doc, t);
    if (this.clipboard) toast(`${t.length} ${t.length === 1 ? 'fotograma copiado' : 'fotogramas copiados'}`, 'ok');
  }
  cut() { this.copy(); if (this.clipboard) this.deleteFrames(false); }
  paste() {
    const l = this.animatedActive();
    if (!l || !this.clipboard) { if (!this.clipboard) toast('No hay fotogramas copiados'); return; }
    this.run(() => M.cmdPasteCels(this.doc, this.clipboard!, l.id), 'No se puede pegar aquí: las pistas de destino han de ser animadas');
  }
  move(refs: CelRef[], dF: number, dT: number, copy: boolean) {
    if (!this.run(() => M.cmdMoveCels(this.doc, refs, dF, dT, copy), 'No caben ahí: chocarían con otros dibujos o la pista no es animada')) return;
    // La selección sigue a los cels movidos (o a las copias).
    if (!copy && dT) {
      this.sel.clear();
      for (const r of refs) { const to = this.doc.layers[this.doc.index(r.layer) + dT]; if (to) this.sel.set(r.cel, to.id); }
    }
  }

  // ---------------------------------------------------------------- pistas

  newTrack(animated = true) {
    if (this.doc.layers.length >= MAX_LAYERS) { toast(`Máximo ${MAX_LAYERS} pistas`); return; }
    const l = this.doc.newLayer(animated ? `Animación ${this.doc.layers.filter(x => x.cels).length + 1}` : undefined);
    if (animated) l.cels = [];
    if (this.active.group) l.group = this.active.group;
    this.engine.exec(this.doc.cmdAddLayer(this.doc.activeId, l));
  }
  makeAnimated(id: string) { this.run(() => M.cmdMakeAnimated(this.doc, id)); }
  makeStatic(id: string) { this.run(() => M.cmdMakeStatic(this.doc, id)); }

  // ---------------------------------------------------------------- audio

  async decodeAll() {
    const a = this.anim;
    if (!a) return;
    for (const c of a.audio) {
      try {
        const b = await this.audio.decode(c);
        if (Math.abs(c.duration - b.duration) > 0.01) c.duration = b.duration;
      } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); }
    }
    this.emit('audio', undefined);
    this.emit('change', undefined);
  }

  async importAudio(files?: File[]) {
    const a = this.anim;
    if (!a) return;
    files ??= await pickFiles(AUDIO_ACCEPT, true);
    for (const f of files) {
      if (f.size > 400 * 1024 * 1024) { toast(`${f.name}: demasiado grande (máx. 400 MB)`, 'error'); continue; }
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      const clip: M.AudioClip = {
        id: M.uid('ac'), name: f.name, lane: a.lanes[0].id, data: new Uint8Array(await f.arrayBuffer()), mime: f.type || AUDIO_MIME[ext] || 'audio/mpeg',
        duration: 0, offset: a.current / a.fps, trimStart: 0, trimEnd: 0, volume: 1, muted: false, dialogue: [], mouth: [],
      };
      try { clip.duration = (await this.audio.decode(clip)).duration; }
      catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); continue; }
      // Una pista de audio libre en ese tramo (o una nueva).
      const busy = (lane: string) => a.audio.some(c => c.lane === lane && c.offset < clip.offset + clip.duration && clip.offset < c.offset + c.duration - c.trimStart - c.trimEnd);
      const free = a.lanes.find(l => !busy(l.id));
      this.run(() => M.cmdAnimEdit(this.doc, 'Importar audio', an => {
        if (free) clip.lane = free.id;
        else { const lane = { id: M.uid('au'), name: `Audio ${an.lanes.length + 1}`, volume: 1, muted: false, solo: false }; an.lanes.push(lane); clip.lane = lane.id; }
        an.audio.push(clip);
        const end = Math.ceil((clip.offset + clip.duration) * an.fps);
        if (end > an.length && end <= M.MAX_FRAMES) an.length = end;
      }));
      this.selectedClip = clip.id;
      toast(`Audio «${f.name}» importado (${clip.duration.toFixed(1).replace('.', ',')} s)`, 'ok');
    }
    this.emit('audio', undefined);
  }

  clip(id = this.selectedClip): M.AudioClip | null { return this.anim?.audio.find(c => c.id === id) ?? null; }
  editClip(id: string, label: string, fn: (c: M.AudioClip, a: M.Animation) => boolean | void) {
    this.run(() => M.cmdAnimEdit(this.doc, label, a => { const c = a.audio.find(x => x.id === id); return c ? fn(c, a) : false; }));
  }

  /** Bocas automáticas por volumen para el clip. */
  async autoLipSync(id: string) {
    const c = this.clip(id), a = this.anim;
    if (!c || !a) return;
    await this.audio.decode(c);
    const keys = this.audio.lipSync(c, a.fps);
    this.editClip(id, 'Sincronización labial automática', x => { x.mouth = keys; });
    toast(`${keys.length} cambios de boca generados. Ajústalos en la hoja de exposición.`, 'ok');
  }

  /**
   * Aplica las bocas del clip a una pista: en cada tramo pone una copia del dibujo
   * de esa pista etiquetado con la forma (A…H, X). Sustituye lo que hubiera en el tramo.
   */
  applyMouth(id: string, layerId: string) {
    const c = this.clip(id), a = this.anim, l = this.doc.layer(layerId);
    if (!c || !a || !l?.cels) return;
    const byShape = new Map<string, M.Cel>();
    for (const cel of l.cels) if (cel.label) byShape.set(cel.label.toUpperCase(), cel);
    if (!byShape.size) { toast('Etiqueta antes los dibujos de la pista con su forma de boca (A, B, C, D, E, F, G, H o X)'); return; }
    const end = Math.min(a.length, Math.ceil((c.offset + c.duration - c.trimStart - c.trimEnd) * a.fps));
    const spans = mouthTimeline(c.mouth, end);
    if (!spans.length) { toast('El clip no tiene bocas: genera la sincronización labial o escríbela en la hoja de exposición'); return; }
    const missing = new Set(spans.map(s => s.shape).filter(s => !byShape.has(s)));
    this.run(() => M.cmdAnimEdit(this.doc, 'Aplicar sincronización labial', () => {
      const s0 = spans[0].start, s1 = spans[spans.length - 1].start + spans[spans.length - 1].length;
      // Se conservan los dibujos de referencia (etiquetados) que estén fuera del tramo.
      l.cels = l.cels!.filter(x => M.celEnd(x) <= s0 || x.start >= s1);
      for (const s of spans) {
        const src = byShape.get(s.shape) ?? byShape.get('X');
        if (!src) continue;
        l.cels.push(M.newCel(s.start, s.length, src.content.items.slice(), false, s.shape));
      }
    }));
    if (missing.size) toast(`Faltan dibujos para: ${[...missing].join(', ')} (se usó X o se dejó en blanco)`);
  }

  // ---------------------------------------------------------------- imágenes como fotogramas

  /** Importa imágenes como fotogramas consecutivos de una pista nueva (rotoscopia, referencias). */
  async importSequence(files?: File[], reference = false) {
    const a = this.anim;
    if (!a) return;
    files ??= await pickFiles('image/png,image/jpeg,image/webp,image/gif,image/bmp', true);
    if (!files.length) return;
    files = [...files].sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }));
    if (this.doc.layers.length >= MAX_LAYERS) { toast(`Máximo ${MAX_LAYERS} pistas`); return; }
    const doc = this.doc, cels: M.Cel[] = [];
    // Las referencias se guardan reducidas (no se exportan): menos memoria.
    const maxSide = reference ? Math.min(1280, Math.max(doc.width, doc.height)) : Math.max(doc.width, doc.height);
    let f = a.current;
    for (const file of files) {
      const bmp = await createImageBitmap(file).catch(() => null);
      if (!bmp) { toast(`${file.name}: no se pudo leer`, 'error'); continue; }
      const fit = Math.min(doc.width / bmp.width, doc.height / bmp.height);
      const k = Math.min(1, maxSide / Math.max(bmp.width * fit, bmp.height * fit));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * fit * k)); c.height = Math.max(1, Math.round(bmp.height * fit * k));
      c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      const w = bmp.width * fit, h = bmp.height * fit;
      cels.push(M.newCel(f++, 1, [doc.item({ kind: 'bitmap', image: c, x: (doc.width - w) / 2, y: (doc.height - h) / 2, w, h })]));
    }
    if (!cels.length) return;
    const layer = doc.newLayer(reference ? 'Referencia' : files[0].name.replace(/\.[^.]+$/, '').slice(0, 40));
    layer.cels = cels;
    if (reference) { layer.reference = true; layer.opacity = 0.5; layer.locked = true; }
    this.engine.exec(Document.group(reference ? 'Pista de referencia' : 'Importar secuencia', [doc.cmdAddLayer(doc.activeId, layer), M.cmdAnimEdit(doc, '', an => { if (f <= an.length) return false; an.length = Math.min(M.MAX_FRAMES, f); return true; })]));
    toast(`${cels.length} imágenes importadas como fotogramas`, 'ok');
  }
}
