import { h, pickFiles, toast } from '../../ui/dom';
import { TRANS_TYPES, cardPhys, defaultAudio, defaultCel, defaultTuber, sid as newId, defaultCtrl, defaultFx, defaultObjStyle, defaultPhys, styled, sid, type Cel3, type Line3, type Pose3, type TransType, type Tuber3, type Act3, type ActType, type Track3, type EventType, type Fx3, type Obj3, type Rule3 } from '../model';
import type { Studio3D } from '../Studio3D';
import type { Rows } from './Panels';

/** Física y control de un objeto (sección del panel «Objeto»). */
export type PickArt = (kind: 'image' | 'drawing') => Promise<{ src: string; name: string; project: { id: string; rev: number } | null } | null>;
export function physicsSection(r: Rows, s: Studio3D, o: Obj3, pick?: PickArt) {
  const ids = s.selected.filter(x => x.kind === 'mesh').map(x => x.id);
  if (o.kind === 'light') {
    r.sec('En vivo', r.select('Comportamiento', o.lightFx ?? 'none', [['none', 'Fija'], ['flicker', 'Parpadeo (fuego, avería)'], ['pulse', 'Pulso suave'], ['orbit', 'Girar alrededor del centro']], v => s.edit('Comportamiento de la luz', (_st, sc) => { const x = sc.objects.find(y => y.id === o.id); if (x) x.lightFx = v as Obj3['lightFx']; })));
    return;
  }
  if (o.kind !== 'mesh') return;
  const ph = { ...defaultPhys('none'), ...(o.phys ?? (o.card ? cardPhys() : {})) };
  const c = o.ctrl;
  const kids: (Node | null)[] = [
    r.select('Física', ph.body, [['none', 'Sin física (decorado)'], ['dynamic', 'Dinámico (cae, choca, se puede agarrar)'], ['static', 'Estático (suelo, paredes)'], ['kinematic', 'Cinemático (sigue sus keyframes y empuja)']], v => s.setPhys(ids, { body: v as typeof ph.body })),
  ];
  if (ph.body !== 'none') kids.push(
    r.plainNum('Masa', ph.mass, v => s.setPhys(ids, { mass: Math.max(0.05, v) }), { min: 0.05, step: 0.5, unit: 'kg' }),
    r.range('Rebote', ph.bounce, 0, 1, 0.05, v => s.setPhys(ids, { bounce: v })),
    r.range('Rozamiento', ph.friction, 0, 1, 0.05, v => s.setPhys(ids, { friction: v })),
    r.select('Forma de choque', ph.shape, [['auto', 'Automática'], ['box', 'Caja'], ['sphere', 'Esfera (rueda)']], v => s.setPhys(ids, { shape: v as typeof ph.shape })),
    r.check('Se puede agarrar y sacudir con el ratón', ph.grab, v => s.setPhys(ids, { grab: v })),
    ph.body === 'dynamic' ? r.range('Gelatina', ph.jelly, 0, 1, 0.05, (v, live) => { if (!live) s.setPhys(ids, { jelly: v }); }) : null,
    ph.body === 'dynamic' ? r.range('Balanceo al arrastrar', ph.swing, 0, 2, 0.05, (v, live) => { if (!live) s.setPhys(ids, { swing: v }); }) : null,
    ph.body === 'dynamic' ? r.check('Flota (sin gravedad, vuelve a ponerse derecho)', ph.float, v => s.setPhys(ids, { float: v })) : null,
    ph.body === 'dynamic' ? r.select('Al arrastrarlo con el ratón', ph.turn ?? (o.card ? 'face' : 'free'), [['face', 'Se inclina de frente (como una hoja, sin dejar de mirar al frente)'], ['free', 'Gira libre en 3D']], v => s.setPhys(ids, { turn: v as 'face' | 'free' })) : null,
    r.check('Zona (no choca: avisa cuando algo entra)', ph.zone, v => s.setPhys(ids, { zone: v, body: 'static' })));
  kids.push(r.check('Personaje (se mueve solo, con el ratón o con reglas)', !!c, v => s.setCharacter(ids, v)));
  if (c) {
    const set = (patch: Parameters<Studio3D['setCtrl']>[1]) => s.setCtrl(ids, patch);
    kids.push(
      r.select('Comportamiento', c.behavior, [['walk', 'Caminar en su dirección'], ['patrol', 'Ir y volver (patrulla)'], ['mouse', 'Ir hacia el ratón (clic o arrastrar en el suelo)'], ['idle', 'Quieto (sólo reglas y ratón)']], v => set({ behavior: v as typeof c.behavior })),
      r.range('Dirección', c.dir, -180, 180, 5, (v, live) => s.setCtrl(ids, { dir: v }, live), v => `${Math.round(v)}°`),
      r.btns(['Apuntar en el visor', () => { s.setTool('aim'); toast('Haz clic en el suelo hacia donde debe ir'); }, 'Clic en el suelo: el personaje mirará y caminará hacia ese punto']),
      r.range('Velocidad', c.speed, 0, 15, 0.1, (v, live) => s.setCtrl(ids, { speed: v }, live), v => `${v.toFixed(1)} m/s`),
      r.range('Salto', c.jump, 0, 20, 0.5, (v, live) => s.setCtrl(ids, { jump: v }, live), v => `${v.toFixed(1)} m/s`),
      c.behavior === 'patrol' ? r.range('Recorrido', c.dist, 0.5, 40, 0.5, (v, live) => s.setCtrl(ids, { dist: v }, live), v => `${v.toFixed(1)} m`) : null,
      r.range('Gelatina', c.wobble, 0, 1, 0.05, (v, live) => s.setCtrl(ids, { wobble: v }, live)),
      r.check('Siempre de pie (no vuelca)', c.upright, v => set({ upright: v })),
      r.text('Actor: tecla(s) para controlarlo en vivo', c.keys ?? '', v => set({ keys: v.trim().slice(0, 20) })),
      c.keys?.trim() ? r.select('Cuando controlas a otro', c.rest ?? 'stay', [['stay', 'Se queda quieto'], ['return', 'Vuelve a su sitio']], v => set({ rest: v as 'stay' | 'return' })) : null,
      c.keys?.trim() ? h('p', { class: 'ctl-help' }, `En vivo, pulsa ${c.keys.trim().toUpperCase()} para controlarlo: clic en la escena para mandarlo allí, WASD o flechas para caminar, Espacio para saltar. Los demás actores esperan.`) : null,
      h('div', { class: 'mo-btnrow' }, h('span', { class: 'mo-unit' }, 'Bloquear movimiento en'),
        ...(['x', 'y', 'z'] as const).map(a => { const cb = h('input', { type: 'checkbox', checked: c.lock[a] }); cb.addEventListener('change', () => set({ lock: { ...c.lock, [a]: cb.checked } })); return h('label', { class: 'mo-checkrow' }, cb, h('span', null, a.toUpperCase())); })));
  }
  // Grosor de los dibujos (volumen 3D).
  if (o.card) kids.unshift(r.range('Grosor del dibujo (volumen)', o.card.depth ?? 0, 0, 0.5, 0.01, (v, live) => s.setCardDepth(ids, v, live), v => (v > 0 ? `${Math.round(v * 100)} cm` : 'Plano')));
  kids.push(h('p', { class: 'ctl-help' }, 'Pulsa «En vivo» (F5) para ejecutar la escena: agarra y sacude lo dinámico con el ratón, Espacio hace saltar a los personajes.'));
  r.sec('Física y control (En vivo)', ...kids);
  if (o.card && pick) { tuberSection(r, s, o, pick); posesSection(r, s, o, pick); }
  if (o.card && o.parent && s.obj(o.parent)?.card) partSection(r, s, o);
  styleSection(r, s, o, ids);
}

