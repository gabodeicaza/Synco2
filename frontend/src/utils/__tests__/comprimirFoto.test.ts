jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

import * as ImageManipulator from 'expo-image-manipulator';
import {
  bytesDeBase64, calcularTamanoDestino, LIMITE_BYTES, prepararFotoEvidencia,
} from '../comprimirFoto';

const manipular = ImageManipulator.manipulateAsync as jest.Mock;

beforeEach(() => manipular.mockReset());

describe('calcularTamanoDestino', () => {
  it('reduce el lado mayor a 1600 respetando la proporción', () => {
    expect(calcularTamanoDestino(4000, 3000)).toEqual({ ancho: 1600, alto: 1200, redimensionar: true });
    expect(calcularTamanoDestino(3000, 4000)).toEqual({ ancho: 1200, alto: 1600, redimensionar: true });
  });

  it('no amplía imágenes pequeñas ni exactamente del tope', () => {
    expect(calcularTamanoDestino(800, 600)).toEqual({ ancho: 800, alto: 600, redimensionar: false });
    expect(calcularTamanoDestino(1600, 900).redimensionar).toBe(false);
  });

  it('con medidas desconocidas no redimensiona', () => {
    expect(calcularTamanoDestino(0, 0).redimensionar).toBe(false);
  });

  it('nunca da un lado de cero píxeles en panorámicas extremas', () => {
    expect(calcularTamanoDestino(20000, 10)).toEqual({ ancho: 1600, alto: 1, redimensionar: true });
  });
});

describe('bytesDeBase64', () => {
  it('calcula los bytes reales, con o sin encabezado y con relleno', () => {
    expect(bytesDeBase64('QUJD')).toBe(3); // "ABC"
    expect(bytesDeBase64('QUI=')).toBe(2);
    expect(bytesDeBase64('QQ==')).toBe(1);
    expect(bytesDeBase64('data:image/jpeg;base64,QUJD')).toBe(3);
  });
});

describe('prepararFotoEvidencia', () => {
  it('comprime a JPEG 0.7, redimensiona y devuelve el data URI', async () => {
    manipular.mockResolvedValue({ base64: 'QUJD' });
    const r = await prepararFotoEvidencia({ uri: 'file:///f.jpg', width: 4000, height: 3000, base64: 'ORIGINAL' });
    expect(manipular).toHaveBeenCalledWith(
      'file:///f.jpg',
      [{ resize: { width: 1600 } }],
      { compress: 0.7, format: 'jpeg', base64: true },
    );
    expect(r).toEqual({ ok: true, dataUri: 'data:image/jpeg;base64,QUJD', bytes: 3, comprimida: true });
  });

  it('en foto vertical redimensiona por el alto', async () => {
    manipular.mockResolvedValue({ base64: 'QUJD' });
    await prepararFotoEvidencia({ uri: 'u', width: 3000, height: 4000 });
    expect(manipular.mock.calls[0][1]).toEqual([{ resize: { height: 1600 } }]);
  });

  it('una foto pequeña solo se recomprime, sin redimensionar', async () => {
    manipular.mockResolvedValue({ base64: 'QUJD' });
    await prepararFotoEvidencia({ uri: 'u', width: 800, height: 600 });
    expect(manipular.mock.calls[0][1]).toEqual([]);
  });

  it('si la compresión falla cae a la original y lo indica', async () => {
    manipular.mockRejectedValue(new Error('sin memoria'));
    const r = await prepararFotoEvidencia({ uri: 'u', width: 4000, height: 3000, base64: 'QUJD', mimeType: 'image/png' });
    expect(r).toEqual({ ok: true, dataUri: 'data:image/png;base64,QUJD', bytes: 3, comprimida: false });
  });

  it('si falla y tampoco hay base64 original, no hay datos', async () => {
    manipular.mockRejectedValue(new Error('x'));
    expect(await prepararFotoEvidencia({ uri: 'u' })).toEqual({ ok: false, motivo: 'sin_datos' });
  });

  it('rechaza una foto que aun comprimida pasa del límite', async () => {
    manipular.mockResolvedValue({ base64: 'A'.repeat(Math.ceil((LIMITE_BYTES * 4) / 3) + 8) });
    const r = await prepararFotoEvidencia({ uri: 'u', width: 800, height: 600 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toBe('demasiado_grande');
      expect(r.bytes).toBeGreaterThan(LIMITE_BYTES);
    }
  });
});
