import { ByteWriter, latin1 } from './bytes';

/**
 * Completa un JPEG del navegador: JFIF con la densidad en PPP y el perfil ICC
 * en segmentos APP2 "ICC_PROFILE" (se divide si supera 64 KB).
 */
export function jpegWithMeta(jpeg: Uint8Array, o: { dpi?: number; icc?: Uint8Array }): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('No es un JPEG válido');
  let pos = 2;
  const segments: Uint8Array[] = [];
  let hasJfif = false;
  // Copia los marcadores APPn iniciales; reescribe APP0 JFIF y descarta un ICC previo.
  while (pos + 4 <= jpeg.length && jpeg[pos] === 0xff && jpeg[pos + 1] >= 0xe0 && jpeg[pos + 1] <= 0xef) {
    const len = (jpeg[pos + 2] << 8) | jpeg[pos + 3];
    const seg = jpeg.slice(pos, pos + 2 + len);
    const id = String.fromCharCode(...seg.subarray(4, 9));
    if (seg[1] === 0xe0 && id === 'JFIF\0') {
      hasJfif = true;
      if (o.dpi) { const d = Math.min(65535, Math.round(o.dpi)); seg[11] = 1; seg[12] = d >> 8; seg[13] = d & 255; seg[14] = d >> 8; seg[15] = d & 255; }
      segments.push(seg);
    } else if (!(seg[1] === 0xe2 && String.fromCharCode(...seg.subarray(4, 15)) === 'ICC_PROFILE')) segments.push(seg);
    pos += 2 + len;
  }
  const w = new ByteWriter(jpeg.length + (o.icc?.length ?? 0) + 64);
  w.bytes([0xff, 0xd8]);
  if (!hasJfif) {
    const d = Math.min(65535, Math.round(o.dpi ?? 72));
    w.bytes([0xff, 0xe0, 0, 16]).bytes(latin1('JFIF\0')).bytes([1, 1, 1, d >> 8, d & 255, d >> 8, d & 255, 0, 0]);
  }
  segments.forEach((s, i) => {
    w.bytes(s);
    if (i === 0 && o.icc) writeIcc(w, o.icc);
  });
  if (!segments.length && o.icc) writeIcc(w, o.icc);
  w.bytes(jpeg.subarray(pos));
  return w.result();
}

function writeIcc(w: ByteWriter, icc: Uint8Array) {
  const max = 65519;
  const n = Math.ceil(icc.length / max);
  for (let i = 0; i < n; i++) {
    const part = icc.subarray(i * max, (i + 1) * max);
    w.bytes([0xff, 0xe2]).u16(part.length + 16).bytes(latin1('ICC_PROFILE\0')).u8(i + 1).u8(n).bytes(part);
  }
}
