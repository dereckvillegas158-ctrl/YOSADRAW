import { transformItem } from '../../doc/items';
import type { ToolHandler } from '../../engine/CanvasEngine';
import * as M from '../../anim/model';
import { h, toast } from '../dom';
import { modal } from '../modal';
import type { AnimStudio } from './AnimStudio';

/** Diálogo «Interpolar movimiento» a partir del dibujo actual de la pista activa. */
export async function openTween(s: AnimStudio) {
  const a = s.anim, l = s.active;
  if (!a) return;
  const sel = s.selection();
  const cel = sel.length === 1 ? s.doc.layer(sel[0].layer)?.cels?.find(c => c.id === sel[0].cel) : M.celAt(l, a.current);
  const layerId = sel.length === 1 ? sel[0].layer : l.id;
  if (!cel || !cel.content.items.length) { toast('Elige un fotograma con dibujo en una pista animada: se interpola a partir de él'); return; }
  const f = (label: string, value: string, attrs: Record<string, string> = {}) => {
    const input = h('input', { type: 'number', value, ...attrs, 'aria-label': label });
    return { input, el: h('label', { class: 'ap-field' }, h('span', null, label), input) };
  };
  const frames = f('Duración (fotogramas)', String(a.fps), { min: '1', max: '2000' });
  const step = h('select', { 'aria-label': 'Exposición' }, ...[[1, 'En unos (cada fotograma)'], [2, 'En doses'], [3, 'En treses'], [4, 'En cuatros']].map(([v, t]) => h('option', { value: String(v) }, String(t))));
  const dx = f('Desplazar X (px)', '200'), dy = f('Desplazar Y (px)', '0');
  const rot = f('Girar (°)', '0'), scale = f('Escala final (%)', '100', { min: '1' }), op = f('Opacidad final (%)', '100', { min: '0', max: '100' });
  const ease = h('select', { 'aria-label': 'Curva' }, ...[['inout', 'Suave (entra y sale)'], ['out', 'Frenando'], ['in', 'Acelerando'], ['linear', 'Lineal']].map(([v, t]) => h('option', { value: v }, t)));
  const guides = a.guides.filter(g => g.pts.length >= 4);
  const guide = h('select', { 'aria-label': 'Guía' }, h('option', { value: '' }, 'En línea recta (Desplazar X/Y)'), ...guides.map(g => h('option', { value: g.id }, `Seguir «${g.name}»`)));
  const orient = h('input', { type: 'checkbox' });
  const res = await modal<'ok'>({
    title: 'Interpolar movimiento',
    body: [
      h('p', { class: 'muted' }, `Genera dibujos intermedios a partir del fotograma ${cel.start + 1} de «${s.doc.layer(layerId)!.name}». Son copias transformadas: luego puedes retocar cada una. Lo que hay detrás se desplaza para hacer sitio.`),
      h('div', { class: 'ap-row2' }, frames.el, h('label', { class: 'ap-field' }, h('span', null, 'Exposición'), step)),
      h('label', { class: 'ap-field' }, h('span', null, 'Recorrido'), guide),
      h('label', { class: 'switch' }, orient, h('span', { class: 'track' }), h('span', null, 'Orientar según la guía')),
      h('div', { class: 'ap-row2' }, dx.el, dy.el),
      h('div', { class: 'ap-row2' }, rot.el, scale.el),
      h('div', { class: 'ap-row2' }, op.el, h('label', { class: 'ap-field' }, h('span', null, 'Curva'), ease)),
      guides.length ? null as unknown as Node : h('p', { class: 'ctl-help' }, 'Para seguir un recorrido curvo, dibuja antes una guía (botón de guía en la línea de tiempo).'),
    ].filter(Boolean),
    actions: [{ label: 'Cancelar', value: null as never, kind: 'ghost' }, { label: 'Interpolar', value: 'ok', kind: 'primary' }],
  });
  if (res !== 'ok') return;
  const g = a.guides.find(x => x.id === guide.value);
  s.run(() => M.cmdTween(s.doc, layerId, cel.id, {
    frames: Number(frames.input.value) || a.fps, step: Number(step.value), dx: Number(dx.input.value) || 0, dy: Number(dy.input.value) || 0,
    rotate: Number(rot.input.value) || 0, scale: Math.max(0.01, (Number(scale.input.value) || 100) / 100), opacity: Math.min(1, Math.max(0, (Number(op.input.value) ?? 100) / 100)),
    ease: ease.value as M.Ease, guide: g?.pts ?? null, orient: orient.checked,
  }, transformItem), 'No se pudo interpolar');
}

