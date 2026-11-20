import { desktopBridge } from '../brush/storage';
import type { ToolManager } from '../tools/ToolManager';
import { fromHex, hsvToRgb, isHex, rgbToHsv, toHex, WHEELS, mix, type WheelModel } from './color';
import { layerTips, scheme, SCHEMES, type SchemeId } from './colorplan';
import { BLENDS } from './LayersPanel';
import { h, pickFiles, toast } from './dom';
import { confirmDialog, promptText } from './modal';
import { BUILTIN_PALETTES, MAX_COLORS, MAX_PALETTES, paletteId, parsePalette, toGpl, type Palette, type PalettePrefs } from './palettes';

type Mode = PalettePrefs['mode'];
const MODES: [Mode, string, string][] = [
  ['square', 'Cuadro', 'Saturación y brillo con barra de tono'],
  ['wheel', 'Rueda', 'Rueda de colores: primarios, secundarios y terciarios con sus luces y sombras'],
  ['values', 'Valores', 'Deslizadores de tono, saturación, brillo y RGB'],
  ['harmony', 'Armonías', 'Complementario, análogos, tríada… a partir del color actual'],
];

/**
 * Selector de color: color principal y secundario (X intercambia), hexadecimal,
 * cuatro maneras de elegir (cuadro, rueda de colores con primarios/secundarios/
 * terciarios, valores numéricos y armonías), recientes y paletas guardables
 * (crear, renombrar, duplicar, borrar, añadir y quitar colores, importar y
 * exportar .gpl de GIMP/Krita/Inkscape).
 */
export class ColorPanel {
  readonly el: HTMLElement;
  private sv: HTMLCanvasElement;
  private hue: HTMLCanvasElement;
  private wheel: HTMLCanvasElement;
  private hex: HTMLInputElement;
  private primaryChip: HTMLButtonElement;
  private secondaryChip: HTMLButtonElement;
  private recent: HTMLElement;
  private modeTabs: HTMLElement;
  private views: Record<Mode, HTMLElement>;
  private wheelRoles = h('div', { class: 'cp-roles' });
  private valuesBox = h('div', { class: 'cp-values' });
  private harmonyBox = h('div', { class: 'cp-harmony' });
  private paletteSel = h('select', { class: 'cp-pal-select', 'aria-label': 'Paleta' });
  private paletteGrid = h('div', { class: 'swatch-row cp-pal-grid', role: 'group', 'aria-label': 'Colores de la paleta' });
  private editing: 'primary' | 'secondary' = 'primary';
  private hsv: [number, number, number] = [0, 0, 0];

