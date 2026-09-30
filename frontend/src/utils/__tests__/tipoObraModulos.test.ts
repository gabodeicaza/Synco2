import { MODULOS } from '../modulos';
import {
  esTipoElegible, moduloPayloadRecomendado, nombreTipoObra, puedeRestablecerModulos, TIPO_OBRA_DEFECTO,
} from '../tipoObraModulos';

const INFO = {
  id: 'carretera' as const,
  nombre: 'Carretera',
  descripcion: 'Terracerías y pavimentos',
  plantillas_recomendadas: [],
  modulos_por_defecto: {
    reportes_diarios: { seguridad_higiene: true, estado_tiempo: true },
    reportes_semanales: { seguridad_higiene: true },
    reportes_mensuales: {},
  },
};

describe('tipoObraModulos (K-13 / T-10)', () => {
  it('el tipo por defecto es «generica» y los tipos elegibles no incluyen «legado»', () => {
    expect(TIPO_OBRA_DEFECTO).toBe('generica');
    for (const tipo of ['generica', 'carretera', 'edificacion', 'hidraulica', 'puente']) expect(esTipoElegible(tipo)).toBe(true);
    for (const tipo of ['legado', '', null, undefined, 'x']) expect(esTipoElegible(tipo as any)).toBe(false);
  });

  it('nombre legible: del catálogo del servidor, de respaldo o «Personalizado» para el legado', () => {
    expect(nombreTipoObra('carretera', [{ ...INFO, nombre: 'Vialidad' }])).toBe('Vialidad');
    expect(nombreTipoObra('carretera')).toBe('Carretera');
    expect(nombreTipoObra('edificacion')).toBe('Edificación');
    expect(nombreTipoObra('legado')).toBe('Personalizado (proyecto anterior)');
    expect(nombreTipoObra(undefined)).toBe('Personalizado (proyecto anterior)');
  });

  it('solo un tipo elegible admite restablecer módulos', () => {
    expect(puedeRestablecerModulos('puente')).toBe(true);
    expect(puedeRestablecerModulos('legado')).toBe(false);
    expect(puedeRestablecerModulos(undefined)).toBe(false);
  });

  it('el cuerpo de restablecer manda las 8 claves de cada informe, con false en las no recomendadas', () => {
    const cuerpo = moduloPayloadRecomendado(INFO);
    for (const categoria of ['reportes_diarios', 'reportes_semanales', 'reportes_mensuales'] as const) {
      expect(Object.keys(cuerpo[categoria]).sort()).toEqual(MODULOS.map((m) => m.key).sort());
    }
    expect(cuerpo.reportes_diarios.seguridad_higiene).toBe(true);
    expect(cuerpo.reportes_diarios.estado_tiempo).toBe(true);
    expect(cuerpo.reportes_diarios.control_obra).toBe(false);
    expect(cuerpo.reportes_semanales.estado_tiempo).toBe(false);
    expect(Object.values(cuerpo.reportes_mensuales).every((v) => v === false)).toBe(true);
  });

  it('solo cuenta como recomendado un valor exactamente true; un catálogo vacío apaga todo', () => {
    const cuerpo = moduloPayloadRecomendado({ modulos_por_defecto: { reportes_diarios: { seguridad_higiene: 'si' as any } } as any });
    expect(cuerpo.reportes_diarios.seguridad_higiene).toBe(false);
    expect(Object.values(cuerpo.reportes_semanales).every((v) => v === false)).toBe(true);
  });
});