const OBJ_STYLE_PARAMS: [keyof typeof OBJ_STYLE_LABELS, string][] = [];
const OBJ_STYLE_LABELS = { squiggle: 'Squiggle (líneas que tiemblan)', ink: 'Contorno de tinta', paint: 'Pintura al óleo', posterize: 'Posterizar', halftone: 'Semitono de cómic', pixel: 'Píxel art', scan: 'Líneas de TV' } as const;
for (const k of Object.keys(OBJ_STYLE_LABELS) as (keyof typeof OBJ_STYLE_LABELS)[]) OBJ_STYLE_PARAMS.push([k, OBJ_STYLE_LABELS[k]]);
/** Estilos listos para un objeto. */
const OBJ_PRESETS: [string, Partial<ReturnType<typeof defaultObjStyle>>][] = [
  ['Squiggle vision', { squiggle: 0.7, squigFps: 8, squigSize: 30, ink: 0.8, inkColor: '#1a1420', posterize: 0.3, paint: 0, halftone: 0, pixel: 0, scan: 0 }],
  ['Cómic', { squiggle: 0, ink: 0.9, inkColor: '#000000', halftone: 0.6, posterize: 0.5, paint: 0, pixel: 0, scan: 0 }],
  ['Óleo', { squiggle: 0, ink: 0, paint: 0.8, posterize: 0, halftone: 0, pixel: 0, scan: 0 }],
  ['Píxel art', { squiggle: 0, ink: 0, pixel: 0.4, posterize: 0.7, paint: 0, halftone: 0, scan: 0 }],
  ['Holograma', { squiggle: 0.2, squigFps: 24, squigSize: 80, scan: 0.9, ink: 0.5, inkColor: '#5ad1ff', posterize: 0, paint: 0, halftone: 0, pixel: 0 }],
];
/** Estilo propio (shaders) de un objeto: sólo él se ve así. */
function styleSection(r: Rows, s: Studio3D, o: Obj3, ids: string[]) {
  const st = { ...defaultObjStyle(), ...(o.style ?? {}) };
  const pre = h('select', { class: 'mo-sel', 'aria-label': 'Estilo del objeto' }, h('option', { value: '' }, 'Estilo listo para este objeto…'), ...OBJ_PRESETS.map(([l], i) => h('option', { value: String(i) }, l)));
  pre.addEventListener('change', () => { const p = OBJ_PRESETS[Number(pre.value)]; if (p) s.setStyle(ids, p[1]); });
  const on = styled(o.style);
  r.sec('Estilo del objeto (shaders)',
    h('p', { class: 'ctl-help' }, 'Sólo este objeto (o dibujo) se ve con el estilo; se suma al de la escena. Se ve en los modos Materiales y Render, en vivo y en los renders.'),
    pre,
    ...OBJ_STYLE_PARAMS.map(([k, l]) => r.range(l, st[k], 0, 1, 0.01, (v, live) => s.setStyle(ids, { [k]: v }, live))),
    st.squiggle > 0 ? r.range('Squiggle: dibujos por segundo', st.squigFps, 1, 30, 1, (v, live) => s.setStyle(ids, { squigFps: v }, live), v => `${Math.round(v)} fps`) : null,
    st.squiggle > 0 ? r.range('Squiggle: tamaño de la onda', st.squigSize, 5, 200, 1, (v, live) => s.setStyle(ids, { squigSize: v }, live), v => `${Math.round(v)} px`) : null,
    st.ink > 0 ? (() => { const i = h('input', { type: 'color', class: 'mo-color', value: st.inkColor }); i.addEventListener('change', () => s.setStyle(ids, { inkColor: i.value })); return h('div', { class: 'mo-prop' }, h('label', { class: 'mo-lab' }, 'Color de la tinta'), i); })() : null,
    on ? r.btns(['Quitar el estilo', () => s.setStyle(ids, null)]) : null);
  // Dibujo animado propio de este objeto (anula el de la escena).
  r.sec('Dibujo animado del objeto (cel shading y lineart)',
    h('p', { class: 'ctl-help' }, o.card ? 'En los dibujos, el lineart es el contorno de su silueta.' : 'Sólo este objeto; anula el de la escena. Se ve en los modos Materiales y Render, en vivo y en los renders.'),
    ...toonControls(r, o.style?.cel ?? null, o.style?.line ?? null, c => s.setStyle(ids, { cel: c }), (l, live) => s.setStyle(ids, { line: l }, live)));
}

