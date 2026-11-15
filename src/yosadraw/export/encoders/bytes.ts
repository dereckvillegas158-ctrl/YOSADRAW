/** Utilidades binarias para los codificadores. */
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(data: Uint8Array, start = 0, end = data.length, crc = 0xffffffff): number {
  for (let i = start; i < end; i++) crc = CRC_TABLE[(crc ^ data[i]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Búfer que crece al escribir. */
export class ByteWriter {
  private buf: Uint8Array;
  length = 0;
  constructor(initial = 1 << 16, private little = false) { this.buf = new Uint8Array(initial); }
  private grow(n: number) {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const b = new Uint8Array(size); b.set(this.buf.subarray(0, this.length)); this.buf = b;
  }
  u8(v: number) { this.grow(1); this.buf[this.length++] = v & 255; return this; }
  u16(v: number) { this.grow(2); if (this.little) { this.buf[this.length++] = v & 255; this.buf[this.length++] = (v >> 8) & 255; } else { this.buf[this.length++] = (v >> 8) & 255; this.buf[this.length++] = v & 255; } return this; }
  u32(v: number) {
    this.grow(4);
    const b = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    if (this.little) b.reverse();
    for (const x of b) this.buf[this.length++] = x;
    return this;
  }
  i32(v: number) { return this.u32(v >>> 0); }
  bytes(d: Uint8Array | number[]) { this.grow(d.length); this.buf.set(d, this.length); this.length += d.length; return this; }
  ascii(s: string) { for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i)); return this; }
  /** Sobrescribe un u32 en una posición ya escrita. */
  setU32(pos: number, v: number) {
    const b = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    if (this.little) b.reverse();
    this.buf.set(b, pos);
  }
  result(): Uint8Array { return this.buf.slice(0, this.length); }
}

export const latin1 = (s: string) => Uint8Array.from(s, c => c.charCodeAt(0) & 255);
