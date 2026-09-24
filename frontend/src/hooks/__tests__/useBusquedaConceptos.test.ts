import { act, renderHook } from '@testing-library/react-native';
import { LIMITE_LISTA_POR_DEFECTO, RETRASO_BUSQUEDA_MS, useBusquedaConceptos } from '../useBusquedaConceptos';

jest.mock('@/src/api', () => ({ api: { searchConceptos: jest.fn() } }));
import { api } from '@/src/api';

const buscar = api.searchConceptos as jest.Mock;
const c = (id: string, clave: string) => ({ id, clave, descripcion: `Concepto ${clave}` }) as any;

function diferida<T>() {
  let resolver!: (v: T) => void;
  let rechazar!: (e: unknown) => void;
  const promesa = new Promise<T>((res, rej) => { resolver = res; rechazar = rej; });
  return { promesa, resolver, rechazar };
}

async function avanzar(ms: number) {
  await act(async () => { jest.advanceTimersByTime(ms); });
}

beforeEach(() => { jest.useFakeTimers(); buscar.mockReset(); });
afterEach(() => { jest.useRealTimers(); });

describe('useBusquedaConceptos', () => {
  it('con la búsqueda vacía carga la lista por defecto acotada', async () => {
    buscar.mockResolvedValue([c('1', '1.1'), c('2', '1.2')]);
    const { result } = renderHook(() => useBusquedaConceptos('p1', 'error'));
    expect(result.current.cargando).toBe(true);
    await avanzar(0);
    expect(buscar).toHaveBeenCalledWith('p1', { limit: LIMITE_LISTA_POR_DEFECTO });
    expect(result.current.results.map((r) => r.clave)).toEqual(['1.1', '1.2']);
    expect(result.current.cargando).toBe(false);
  });

  it('busca con retraso y el texto visible es el texto buscado', async () => {
    buscar.mockResolvedValue([]);
    const { result } = renderHook(() => useBusquedaConceptos('p1', 'error'));
    await avanzar(0);
    buscar.mockClear();
    act(() => result.current.setQuery('  1.1.  '));
    expect(result.current.query).toBe('  1.1.  ');
    expect(result.current.buscado).toBe('1.1.');
    expect(buscar).not.toHaveBeenCalled();
    await avanzar(RETRASO_BUSQUEDA_MS);
    expect(buscar).toHaveBeenCalledWith('p1', { q: '1.1.' });
  });

  it('"1.1." con resultados vacíos termina de cargar (no se queda cargando)', async () => {
    buscar.mockResolvedValue([]);
    const { result } = renderHook(() => useBusquedaConceptos('p1', 'error'));
    await avanzar(0);
    act(() => result.current.setQuery('1.1.'));
    await avanzar(RETRASO_BUSQUEDA_MS);
    expect(result.current.cargando).toBe(false);
    expect(result.current.results).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('descarta la respuesta tardía de una búsqueda anterior', async () => {
    const lenta = diferida<any[]>();
    buscar.mockResolvedValueOnce([]); // lista por defecto
    const { result } = renderHook(() => useBusquedaConceptos('p1', 'error'));
    await avanzar(0);

    buscar.mockReturnValueOnce(lenta.promesa); // "1." (lenta)
    act(() => result.current.setQuery('1.'));
    await avanzar(RETRASO_BUSQUEDA_MS);

    buscar.mockResolvedValueOnce([c('b', '1.1.1')]); // "1.1." (rápida)
    act(() => result.current.setQuery('1.1.'));
    await avanzar(RETRASO_BUSQUEDA_MS);
    expect(result.current.results.map((r) => r.clave)).toEqual(['1.1.1']);

    await act(async () => { lenta.resolver([c('a', '1.9')]); });
    expect(result.current.results.map((r) => r.clave)).toEqual(['1.1.1']);
    expect(result.current.cargando).toBe(false);
  });

  it('un error queda visible y reintentar vuelve a pedir', async () => {
    buscar.mockRejectedValueOnce(Object.assign(new Error('Sin conexión'), { status: 0 }));
    const { result } = renderHook(() => useBusquedaConceptos('p1', 'error'));
    await avanzar(0);
    expect(result.current.error).toBe('Sin conexión');
    expect(result.current.cargando).toBe(false);

    buscar.mockResolvedValueOnce([c('1', '1.1')]);
    act(() => result.current.reintentar());
    await avanzar(0);
    expect(result.current.error).toBeNull();
    expect(result.current.results).toHaveLength(1);
  });

  it('un error sin mensaje usa el texto de respaldo', async () => {
    buscar.mockRejectedValueOnce({});
    const { result } = renderHook(() => useBusquedaConceptos('p1', 'No se pudo cargar'));
    await avanzar(0);
    expect(result.current.error).toBe('No se pudo cargar');
  });

  it('limpiar vuelve a la lista por defecto', async () => {
    buscar.mockResolvedValue([]);
    const { result } = renderHook(() => useBusquedaConceptos('p1', 'error'));
    await avanzar(0);
    act(() => result.current.setQuery('acero'));
    await avanzar(RETRASO_BUSQUEDA_MS);
    buscar.mockClear();
    act(() => result.current.limpiar());
    await avanzar(0);
    expect(result.current.query).toBe('');
    expect(buscar).toHaveBeenCalledWith('p1', { limit: LIMITE_LISTA_POR_DEFECTO });
  });
});