/** Nivel del audio en vivo para el medidor del panel (lo pone la interfaz; null = sin audio). */
let meterSource: (() => { level: number; talking: boolean } | null) | null = null;
export function setMeterSource(fn: typeof meterSource) { meterSource = fn; }
/** Medidor del nivel de audio con la marca del umbral (se actualiza mientras se ve). */
function meter(threshold: number) {
  const bar = h('div', { class: 's3-meterbar' }), mark = h('div', { class: 's3-metermark', style: { left: `${Math.min(100, threshold * 100)}%` } });
  const el = h('div', { class: 's3-meter', title: 'Nivel del audio (la marca es el umbral para hablar)' }, bar, mark);
  const tick = () => {
    if (!el.isConnected) return;
    const v = meterSource?.() ?? null;
    bar.style.width = `${Math.round(Math.min(1, v?.level ?? 0) * 100)}%`;
    el.classList.toggle('on', !!v?.talking);
    el.classList.toggle('idle', !v);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return el;
}

/**
 * PNGTuber de un dibujo: boca abierta y ojos cerrados (imágenes que no cambian el
 * original), parpadeo y reacción al audio (rebote, aplastado, brillo).
 */
function tuberSection(r: Rows, s: Studio3D, o: Obj3, pick: PickArt) {
  const c = o.card!, tb = c.tuber;
  const set = (fn: (t: Tuber3) => void, label = 'PNGTuber', live = false) => s.setCard(o.id, x => { const t: Tuber3 = { ...defaultTuber(), ...(x.tuber ?? {}) }; fn(t); x.tuber = t; }, label, live);
  const imgRow = (label: string, tex: string | undefined, key: 'talk' | 'blink') => {
    const add = async (kind: 'image' | 'drawing') => { const a = await pick(kind); if (a) s.addTexture(a.src, `${o.name} · ${label}`, a.project, (id, sc) => { const x = sc.objects.find(y => y.id === o.id); if (x?.card) x.card.tuber = { ...defaultTuber(), ...(x.card.tuber ?? {}), [key]: id }; }, label); };
    const name = tex ? s.s.textures.find(t => t.id === tex)?.name ?? 'imagen' : '—';
    return h('div', { class: 's3-poserow' }, h('span', { class: 's3-posename', title: name }, `${label}: ${tex ? '✓' : '—'}`),
      h('button', { type: 'button', class: 'btn xs', on: { click: () => void add('drawing') } }, 'Dibujo…'),
      h('button', { type: 'button', class: 'btn xs', on: { click: () => void add('image') } }, 'Imagen…'),
      tex ? h('button', { type: 'button', class: 'icon sm', title: 'Quitar', 'aria-label': `Quitar ${label}`, on: { click: () => set(t => { delete t[key]; }) } }, '✕') : null);
  };
  const kids: (Node | null)[] = [r.check('Personaje PNGTuber (habla con el audio o el micrófono)', !!tb, v => s.setCard(o.id, x => { if (v) x.tuber = { ...defaultTuber(), ...(x.tuber ?? {}) }; else delete x.tuber; }, 'PNGTuber'))];
  if (tb) kids.push(
    h('p', { class: 'ctl-help' }, 'Al hablar se muestra la boca abierta y rebota; parpadea solo. Cada pose (expresión) puede tener su propia boca y ojos. El original no se modifica.'),
    imgRow('Boca abierta', tb.talk, 'talk'),
    imgRow('Ojos cerrados', tb.blink, 'blink'),
    r.range('Parpadeo cada', tb.blinkEvery, 0, 10, 0.5, (v, live) => set(t => { t.blinkEvery = v; }, 'Parpadeo', live), v => (v > 0 ? `${v.toFixed(1)} s` : 'Nunca')),
    r.range('Rebote al hablar', tb.bounce, 0, 1, 0.05, (v, live) => set(t => { t.bounce = v; }, 'Rebote', live)),
    r.range('Aplastado al hablar (squash)', tb.squash, 0, 1, 0.05, (v, live) => set(t => { t.squash = v; }, 'Aplastado', live)),
    r.range('Brillo al hablar', tb.glow, 0, 1, 0.05, (v, live) => set(t => { t.glow = v; }, 'Brillo', live)));
  r.sec('PNGTuber', ...kids);
}
/** Parte de un personaje (hija de otro dibujo): balanceo y punto de giro. */
function partSection(r: Rows, s: Studio3D, o: Obj3) {
  const pt = o.part;
  r.sec('Parte del personaje',
    r.check('Se balancea con el movimiento del personaje (pelo, orejas…)', !!pt, v => s.setPart([o.id], v ? { sway: pt?.sway ?? 0.6 } : null)),
    pt ? r.range('Balanceo', pt.sway, 0, 2, 0.05, (v, live) => { if (!live) s.setPart([o.id], { sway: v }); }) : null,
    pt ? r.range('Punto de giro: horizontal', pt.pivot?.[0] ?? 0.5, 0, 1, 0.01, (v, live) => { if (!live) s.setPart([o.id], { pivot: [v, pt.pivot?.[1] ?? 0] }); }, v => `${Math.round(v * 100)} %`) : null,
    pt ? r.range('Punto de giro: altura', pt.pivot?.[1] ?? 0, 0, 1, 0.01, (v, live) => { if (!live) s.setPart([o.id], { pivot: [pt.pivot?.[0] ?? 0.5, v] }); }, v => `${Math.round(v * 100)} %`) : null);
}

/**
 * Poses de un dibujo: otros dibujos o imágenes que se cambian en vivo pulsando una
 * tecla, con una transición (squash and stretch, volteo, giro, pop…), sin keyframes.
 */
function posesSection(r: Rows, s: Studio3D, o: Obj3, pick: PickArt) {
  const c = o.card!, poses = c.poses ?? [];
  const tr = c.trans ?? { type: 'squash' as TransType, dur: 0.45 };
  const add = async (kind: 'image' | 'drawing') => { const a = await pick(kind); if (a) { s.addPose(o.id, a.src, a.name, a.project); toast(`Pose «${a.name}» añadida`, 'ok'); } };
  const keyInput = (value: string, set: (v: string) => void, label: string) => {
    const i = h('input', { type: 'text', class: 'mo-num s3-keyin', value, maxlength: '12', 'aria-label': label, title: 'Tecla (una letra, número o nombre como F1)' });
    i.addEventListener('keydown', e => e.stopPropagation());
    i.addEventListener('change', () => set(i.value.trim()));
    return i;
  };
  const variant = (p: Pose3, i: number, key: 'talk' | 'blink', label: string, title: string) => h('button', { type: 'button', class: `btn xs${p[key] ? ' primary' : ''}`, title: p[key] ? `${title} — clic para cambiarla (Mayús + clic: quitarla)` : title, on: { click: async (e: Event) => {
    if ((e as MouseEvent).shiftKey && p[key]) { s.setCard(o.id, x => { delete x.poses![i][key]; }); return; }
    const a = await pick('image'); if (a) s.addTexture(a.src, `${p.name} · ${label}`, a.project, (id, sc) => { const x = sc.objects.find(y => y.id === o.id); const q = x?.card?.poses?.[i]; if (q) q[key] = id; }, label);
  } } }, label);
  const row = (name: string, key: string, setKey: (v: string) => void, extra: Node | null) => h('div', { class: 's3-poserow' }, h('span', { class: 's3-posename', title: name }, name), keyInput(key, setKey, `Tecla de ${name}`), extra);
  r.sec(`Poses del dibujo (${poses.length})`,
    h('p', { class: 'ctl-help' }, 'En vivo, pulsa la tecla de una pose para cambiar el dibujo con la transición elegida (sin keyframes).'),
    row('Original', c.baseKey ?? '0', v => s.setCard(o.id, x => { x.baseKey = v; }), null),
    ...poses.map((p, i) => row(p.name, p.key, v => s.setCard(o.id, x => { x.poses![i].key = v; }), h('span', { class: 's3-poseopts' },
      // PNGTuber: la boca abierta y los ojos cerrados de esta expresión.
      c.tuber ? variant(p, i, 'talk', 'Boca', 'Imagen de esta expresión hablando (boca abierta)') : null,
      c.tuber ? variant(p, i, 'blink', 'Ojos', 'Imagen de esta expresión con los ojos cerrados (parpadeo)') : null,
      h('button', { type: 'button', class: 'icon sm', title: 'Quitar la pose', 'aria-label': `Quitar ${p.name}`, on: { click: () => s.setCard(o.id, x => { x.poses!.splice(i, 1); }, 'Quitar pose') } }, '✕')))),
    r.btns(['+ Dibujo de YOSADRAW…', () => void add('drawing')], ['+ Imagen…', () => void add('image')]),
    r.select('Transición', tr.type, TRANS_TYPES, v => s.setCard(o.id, x => { x.trans = { ...tr, type: v as TransType }; })),
    tr.type !== 'cut' ? r.range('Duración', tr.dur, 0.1, 1.5, 0.05, (v, live) => s.setCard(o.id, x => { x.trans = { ...tr, dur: v }; }, 'Transición', live), v => `${v.toFixed(2)} s`) : null,
    h('div', { class: 's3-poserow' }, h('span', { class: 's3-posename' }, 'Siguiente pose'), keyInput(c.nextKey ?? '', v => s.setCard(o.id, x => { x.nextKey = v; }), 'Tecla para la siguiente pose'), null));
}

const color = (label: string, value: string, set: (v: string) => void) => { const i = h('input', { type: 'color', class: 'mo-color', value }); i.addEventListener('change', () => set(i.value)); return h('div', { class: 'mo-prop' }, h('label', { class: 'mo-lab' }, label), i); };
/** Controles de cel shading y lineart (escena u objeto). */
function toonControls(r: Rows, cel: Cel3 | null, line: Line3 | null, setCel: (c: Cel3 | null) => void, setLine: (l: Line3 | null, live?: boolean) => void): (Node | null)[] {
  const c = cel ?? defaultCel();
  const up = (patch: Partial<Cel3>) => setCel({ ...c, ...patch });
  const out: (Node | null)[] = [r.check('Cel shading (sombreado de dibujo animado)', !!cel, v => setCel(v ? c : null))];
  if (cel) out.push(
    r.range('Tonos', c.bands, 2, 6, 1, (v, live) => { if (!live) up({ bands: v }); }, v => `${Math.round(v)}`),
    r.range('Suavidad del borde', c.soft, 0, 1, 0.05, (v, live) => { if (!live) up({ soft: v }); }),
    r.select('Color de la sombra', c.shade, [['ambient', 'Reacciona al ambiente (luces y entorno)'], ['color', 'Color propio']], v => up({ shade: v as Cel3['shade'] })),
    c.shade === 'color' ? color('Color de la sombra', c.color, v => up({ color: v })) : null,
    r.range('Brillo de borde', c.rim, 0, 1, 0.05, (v, live) => { if (!live) up({ rim: v }); }),
    c.rim > 0 ? color('Color del brillo', c.rimColor, v => up({ rimColor: v })) : null);
  const l = line ?? { width: 0, color: '#111111' };
  out.push(r.range('Lineart (contorno de caricatura)', l.width, 0, 10, 0.5, (v, live) => setLine(v > 0 ? { ...l, width: v } : null, live), v => (v > 0 ? `${v} px` : 'Sin contorno')));
  if (line && line.width > 0) out.push(color('Color del lineart', l.color, v => setLine({ ...l, color: v })));
  return out;
}

/** Audio de la escena (PNGTuber): pistas, micrófono, umbral para hablar y medidor. */
export function audioSection(r: Rows, s: Studio3D) {
  const au = { ...defaultAudio(), ...(s.scene.audio ?? {}) };
  const add = async () => {
    const files = await pickFiles('audio/*,.mp3,.ogg,.wav,.m4a,.aac,.webm', true);
    for (const f of files) {
      if (f.size > 25 * 1024 * 1024) { toast(`«${f.name}» es muy grande (máx. 25 MB)`, 'error'); continue; }
      const src = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(fr.error); fr.readAsDataURL(f); });
      s.setAudio(a => { a.tracks.push({ id: newId('au'), name: f.name.replace(/\.[^.]+$/, '') || 'Audio', src, auto: a.tracks.length === 0, loop: false, volume: 1 }); }, 'Añadir audio');
    }
  };
  const row = (t: Track3, i: number) => {
    const chk = (label: string, v: boolean, fn: (on: boolean) => void) => { const cb = h('input', { type: 'checkbox', checked: v }); cb.addEventListener('change', () => fn(cb.checked)); return h('label', { class: 'mo-checkrow', title: label }, cb, h('span', null, label)); };
    return h('div', { class: 's3-poserow' }, h('span', { class: 's3-posename', title: t.name }, t.name),
      chk('Al empezar', t.auto, v => s.setAudio(a => { a.tracks[i].auto = v; })),
      chk('Repetir', t.loop, v => s.setAudio(a => { a.tracks[i].loop = v; })),
      h('button', { type: 'button', class: 'icon sm', title: 'Quitar el audio', 'aria-label': `Quitar ${t.name}`, on: { click: () => s.setAudio(a => { a.tracks.splice(i, 1); }, 'Quitar audio') } }, '✕'));
  };
  r.sec(`Audio (PNGTuber) ${au.tracks.length ? `(${au.tracks.length})` : ''}`,
    h('p', { class: 'ctl-help' }, 'Los personajes PNGTuber hablan con el micrófono o con un audio: boca abierta, rebote y sucesos «al empezar a hablar», «al callarse» y «sonido fuerte» para los disparadores. Lo que suena se graba con el vídeo.'),
    ...au.tracks.map(row),
    r.btns(['+ Audio (MP3, WAV, OGG…)', () => void add()]),
    r.check('Usar el micrófono en vivo (tu voz mueve al personaje)', au.mic, v => s.setAudio(a => { a.mic = v; }, 'Micrófono')),
    r.range('Umbral para hablar', au.threshold, 0.01, 0.5, 0.01, (v, live) => s.setAudio(a => { a.threshold = v; }, 'Umbral', live), v => `${Math.round(v * 100)} %`),
    meter(au.threshold),
    r.range('Mantener la boca abierta', au.hold, 0, 0.6, 0.02, (v, live) => s.setAudio(a => { a.hold = v; }, 'Boca', live), v => `${Math.round(v * 1000)} ms`),
    r.range('Sonido fuerte a partir de', au.loud, 0.1, 1, 0.05, (v, live) => s.setAudio(a => { a.loud = v; }, 'Sonido fuerte', live), v => `${Math.round(v * 100)} %`),
    h('p', { class: 'ctl-help' }, 'El medidor se mueve mientras la escena está en vivo; la marca es el umbral.'));
}

