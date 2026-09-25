import { AppState } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { usePollingConFoco } from '../usePollingConFoco';

let mockEnfocada = true;
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockEnfocada }));

let manejadorAppState: ((estado: string) => void) | null = null;
const remover = jest.fn();

beforeEach(() => {
  jest.useFakeTimers();
  mockEnfocada = true;
  manejadorAppState = null;
  remover.mockClear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, fn: any) => {
    manejadorAppState = fn;
    return { remove: remover };
  }) as any);
  (AppState as any).currentState = 'active';
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('usePollingConFoco (G-07)', () => {
  it('consulta cada intervalo mientras está enfocada, sin refrescar al montar', () => {
    const tarea = jest.fn();
    renderHook(() => usePollingConFoco(tarea, 1000));
    expect(tarea).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(3000); });
    expect(tarea).toHaveBeenCalledTimes(3);
  });

  it('sin foco no consulta nunca', () => {
    mockEnfocada = false;
    const tarea = jest.fn();
    renderHook(() => usePollingConFoco(tarea, 1000));
    act(() => { jest.advanceTimersByTime(10000); });
    expect(tarea).not.toHaveBeenCalled();
  });

  it('al perder el foco se detiene y al recuperarlo refresca una vez y reanuda', () => {
    const tarea = jest.fn();
    const { rerender } = renderHook(() => usePollingConFoco(tarea, 1000));
    act(() => { jest.advanceTimersByTime(2000); });
    expect(tarea).toHaveBeenCalledTimes(2);

    mockEnfocada = false;
    rerender({});
    act(() => { jest.advanceTimersByTime(5000); });
    expect(tarea).toHaveBeenCalledTimes(2);

    mockEnfocada = true;
    rerender({});
    expect(tarea).toHaveBeenCalledTimes(3); // refresco al volver
    act(() => { jest.advanceTimersByTime(2000); });
    expect(tarea).toHaveBeenCalledTimes(5);
  });

  it('en segundo plano se detiene y al volver a activa refresca y reanuda', () => {
    const tarea = jest.fn();
    renderHook(() => usePollingConFoco(tarea, 1000));
    act(() => { manejadorAppState?.('background'); });
    act(() => { jest.advanceTimersByTime(5000); });
    expect(tarea).not.toHaveBeenCalled();

    act(() => { manejadorAppState?.('active'); });
    expect(tarea).toHaveBeenCalledTimes(1);
    act(() => { jest.advanceTimersByTime(2000); });
    expect(tarea).toHaveBeenCalledTimes(3);
  });

  it('con activo=false no consulta y al activarlo arranca', () => {
    const tarea = jest.fn();
    const { rerender } = renderHook(({ activo }: { activo: boolean }) => usePollingConFoco(tarea, 1000, activo), {
      initialProps: { activo: false },
    });
    act(() => { jest.advanceTimersByTime(3000); });
    expect(tarea).not.toHaveBeenCalled();
    rerender({ activo: true });
    act(() => { jest.advanceTimersByTime(2000); });
    expect(tarea).toHaveBeenCalledTimes(2);
  });

  it('al desmontar limpia el intervalo y el listener', () => {
    const tarea = jest.fn();
    const { unmount } = renderHook(() => usePollingConFoco(tarea, 1000));
    unmount();
    act(() => { jest.advanceTimersByTime(5000); });
    expect(tarea).not.toHaveBeenCalled();
    expect(remover).toHaveBeenCalled();
  });

  it('usa siempre la última versión de la tarea sin reiniciar el intervalo', () => {
    const a = jest.fn();
    const b = jest.fn();
    const { rerender } = renderHook(({ fn }: { fn: () => void }) => usePollingConFoco(fn, 1000), {
      initialProps: { fn: a },
    });
    rerender({ fn: b });
    act(() => { jest.advanceTimersByTime(1000); });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
});
