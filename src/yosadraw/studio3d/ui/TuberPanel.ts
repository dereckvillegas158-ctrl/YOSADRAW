import { h, toast } from '../../ui/dom';
import { TUBER_BG } from '../model';
import type { Studio3D } from '../Studio3D';
import { audioSection, type PickArt } from './LivePanel';
import { Rows } from './Panels';

/**
 * Panel del módulo PNGTuber (2D): personajes, fondo (pantalla verde, color,
 * transparente o un escenario dibujado), luces opcionales, audio y en vivo.
 * Sólo organiza lo que ya hacen el 3D Studio y el modo En vivo.
 */
export class TuberPanel extends Rows {
  readonly el: HTMLElement;
  constructor(s: Studio3D, private ui: { card: (src: 'layers' | 'tuber' | 'drawing') => void; play: () => void; pick: PickArt; frame: () => void }) {
    const el = h('div', { class: 'mo-props s3-tuberpanel' });
    super(s, el);
    this.el = el;
    for (const ev of ['change', 'select', 'open'] as const) s.on(ev, () => { if (this.el.isConnected) this.render(); });
  }
  render() {
    const s = this.s;
    this.root.replaceChildren();
    this.syncs = [];
    if (!s.active) return;
    const sc = s.scene, env = sc.env;
    const chars = sc.objects.filter(o => o.card && !o.part);
    // Personajes.
    this.sec(`Personajes (${chars.length})`,
      h('p', { class: 'ctl-help' }, 'Tus dibujos sobre el fondo. Elige uno para ponerle boca abierta, ojos cerrados, expresiones (poses) y física en el panel de la derecha.'),
      h('div', { class: 'mo-btnrow' },
        h('button', { type: 'button', class: 'btn sm primary', title: 'Cada capa del dibujo es una parte: la de abajo es el cuerpo y las demás se balancean', on: { click: () => this.ui.card('layers') } }, 'Personaje por capas (dibujo)…'),
        h('button', { type: 'button', class: 'btn sm', on: { click: () => this.ui.card('tuber') } }, 'Personaje desde un PNG…')),
      ...chars.map(o => h('div', { class: `s3-poserow${s.sel.includes(o.id) ? ' on' : ''}` },
        h('button', { type: 'button', class: 'btn xs', on: { click: () => s.select([o.id]) } }, s.sel.includes(o.id) ? '● ' + o.name : o.name),
        h('span', { class: 'mo-unit' }, o.card?.tuber ? 'habla' : 'sin boca'),
        o.card?.poses?.length ? h('span', { class: 'mo-unit' }, `${o.card.poses.length} expr.`) : null)),
      chars.length ? r(this).btns(['Encuadrar', () => this.ui.frame()]) : null);
    // Fondo.
    const cur = env.transparent ? 'transparent' : TUBER_BG.find(([, , c]) => c.toLowerCase() === env.bg.toLowerCase())?.[0] ?? 'custom';
    const sel = h('select', { class: 'mo-sel', 'aria-label': 'Fondo' }, ...TUBER_BG.map(([v, l]) => h('option', { value: v, selected: !env.bgTex && cur === v }, l)), h('option', { value: 'custom', selected: !env.bgTex && cur === 'custom' }, 'Otro color'));
    sel.addEventListener('change', () => { const b = TUBER_BG.find(x => x[0] === sel.value); s.edit('Fondo', (st, x) => { x.env.bgTex = null; if (b) { x.env.bg = b[2]; x.env.transparent = b[0] === 'transparent'; st.render.transparent = b[0] === 'transparent'; } else x.env.transparent = false; }); });
    const col = h('input', { type: 'color', class: 'mo-color', value: env.bg, 'aria-label': 'Color del fondo' });
    col.addEventListener('change', () => s.edit('Color del fondo', (_st, x) => { x.env.bg = col.value; x.env.transparent = false; x.env.bgTex = null; }));
    const art = async (kind: 'image' | 'drawing') => {
      const a = await this.ui.pick(kind);
      if (a) { s.addTexture(a.src, `Escenario · ${a.name}`, a.project, (id, x) => { x.env.bgTex = id; x.env.transparent = false; }, 'Escenario dibujado'); toast(`Escenario: «${a.name}»`, 'ok'); }
    };
    this.sec('Fondo',
      h('p', { class: 'ctl-help' }, 'Pantalla verde para recortarla en OBS (filtro «Chroma Key»), un color, transparente para los renders, o tu propio escenario dibujado.'),
      sel, h('div', { class: 'mo-prop' }, h('label', { class: 'mo-lab' }, 'Color'), col),
      h('div', { class: 'mo-btnrow' },
        h('button', { type: 'button', class: 'btn sm', on: { click: () => void art('drawing') } }, 'Escenario: dibujo de YOSADRAW…'),
        h('button', { type: 'button', class: 'btn sm', on: { click: () => void art('image') } }, 'Escenario: imagen…'),
        env.bgTex ? h('button', { type: 'button', class: 'btn sm', on: { click: () => s.edit('Quitar escenario', (_st, x) => { x.env.bgTex = null; }) } }, 'Quitar escenario') : null),
      env.bgTex ? h('p', { class: 'ctl-help' }, `Escenario: ${s.s.textures.find(t => t.id === env.bgTex)?.name ?? 'imagen'} (cubre todo el encuadre).`) : null);
    // Aspecto.
    this.sec('Aspecto',
      this.check('Colores originales del dibujo (2D, sin luces)', !!env.unlit, v => s.edit('Luces', (_st, x) => { x.env.unlit = v; x.fx = { ...(x.fx ?? {}), shadows: v ? 0 : 2 } as typeof x.fx; })),
      h('p', { class: 'ctl-help' }, 'Desmárcalo para que las luces, las sombras y la luz volumétrica afecten al personaje. Los efectos (resplandor, glitch, aberración, estilos, cel shading) funcionan siempre: pestaña «Vivo» a la derecha.'));
    // Audio.
    audioSection(this, s);
    // En vivo.
    this.sec('En vivo',
      h('button', { type: 'button', class: 'btn primary s3-tuberplay', on: { click: () => this.ui.play() } }, '▶ Empezar (F5)'),
      h('p', { class: 'ctl-help' }, 'Agarra y sacude al personaje con el ratón; habla con el micrófono o un audio; cambia de expresión con sus teclas. H oculta la interfaz (para capturar la ventana en OBS), F9 graba vídeo o GIF, Esc para.'));
  }
}
const r = (x: Rows) => x;