/** Cel shading y lineart de toda la escena. */
function toonSection(r: Rows, s: Studio3D) {
  const fx = s.fx;
  r.sec('Dibujo animado (cel shading y lineart)',
    h('p', { class: 'ctl-help' }, 'Toda la escena como una caricatura. Se ve en vivo, en la vista previa de efectos y en los renders con efectos. Cada objeto puede tener el suyo en Objeto → «Dibujo animado del objeto».'),
    ...toonControls(r, fx.cel, fx.line, c => s.setFx({ cel: c }), (l, live) => s.setFx({ line: l }, live)),
    r.btns(['Caricatura', () => s.setFx({ cel: { ...defaultCel(), bands: 2, soft: 0.05 }, line: { width: 3, color: '#151018' }, preview: true })], ['Anime', () => s.setFx({ cel: { ...defaultCel(), bands: 3, soft: 0.15, shade: 'color', color: '#6b5b9a', rim: 0.35, rimColor: '#fff4e0' }, line: { width: 1.5, color: '#2a2030' }, preview: true })], ['Quitar', () => s.setFx({ cel: null, line: null })]));
}

const EVENTS: [EventType, string][] = [['start', 'Al empezar'], ['time', 'En el segundo…'], ['every', 'Cada … segundos'], ['key', 'Al pulsar la tecla…'], ['click', 'Al hacer clic en…'], ['collide', 'Al chocar…'], ['enter', 'Al entrar en la zona…'], ['grab', 'Al agarrar…'], ['release', 'Al soltar…'], ['talk', 'Al empezar a hablar (audio)'], ['quiet', 'Al callarse (audio)'], ['loud', 'Con un sonido fuerte (audio)']];
const ACTS: [ActType, string][] = [['impulse', 'Empujar'], ['jump', 'Saltar'], ['setdir', 'Cambiar dirección'], ['speed', 'Cambiar velocidad'], ['behavior', 'Cambiar comportamiento'], ['color', 'Cambiar color'], ['light', 'Luz (intensidad / color)'], ['fx', 'Efecto visual'], ['shake', 'Temblor de cámara'], ['spawn', 'Soltar una copia'], ['hide', 'Ocultar'], ['show', 'Mostrar'], ['gravity', 'Gravedad'], ['slowmo', 'Cámara lenta'], ['stop', 'Parar'], ['script', 'Código'], ['pose', 'Cambiar de expresión (pose)'], ['audio', 'Reproducir o parar audio']];
const FX_PARAMS: [keyof Fx3, string, number][] = [['godrays', 'Luz volumétrica', 2], ['cones', 'Conos de luz', 2], ['bloom', 'Resplandor (bloom)', 3], ['chroma', 'Aberración cromática', 3], ['glitch', 'Glitch', 1], ['tintAmt', 'Tinte de color', 1], ['vignette', 'Viñeta', 1], ['grain', 'Grano', 1], ['ao', 'Volumen (oclusión ambiental)', 1]];

