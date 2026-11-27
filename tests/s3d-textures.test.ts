import { describe, expect, it } from 'vitest';
import { texRole } from '../src/yosadraw/studio3d/io';

describe('Texturas: papel de cada imagen por su nombre', () => {
  it('reconoce las convenciones habituales (Substance, Blender, Sketchfab, glTF)', () => {
    expect(texRole('AK47_BaseColor.png')).toBe('color');
    expect(texRole('rifle_albedo.jpg')).toBe('color');
    expect(texRole('Glock_Diffuse.tga')).toBe('color');
    expect(texRole('Glock_Normal.png')).toBe('normal');
    expect(texRole('m4_nrm.png')).toBe('normal');
    expect(texRole('Gun_N.png')).toBe('normal');
    expect(texRole('Gun_Roughness.png')).toBe('rough');
    expect(texRole('Gun_Metallic.png')).toBe('metal');
    expect(texRole('Gun_Metalness.jpg')).toBe('metal');
    expect(texRole('Gun_AO.png')).toBe('ao');
    expect(texRole('Gun_AmbientOcclusion.png')).toBe('ao');
    expect(texRole('Gun_Emissive.png')).toBe('emissive');
    expect(texRole('Gun_ORM.png')).toBe('orm');
    expect(texRole('Default_metalRoughness.jpg')).toBe('mr');
    // Una palabra que termina en «n» no es un mapa de normales.
    expect(texRole('Camo_Pattern.png')).toBe('color');
  });
});
