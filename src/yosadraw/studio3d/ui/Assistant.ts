import { h } from '../../ui/dom';
import type { Studio3D } from '../Studio3D';
import { I3 } from './icons3';

interface Tip { icon: string; title: string; steps: string[]; target?: string }

/**
 * Asistente 3D: según la herramienta, el modo y lo elegido, explica paso a paso qué
 * hacer y resalta el botón o panel que hay que usar. También guía el tutorial
 * «Tu primera casa», que avanza solo cuando cada paso se ha hecho de verdad.
 */
export class Assistant {
  readonly el: HTMLElement;
  private body = h('div', { class: 's3-asbody' });
  private tut: Tutorial | null = null;
  constructor(private s: Studio3D, private onClose: () => void) {
    this.el = h('aside', { class: 's3-assistant', 'aria-live': 'polite', 'aria-label': 'Asistente 3D' },
      h('div', { class: 's3-ashead' }, h('span', { html: I3.wand }), h('strong', null, 'Asistente 3D'),
        h('button', { type: 'button', class: 'icon xs', title: 'Cerrar el asistente (se vuelve a abrir con el botón ? de arriba)', 'aria-label': 'Cerrar asistente', html: I3.close, on: { click: () => this.onClose() } })),
      this.body);
    for (const ev of ['tool', 'mode', 'select', 'change', 'view'] as const) s.on(ev, () => this.render());
  }
  get tutorial() { return this.tut; }
  startTutorial(checks: TutorialChecks) { this.tut = new Tutorial(this.s, checks, () => { this.tut = null; this.render(); }); this.render(); }
  render() {
    const s = this.s;
    if (!s.active || this.el.hidden) return;
    document.querySelectorAll('.s3-hl').forEach(x => x.classList.remove('s3-hl'));
    if (this.tut) { this.tut.render(this.body); return; }
    const t = this.tip();
    if (t.target) document.querySelector(t.target)?.classList.add('s3-hl');
    this.body.replaceChildren(
      h('div', { class: 's3-astitle' }, h('span', { class: 's3-asicon', html: t.icon }), h('span', null, t.title)),
      h('ol', { class: 's3-assteps' }, ...t.steps.map(x => h('li', { html: x }))),
      h('p', { class: 's3-asnav' }, 'Vista: rueda = acercar · botón central = girar · Mayús + central = desplazar · Alt + clic = girar · tecla F = encuadrar lo elegido.'));
  }
  private tip(): Tip {
    const s = this.s, o = s.one, k = (x: string) => `<kbd>${x}</kbd>`;
    if (s.mode === 'edit') {
      const what = s.selMode === 'vert' ? 'vértices' : s.selMode === 'edge' ? 'aristas' : 'caras';
      if (!s.editCount) return { icon: I3[s.selMode === 'vert' ? 'vert' : s.selMode === 'edge' ? 'edge' : 'face'], title: `Modo edición: elige ${what}`, target: '.s3-editbar', steps: [`Haz clic sobre el objeto para elegir ${what} (${k('1')} vértices, ${k('2')} aristas, ${k('3')} caras).`, `Mayús + clic suma más; arrastra en vacío para elegir con un rectángulo; ${k('A')} = todo.`, `Cuando salgas, pulsa ${k('Tab')} o el botón «Objeto».`] };
      return { icon: I3.extrude, title: `${s.editCount} ${what} elegidos: ¡modela!`, target: '.s3-editbar', steps: ['Arrastra las flechas del gizmo para moverlos (o gíralos y escálalos con las herramientas de la izquierda).', `${k('E')} Extruir: saca las caras elegidas hacia fuera (después muévelas con el gizmo).`, `${k('I')} Inset: un borde hacia dentro de cada cara · ${k('Ctrl')}+${k('B')} Biselar aristas · ${k('M')} Fusionar vértices.`, 'Agujero: inset y quita las caras · Agujero pasante: elige dos caras opuestas y únelas con un túnel.'] };
    }
    switch (s.tool) {
      case 'create': {
        const g = typeof s.createPrim === 'object' ? s.createPrim.gen : null;
        if (g === 'wall') return { icon: I3.wall, title: 'Dibuja una pared', target: '.s3-view', steps: ['Arrastra en el suelo desde donde empieza la pared hasta donde acaba.', 'Suelta: la pared aparece con una puerta y una ventana.', 'En «Objeto» cambia el alto, el grosor, la puerta y las ventanas.'] };
        if (g) return { icon: I3.house, title: 'Coloca el objeto', target: '.s3-view', steps: ['Haz clic en el suelo (o encima de otro objeto) para ponerlo.', 'Ajusta sus medidas y proporciones en el panel «Objeto».', '«Convertir en editable» si quieres modelar sus vértices.'] };
        return { icon: I3.cube, title: 'Crea una forma', target: '.s3-view', steps: ['Un clic en el suelo: la forma aparece con su tamaño normal.', 'O arrastra para dibujar la base, suelta y mueve el puntero arriba o abajo para la altura; clic para terminar.', 'Después cambia sus medidas exactas en «Objeto».'] };
      }
      case 'block': return { icon: I3.block, title: 'Construye con bloques', target: '.s3-view', steps: ['Clic en el suelo o en la cara de un bloque: se pone otro pegado.', 'Mayús + clic sobre un bloque lo quita.', 'Cambia la forma, el tamaño y el material del bloque en «Añadir» y «Material».'] };
      case 'paint': return { icon: I3.paint, title: 'Pinta sobre el modelo', target: '.s3-paintbar', steps: ['Elige color y tamaño en la barra de pintura del visor.', 'Pinta arrastrando sobre el objeto: la textura cambia en vivo.', 'Todo se puede deshacer; la pintura se guarda con el proyecto.'] };
      default: break;
    }
    if (!o) return { icon: I3.select, title: 'Empieza', target: '.s3-left', steps: ['Haz clic en un objeto del visor (o en la lista «Escena») para elegirlo.', 'Para añadir formas, casas, árboles o muebles usa el panel «Añadir».', '¿Primera vez? Abre el tutorial «Tu primera casa» con el botón ? de arriba.'] };
    if (o.kind === 'light') return { icon: I3.light, title: `Luz: ${o.name}`, target: '.mo-right', steps: ['Muévela con el gizmo; la dirección del sol y del foco es su rotación.', 'Cambia color, intensidad y sombras en el panel «Objeto».', 'Las luces se ven en los modos Materiales y Render.'] };
    if (o.kind === 'camera') return { icon: I3.cam3, title: `Cámara: ${o.name}`, target: '.mo-right', steps: ['«Ver por la cámara» muestra el encuadre final (tecla 0).', '«Colocar donde miro» la pone donde está tu vista.', 'Anima su posición, giro y campo de visión con keyframes para hacer movimientos de cámara.'] };
    const tool = s.tool === 'rotate' ? 'Rotar' : s.tool === 'scale' ? 'Escalar' : s.tool === 'move' ? 'Mover' : 'Seleccionar';
    return { icon: s.tool === 'rotate' ? I3.rotate : s.tool === 'scale' ? I3.scale : I3.move, title: `${tool}: ${o.name}`, target: '.s3-rail', steps: [
      s.tool === 'move' ? 'Arrastra una flecha del gizmo para moverlo en ese eje, o arrastra el objeto para deslizarlo por el suelo.' : s.tool === 'rotate' ? 'Arrastra uno de los anillos del gizmo para girar en ese eje.' : s.tool === 'scale' ? 'Arrastra un cubito del gizmo para estirar en un eje, o el centro para escalar igual en todos.' : `Cambia de herramienta: ${k('G')} mover, ${k('R')} rotar, ${k('S')} escalar.`,
      `${k('X')} ${k('Y')} ${k('Z')} limitan al eje; el imán ajusta a la cuadrícula (${k('Mayús')}+${k('S')} lo activa o quita).`,
      `Valores exactos en «Objeto» · ${k('Mayús')}+${k('D')} duplicar · ${k('Supr')} borrar · ${k('Tab')} editar vértices, aristas y caras.`] };
  }
}

