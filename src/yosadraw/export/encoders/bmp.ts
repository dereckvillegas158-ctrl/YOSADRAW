import { ByteWriter } from './bytes';

/**
 * BMP con BITMAPV5HEADER: 32 bits con canal alfa (máscaras de bits) o 24 bits,
 * resolución en píxeles por metro y espacio de color sRGB o perfil incrustado.
 */
export function encodeBMP(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, o: { depth: 24 | 32; dpi?: number; icc?: Uint8Array }): Uint8Array {
  const bpp = o.depth / 8;
  const stride = Math.ceil((width * bpp) / 4) * 4;
  const pixelBytes = stride * height;
  const headerSize = 14 + 124;
  const profileOffset = 124 + pixelBytes; // relativo al inicio de BITMAPV5HEADER
  const total = headerSize + pixelBytes + (o.icc?.length ?? 0);
  const w = new ByteWriter(total, true);
  const ppm = Math.round((o.dpi ?? 72) / 0.0254);
  w.ascii('BM').u32(total).u16(0).u16(0).u32(headerSize);
  w.u32(124).i32(width).i32(height).u16(1).u16(o.depth).u32(o.depth === 32 ? 3 : 0).u32(pixelBytes).i32(ppm).i32(ppm).u32(0).u32(0);
  if (o.depth === 32) w.u32(0x00ff0000).u32(0x0000ff00).u32(0x000000ff).u32(0xff000000);
  else w.u32(0).u32(0).u32(0).u32(0);
  w.u32(o.icc ? 0x4d424544 /* 'MBED' */ : 0x73524742 /* 'sRGB' */);
  for (let i = 0; i < 9; i++) w.u32(0); // CIEXYZTRIPLE
  w.u32(0).u32(0).u32(0); // gamma
  w.u32(4); // LCS_GM_IMAGES
  w.u32(o.icc ? profileOffset : 0).u32(o.icc?.length ?? 0).u32(0);
  const row = new Uint8Array(stride);
  for (let y = height - 1; y >= 0; y--) { // de abajo arriba
    row.fill(0);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, j = x * bpp;
      row[j] = rgba[i + 2]; row[j + 1] = rgba[i + 1]; row[j + 2] = rgba[i];
      if (bpp === 4) row[j + 3] = rgba[i + 3];
    }
    w.bytes(row);
  }
  if (o.icc) w.bytes(o.icc);
  return w.result();
}