/** Plantillas de reglas para empezar rápido. */
function presets(s: Studio3D): [string, () => Rule3][] {
  const ch = s.scene.objects.find(o => o.ctrl)?.id ?? '', zone = s.scene.objects.find(o => o.phys?.zone)?.id ?? '', dyn = s.scene.objects.find(o => o.phys?.body === 'dynamic' && !o.ctrl)?.id ?? '';
  const light = s.scene.objects.find(o => o.light?.type === 'point' || o.light?.type === 'spot')?.id ?? '';
  const tub = s.scene.objects.find(o => o.card?.tuber)?.id ?? '';
  const R = (name: string, on: Rule3['on'], acts: Act3[]): Rule3 => ({ id: sid('ru'), name, enabled: true, once: false, on, do: acts });
  return [
    ['Espacio: saltar', () => R('Espacio: saltar', { type: 'key', key: ' ' }, [{ type: 'jump', target: ch, value: 6 }])],
    ['Al chocar: glitch y temblor', () => R('Choque: glitch', { type: 'collide', a: ch }, [{ type: 'fx', target: '', param: 'glitch', value: 0.8, dur: 0.1 }, { type: 'shake', target: '', value: 0.25, dur: 0.4 }, { type: 'fx', target: '', param: 'chroma', value: 1.5, dur: 0.1 }])],
    ['Cada 2 s: soltar una copia', () => R('Lluvia de copias', { type: 'every', t: 2 }, [{ type: 'spawn', target: dyn, v: [0, 4, 0] }])],
    ['Al entrar en la zona: luz roja', () => R('Zona: alarma', { type: 'enter', a: zone }, [{ type: 'light', target: light, value: 2, color: '#ff3030', dur: 0.3 }, { type: 'fx', target: '', param: 'tintAmt', value: 0.5, dur: 0.5 }])],
    ['Tecla G: gravedad lunar', () => R('Gravedad lunar', { type: 'key', key: 'g' }, [{ type: 'gravity', target: '', value: 1.6 }, { type: 'slowmo', target: '', value: 0.6, dur: 3 }])],
    ['PNGTuber: al hablar, brillo y resplandor', () => R('Hablar: brillo', { type: 'talk' }, [{ type: 'fx', target: '', param: 'bloom', value: 0.8, dur: 0.15 }])],
    ['PNGTuber: al callarse, quitar el resplandor', () => R('Callar: sin brillo', { type: 'quiet' }, [{ type: 'fx', target: '', param: 'bloom', value: 0.2, dur: 0.4 }])],
    ['PNGTuber: grito → sorpresa, temblor y glitch', () => R('Grito', { type: 'loud' }, [...(tub ? [{ type: 'pose' as const, target: tub, param: s.obj(tub)?.card?.poses?.[0]?.name ?? '' }] : []), { type: 'shake', target: '', value: 0.25, dur: 0.35 }, { type: 'fx', target: '', param: 'glitch', value: 0.6, dur: 0.12 }, { type: 'fx', target: '', param: 'chroma', value: 1.2, dur: 0.12 }])],
    ['PNGTuber: al callarse, volver a la expresión normal', () => R('Volver a normal', { type: 'quiet' }, tub ? [{ type: 'pose', target: tub }] : [])],
    ['A los 3 s: girar y acelerar', () => R('Giro', { type: 'time', t: 3 }, [{ type: 'setdir', target: ch, value: 90 }, { type: 'speed', target: ch, value: 4 }])],
  ];
}