export interface TutorialChecks { orbited: () => boolean; rendered: () => boolean }

/** Tutorial guiado: cada paso se marca hecho cuando el proyecto lo cumple. */
class Tutorial {
  private i = 0;
  private start: { cubes: number; cubeId: string | null; cubePos: string } = { cubes: 0, cubeId: null, cubePos: '' };
  private steps: { title: string; text: string; target?: string; done: () => boolean; enter?: () => void }[];
  constructor(s: Studio3D, c: TutorialChecks, private end: () => void) {
    const cubes = () => s.scene.objects.filter(o => o.prim?.type === 'box' && o.name !== 'Suelo');
    const has = (g: string) => s.scene.objects.some(o => o.gen?.type === g || (o.name.startsWith({ wall: 'Pared', roof: 'Tejado', door: 'Puerta', window: 'Ventana' }[g] ?? '?') && !o.gen));
    this.steps = [
      { title: '1. Mira alrededor', text: 'Gira la vista: arrastra con el <b>botón central</b> del ratón, o con <b>Alt + clic izquierdo</b>, o activa la <b>mano</b> de la izquierda. La rueda acerca y aleja.', target: '.s3-view', done: c.orbited },
      { title: '2. Añade un cubo', text: 'En el panel <b>Añadir</b>, pulsa <b>Cubo</b> y haz clic en el suelo del visor.', target: '.s3-add', enter: () => { this.start.cubes = cubes().length; }, done: () => cubes().length > this.start.cubes },
      { title: '3. Muévelo', text: 'Con la herramienta <b>Mover (G)</b>, arrastra una de las flechas de colores del cubo, o arrastra el cubo directamente.', target: '.s3-rail', enter: () => { const c2 = cubes().pop(); this.start.cubeId = c2?.id ?? null; this.start.cubePos = c2 ? JSON.stringify([c2.tf.px.v, c2.tf.py.v, c2.tf.pz.v]) : ''; }, done: () => { const c2 = this.start.cubeId ? s.obj(this.start.cubeId) : null; return !!c2 && JSON.stringify([c2.tf.px.v, c2.tf.py.v, c2.tf.pz.v]) !== this.start.cubePos; } },
      { title: '4. Dale un material', text: 'Con el cubo elegido, abre la pestaña <b>Material</b> (derecha) y pulsa <b>Madera</b> en la biblioteca.', target: '.mo-right', done: () => { const c2 = this.start.cubeId ? s.obj(this.start.cubeId) : null; return !!c2?.mats?.some(m => s.mat(m)?.name !== 'Material'); } },
      { title: '5. Levanta una pared', text: 'En <b>Añadir → Pared</b>, arrastra en el suelo de un punto a otro. La pared lleva una puerta y una ventana (se cambian en «Objeto»).', target: '.s3-add', done: () => has('wall') },
      { title: '6. Ponle tejado', text: 'En <b>Añadir → Tejado</b>, haz clic en el suelo y súbelo con el gizmo hasta lo alto de la pared (o pon su <b>Posición Y</b> en 2,6).', target: '.s3-add', done: () => has('roof') },
      { title: '7. Renderiza', text: 'Pulsa <b>Render</b> (arriba a la derecha) y luego <b>Renderizar imagen</b>. Puedes guardarla en PNG o mandarla al lienzo de dibujo. ¡Truco: «Casa de ejemplo» en Añadir hace una casa completa de un clic!', target: '.s3-renderbtn', done: c.rendered },
    ];
    this.steps[0].enter?.();
    this.tick = () => this.check();
    for (const ev of ['change', 'select', 'view'] as const) this.offs.push(s.on(ev, this.tick));
  }
  private tick: () => void;
  private offs: (() => void)[] = [];
  private check() {
    const st = this.steps[this.i];
    if (st && st.done()) { this.i++; this.steps[this.i]?.enter?.(); }
    if (this.i >= this.steps.length) { this.stop(); return; }
  }
  stop() { for (const f of this.offs) f(); this.offs = []; this.end(); }
  render(body: HTMLElement) {
    this.check();
    const st = this.steps[this.i];
    if (!st) return;
    if (st.target) document.querySelector(st.target)?.classList.add('s3-hl');
    body.replaceChildren(
      h('div', { class: 's3-astitle' }, h('span', { class: 's3-asicon', html: I3.house }), h('span', null, `Tu primera casa · ${this.i + 1}/${this.steps.length}`)),
      h('div', { class: 's3-tutbar' }, h('span', { style: { width: `${(this.i / this.steps.length) * 100}%` } })),
      h('p', { class: 's3-tutstep' }, h('b', null, st.title)), h('p', { class: 's3-tuttext', html: st.text }),
      h('div', { class: 'mo-btnrow' },
        h('button', { type: 'button', class: 'btn sm', on: { click: () => { this.i++; this.steps[this.i]?.enter?.(); if (this.i >= this.steps.length) this.stop(); else this.render(body); } } }, 'Saltar paso'),
        h('button', { type: 'button', class: 'btn sm ghost', on: { click: () => this.stop() } }, 'Terminar')));
  }
}
