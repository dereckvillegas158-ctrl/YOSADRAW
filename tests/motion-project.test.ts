import { describe, expect, it } from 'vitest';
import { strToU8 } from 'fflate';
import { Document } from '../src/yosadraw/doc/Document';
import { mediaClip, newMotion, normalizeMotion, textClip, type MediaItem } from '../src/yosadraw/motion/model';
import { readProject, readProjectInfo, writeProject, type ImageCodec } from '../src/yosadraw/project/format';
import { collectMedia } from '../src/yosadraw/project/library';
import { MemoryBlobStore } from '../src/yosadraw/project/store';

const codec: ImageCodec = { async encode() { return strToU8('{}'); }, async decode() { return {} as CanvasImageSource; } };
const meta = { id: 'p1', name: 'Vídeo', width: 1920, height: 1080, dpi: 72, background: '#ffffff', profile: 'srgb' as const, created: 1, modified: 2, layers: 1, anim: null, motion: null, source: 'yosa', rev: 1, app: 'test' };
const media = (id: string, kind: MediaItem['kind'] = 'video'): MediaItem => ({ id, name: `${id}.mp4`, kind, mime: 'video/mp4', size: 3, w: 640, h: 360, dur: 4, fps: 30, frames: 120, hasAudio: true, folder: '', added: 1 });

function videoDoc() {
  const doc = new Document(1920, 1080, { background: '#ffffff', dpi: 72, profile: 'srgb' });
  const m = newMotion(1920, 1080, 30, 12);
  m.media.push(media('mdA'));
  const comp = m.comps[0];
  const c = mediaClip(comp, m.media[0], comp.tracks[1].id, 1);
  c.tf.x = { v: 100, k: [{ t: 0, v: 0, e: 'inout' }, { t: 2, v: 500, e: 'bezier', b: [0.1, 0.7, 0.3, 1] }] };
  c.fx.push({ id: 'f1', fx: 'gauss', on: true, p: { radius: { v: 4 } } });
  comp.clips.push(c, textClip(comp, comp.tracks[0].id, 0, 'Hola'));
  comp.markers.push({ id: 'k', t: 3, name: 'Corte', color: '#ffb347' });
  doc.motion = m;
  return doc;
}

describe('proyecto de vídeo en .yosa', () => {
  it('guarda y abre el proyecto con clips, keyframes, efectos y marcadores', async () => {
    const doc = videoDoc();
    const bytes = await writeProject(doc, meta, { codec });
    const info = readProjectInfo(bytes);
    expect(info.meta.motion).toEqual({ fps: 30, dur: 12 });
    const r = await readProject(bytes, codec);
    expect(r.doc.motion).toEqual(doc.motion);
    expect(r.media).toBeUndefined();
  });

  it('un dibujo normal sigue sin vídeo (compatibilidad)', async () => {
    const r = await readProject(await writeProject(new Document(100, 100), { ...meta, width: 100, height: 100 }, { codec }), codec);
    expect(r.doc.motion).toBeNull();
    expect(r.meta.motion).toBeNull();
  });

  it('valida un vídeo dañado sin romper la app', () => {
    expect(normalizeMotion(null)).toBeNull();
    expect(normalizeMotion({ comps: [] })).toBeNull();
    const m = normalizeMotion({ comps: [{ id: 'c', w: 'x', fps: -3, clips: [{ id: 'a', track: 'nope', start: 0, dur: 1, tf: {} }, 7], tracks: [] }], media: [{ id: 'z' }, 5] })!;
    expect(m.comps[0].w).toBe(1920);
    expect(m.comps[0].fps).toBe(30);
    expect(m.comps[0].tracks.length).toBe(3);
    expect(m.comps[0].clips).toEqual([]);
    expect(m.media).toEqual([]);
    expect(m.main).toBe('c');
  });

  it('recopila los medios en el archivo y los recupera al abrirlo', async () => {
    const store = new MemoryBlobStore();
    await store.put('m/mdA', new Uint8Array([1, 2, 3]));
    await store.put('m/mdA.mp4', new Uint8Array([4, 5]));
    await store.put('m/mdA.proxy', new Uint8Array([9]));
    const doc = videoDoc();
    doc.motion!.media.push(media('mdB'));
    const bytes = await writeProject(doc, meta, { codec });
    const r = await collectMedia(bytes, store);
    expect(r.count).toBe(2);
    expect(r.missing).toEqual(['mdB.mp4']);
    const opened = await readProject(r.bytes, codec);
    expect([...opened.media!.keys()].sort()).toEqual(['m/mdA', 'm/mdA.mp4']);
    expect([...opened.media!.get('m/mdA')!]).toEqual([1, 2, 3]);
    expect(opened.doc.motion!.comps[0].clips.length).toBe(2);
  });
});