export const SCRIPT_EXAMPLE = `// Programa de la escena: se ejecuta al pulsar «En vivo».
// on(suceso, [objeto o tecla], función) · every(s, f) · after(s, f) · obj(nombre)
// light(nombre) · fx(efecto, valor, segundos) · shake(fuerza, s) · gravity(g)
// slowmo(k, s) · random(a, b) · time() · log(texto) · stop()

const heroe = obj('Cubo');

on('key', 'w', () => heroe?.impulse(0, 0, -3));
on('key', 's', () => heroe?.impulse(0, 0, 3));
on('collide', 'Cubo', e => {
  fx('glitch', 0.7, 0.1);
  shake(0.2, 0.3);
  after(0.4, () => fx('glitch', 0, 0.3));
});
every(1, () => fx('bloom', random(0.3, 1.2), 0.8));
`;

/** Pestaña «Vivo»: efectos en tiempo real, reglas (disparadores) y programa. */
const STYLE_PARAMS: [keyof Fx3, string][] = [['squiggle', 'Squiggle (líneas que tiemblan)'], ['ink', 'Contorno de tinta'], ['paint', 'Pintura al óleo'], ['posterize', 'Posterizar (pocos colores)'], ['halftone', 'Semitono de cómic'], ['pixel', 'Píxel art'], ['paper', 'Papel'], ['scan', 'Líneas de TV']];
const STYLE_OFF: Partial<Fx3> = { squiggle: 0, ink: 0, paint: 0, posterize: 0, halftone: 0, pixel: 0, paper: 0, scan: 0 };
/** Estilos de render (shaders) listos para usar. */
export const STYLE_PRESETS: [string, Partial<Fx3>][] = [
  ['Sin estilo', STYLE_OFF],
  ['Squiggle vision', { ...STYLE_OFF, squiggle: 0.6, squigFps: 8, squigSize: 40, ink: 0.7, inkColor: '#1a1420', posterize: 0.25, paper: 0.35 }],
  ['Boceto a lápiz', { ...STYLE_OFF, squiggle: 0.35, squigFps: 6, squigSize: 25, ink: 1, inkColor: '#2b2b33', paper: 0.8, posterize: 0.6 }],
  ['Cómic', { ...STYLE_OFF, ink: 0.85, inkColor: '#000000', halftone: 0.55, posterize: 0.5 }],
  ['Óleo', { ...STYLE_OFF, paint: 0.7, paper: 0.4 }],
  ['Píxel art', { ...STYLE_OFF, pixel: 0.35, posterize: 0.7 }],
  ['VHS', { ...STYLE_OFF, scan: 0.7, squiggle: 0.15, squigFps: 24, squigSize: 120, chroma: 0.6, glitch: 0.12, grain: 0.3 }],
];

