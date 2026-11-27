import { h, toast } from '../../ui/dom';
import { CALIBERS, PART_ROLES, subtree, type Caliber, type Obj3, type PartRole, type Weapon3, type WeaponAction } from '../model';
import type { Studio3D } from '../Studio3D';
import type { Rows } from './Panels';

const FWD: [string, string, [number, number, number]][] = [['+z', 'Hacia +Z', [0, 0, 1]], ['-z', 'Hacia −Z', [0, 0, -1]], ['+x', 'Hacia +X', [1, 0, 0]], ['-x', 'Hacia −X', [-1, 0, 0]]];
const fwdKey = (f: [number, number, number]) => FWD.find(x => x[2].every((v, i) => Math.abs(v - f[i]) < 1e-6))?.[0] ?? '+z';

/** El arma de la que forma parte un objeto (o él mismo). */
export function weaponOf(s: Studio3D, o: Obj3): Obj3 | null {
  let x: Obj3 | undefined = o, g = 0;
  while (x && g++ < 40) { if (x.weapon) return x; x = x.parent ? s.obj(x.parent) : undefined; }
  return null;
}

/**
 * Panel del arma: convertir cualquier modelo en arma, asignar sus piezas, ajustar el
 * disparo (acción, calibre, munición, teclas, retroceso, fogonazo, casquillos) y mover
 * cada pieza con keyframes para animar recargas e inspecciones.
 */
