import { describe, expect, it } from 'vitest';
import { Document, History } from '../src/yosadraw/doc/Document';
import { clipBaseOf, clipHidden, hasClipped } from '../src/yosadraw/doc/clip';

describe('máscara de recorte', () => {
  const setup = () => {
    const d = new Document(100, 100);
    const [a] = d.layers;
    const b = d.newLayer('B'), c = d.newLayer('C'), e = d.newLayer('E');
    d.layers.push(b, c, e);
    b.clip = true; c.clip = true;
    return { d, a, b, c, e };
  };
  it('varias capas seguidas comparten la base; una capa sin recorte corta la cadena', () => {
    const { d, a, b, c, e } = setup();
    expect(clipBaseOf(d.layers, b)).toBe(a);
    expect(clipBaseOf(d.layers, c)).toBe(a);
    expect(clipBaseOf(d.layers, e)).toBeNull();
    expect(hasClipped(d.layers, a)).toBe(true);
    expect(hasClipped(d.layers, c)).toBe(false);
    a.visible = false;
    expect(clipHidden(d.layers, b)).toBe(true);
    expect(clipHidden(d.layers, e)).toBe(false);
  });
  it('sin capa debajo no recorta; propiedades deshacibles', () => {
    const d = new Document(100, 100), h = new History();
    const l = d.layers[0];
    l.clip = true;
    expect(clipBaseOf(d.layers, l)).toBeNull();
    l.clip = false;
    h.exec(d.cmdLayerProps(l.id, { clip: true }));
    expect(l.clip).toBe(true);
    h.undo();
    expect(l.clip).toBe(false);
  });
  it('combinar una capa recortada con su base la conserva recortada (grupo sobre lo existente)', () => {
    const { d, a, b } = setup();
    b.items.push(d.item({ kind: 'clear' }));
    a.items.push(d.item({ kind: 'clear' }));
    d.layers.splice(2, 1); // quitar C
    new History().exec(d.cmdMergeDown(b.id)!);
    const last = a.items[a.items.length - 1];
    expect(last.kind).toBe('group');
    expect(last.lock).toBe(true);
  });
});
