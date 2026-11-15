import { zlibSync } from 'fflate';
import { ByteWriter, latin1 } from './bytes';

export interface PdfPage {
  width: number;
  height: number;
  /** Píxeles intercalados (1 = gris, 3 = RGB), o un JPEG ya codificado en `jpeg`. */
  channels: 1 | 3;
  pixels?: Uint8Array;
  jpeg?: Uint8Array;
  /** Canal alfa (máscara suave); se omite si es totalmente opaco. */
  alpha?: Uint8Array;
}

export interface PdfOptions { dpi: number; title: string; icc?: Uint8Array; onProgress?: (f: number) => void }

const pdfString = (s: string) => `(${s.replace(/[\\()]/g, m => `\\${m}`).replace(/[^\x20-\x7e]/g, '?')})`;
const num = (n: number) => (Math.round(n * 1000) / 1000).toString();

/**
 * PDF 1.4 con una imagen por página a tamaño real (ancho × 72 / PPP puntos).
 * Transparencia como /SMask, color con /ICCBased cuando hay perfil.
 */
export function encodePDF(pages: PdfPage[], o: PdfOptions): Uint8Array {
  const w = new ByteWriter(1 << 20);
  const offsets: number[] = [];
  let nextId = 1;
  const reserve = () => nextId++;
  const begin = (id: number) => { offsets[id] = w.length; w.ascii(`${id} 0 obj\n`); };
  const end = () => w.ascii('endobj\n');
  const stream = (id: number, dict: string, data: Uint8Array) => {
    begin(id);
    w.ascii(`<< ${dict} /Length ${data.length} >>\nstream\n`).bytes(data).ascii('\nendstream\n');
    end();
  };

  w.ascii('%PDF-1.4\n%').bytes([0xe2, 0xe3, 0xcf, 0xd3]).ascii('\n');
  const catalogId = reserve(), pagesId = reserve(), infoId = reserve();
  let iccRgb = 0, iccGray = 0;
  if (o.icc) {
    // El perfil va con su número de componentes (3 RGB, 1 gris).
    const n = pages.some(p => p.channels === 1) ? 1 : 3;
    const id = reserve();
    stream(id, `/N ${n} /Alternate /${n === 1 ? 'DeviceGray' : 'DeviceRGB'} /Filter /FlateDecode`, zlibSync(o.icc, { level: 9 }));
    if (n === 1) iccGray = id; else iccRgb = id;
  }
  const pageIds: number[] = [];
  pages.forEach((p, i) => {
    const imgId = reserve();
    let smaskId = 0;
    if (p.alpha && p.alpha.some(a => a !== 255)) {
      smaskId = reserve();
      stream(smaskId, `/Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, zlibSync(p.alpha, { level: 6 }));
    }
    const icc = p.channels === 1 ? iccGray : iccRgb;
    const cs = icc ? `[/ICCBased ${icc} 0 R]` : p.channels === 1 ? '/DeviceGray' : '/DeviceRGB';
    const data = p.jpeg ?? zlibSync(p.pixels!, { level: 6 });
    stream(imgId, `/Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /${p.jpeg ? 'DCTDecode' : 'FlateDecode'}${smaskId ? ` /SMask ${smaskId} 0 R` : ''}`, data);
    const pw = (p.width * 72) / o.dpi, ph = (p.height * 72) / o.dpi;
    const contentId = reserve();
    stream(contentId, '', latin1(`q ${num(pw)} 0 0 ${num(ph)} 0 0 cm /Im0 Do Q`));
    const pageId = reserve();
    begin(pageId);
    w.ascii(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(pw)} ${num(ph)}] /Resources << /XObject << /Im0 ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>\n`);
    end();
    pageIds.push(pageId);
    o.onProgress?.((i + 1) / pages.length);
  });
  begin(pagesId); w.ascii(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>\n`); end();
  begin(catalogId); w.ascii(`<< /Type /Catalog /Pages ${pagesId} 0 R >>\n`); end();
  const d = new Date(), pad = (n: number) => String(n).padStart(2, '0');
  const date = `D:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  begin(infoId); w.ascii(`<< /Title ${pdfString(o.title)} /Producer (YOSADRAW) /Creator (YOSADRAW) /CreationDate (${date}) >>\n`); end();
  const xref = w.length;
  const count = nextId;
  w.ascii(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let i = 1; i < count; i++) w.ascii(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  w.ascii(`trailer\n<< /Size ${count} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return w.result();
}
