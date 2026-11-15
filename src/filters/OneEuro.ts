/**
 * Filtro "1€" (Casiez, Roussel y Vogel, CHI 2012), implementación propia.
 * Paso bajo adaptativo: la frecuencia de corte crece con la velocidad,
 * así que a baja velocidad elimina el temblor y a alta velocidad casi no
 * añade retraso. Versión 2D isótropa: un solo corte para ambos ejes, para que
 * el suavizado no dependa de la orientación del trazo.
 */
export function cutoffAlpha(cutoffHz: number, dtSec: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
}

export class OneEuro2D {
  minCutoff = 1;  // Hz
  beta = 0.01;    // Hz por (px/s)
  dCutoff = 1.5;  // Hz, suavizado de la velocidad estimada
  /** 1 = filtro 1€ clásico; 2 = dos polos en cascada (−12 dB/oct), mejor contra temblor. */
  order: 1 | 2 = 2;
  x = 0; y = 0;
  private x1 = 0; private y1 = 0;
  private rx = 0; private ry = 0;
  private dx = 0; private dy = 0;

  reset(x: number, y: number) { this.x = this.x1 = this.rx = x; this.y = this.y1 = this.ry = y; this.dx = 0; this.dy = 0; }

  filter(x: number, y: number, dtSec: number): void {
    const ad = cutoffAlpha(this.dCutoff, dtSec);
    // Derivada sobre la muestra cruda anterior (no la filtrada: el retraso del
    // propio filtro inflaría la velocidad y abriría el corte).
    this.dx += ad * ((x - this.rx) / dtSec - this.dx);
    this.dy += ad * ((y - this.ry) / dtSec - this.dy);
    this.rx = x; this.ry = y;
    const speed = Math.sqrt(this.dx * this.dx + this.dy * this.dy);
    // Con dos polos idénticos, el corte de cada uno se sube un 55% para que
    // el corte global (−3 dB) coincida con el de un solo polo.
    const fc = (this.minCutoff + this.beta * speed) * (this.order === 2 ? 1.554 : 1);
    const a = cutoffAlpha(fc, dtSec);
    if (this.order === 2) {
      this.x1 += a * (x - this.x1); this.y1 += a * (y - this.y1);
      this.x += a * (this.x1 - this.x); this.y += a * (this.y1 - this.y);
    } else {
      this.x += a * (x - this.x); this.y += a * (y - this.y);
    }
  }
  get speed() { return Math.sqrt(this.dx * this.dx + this.dy * this.dy); }
}

export class OneEuro1D {
  minCutoff = 2; beta = 1; dCutoff = 1.5;
  v = 0; private d = 0; private raw = 0;
  reset(v: number) { this.v = this.raw = v; this.d = 0; }
  filter(v: number, dtSec: number): number {
    const ad = cutoffAlpha(this.dCutoff, dtSec);
    this.d += ad * ((v - this.raw) / dtSec - this.d);
    this.raw = v;
    const a = cutoffAlpha(this.minCutoff + this.beta * Math.abs(this.d), dtSec);
    this.v += a * (v - this.v);
    return this.v;
  }
}
