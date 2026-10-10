import { t } from '@/src/i18n';
import { EXCEPCION_META, claveTituloExcepcion, etiquetaExcepcion, TipoExcepcion } from '../excepcionesMeta';

// Mismos valores que el `Literal` de ExcepcionEvmOut en el servidor (server.py).
const TIPOS_DEL_SERVIDOR: TipoExcepcion[] = [
  'fuera_de_ventana', 'atrasado', 'excedente_volumen', 'sobrecosto',
  'ajuste_negativo', 'acuerdo_vencido', 'sin_avance_en_ventana',
];

describe('EXCEPCION_META', () => {
  it('todo tipo de excepción tiene ícono y color', () => {
    for (const tipo of TIPOS_DEL_SERVIDOR) {
      expect(EXCEPCION_META[tipo]).toBeDefined();
      expect(EXCEPCION_META[tipo].icon).toEqual(expect.any(String));
      expect(EXCEPCION_META[tipo].color).toEqual(expect.any(String));
    }
    expect(Object.keys(EXCEPCION_META).sort()).toEqual([...TIPOS_DEL_SERVIDOR].sort());
  });

  it('todo tipo tiene un título es-MX (no cae al nombre de la clave)', () => {
    for (const tipo of TIPOS_DEL_SERVIDOR) {
      const clave = claveTituloExcepcion(tipo);
      const titulo = t(clave);
      expect(titulo).not.toBe(clave);
      expect(titulo.length).toBeGreaterThan(3);
    }
    expect(t(claveTituloExcepcion('acuerdo_vencido'))).toBe('Acuerdo vencido');
    expect(t(claveTituloExcepcion('sin_avance_en_ventana'))).toBe('Sin avance en su ventana');
  });

  it('sobre_meta ya no existe', () => {
    expect((EXCEPCION_META as Record<string, unknown>).sobre_meta).toBeUndefined();
  });
});

describe('etiquetaExcepcion', () => {
  it('con clave: "clave · descripción"', () => {
    expect(etiquetaExcepcion({ clave: '1.1', descripcion: 'Concreto' })).toBe('1.1 · Concreto');
  });

  it('sin clave (acuerdos, sobrecosto): solo la descripción, sin " · " suelto', () => {
    expect(etiquetaExcepcion({ clave: '', descripcion: 'Entregar planos' })).toBe('Entregar planos');
  });
});

describe('textos del bloque de excepciones', () => {
  it('título con el conteo y estado vacío en es-MX', () => {
    expect(t('excepciones.titulo', { n: 3 })).toBe('Lista por excepción (3)');
    expect(t('excepciones.vacio')).toMatch(/acuerdo vencido/);
  });
});
