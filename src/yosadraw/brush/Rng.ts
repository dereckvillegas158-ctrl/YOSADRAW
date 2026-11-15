/** PRNG con estado clonable (mulberry32): el mismo trazo produce siempre los mismos sellos. */
export class Rng {
  constructor(public state: number) { this.state = state >>> 0; }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** -1..1 */
  signed(): number { return this.next() * 2 - 1; }
}
