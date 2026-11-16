import { describe, expect, it } from 'vitest';
import { mimeOf } from '../src/yosadraw/platform/android';
import { DEFAULT_TOUCH, normalizeTouch } from '../src/yosadraw/ui/Mobile';

describe('preferencias táctiles', () => {
  it('valores por defecto y saneado', () => {
    expect(normalizeTouch(null)).toEqual(DEFAULT_TOUCH);
    expect(normalizeTouch({ finger: 'navigate', hold: false, sliders: false, sliderSide: 'right', touchBoost: 60, penBoost: 0, fingerPressure: false, cleanup: false })).toEqual({ finger: 'navigate', hold: false, sliders: false, sliderSide: 'right', touchBoost: 60, penBoost: 0, fingerPressure: false, cleanup: false });
    expect(normalizeTouch({ touchBoost: 500, penBoost: -3 })).toMatchObject({ touchBoost: DEFAULT_TOUCH.touchBoost, penBoost: DEFAULT_TOUCH.penBoost });
    expect(normalizeTouch({ finger: 'volar', hold: 'x', sliderSide: 3 })).toEqual({ ...DEFAULT_TOUCH });
  });
});

describe('tipos MIME de exportación en Android', () => {
  it('imágenes van a la galería, el resto a Descargas', () => {
    expect(mimeOf('Dibujo.png')).toBe('image/png');
    expect(mimeOf('a.JPG')).toBe('image/jpeg');
    expect(mimeOf('a.tif')).toBe('image/tiff');
    expect(mimeOf('a.psd')).toBe('image/vnd.adobe.photoshop');
    expect(mimeOf('a.pdf')).toBe('application/pdf');
    expect(mimeOf('pincel.json')).toBe('application/json');
    expect(mimeOf('raro.xyz')).toBe('application/octet-stream');
  });
});
