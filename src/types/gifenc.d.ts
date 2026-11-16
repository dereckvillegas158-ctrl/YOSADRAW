declare module 'gifenc' {
  type Format = 'rgb565' | 'rgb444' | 'rgba4444';
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, o?: { format?: Format; oneBitAlpha?: boolean | number; clearAlpha?: boolean; clearAlphaThreshold?: number; clearAlphaColor?: number }): number[][];
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: number[][], format?: Format): Uint8Array;
  export function GIFEncoder(o?: { auto?: boolean; initialCapacity?: number }): {
    writeFrame(index: Uint8Array, width: number, height: number, o?: { palette?: number[][]; delay?: number; repeat?: number; transparent?: boolean; transparentIndex?: number; dispose?: number; first?: boolean }): void;
    finish(): void;
    bytes(): Uint8Array;
  };
}