export function livePanel(r: Rows, s: Studio3D, onPlay: () => void) {
  const fx = s.fx;
  const objs: [string, string][] = [['', '(el objeto del suceso)'], ...s.scene.objects.filter(o => !o.folder).map(o => [o.id, o.name] as [string, string])];
  r.sec('En vivo', r.btns(['▶ Ejecutar (F5)', onPlay, 'La escena se ejecuta como un videojuego: física, personajes, reglas y efectos']),
    h('p', { class: 'ctl-help' }, 'Ratón: agarra y sacude lo dinámico, arrastra en el suelo para guiar a los personajes «hacia el ratón». Espacio: saltar. Esc: parar. Mientras corre puedes cambiar los efectos, grabar keyframes o grabar vídeo.'));
  const fxRow = (k: keyof Fx3, label: string, max: number) => r.range(label, fx[k] as number, 0, max, 0.01, (v, live) => s.setFx({ [k]: v } as Partial<Fx3>, live));
  r.sec('Efectos en tiempo real',
    r.check('Ver los efectos también al editar (modos Materiales y Render)', fx.preview, v => s.setFx({ preview: v })),
    ...FX_PARAMS.map(([k, l, max]) => fxRow(k, l, max)),
    (() => { const i = h('input', { type: 'color', class: 'mo-color', value: fx.godColor }); i.addEventListener('change', () => s.setFx({ godColor: i.value })); return h('div', { class: 'mo-prop' }, h('label', { class: 'mo-lab' }, 'Color de la luz volumétrica'), i); })(),
    (() => { const i = h('input', { type: 'color', class: 'mo-color', value: fx.tint }); i.addEventListener('change', () => s.setFx({ tint: i.value })); return h('div', { class: 'mo-prop' }, h('label', { class: 'mo-lab' }, 'Color del entorno (tinte)'), i); })(),
    r.select('Sombras', String(fx.shadows), [['0', 'Sin sombras'], ['1', 'Básicas'], ['2', 'Buenas'], ['3', 'Muy nítidas']], v => s.setFx({ shadows: Number(v) as Fx3['shadows'] })),
    r.select('Calidad', fx.quality, [['low', 'Baja (más FPS)'], ['medium', 'Media'], ['high', 'Alta']], v => s.setFx({ quality: v as Fx3['quality'] })),
    r.check('Calidad adaptativa (baja sola si van pocos FPS)', fx.adaptive, v => s.setFx({ adaptive: v })),
    r.btns(['Quitar todos los efectos', () => s.setFx({ godrays: 0, cones: 0, bloom: 0, chroma: 0, glitch: 0, tintAmt: 0, vignette: 0, grain: 0, ao: 0 })], ['Cinemático', () => s.setFx({ godrays: 1, cones: 0.6, bloom: 0.5, vignette: 0.45, grain: 0.15, tintAmt: 0.15, tint: '#ffd9a8' })], ['Ciberpunk', () => s.setFx({ bloom: 1.2, chroma: 0.8, glitch: 0.15, tintAmt: 0.35, tint: '#c48bff', vignette: 0.4, cones: 1 })]));
  const styleRow = (k: keyof Fx3, label: string) => r.range(label, fx[k] as number, 0, 1, 0.01, (v, live) => s.setFx({ [k]: v } as Partial<Fx3>, live));
  const preset = h('select', { class: 'mo-sel', 'aria-label': 'Estilo' }, h('option', { value: '' }, 'Estilo listo…'), ...STYLE_PRESETS.map(([l], i) => h('option', { value: String(i) }, l)));
  preset.addEventListener('change', () => { const p = STYLE_PRESETS[Number(preset.value)]; if (p) s.setFx({ ...p[1], preview: true }); });
  r.sec('Estilo (shaders)',
    h('p', { class: 'ctl-help' }, 'Cambia el aspecto de todo lo que se ve: en vivo, en la vista previa (si está activada) y en los renders de imagen, MP4 y GIF.'),
    preset,
    ...STYLE_PARAMS.map(([k, l]) => styleRow(k, l)),
    fx.squiggle > 0 ? r.range('Squiggle: dibujos por segundo', fx.squigFps, 1, 30, 1, (v, live) => s.setFx({ squigFps: v }, live), v => `${Math.round(v)} fps`) : null,
    fx.squiggle > 0 ? r.range('Squiggle: tamaño de la onda', fx.squigSize, 5, 200, 1, (v, live) => s.setFx({ squigSize: v }, live), v => `${Math.round(v)} px`) : null,
    fx.ink > 0 ? (() => { const i = h('input', { type: 'color', class: 'mo-color', value: fx.inkColor }); i.addEventListener('change', () => s.setFx({ inkColor: i.value })); return h('div', { class: 'mo-prop' }, h('label', { class: 'mo-lab' }, 'Color de la tinta'), i); })() : null);
  toonSection(r, s);
  audioSection(r, s);
  r.sec('Física de la escena',
    r.range('Gravedad', fx.gravity, 0, 30, 0.1, (v, live) => s.setFx({ gravity: v }, live), v => `${v.toFixed(1)} m/s²`),
    r.check('Suelo infinito (y = 0)', fx.ground, v => s.setFx({ ground: v })),
    r.check('Con un actor elegido, el clic sólo lo mueve a él (no agarra objetos)', fx.actorClick !== false, v => s.setFx({ actorClick: v })),
    r.btns(['Hacer dinámicos los elegidos', () => s.setPhys(s.selected.map(o => o.id), { body: 'dynamic' })], ['Estáticos', () => s.setPhys(s.selected.map(o => o.id), { body: 'static' })], ['Personajes', () => s.setCharacter(s.selected.map(o => o.id), true)]));
  // Reglas.
  const rules = s.scene.rules ?? [];
  const pre = h('select', { class: 'mo-sel', 'aria-label': 'Añadir regla' }, h('option', { value: '' }, '+ Regla desde plantilla…'), h('option', { value: '__new' }, 'Regla vacía'), ...presets(s).map(([l], i) => h('option', { value: String(i) }, l)));
  pre.addEventListener('change', () => { const v = pre.value; if (!v) return; if (v === '__new') s.addRule({ id: sid('ru'), name: `Regla ${rules.length + 1}`, enabled: true, once: false, on: { type: 'start' }, do: [] }); else s.addRule(presets(s)[Number(v)][1]()); });
  r.sec(`Disparadores (${rules.length})`, pre, ...rules.map(rule => ruleCard(r, s, rule, objs)), rules.length ? null : h('p', { class: 'ctl-help' }, 'Cuando pase algo (tecla, choque, clic, entrar en una zona, tiempo), haz algo (empujar, saltar, luz, efecto, temblor, copias…).'));
  // Programa.
  const ta = h('textarea', { class: 's3-code', rows: '12', spellcheck: 'false', 'aria-label': 'Programa de la escena' }, s.scene.script ?? '');
  ta.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Tab') { e.preventDefault(); const p = ta.selectionStart; ta.setRangeText('  ', p, ta.selectionEnd, 'end'); } });
  ta.addEventListener('change', () => s.setScript(ta.value));
  r.sec('Programa (JavaScript)', ta,
    r.btns(['Guardar', () => s.setScript(ta.value)], ['Ejemplo', () => { ta.value = SCRIPT_EXAMPLE; s.setScript(ta.value); }], ['Probar', () => { s.setScript(ta.value); onPlay(); }]),
    h('p', { class: 'ctl-help' }, 'on(suceso, objeto o tecla, función) — sucesos: start, key, click, collide, enter, grab, release, talk (empieza a hablar), quiet (se calla), loud (sonido fuerte). obj("Nombre") da .pos, .vel, .impulse(x,y,z), .jump(v), .dir(grados), .speed(v), .goTo(x,z), .color("#f00", s), .hide(), .show(), .spawn(x,y,z), .pose(n o "nombre"). audio.level, audio.talking, audio.play("pista"), audio.stop(), audio.mic(true). También every, after, light("Nombre").intensity(k, s), fx("glitch", 0.5, s), shake, gravity, slowmo, random, time, log y stop.'));
}

