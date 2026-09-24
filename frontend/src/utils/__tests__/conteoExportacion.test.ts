import { interpretarConteo, verificarConteoExportacion } from '../conteoExportacion';

jest.mock('@/src/utils/toast', () => ({ showToast: jest.fn() }));
jest.mock('@/src/api', () => ({ api: { countExportReports: jest.fn() } }));

import { api } from '@/src/api';
import { showToast } from '@/src/utils/toast';

const conteo = api.countExportReports as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('interpretarConteo', () => {
  it('0 reportes es vacío; los de otra severidad se cuentan aparte', () => {
    expect(interpretarConteo({ reportes: 0, reportes_fuerza_trabajo: 0 })).toEqual({ vacio: true, otros: 0 });
    expect(interpretarConteo({ reportes: 0, reportes_fuerza_trabajo: 7 })).toEqual({ vacio: true, otros: 7 });
    expect(interpretarConteo({ reportes: 3, reportes_fuerza_trabajo: 8 })).toEqual({ vacio: false, otros: 5 });
  });
});

describe('verificarConteoExportacion', () => {
  it('pasa el periodo y los filtros al servidor', async () => {
    conteo.mockResolvedValue({ reportes: 2, reportes_fuerza_trabajo: 2 });
    const r = await verificarConteoExportacion('p1', 'week', { area_id: 'a1', period_type: 'semanal' });
    expect(conteo).toHaveBeenCalledWith('p1', 'week', { area_id: 'a1', period_type: 'semanal' });
    expect(r.vacio).toBe(false);
  });

  it('si el conteo falla por red NO bloquea la exportación y avisa con un toast', async () => {
    conteo.mockRejectedValue(Object.assign(new Error('x'), { status: 0 }));
    const r = await verificarConteoExportacion('p1', 'today', {});
    expect(r).toEqual({ vacio: false, otros: 0 });
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('si falla por otra causa tampoco bloquea (y no molesta con un toast de red)', async () => {
    conteo.mockRejectedValue(Object.assign(new Error('Proyecto no existe'), { status: 404 }));
    const r = await verificarConteoExportacion('p1', 'today', {});
    expect(r.vacio).toBe(false);
    expect(showToast).not.toHaveBeenCalled();
  });
});