  constructor(private mgr: ToolManager, public prefs: PalettePrefs, private persist: (p: PalettePrefs) => void) {
    this.sv = h('canvas', { class: 'sv', tabindex: '0', role: 'slider', 'aria-label': 'Saturación y brillo (flechas para ajustar)' });
    this.hue = h('canvas', { class: 'hue', tabindex: '0', role: 'slider', 'aria-label': 'Tono (flechas para ajustar)', 'aria-valuemin': '0', 'aria-valuemax': '360' });
    this.wheel = h('canvas', { class: 'cp-wheel', 'aria-label': 'Rueda de colores' });
    this.hex = h('input', { type: 'text', id: 'color-hex', class: 'hex', maxlength: '7', spellcheck: 'false', 'aria-label': 'Color en hexadecimal' });
    this.primaryChip = h('button', { type: 'button', class: 'chip primary', title: 'Color principal', 'aria-label': 'Editar color principal', on: { click: () => this.edit('primary') } });
    this.secondaryChip = h('button', { type: 'button', class: 'chip secondary', title: 'Color secundario', 'aria-label': 'Editar color secundario', on: { click: () => this.edit('secondary') } });
    this.recent = h('div', { class: 'swatch-row', 'aria-label': 'Colores recientes' });

    this.modeTabs = h('div', { class: 'segmented compact cp-modes', role: 'tablist', 'aria-label': 'Modo del selector' },
      ...MODES.map(([id, label, title]) => h('button', { type: 'button', role: 'tab', title, 'aria-selected': String(id === prefs.mode), dataset: { mode: id }, on: { click: () => this.setMode(id) } }, label)));
    const wheelModel = h('div', { class: 'segmented compact', role: 'radiogroup', 'aria-label': 'Rueda' },
      ...([['ryb', 'Pintura (RYB)'], ['rgb', 'Luz (RGB)']] as [WheelModel, string][]).map(([id, label]) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(prefs.wheel === id),
        on: { click: (e: Event) => { this.prefs.wheel = id; wheelModel.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(b === e.currentTarget))); this.save(); this.drawWheel(); this.renderRoles(); } },
      }, label)));
    this.views = {
      square: h('div', { class: 'cp-view' }, this.sv, this.hue),
      wheel: h('div', { class: 'cp-view' }, wheelModel, this.wheel, this.wheelRoles),
      values: h('div', { class: 'cp-view' }, this.valuesBox),
      harmony: h('div', { class: 'cp-view' }, this.harmonyBox),
    };

    const palBtn = (label: string, title: string, run: () => void) => h('button', { type: 'button', class: 'btn sm ghost', title, on: { click: run } }, label);
    this.paletteSel.addEventListener('change', () => { this.prefs.active = this.paletteSel.value; this.save(); this.renderPalette(); });
    this.el = h('section', { class: 'block color-panel', 'aria-label': 'Color' },
      h('div', { class: 'color-top' },
        h('div', { class: 'chips' }, this.secondaryChip, this.primaryChip),
        h('button', { type: 'button', class: 'link', title: 'Intercambiar (X)', on: { click: () => mgr.swapColors() } }, '⇄ Intercambiar'),
        this.hex),
      this.modeTabs,
      ...Object.values(this.views),
      h('span', { class: 'mini-label' }, 'Recientes'), this.recent,
      h('div', { class: 'cp-pal-head' }, h('span', { class: 'mini-label' }, 'Paletas'), this.paletteSel,
        h('button', { type: 'button', class: 'icon sm', title: 'Más opciones de paletas', 'aria-label': 'Opciones de paletas', html: '⋯', on: { click: (e: Event) => this.paletteMenu(e.currentTarget as HTMLElement) } })),
      this.paletteGrid,
      h('div', { class: 'cp-pal-actions' },
        palBtn('+ Color', 'Añadir el color actual a la paleta', () => this.addColor()),
        palBtn('Nueva', 'Paleta nueva vacía', () => void this.newPalette()),
        palBtn('Importar', 'Importar una paleta (.gpl de GIMP, Krita o Inkscape, .json o lista de colores)', () => void this.importPalette()),
        palBtn('Exportar', 'Exportar esta paleta como .gpl', () => void this.exportPalette())),
      h('p', { class: 'ctl-help cp-pal-help' }, 'Toca un color para usarlo. Mantén pulsado (o clic derecho) para quitarlo de la paleta.'));
    this.bindPicker();
    this.hex.addEventListener('change', () => {
      const v = this.hex.value.trim().replace(/^([0-9a-f]{6})$/i, '#$1');
      if (/^#[0-9a-f]{6}$/i.test(v)) this.apply(v.toLowerCase()); else this.sync();
    });
    mgr.on('colors', () => this.sync());
    new ResizeObserver(() => this.draw()).observe(this.sv);
    new ResizeObserver(() => this.drawWheel()).observe(this.wheel);
    this.showMode();
    this.renderPalette();
    this.sync();
  }

  private save() { this.persist(this.prefs); }

  private swatch(c: string, title = c) {
    return h('button', { type: 'button', class: 'sw', style: { '--sw': c }, title, 'aria-label': `Usar ${title}`, on: { click: () => this.apply(c) } });
  }

  private edit(which: 'primary' | 'secondary') { this.editing = which; this.sync(); }

  private current() { return this.editing === 'primary' ? this.mgr.colors.primary : this.mgr.colors.secondary; }

  private apply(hex: string) {
    const c = this.mgr.colors;
    if (this.editing === 'primary') this.mgr.setColors(hex, c.secondary); else this.mgr.setColors(c.primary, hex);
  }

  private sync() {
    const c = this.mgr.colors;
    this.primaryChip.style.setProperty('--c', c.primary);
    this.secondaryChip.style.setProperty('--c', c.secondary);
    this.primaryChip.setAttribute('aria-pressed', String(this.editing === 'primary'));
    this.secondaryChip.setAttribute('aria-pressed', String(this.editing === 'secondary'));
    const cur = this.current();
    if (document.activeElement !== this.hex) this.hex.value = cur;
    const [r, g, b] = fromHex(cur);
    const hsv = rgbToHsv(r, g, b);
    // Conserva el tono si el color es gris (sin tono propio).
    this.hsv = [hsv[1] === 0 || hsv[2] === 0 ? this.hsv[0] : hsv[0], hsv[1], hsv[2]];
    this.recent.replaceChildren(...c.recent.map(x => this.swatch(x)));
    this.hue.setAttribute('aria-valuenow', String(Math.round(this.hsv[0])));
    this.draw();
    if (this.prefs.mode === 'wheel') this.drawWheel();
    if (this.prefs.mode === 'values') this.renderValues();
    if (this.prefs.mode === 'harmony') this.renderHarmony();
  }

  private setHsv(hh: number, s: number, v: number) {
    this.hsv = [hh, Math.min(1, Math.max(0, s)), Math.min(1, Math.max(0, v))];
    this.apply(toHex(...hsvToRgb(...this.hsv)));
  }

  // ---------------------------------------------------------------- modos

  private setMode(m: Mode) { this.prefs.mode = m; this.save(); this.showMode(); this.sync(); }

  private showMode() {
    for (const [id, el] of Object.entries(this.views)) el.hidden = id !== this.prefs.mode;
    this.modeTabs.querySelectorAll<HTMLElement>('button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === this.prefs.mode)));
    if (this.prefs.mode === 'wheel') { this.renderRoles(); requestAnimationFrame(() => this.drawWheel()); }
    if (this.prefs.mode === 'square') requestAnimationFrame(() => this.draw());
  }

  private bindPicker() {
    const drag = (el: HTMLCanvasElement, fn: (u: number, v: number) => void) => {
      const at = (e: PointerEvent) => { const r = el.getBoundingClientRect(); fn(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))); };
      el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); at(e); });
      el.addEventListener('pointermove', e => { if (el.hasPointerCapture(e.pointerId)) at(e); });
    };
    drag(this.sv, (u, v) => this.setHsv(this.hsv[0], u, 1 - v));
    drag(this.hue, u => this.setHsv(u * 360, this.hsv[1], this.hsv[2]));
    // Rueda: 12 sectores × 3 anillos (luz, puro, sombra) y el centro.
    this.wheel.addEventListener('pointerdown', e => {
      const r = this.wheel.getBoundingClientRect();
      const x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2;
      const c = this.wheelAt(Math.hypot(x, y) / (r.width / 2), Math.atan2(y, x));
      if (c) this.apply(c);
    });
    this.sv.addEventListener('keydown', e => {
      const d = e.shiftKey ? 0.1 : 0.02, [hh, s, v] = this.hsv;
      const m: Record<string, [number, number]> = { ArrowLeft: [s - d, v], ArrowRight: [s + d, v], ArrowUp: [s, v + d], ArrowDown: [s, v - d] };
      if (m[e.key]) { e.preventDefault(); e.stopPropagation(); this.setHsv(hh, m[e.key][0], m[e.key][1]); }
    });
    this.hue.addEventListener('keydown', e => {
      const d = e.shiftKey ? 15 : 3;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); this.setHsv((this.hsv[0] + (e.key === 'ArrowRight' ? d : -d) + 360) % 360, this.hsv[1], this.hsv[2]); }
    });
  }

  /** Color de la rueda en (radio relativo 0..1, ángulo). Anillos de fuera a dentro: luz, puro, sombra. */
  private wheelAt(rr: number, ang: number): string | null {
    const segs = WHEELS[this.prefs.wheel];
    if (rr > 1) return null;
    if (rr < 0.28) return null;
    // El sector 0 (rojo) arriba, sentido horario.
    const a = (ang + Math.PI / 2 + Math.PI * 2 + Math.PI / 12) % (Math.PI * 2);
    const base = segs[Math.floor(a / (Math.PI / 6)) % 12].hex;
    return rr > 0.76 ? mix(base, '#ffffff', 0.45) : rr > 0.52 ? base : mix(base, '#000000', 0.4);
  }

  private drawWheel() {
    const c = this.wheel, r0 = c.getBoundingClientRect();
    if (!r0.width || this.prefs.mode !== 'wheel') return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(r0.width * dpr); c.height = Math.round(r0.width * dpr);
    const g = c.getContext('2d')!, W = c.width, R = W / 2;
    const segs = WHEELS[this.prefs.wheel], step = Math.PI / 6;
    const rings: [number, number, (b: string) => string][] = [[0.76, 1, b => mix(b, '#ffffff', 0.45)], [0.52, 0.76, b => b], [0.28, 0.52, b => mix(b, '#000000', 0.4)]];
    segs.forEach((s, i) => {
      const a0 = -Math.PI / 2 - step / 2 + i * step, a1 = a0 + step;
      for (const [ri, ro, f] of rings) {
        g.beginPath(); g.arc(R, R, ro * R - dpr, a0, a1); g.arc(R, R, ri * R, a1, a0, true); g.closePath();
        g.fillStyle = f(s.hex); g.fill();
        g.strokeStyle = 'rgba(12,10,19,0.9)'; g.lineWidth = 1.5 * dpr; g.stroke();
      }
      // Marca de papel: P (primario), S (secundario).
      if (s.role !== 'terciario') {
        const am = (a0 + a1) / 2, rm = 0.64 * R;
        g.fillStyle = s.role === 'primario' ? '#fff' : 'rgba(255,255,255,0.75)';
        g.font = `bold ${Math.round(10 * dpr)}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 3 * dpr;
        const t = s.role === 'primario' ? 'P' : 'S';
        g.strokeText(t, R + Math.cos(am) * rm, R + Math.sin(am) * rm); g.fillText(t, R + Math.cos(am) * rm, R + Math.sin(am) * rm);
      }
    });
    // Centro: el color actual.
    g.beginPath(); g.arc(R, R, 0.24 * R, 0, Math.PI * 2); g.fillStyle = this.current(); g.fill();
    g.lineWidth = 2 * dpr; g.strokeStyle = 'rgba(255,255,255,0.8)'; g.stroke();
  }

  private renderRoles() {
    const segs = WHEELS[this.prefs.wheel];
    const row = (title: string, role: string) => h('div', { class: 'cp-role' }, h('span', { class: 'mini-label' }, title),
      h('div', { class: 'swatch-row' }, ...segs.filter(s => s.role === role).map(s => this.swatch(s.hex, s.name))));
    this.wheelRoles.replaceChildren(row('Primarios', 'primario'), row('Secundarios', 'secundario'), row('Terciarios', 'terciario'),
      h('p', { class: 'ctl-help' }, this.prefs.wheel === 'ryb' ? 'Rueda de pintura (Itten): mezclar dos primarios da el secundario que hay entre ellos. Anillo exterior: luz; interior: sombra.' : 'Rueda de luz (pantalla): rojo, verde y azul se suman; sus mezclas son cian, magenta y amarillo.'));
  }

  private renderValues() {
    const [r, g, b] = fromHex(this.current());
    const [hh, s, v] = this.hsv;
    const slider = (label: string, value: number, max: number, unit: string, grad: string, set: (x: number) => void) => {
      const range = h('input', { type: 'range', min: '0', max: String(max), step: '1', value: String(Math.round(value)), 'aria-label': label, class: 'cp-slider', style: { '--grad': grad } });
      const num = h('input', { type: 'number', min: '0', max: String(max), value: String(Math.round(value)), 'aria-label': `${label} (número)` });
      range.addEventListener('input', () => { num.value = range.value; set(Number(range.value)); });
      num.addEventListener('change', () => { const x = Math.min(max, Math.max(0, Number(num.value) || 0)); range.value = String(x); set(x); });
      return h('label', { class: 'cp-val' }, h('span', null, label), range, h('span', { class: 'cp-num' }, num, h('small', null, unit)));
    };
    const at = (fn: (x: number) => string) => `linear-gradient(90deg, ${[0, 0.17, 0.33, 0.5, 0.67, 0.83, 1].map(fn).join(', ')})`;
    const hsvHex = (H: number, S: number, V: number) => toHex(...hsvToRgb(H, S, V));
    this.valuesBox.replaceChildren(
      slider('Tono', hh, 360, '°', at(t => hsvHex(t * 360, 1, 1)), x => this.setHsv(x, s, v)),
      slider('Saturación', s * 100, 100, '%', at(t => hsvHex(hh, t, Math.max(v, 0.3))), x => this.setHsv(hh, x / 100, v)),
      slider('Brillo', v * 100, 100, '%', at(t => hsvHex(hh, s, t)), x => this.setHsv(hh, s, x / 100)),
      slider('Rojo', r, 255, '', at(t => toHex(Math.round(t * 255), g, b)), x => this.apply(toHex(x, g, b))),
      slider('Verde', g, 255, '', at(t => toHex(r, Math.round(t * 255), b)), x => this.apply(toHex(r, x, b))),
      slider('Azul', b, 255, '', at(t => toHex(r, g, Math.round(t * 255))), x => this.apply(toHex(r, g, x))));
  }

  /**
   * Armonías: esquema elegido a partir del color actual (rueda de pintor o de luz),
   * cada color con su papel y la proporción de la imagen que conviene darle, consejos
   * de uso, y colores calculados para colorear con capas de fusión (sombras con
   * Multiplicar, luces con Trama, ambiente con Superponer…).
   */
  private renderHarmony() {
    const cur = this.current();
    const id = (SCHEMES.some(s => s.id === this.prefs.scheme) ? this.prefs.scheme : 'comp') as SchemeId;
    const model = this.prefs.wheel;
    const sc = scheme(cur, id, model);
    const chips = h('div', { class: 'cp-schemes', role: 'radiogroup', 'aria-label': 'Esquema de armonía' },
      ...SCHEMES.map(s => h('button', { type: 'button', role: 'radio', class: 'cp-scheme', 'aria-checked': String(s.id === id), on: { click: () => { this.prefs.scheme = s.id; this.save(); this.renderHarmony(); } } }, s.name)));
    const wheel = h('div', { class: 'segmented compact', role: 'radiogroup', 'aria-label': 'Rueda para calcular' },
      ...([['ryb', 'Pintura (RYB)'], ['rgb', 'Luz (RGB)']] as [WheelModel, string][]).map(([w, label]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(model === w), title: w === 'ryb' ? 'Rueda de pintor: complementario del rojo = verde (la tradicional en ilustración)' : 'Rueda de luz: complementario del rojo = cian', on: { click: () => { this.prefs.wheel = w; this.save(); this.renderHarmony(); } } }, label)));
    // Colores del esquema con su papel y proporción.
    const bar = h('div', { class: 'cp-share', 'aria-hidden': 'true' }, ...sc.colors.map(c => h('span', { style: { background: c.hex, flex: String(c.share) }, title: `${c.role}: ${c.share} %` })));
    const rows = h('div', { class: 'cp-roles-list' }, ...sc.colors.map(c => h('div', { class: 'cp-role-row' },
      this.swatch(c.hex, `${c.role} ${c.hex}`), h('span', { class: 'cp-role-name' }, c.role), h('span', { class: 'cp-role-share' }, `${c.share} %`), h('code', null, c.hex))));
    const tips = h('ul', { class: 'cp-tips' }, ...sc.tips.map(t => h('li', null, t)));
    // Capas de fusión calculadas sobre el color actual.
    const tipsLayers = layerTips(cur, sc).map(t => {
      const label = BLENDS.find(b => b.value === t.mode)?.label ?? t.name;
      return h('div', { class: 'cp-layer-tip' },
        h('div', { class: 'cp-lt-head' }, h('strong', null, t.use), h('span', { class: 'cp-lt-mode' }, `capa ${label}`)),
        h('div', { class: 'cp-lt-math', title: 'Color de debajo → color para la capa → resultado' },
          this.swatch(cur, `Color de debajo ${cur}`), h('span', null, '+'), this.swatch(t.layer, `Pinta con ${t.layer}`), h('span', null, '='), this.swatch(t.result, `Resultado ${t.result}`),
          h('code', null, t.layer)),
        h('p', { class: 'ctl-help' }, t.how),
        h('div', { class: 'cp-lt-actions' },
          h('button', { type: 'button', class: 'btn sm', on: { click: () => { this.mgr.setColors(t.layer, this.mgr.colors.secondary); toast(`Color para la capa ${label}: ${t.layer}`, 'ok'); } } }, 'Usar este color'),
          h('button', { type: 'button', class: 'btn sm primary', title: `Nueva capa «${t.layerName}» en modo ${label} encima de la activa, con este color listo`, on: { click: () => this.makeLayer(t.layerName, t.mode, t.layer) } }, `Crear capa ${label}`)));
    });
    this.harmonyBox.replaceChildren(
      h('div', { class: 'cp-harm-top' }, wheel), chips,
      h('div', { class: 'cp-harm' }, h('div', { class: 'cp-harm-head' }, h('span', { class: 'mini-label' }, `${sc.name} · proporciones sugeridas`),
        h('button', { type: 'button', class: 'link', title: 'Guardar estos colores como paleta', on: { click: () => void this.newPalette(`${sc.name} ${cur}`, sc.colors.map(c => c.hex)) } }, 'Guardar paleta')),
        bar, rows, tips),
      h('details', { class: 'cp-layers-help', open: true }, h('summary', null, 'Colorear con capas de fusión'),
        h('p', { class: 'ctl-help' }, `Calculado para el color actual (${cur}) como color de debajo: el color de la capa da exactamente el resultado mostrado.`),
        ...tipsLayers));
  }

  /** Nueva capa con ese modo de fusión encima de la activa y el color elegido. */
  private makeLayer(name: string, mode: string, color: string) {
    const e = this.mgr.engine, d = e.doc;
    if (d.motion) { toast('Las capas de fusión son para dibujos y animaciones.'); return; }
    const l = d.newLayer(name);
    l.blend = mode as typeof l.blend;
    if (!e.exec({ ...d.cmdAddLayer(d.activeId, l), label: `Capa ${name}` })) return;
    this.mgr.setColors(color, this.mgr.colors.secondary);
    toast(`Capa «${name}» creada; pinta con ${color}`, 'ok');
  }

  // ---------------------------------------------------------------- paletas

  private all(): Palette[] { return [...BUILTIN_PALETTES, ...this.prefs.palettes]; }
  private active(): Palette { return this.all().find(p => p.id === this.prefs.active) ?? BUILTIN_PALETTES[0]; }

  private renderPalette() {
    const all = this.all(), act = this.active();
    this.paletteSel.replaceChildren(
      h('optgroup', { label: 'Incluidas' }, ...BUILTIN_PALETTES.map(p => h('option', { value: p.id, selected: p.id === act.id }, p.name))),
      ...(this.prefs.palettes.length ? [h('optgroup', { label: 'Mis paletas' }, ...this.prefs.palettes.map(p => h('option', { value: p.id, selected: p.id === act.id }, `${p.name} (${p.colors.length})`)))] : []));
    void all;
    this.paletteGrid.replaceChildren(...act.colors.map((c, i) => {
      const b = this.swatch(c);
      if (!act.builtin) {
        let t = 0;
        const remove = () => { act.colors.splice(i, 1); this.save(); this.renderPalette(); toast(`${c} quitado de «${act.name}»`); };
        b.addEventListener('contextmenu', e => { e.preventDefault(); remove(); });
        b.addEventListener('pointerdown', () => { t = window.setTimeout(() => { t = 0; remove(); }, 600); });
        for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => clearTimeout(t));
      }
      return b;
    }), ...(act.colors.length ? [] : [h('span', { class: 'ctl-help' }, 'Vacía: añade colores con «+ Color».')]));
  }

  /** Las paletas incluidas no se editan: al añadir a una se crea una copia propia. */
  private editable(): Palette | null {
    const act = this.active();
    if (!act.builtin) return act;
    if (this.prefs.palettes.length >= MAX_PALETTES) { toast(`Máximo ${MAX_PALETTES} paletas`); return null; }
    const copy = { id: paletteId(), name: `${act.name} (mía)`, colors: act.colors.slice() };
    this.prefs.palettes.push(copy);
    this.prefs.active = copy.id;
    toast(`«${act.name}» es una paleta incluida: se creó la copia «${copy.name}»`);
    return copy;
  }

  private addColor() {
    const c = this.current();
    const p = this.editable();
    if (!p) return;
    if (p.colors.includes(c)) { toast(`${c} ya está en «${p.name}»`); this.renderPalette(); return; }
    if (p.colors.length >= MAX_COLORS) { toast(`Máximo ${MAX_COLORS} colores por paleta`); return; }
    p.colors.push(c);
    this.save();
    this.renderPalette();
  }

  private async newPalette(name?: string, colors: string[] = []) {
    if (this.prefs.palettes.length >= MAX_PALETTES) { toast(`Máximo ${MAX_PALETTES} paletas`); return; }
    const n = await promptText('Nueva paleta', name ?? `Paleta ${this.prefs.palettes.length + 1}`, { ok: 'Crear' });
    if (!n) return;
    const p = { id: paletteId(), name: n.slice(0, 60), colors: colors.filter(isHex).slice(0, MAX_COLORS) };
    this.prefs.palettes.push(p);
    this.prefs.active = p.id;
    this.save();
    this.renderPalette();
    toast(`Paleta «${p.name}» creada${p.colors.length ? ` con ${p.colors.length} colores` : ''}`, 'ok');
  }

  private paletteMenu(anchor: HTMLElement) {
    document.querySelector('.menu.cp-menu')?.remove();
    const act = this.active();
    const close = () => { menu.remove(); removeEventListener('pointerdown', out, true); };
    const out = (e: Event) => { if (!menu.contains(e.target as Node)) close(); };
    const item = (label: string, run: () => void, disabled = false, danger = false) => h('button', { type: 'button', role: 'menuitem', class: danger ? 'danger' : '', disabled, on: { click: () => { close(); run(); } } }, label);
    const menu = h('div', { class: 'menu cp-menu', role: 'menu', on: { keydown: (e: Event) => { if ((e as KeyboardEvent).key === 'Escape') { e.stopPropagation(); close(); } } } },
      item('Renombrar…', async () => { const n = await promptText('Renombrar paleta', act.name); if (n) { act.name = n.slice(0, 60); this.save(); this.renderPalette(); } }, !!act.builtin),
      item('Duplicar', () => { if (this.prefs.palettes.length >= MAX_PALETTES) return; const p = { id: paletteId(), name: `${act.name} copia`, colors: act.colors.slice() }; this.prefs.palettes.push(p); this.prefs.active = p.id; this.save(); this.renderPalette(); }),
      item('Añadir los colores recientes', () => { const p = this.editable(); if (!p) return; for (const c of this.mgr.colors.recent) if (!p.colors.includes(c) && p.colors.length < MAX_COLORS) p.colors.push(c); this.save(); this.renderPalette(); }),
      item('Ordenar por tono', () => { const p = this.editable(); if (!p) return; p.colors.sort((a, b) => { const A = rgbToHsv(...fromHex(a)), B = rgbToHsv(...fromHex(b)); return (A[1] < 0.08 ? 400 + A[2] : A[0]) - (B[1] < 0.08 ? 400 + B[2] : B[0]); }); this.save(); this.renderPalette(); }),
      item('Vaciar', async () => { if (await confirmDialog('Vaciar paleta', `¿Quitar todos los colores de «${act.name}»?`, 'Vaciar', true)) { act.colors = []; this.save(); this.renderPalette(); } }, !!act.builtin, true),
      item('Eliminar paleta', async () => {
        if (!(await confirmDialog('Eliminar paleta', `¿Eliminar «${act.name}»? No se puede deshacer.`, 'Eliminar', true))) return;
        this.prefs.palettes = this.prefs.palettes.filter(p => p.id !== act.id);
        this.prefs.active = 'yosadraw';
        this.save(); this.renderPalette();
      }, !!act.builtin, true));
    document.body.append(menu);
    const r = anchor.getBoundingClientRect(), mr = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(innerWidth - mr.width - 8, r.right - mr.width))}px`;
    menu.style.top = `${Math.min(innerHeight - mr.height - 8, r.bottom + 4)}px`;
    addEventListener('pointerdown', out, true);
  }

  private async importPalette() {
    const files = await pickFiles('.gpl,.json,.txt,.hex,text/plain,application/json', true);
    let ok = 0;
    for (const f of files) {
      try {
        if (this.prefs.palettes.length >= MAX_PALETTES) throw new Error(`máximo ${MAX_PALETTES} paletas`);
        const p = parsePalette(await f.text(), f.name);
        this.prefs.palettes.push(p);
        this.prefs.active = p.id;
        ok++;
      } catch (e) { toast(`${f.name}: ${e instanceof Error ? e.message : String(e)}`, 'error'); }
    }
    if (ok) { this.save(); this.renderPalette(); toast(`${ok === 1 ? 'Paleta importada' : `${ok} paletas importadas`}`, 'ok'); }
  }

  private async exportPalette() {
    const p = this.active();
    const name = `${p.name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Paleta'}.gpl`;
    const data = new TextEncoder().encode(toGpl(p));
    const bridge = desktopBridge();
    try {
      if (bridge?.writeExport && bridge.exportFolder) {
        const path = await bridge.writeExport(await bridge.exportFolder(), name, data, false);
        toast(`Paleta exportada: ${bridge.describe?.(path).path ?? path}`, 'ok', bridge.revealFile ? { label: 'Mostrar', run: () => void bridge.revealFile!(path) } : undefined);
        return;
      }
      const url = URL.createObjectURL(new Blob([data], { type: 'text/plain' }));
      const a = h('a', { href: url, download: name, style: { display: 'none' } });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) { toast(`No se pudo exportar: ${e instanceof Error ? e.message : String(e)}`, 'error'); }
  }

  // ---------------------------------------------------------------- dibujo del cuadro

  private draw() {
    if (this.prefs.mode !== 'square') return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [this.sv, this.hue]) {
      const r = c.getBoundingClientRect();
      if (!r.width) return;
      c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
    }
    const g = this.sv.getContext('2d')!, W = this.sv.width, H = this.sv.height;
    const [hh, s, v] = this.hsv;
    g.fillStyle = toHex(...hsvToRgb(hh, 1, 1)); g.fillRect(0, 0, W, H);
    let grad = g.createLinearGradient(0, 0, W, 0); grad.addColorStop(0, '#fff'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, '#000');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.lineWidth = 2 * dpr;
    g.beginPath(); g.arc(s * W, (1 - v) * H, 7 * dpr, 0, Math.PI * 2);
    g.strokeStyle = v > 0.55 ? '#1b1530' : '#fff'; g.stroke();

    const hg = this.hue.getContext('2d')!, HW = this.hue.width, HH = this.hue.height;
    const hgrad = hg.createLinearGradient(0, 0, HW, 0);
    for (let i = 0; i <= 6; i++) hgrad.addColorStop(i / 6, toHex(...hsvToRgb(i * 60, 1, 1)));
    hg.fillStyle = hgrad; hg.fillRect(0, 0, HW, HH);
    const x = (hh / 360) * HW;
    hg.fillStyle = '#fff'; hg.fillRect(x - 2 * dpr, 0, 4 * dpr, HH);
    hg.strokeStyle = '#1b1530'; hg.lineWidth = dpr; hg.strokeRect(x - 2 * dpr, 0.5, 4 * dpr, HH - 1);
  }
}
