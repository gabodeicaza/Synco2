import { esErrorDeRed, etiquetaDeCampo, mensajeDeError } from '../errores';

describe('mensajeDeError', () => {
  it('deja pasar los mensajes de texto del backend', () => {
    expect(mensajeDeError('Solicitud ya resuelta')).toBe('Solicitud ya resuelta');
  });

  it('muestra "Precio unitario", no precio_unitario', () => {
    const detail = [{ loc: ['body', 'precio_unitario'], msg: 'Field required', type: 'missing' }];
    const msg = mensajeDeError(detail);
    expect(msg).toBe('Precio unitario: este dato es obligatorio');
    expect(msg).not.toMatch(/precio_unitario/);
  });

  it('traduce número inválido y une varios errores', () => {
    const detail = [
      { loc: ['body', 'cantidad'], msg: 'Input should be a valid number', type: 'float_parsing' },
      { loc: ['body', 'conceptos', 0, 'descripcion'], msg: 'Field required', type: 'missing' },
    ];
    expect(mensajeDeError(detail)).toBe('Cantidad: debe ser un número. Descripción: este dato es obligatorio');
  });

  it('conserva el mensaje en español de un validador propio', () => {
    const detail = [{ loc: ['body', 'cantidad_ejecutada'], msg: 'Value error, La cantidad debe ser un número.', type: 'value_error' }];
    expect(mensajeDeError(detail)).toBe('Cantidad ejecutada: La cantidad debe ser un número.');
  });

  it('nunca devuelve JSON crudo', () => {
    expect(mensajeDeError({ raro: true })).not.toMatch(/[{}[\]]/);
    expect(mensajeDeError([{ msg: 'x' }])).not.toMatch(/[{}[\]]/);
  });
});

describe('etiquetaDeCampo', () => {
  it('humaniza campos desconocidos', () => {
    expect(etiquetaDeCampo('nombre_completo')).toBe('Nombre completo');
  });
});

describe('esErrorDeRed', () => {
  it('detecta fallos de conexión', () => {
    expect(esErrorDeRed(new TypeError('Network request failed'))).toBe(true);
    expect(esErrorDeRed({ status: 0, message: 'x' })).toBe(true);
  });
  it('una respuesta del backend no es error de red', () => {
    expect(esErrorDeRed({ status: 403, message: 'La contraseña no es correcta' })).toBe(false);
  });
});