/**
 * Hoja de exposición (X-sheet): una fila por fotograma y una columna por pista
 * animada, más diálogo, boca y acción. Se edita: duración de cada dibujo, bocas
 * del clip de audio y notas de acción; clic en una celda va a ese fotograma.
 */
export function openXSheet(s: AnimStudio) {
  const a0 = s.anim;
  if (!a0) return;
  const PAGE = 120;
  let page = Math.floor(a0.current / PAGE);
  const body = h('div', { class: 'xs-wrap' });
  const pager = h('div', { class: 'xs-pager' });
  const render = () => {
    const a = s.anim;
    if (!a) return;
    const doc = s.doc;
    const tracks = [...doc.layers].reverse().filter(l => l.cels);
    const clip = s.clip() ?? a.audio.find(c => c.dialogue.length || c.mouth.length) ?? a.audio[0] ?? null;
    const f0 = page * PAGE, f1 = Math.min(a.length, f0 + PAGE);
    const thead = h('tr', null, h('th', null, 'Fot.'), ...tracks.map(l => h('th', { title: l.name }, l.name)), h('th', null, 'Diálogo'), h('th', null, 'Boca'), h('th', null, 'Acción'));
    const rows: HTMLElement[] = [];
    for (let f = f0; f < f1; f++) {
      const cells: HTMLElement[] = [h('td', { class: `xs-f ${f === a.current ? 'cur' : ''} ${f % a.fps === 0 ? 'sec' : ''}` }, String(f + 1))];
      for (const l of tracks) {
        const c = M.celAt(l, f);
        const td = h('td', { class: `xs-cel ${c ? (c.start === f ? 'start' : 'hold') : 'blank'} ${c?.key && c.start === f ? 'key' : ''}`, on: { click: () => { s.engine.setActiveLayer(l.id); s.go(f); render(); } } });
        if (c && c.start === f) {
          const n = l.cels!.indexOf(c) + 1;
          const len = h('input', { type: 'number', min: '1', value: String(c.length), title: 'Duración del dibujo (fotogramas)', 'aria-label': `Duración del dibujo ${n}` });
          len.addEventListener('click', e => e.stopPropagation());
          len.addEventListener('change', () => { s.setLength({ layer: l.id, cel: c.id }, Number(len.value)); render(); });
          td.append(h('span', { class: 'xs-n' }, c.label || String(n)), len);
        } else if (c) td.textContent = '│';
        cells.push(td);
      }
      const dl = clip?.dialogue.find(d => f >= d.start && f <= d.end);
      cells.push(h('td', { class: 'xs-dlg' }, dl && dl.start === f ? dl.text : dl ? '┆' : ''));
      // Boca: la vigente en este fotograma (editable si hay clip).
      const mk = clip ? [...clip.mouth].reverse().find(m => m.frame <= f) : null;
      const exact = clip?.mouth.find(m => m.frame === f);
      const mouth = h('select', { class: `xs-mouth ${exact ? 'set' : ''}`, disabled: !clip, 'aria-label': `Boca en el fotograma ${f + 1}` },
        h('option', { value: '' }, mk && !exact ? `(${mk.shape})` : '–'), ...M.MOUTH_SHAPES.map(sh => h('option', { value: sh, selected: exact?.shape === sh, title: M.MOUTH_HELP[sh] }, sh)));
      mouth.addEventListener('change', () => {
        if (!clip) return;
        s.editClip(clip.id, 'Boca', x => {
          x.mouth = x.mouth.filter(m => m.frame !== f);
          if (mouth.value) x.mouth.push({ frame: f, shape: mouth.value as M.MouthShape });
          x.mouth.sort((p, q) => p.frame - q.frame);
        });
        render();
      });
      cells.push(h('td', null, mouth));
      const note = h('input', { type: 'text', value: a.notes[f] ?? '', 'aria-label': `Acción en el fotograma ${f + 1}` });
      note.addEventListener('change', () => s.run(() => M.cmdNote(s.doc, f, note.value.trim())));
      cells.push(h('td', { class: 'xs-note' }, note));
      rows.push(h('tr', { class: f === a.current ? 'cur' : '' }, ...cells));
    }
    body.replaceChildren(h('table', { class: 'xsheet' }, h('thead', null, thead), h('tbody', null, ...rows)));
    const pages = Math.ceil(a.length / PAGE);
    pager.replaceChildren(
      h('button', { type: 'button', class: 'btn sm', disabled: page <= 0, on: { click: () => { page--; render(); } } }, '◀'),
      h('span', null, `Fotogramas ${f0 + 1}–${f1} de ${a.length} · ${clip ? `bocas y diálogo de «${clip.name}»` : 'sin audio'}`),
      h('button', { type: 'button', class: 'btn sm', disabled: page >= pages - 1, on: { click: () => { page++; render(); } } }, '▶'));
    body.querySelector('tr.cur')?.scrollIntoView({ block: 'center' });
  };
  render();
  const off = s.on('change', () => { if (!body.contains(document.activeElement)) render(); });
  void modal({ title: 'Hoja de exposición', wide: true, className: 'xs-dialog', body: [pager, body], actions: [{ label: 'Cerrar', value: null, kind: 'primary' }] }).then(() => off());
}

