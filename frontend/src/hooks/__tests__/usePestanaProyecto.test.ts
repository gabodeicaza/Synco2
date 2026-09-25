import { act, renderHook, waitFor } from '@testing-library/react-native';
import { usePestanaProyecto } from '../usePestanaProyecto';

const mockGetItem = jest.fn();
const mockSetItem = jest.fn();
jest.mock('@/src/utils/storage', () => ({
  storage: { getItem: (...a: any[]) => mockGetItem(...a), setItem: (...a: any[]) => mockSetItem(...a) },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockGetItem.mockResolvedValue('');
  mockSetItem.mockResolvedValue(true);
});

describe('usePestanaProyecto (P-04)', () => {
  it('arranca en Reportes si no hay nada guardado', async () => {
    const { result } = renderHook(() => usePestanaProyecto('p1'));
    await waitFor(() => expect(mockGetItem).toHaveBeenCalledWith('dirac_pestana_proyecto_p1', ''));
    expect(result.current[0]).toBe('reportes');
  });

  it('restaura la pestaña guardada de ese proyecto', async () => {
    mockGetItem.mockImplementation(async (k: string) => (k.endsWith('_p1') ? 'operacion' : 'configuracion'));
    const { result, rerender } = renderHook(({ pid }: { pid: string }) => usePestanaProyecto(pid), { initialProps: { pid: 'p1' } });
    await waitFor(() => expect(result.current[0]).toBe('operacion'));
    rerender({ pid: 'p2' });
    await waitFor(() => expect(result.current[0]).toBe('configuracion'));
  });

  it('un valor guardado inválido cae a Reportes', async () => {
    mockGetItem.mockResolvedValue('pestaña-vieja');
    const { result } = renderHook(() => usePestanaProyecto('p1'));
    await waitFor(() => expect(mockGetItem).toHaveBeenCalled());
    expect(result.current[0]).toBe('reportes');
  });

  it('al cambiar de pestaña la guarda por proyecto', async () => {
    const { result } = renderHook(() => usePestanaProyecto('p7'));
    await waitFor(() => expect(mockGetItem).toHaveBeenCalled());
    act(() => result.current[1]('configuracion'));
    expect(result.current[0]).toBe('configuracion');
    expect(mockSetItem).toHaveBeenCalledWith('dirac_pestana_proyecto_p7', 'configuracion');
  });

  it('si la persona toca una pestaña antes de que llegue la guardada, manda lo que tocó', async () => {
    let entregar!: (v: string) => void;
    mockGetItem.mockReturnValue(new Promise<string>((r) => { entregar = r; }));
    const { result } = renderHook(() => usePestanaProyecto('p1'));
    act(() => result.current[1]('operacion'));
    await act(async () => { entregar('configuracion'); });
    expect(result.current[0]).toBe('operacion');
  });

  it('si el almacenamiento falla no rompe y se queda en Reportes', async () => {
    mockGetItem.mockRejectedValue(new Error('roto'));
    mockSetItem.mockRejectedValue(new Error('roto'));
    const { result } = renderHook(() => usePestanaProyecto('p1'));
    await waitFor(() => expect(mockGetItem).toHaveBeenCalled());
    expect(result.current[0]).toBe('reportes');
    act(() => result.current[1]('operacion'));
    expect(result.current[0]).toBe('operacion');
  });
});
