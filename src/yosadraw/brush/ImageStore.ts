/**
 * Decodifica las imágenes de los presets (formas y granos importados) una sola
 * vez. La decodificación es asíncrona: quien dibuja consulta `get()` y, si aún
 * no está lista, se suscribe a `onReady` para repintar cuando lo esté.
 */
export class ImageStore {
  private map = new Map<string, { img: HTMLImageElement; ready: boolean }>();
  private listeners = new Set<() => void>();

  /** Identificador estable y barato de un data URL. */
  static key(dataUrl: string): string {
    let h = 2166136261;
    const step = Math.max(1, Math.floor(dataUrl.length / 4096));
    for (let i = 0; i < dataUrl.length; i += step) { h ^= dataUrl.charCodeAt(i); h = Math.imul(h, 16777619); }
    return `${dataUrl.length.toString(36)}_${(h >>> 0).toString(36)}`;
  }

  get(dataUrl: string): HTMLImageElement | null {
    const k = ImageStore.key(dataUrl);
    let e = this.map.get(k);
    if (!e) {
      const img = new Image();
      e = { img, ready: false };
      this.map.set(k, e);
      const entry = e;
      img.onload = () => { entry.ready = true; this.listeners.forEach(fn => fn()); };
      img.onerror = () => { /* imagen inválida: se ignora */ };
      img.src = dataUrl;
    }
    return e.ready ? e.img : null;
  }

  onReady(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}

/** Lee un archivo de imagen y lo reduce a `max` px de lado como PNG (para guardar en el preset). */
export async function fileToDataUrl(file: File, max = 512): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('No se pudo leer la imagen')); i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } finally { URL.revokeObjectURL(url); }
}