function ruleCard(r: Rows, s: Studio3D, rule: Rule3, objs: [string, string][]) {
  const up = (fn: (x: Rule3) => void) => s.updateRule(rule.id, fn);
  const sel = (value: string, opts: [string, string][], set: (v: string) => void, label: string) => { const e = h('select', { class: 'mo-sel', 'aria-label': label }, ...opts.map(([v, l]) => h('option', { value: v, selected: v === value }, l))); e.addEventListener('change', () => set(e.value)); return e; };
  const num = (value: number | undefined, set: (v: number) => void, label: string, step = 0.1) => { const i = h('input', { type: 'number', class: 'mo-num', value: String(value ?? 0), step: String(step), 'aria-label': label, title: label }); i.addEventListener('keydown', e => e.stopPropagation()); i.addEventListener('change', () => { const v = Number(i.value.replace(',', '.')); if (Number.isFinite(v)) set(v); }); return i; };
  const txt = (value: string, set: (v: string) => void, label: string, w = 70) => { const i = h('input', { type: 'text', value, 'aria-label': label, title: label, style: { width: `${w}px` } }); i.addEventListener('keydown', e => e.stopPropagation()); i.addEventListener('change', () => set(i.value)); return i; };
  const objNoSelf: [string, string][] = [['', 'cualquiera'], ...objs.slice(1)];
  const on = rule.on;
  const when = h('div', { class: 's3-rulewhen' }, h('b', null, 'Cuando '),
    sel(on.type, EVENTS, v => up(x => { x.on = { type: v as EventType, t: v === 'every' ? 1 : v === 'time' ? 2 : undefined }; }), 'Suceso'),
    on.type === 'time' || on.type === 'every' ? num(on.t, v => up(x => { x.on.t = Math.max(0, v); }), 'Segundos') : null,
    on.type === 'key' ? txt(on.key === ' ' ? 'Espacio' : on.key ?? '', v => up(x => { x.on.key = v.toLowerCase() === 'espacio' ? ' ' : v.slice(0, 1).toLowerCase(); }), 'Tecla', 60) : null,
    ['click', 'collide', 'enter', 'grab', 'release'].includes(on.type) ? sel(on.a ?? '', objNoSelf, v => up(x => { x.on.a = v; }), 'Objeto') : null,
    on.type === 'collide' || on.type === 'enter' ? h('span', null, ' con ') : null,
    on.type === 'collide' || on.type === 'enter' ? sel(on.b ?? '', objNoSelf, v => up(x => { x.on.b = v; }), 'Con') : null);
  const acts = rule.do.map((a, i) => {
    const ua = (fn: (x: Act3) => void) => up(x => fn(x.do[i]));
    const p: (Node | null)[] = [sel(a.type, ACTS, v => ua(x => { x.type = v as ActType; }), 'Acción')];
    if (!['fx', 'shake', 'gravity', 'slowmo', 'stop', 'script', 'audio'].includes(a.type)) p.push(sel(a.target, objs, v => ua(x => { x.target = v; }), 'Objeto'));
    if (a.type === 'pose') { const o = a.target ? s.obj(a.target) : null; const ps = o?.card?.poses ?? []; p.push(sel(a.param ?? '', [['', 'Original'], ...ps.map(x => [x.name, x.name] as [string, string])], v => ua(x => { x.param = v; }), 'Expresión')); }
    if (a.type === 'audio') { const ts = s.scene.audio?.tracks ?? []; p.push(sel(a.param ?? '', [['', '(todas)'], ...ts.map(t => [t.name, t.name] as [string, string])], v => ua(x => { x.param = v; }), 'Audio'), sel(String((a.value ?? 1) > 0 ? 1 : 0), [['1', 'Reproducir'], ['0', 'Parar']], v => ua(x => { x.value = Number(v); }), 'Qué hacer')); }
    const v3 = () => { const v = a.v ?? [0, 5, 0]; return (['x', 'y', 'z'] as const).map((n, k) => num(v[k], val => ua(x => { const w = [...(x.v ?? [0, 5, 0])] as [number, number, number]; w[k] = val; x.v = w; }), n.toUpperCase())); };
    if (a.type === 'impulse' || a.type === 'spawn') p.push(...v3());
    if (['jump', 'setdir', 'speed', 'gravity', 'slowmo', 'shake'].includes(a.type)) p.push(num(a.value, v => ua(x => { x.value = v; }), 'Valor'));
    if (a.type === 'behavior') p.push(sel(a.param ?? 'walk', [['walk', 'Caminar'], ['patrol', 'Patrulla'], ['mouse', 'Hacia el ratón'], ['idle', 'Quieto']], v => ua(x => { x.param = v; }), 'Comportamiento'));
    if (a.type === 'fx') p.push(sel(a.param ?? 'glitch', FX_PARAMS.map(([k, l]) => [k, l]), v => ua(x => { x.param = v; }), 'Efecto'), num(a.value, v => ua(x => { x.value = v; }), 'Valor', 0.05));
    if (a.type === 'light') p.push(num(a.value, v => ua(x => { x.value = v; }), 'Intensidad (×)', 0.1));
    if (a.type === 'color' || a.type === 'light') { const c = h('input', { type: 'color', value: a.color ?? '#ff4040' }); c.addEventListener('change', () => ua(x => { x.color = c.value; })); p.push(c); }
    if (['color', 'light', 'fx', 'shake', 'slowmo'].includes(a.type)) p.push(num(a.dur, v => ua(x => { x.dur = Math.max(0, v); }), 'Duración (s)'));
    if (a.type === 'script') { const t = h('textarea', { class: 's3-code', rows: '3', spellcheck: 'false', 'aria-label': 'Código' }, a.code ?? 'self?.impulse(0, 6, 0);'); t.addEventListener('keydown', e => e.stopPropagation()); t.addEventListener('change', () => ua(x => { x.code = t.value; })); p.push(t); }
    p.push(h('button', { type: 'button', class: 'icon xs', title: 'Quitar acción', 'aria-label': 'Quitar acción', html: '×', on: { click: () => up(x => { x.do.splice(i, 1); }) } }));
    return h('div', { class: 's3-ruleact' }, h('b', null, i ? 'y ' : 'hacer '), ...p);
  });
  const name = txt(rule.name, v => up(x => { x.name = v.slice(0, 40) || x.name; }), 'Nombre de la regla', 140);
  const en = h('input', { type: 'checkbox', checked: rule.enabled, title: 'Activa' }); en.addEventListener('change', () => up(x => { x.enabled = en.checked; }));
  const once = h('input', { type: 'checkbox', checked: rule.once, title: 'Sólo la primera vez' }); once.addEventListener('change', () => up(x => { x.once = once.checked; }));
  void r;
  return h('div', { class: `s3-rule${rule.enabled ? '' : ' off'}` },
    h('div', { class: 's3-rulehead' }, en, name, h('label', { class: 'mo-checkrow', title: 'Sólo la primera vez' }, once, h('span', null, '1 vez')), h('button', { type: 'button', class: 'icon xs', title: 'Borrar regla', 'aria-label': 'Borrar regla', html: '🗑', on: { click: () => s.removeRule(rule.id) } })),
    when, ...acts,
    h('button', { type: 'button', class: 'btn xs', on: { click: () => up(x => { x.do.push({ type: 'impulse', target: '', v: [0, 5, 0] }); }) } }, '+ Acción'));
}
export { defaultFx, defaultCtrl };