export function weaponSection(r: Rows, s: Studio3D, o: Obj3) {
  const gun = weaponOf(s, o);
  if (gun && gun.id !== o.id) {
    r.sec('Pieza de un arma', h('p', { class: 'ctl-help' }, `Forma parte de «${gun.name}». Elige el arma para ajustar sus piezas y animarlas; esta pieza también se puede animar con keyframes como cualquier objeto.`), r.btns(['Elegir el arma', () => s.select([gun.id])]));
    return;
  }
  if (!gun) {
    if (o.kind !== 'group' && !subtree(s.scene, o.id).length) return;
    r.sec('Arma', h('p', { class: 'ctl-help' }, 'Convierte este modelo (por ejemplo uno importado de Blender) en un arma que funciona: dispara con fogonazo, expulsa casquillos, la corredera o el cerrojo hacen su ciclo, retrocede, recarga y se inspecciona. Las piezas se reconocen por su nombre (corredera / slide, cargador / magazine, gatillo / trigger…) y se pueden cambiar.'),
      r.btns(['Convertir en arma', () => { const n = s.convertToWeapon(o.id); toast(n ? `Arma lista: ${n} ${n === 1 ? 'pieza móvil reconocida' : 'piezas móviles reconocidas'}. Revisa «Piezas» abajo.` : 'Arma lista. Asigna sus piezas móviles en «Piezas».', 'ok'); }]));
    return;
  }
  const w = gun.weapon!, id = gun.id;
  const set = (patch: Partial<Weapon3>, live = false) => s.setWeapon([id], patch, live);
  const sub = subtree(s.scene, id).filter(x => x.kind === 'mesh' || x.kind === 'group');
  const partOf = (role: PartRole) => w.parts.find(p => p.role === role);
  r.sec('Arma',
    r.select('Acción', w.action, [['semi', 'Semiautomática (un disparo por pulsación)'], ['auto', 'Automática (mantener para ráfaga)'], ['pump', 'De bombeo'], ['bolt', 'De cerrojo'], ['revolver', 'Revólver']], v => set({ action: v as WeaponAction })),
    r.select('Calibre (casquillos)', w.caliber, (Object.keys(CALIBERS) as Caliber[]).map(k => [k, CALIBERS[k].label] as [string, string]), v => set({ caliber: v as Caliber })),
    r.plainNum('Balas por cargador', w.ammo, v => set({ ammo: Math.max(1, Math.round(v)) }), { min: 1, step: 1 }),
    w.action === 'auto' ? r.range('Cadencia', w.rpm, 200, 1400, 10, (v, live) => set({ rpm: v }, live), v => `${Math.round(v)} disparos/min`) : null,
    r.text('Tecla para disparar', w.fireKey, v => set({ fireKey: v.trim().slice(0, 12) })),
    r.text('Tecla para recargar', w.reloadKey, v => set({ reloadKey: v.trim().slice(0, 12) })),
    r.text('Tecla para inspeccionar', w.inspectKey, v => set({ inspectKey: v.trim().slice(0, 12) })),
    r.check('Dispara también con clic en la escena', w.fireClick, v => set({ fireClick: v })),
    r.range('Retroceso', w.recoil, 0, 2.5, 0.05, (v, live) => set({ recoil: v }, live)),
    r.range('Fogonazo', w.flash, 0, 3, 0.05, (v, live) => set({ flash: v }, live), v => (v > 0 ? v.toFixed(2) : 'No')),
    r.range('Luz del fogonazo', w.flashLight, 0, 3, 0.05, (v, live) => set({ flashLight: v }, live), v => (v > 0 ? v.toFixed(2) : 'Sin luz')),
    r.range('Tamaño de los casquillos', w.casingScale, 0.3, 4, 0.05, (v, live) => set({ casingScale: v }, live), v => `${Math.round(v * 100)} %`),
    r.check('Balas con impacto (chispas y empujan lo que tiene física)', w.bullets, v => set({ bullets: v })),
    r.check('Sacar y meter el cargador arrastrándolo con el ratón (en vivo)', w.magDrag, v => set({ magDrag: v })),
    r.select('El cañón apunta', fwdKey(w.fwd), FWD.map(([k, l]) => [k, l] as [string, string]), v => set({ fwd: FWD.find(x => x[0] === v)![2] })),
    h('p', { class: 'ctl-help' }, `En vivo (F5): ${w.fireKey.toUpperCase()} dispara${w.action === 'auto' ? ' (mantén para ráfaga)' : ''}, ${w.reloadKey.toUpperCase()} recarga (el cargador cae y entra otro), ${w.inspectKey.toUpperCase()} inspecciona.${w.magDrag ? ' Arrastra el cargador con el ratón para sacarlo; súbelo para meterlo.' : ''} Disparadores: «Arma»; en el programa: obj("${gun.name}").shoot(3), .reload(), .inspect().`));
  // Piezas: qué objeto hace cada papel.
  const opts: [string, string][] = [['', '—'], ...sub.map(x => [x.id, x.name] as [string, string])];
  r.sec('Piezas',
    h('p', { class: 'ctl-help' }, 'Cada pieza móvil es un objeto del arma. Su recorrido (cuánto se mueve o gira) sale de su papel y del tamaño del arma.'),
    ...PART_ROLES.map(([role, label]) => r.select(label, partOf(role)?.id ?? '', opts, v => s.setWeaponPart(id, role, v || null))),
    h('div', { class: 'mo-prop' }, h('label', { class: 'mo-lab' }, 'Boca del cañón (cm)'), ...w.muzzle.map((v, i) => num(v * 100, x => { const m = [...w.muzzle] as [number, number, number]; m[i] = x / 100; set({ muzzle: m }); }))),
    h('div', { class: 'mo-prop' }, h('label', { class: 'mo-lab' }, 'Ventana de expulsión (cm)'), ...w.eject.map((v, i) => num(v * 100, x => { const m = [...w.eject] as [number, number, number]; m[i] = x / 100; set({ eject: m }); }))));
  // Animar: cada pieza a mano, con keyframe.
  const moving = w.parts.filter(p => p.move.some(Boolean) || p.rot.some(Boolean));
  if (moving.length) r.sec('Animar las piezas (keyframes)',
    h('p', { class: 'ctl-help' }, 'Mueve cada pieza (0 = en reposo, 1 = recorrido completo) en el tiempo actual de la línea de tiempo y pulsa ◆ para guardar su keyframe: así se animan recargas, comprobaciones de recámara e inspecciones. Con la clave automática se guarda solo.'),
    ...moving.map(p => {
      const label = PART_ROLES.find(x => x[0] === p.role)?.[1] ?? p.role;
      const max = p.role === 'cylinder' ? 6 : p.role === 'mag' ? 1.4 : 1;
      const row = r.range(label, s.weaponPoseOf(id, p.role), 0, max, 0.01, (v, live) => { if (!live) s.weaponPose(id, p.role, v); });
      const key = h('button', { type: 'button', class: 'icon sm', title: `Keyframe de ${label.toLowerCase()} aquí`, 'aria-label': `Keyframe de ${label}`, on: { click: () => s.weaponPose(id, p.role, s.weaponPoseOf(id, p.role), true, `Keyframe: ${label}`) } }, '◆');
      return h('div', { class: 's3-poserow' }, row, key);
    }),
    r.btns(['Crear animación de inspección', () => { s.weaponInspect(id, 3); toast('Animación de inspección creada (3 s de keyframes desde el tiempo actual): edítala en la línea de tiempo.', 'ok'); }, 'Gira el arma, comprueba la recámara y saca un poco el cargador, con keyframes editables'],
      ['Poner en reposo', () => { for (const p of moving) s.weaponPose(id, p.role, 0, false, 'Arma en reposo'); }]));
}
function num(v: number, set: (v: number) => void) {
  const i = h('input', { type: 'number', class: 'mo-num', value: String(Math.round(v * 10) / 10), step: '0.1', style: { width: '58px' } }) as HTMLInputElement;
  i.addEventListener('keydown', e => e.stopPropagation());
  i.addEventListener('change', () => { const x = Number(i.value); if (isFinite(x)) set(x); });
  return i;
}