/** Modo «dibujar guía»: el siguiente trazo en el lienzo se guarda como guía de movimiento. */
export function drawGuide(s: AnimStudio) {
  const eng = s.engine, a = s.anim;
  if (!a) return;
  if (s.player.playing) s.player.pause();
  let pts: number[] = [];
  const prevTool = s.mgr.current.id;
  const restore = () => s.mgr.select(prevTool);
  const handler: ToolHandler = {
    cursor: 'crosshair',
    down: e => { pts = [e.x, e.y]; },
    move: e => { const n = pts.length; if (n && Math.hypot(e.x - pts[n - 2], e.y - pts[n - 1]) * eng.view.scale > 3) { pts.push(e.x, e.y); eng.requestOverlay(); } },
    up: () => {
      if (pts.length < 4) { toast('La guía necesita un recorrido: arrastra sobre el lienzo'); return; }
      const name = `Guía ${a.guides.length + 1}`;
      const guide = pts.slice();
      s.run(() => M.cmdAnimEdit(s.doc, 'Guía de movimiento', an => { an.guides.push({ id: M.uid('gd'), name, pts: guide, visible: true }); }));
      toast(`${name} creada. Úsala en «Interpolar movimiento».`, 'ok');
      restore();
    },
    cancel: () => { pts = []; },
    overlay: ctx => {
      if (pts.length < 4) return;
      const m = eng.V;
      ctx.strokeStyle = '#ffcc33'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 2) { const x = m[0] * pts[i] + m[2] * pts[i + 1] + m[4], y = m[1] * pts[i] + m[3] * pts[i + 1] + m[5]; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.stroke();
    },
  };
  eng.setMode('custom', handler);
  toast('Arrastra sobre el lienzo para dibujar el recorrido (Esc cancela)');
}

/** Dibuja las guías visibles sobre el lienzo (no forman parte del dibujo). */
export function guideOverlay(s: AnimStudio) {
  return (ctx: CanvasRenderingContext2D) => {
    const a = s.anim;
    if (!a || s.engine.playing || !a.guides.length) return;
    const m = s.engine.V;
    const P = (x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    for (const g of a.guides) {
      if (!g.visible || g.pts.length < 4) continue;
      ctx.strokeStyle = 'rgba(255,204,51,0.9)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      ctx.beginPath();
      for (let i = 0; i < g.pts.length; i += 2) { const [x, y] = P(g.pts[i], g.pts[i + 1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.stroke();
      ctx.setLineDash([]);
      const n = g.pts.length;
      const [ex, ey] = P(g.pts[n - 2], g.pts[n - 1]), [bx, by] = P(g.pts[n - 4], g.pts[n - 3]);
      const ang = Math.atan2(ey - by, ex - bx);
      ctx.fillStyle = 'rgba(255,204,51,0.95)';
      ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - 10 * Math.cos(ang - 0.4), ey - 10 * Math.sin(ang - 0.4)); ctx.lineTo(ex - 10 * Math.cos(ang + 0.4), ey - 10 * Math.sin(ang + 0.4)); ctx.closePath(); ctx.fill();
      const [sx, sy] = P(g.pts[0], g.pts[1]);
      ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2); ctx.fill();
      ctx.font = '11px system-ui, sans-serif'; ctx.fillText(g.name, sx + 7, sy - 6);
    }
  };
}
