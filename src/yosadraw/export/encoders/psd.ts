import { writePsdUint8Array, type BlendMode, type Layer, type Psd } from 'ag-psd';

export interface PsdLayerInput {
  name: string;
  opacity: number;
  blend: string;
  hidden: boolean;
  /** RGBA del recorte de la capa y su posición en el documento exportado. */
  data: Uint8ClampedArray;
  left: number;
  top: number;
  width: number;
  height: number;
}

const BLEND: Record<string, BlendMode> = {
  normal: 'normal', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten',
  'color-burn': 'color burn', 'color-dodge': 'color dodge', 'soft-light': 'soft light', 'hard-light': 'hard light', difference: 'difference',
};

/**
 * PSD de Photoshop (RGB 8 bits) con capas: nombre, opacidad, modo de fusión
 * y visibilidad, más la imagen combinada, la resolución y el perfil ICC.
 */
export function encodePSD(width: number, height: number, composite: Uint8ClampedArray, layers: PsdLayerInput[],
  o: { dpi: number; icc?: Uint8Array; compress: boolean }): Uint8Array {
  const children: Layer[] = layers.map(l => ({
    name: l.name.slice(0, 255), opacity: l.opacity, blendMode: BLEND[l.blend] ?? 'normal', hidden: l.hidden,
    left: l.left, top: l.top, right: l.left + l.width, bottom: l.top + l.height,
    imageData: { data: l.data, width: l.width, height: l.height },
  }));
  const psd: Psd = {
    width, height, channels: 4, bitsPerChannel: 8,
    children,
    imageData: { data: composite, width, height },
    imageResources: {
      resolutionInfo: { horizontalResolution: o.dpi, horizontalResolutionUnit: 'PPI', widthUnit: 'Inches', verticalResolution: o.dpi, verticalResolutionUnit: 'PPI', heightUnit: 'Inches' },
      ...(o.icc ? { iccProfile: o.icc } : {}),
    },
  };
  return writePsdUint8Array(psd, { noBackground: true, compress: o.compress, generateThumbnail: false });
}
