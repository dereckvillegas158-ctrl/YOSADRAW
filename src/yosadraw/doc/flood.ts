/**
 * Relleno por inundación y operaciones de máscara sobre RGBA (lógica pura).
 * Se usa en el bote de pintura y en la varita mágica.
 */
export interface MaskResult { mask: Uint8Array; x0: number; y0: number; x1: number; y1: number; count: number }

/** Diferencia entre dos píxeles, comparando en premultiplicado (0..255). */
function diff(d: Uint8ClampedArray, o: number, r: number, g: number, b: number, a: number): number {
  const pa = d[o + 3];
  const dr = Math.abs((d[o] * pa - r * a) / 255), dg = Math.abs((d[o + 1] * pa - g * a) / 255), db = Math.abs((d[o + 2] * pa - b * a) / 255);
  return Math.max(dr, dg, db, Math.abs(pa - a));
}

/**
 * @param tolerance 0..255: diferencia máxima con el color del punto inicial.
 * @param contiguous false = todos los píxeles parecidos de la imagen.
 */
export function floodFill(data: Uint8ClampedArray, W: number, H: number, sx: number, sy: number, tolerance: number, contiguous = true): MaskResult {
  const mask = new Uint8Array(W * H);
  sx = Math.floor(sx); sy = Math.floor(sy);
  const res: MaskResult = { mask, x0: W, y0: H, x1: -1, y1: -1, count: 0 };
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return res;
  const so = (sy * W + sx) * 4;
  const r = data[so], g = data[so + 1], b = data[so + 2], a = data[so + 3];
  const ok = (i: number) => diff(data, i * 4, r, g, b, a) <= tolerance;
  const mark = (x: number, y: number) => {
    mask[y * W + x] = 255; res.count++;
    if (x < res.x0) res.x0 = x; if (x > res.x1) res.x1 = x; if (y < res.y0) res.y0 = y; if (y > res.y1) res.y1 = y;
  };
  if (!contiguous) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (ok(y * W + x)) mark(x, y);
    return res;
  }
  // Relleno por líneas (scanline) con pila explícita.
  const stack: number[] = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!, x0 = stack.pop()!;
    let x = x0;
    const row = y * W;
    if (mask[row + x] || !ok(row + x)) continue;
    while (x > 0 && !mask[row + x - 1] && ok(row + x - 1)) x--;
    let upOpen = false, downOpen = false;
    for (; x < W && !mask[row + x] && ok(row + x); x++) {
      mark(x, y);
      if (y > 0) {
        const u = row - W + x, can = !mask[u] && ok(u);
        if (can && !upOpen) { stack.push(x, y - 1); upOpen = true; } else if (!can) upOpen = false;
      }
      if (y < H - 1) {
        const dn = row + W + x, can = !mask[dn] && ok(dn);
        if (can && !downOpen) { stack.push(x, y + 1); downOpen = true; } else if (!can) downOpen = false;
      }
    }
  }
  return res;
}

/** Dilata la máscara n píxeles (cubre el borde suavizado de las líneas). */
export function dilate(m: MaskResult, W: number, H: number, n: number): MaskResult {
  if (n <= 0 || m.count === 0) return m;
  let cur = m.mask;
  const x0 = Math.max(0, m.x0 - n), y0 = Math.max(0, m.y0 - n), x1 = Math.min(W - 1, m.x1 + n), y1 = Math.min(H - 1, m.y1 + n);
  for (let k = 0; k < n; k++) {
    const next = cur.slice();
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      if (cur[i]) continue;
      // Vecindad de 8: también cubre las esquinas de las líneas.
      const l = x > 0, r = x < W - 1, u = y > 0, d = y < H - 1;
      if ((l && cur[i - 1]) || (r && cur[i + 1]) || (u && cur[i - W]) || (d && cur[i + W]) ||
        (l && u && cur[i - W - 1]) || (r && u && cur[i - W + 1]) || (l && d && cur[i + W - 1]) || (r && d && cur[i + W + 1])) next[i] = 255;
    }
    cur = next;
  }
  let count = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (cur[y * W + x]) count++;
  return { mask: cur, x0, y0, x1, y1, count };
}

/** Suaviza el borde (desenfoque 3×3) para un relleno antialias. */
export function softenEdges(m: MaskResult, W: number, H: number): MaskResult {
  if (!m.count) return m;
  const x0 = Math.max(0, m.x0 - 1), y0 = Math.max(0, m.y0 - 1), x1 = Math.min(W - 1, m.x1 + 1), y1 = Math.min(H - 1, m.y1 + 1);
  const out = new Uint8Array(W * H);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      s += m.mask[yy * W + xx]; n++;
    }
    // Conserva el interior opaco; sólo se suaviza el borde.
    out[y * W + x] = m.mask[y * W + x] ? Math.max(Math.round(s / n), 200) : Math.round(s / n / 2);
  }
  return { mask: out, x0, y0, x1, y1, count: m.count };
}

/** Recorta la máscara a su caja y la escribe como RGBA del color dado. */
export function maskToRGBA(m: MaskResult, W: number, color: [number, number, number]): { data: Uint8ClampedArray; w: number; h: number } {
  const w = m.x1 - m.x0 + 1, h = m.y1 - m.y0 + 1;
  const data = new Uint8ClampedArray(Math.max(0, w * h * 4));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = m.mask[(y + m.y0) * W + x + m.x0];
    if (!a) continue;
    const o = (y * w + x) * 4;
    data[o] = color[0]; data[o + 1] = color[1]; data[o + 2] = color[2]; data[o + 3] = a;
  }
  return { data, w, h };
}
