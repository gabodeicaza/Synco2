import { etiquetaDeCampo, mensajeDeError } from '../errores';

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
