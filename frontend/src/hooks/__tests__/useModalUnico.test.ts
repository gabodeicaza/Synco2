import { act, renderHook } from '@testing-library/react-native';
import { useModalUnico } from '../useModalUnico';

type Clave = 'a' | 'b' | 'c';

describe('useModalUnico (K-06)', () => {
  it('arranca sin modal abierto', () => {
    const { result } = renderHook(() => useModalUnico<Clave>());
    expect(result.current.abierto).toBeNull();
    expect(result.current.esta('a')).toBe(false);
  });

  it('abrir uno cierra el anterior en el mismo paso', () => {
    const { result } = renderHook(() => useModalUnico<Clave>());
    act(() => result.current.abrir('a'));
    expect(result.current.esta('a')).toBe(true);
    act(() => result.current.abrir('b'));
    expect(result.current.esta('a')).toBe(false);
    expect(result.current.esta('b')).toBe(true);
    expect(result.current.abierto).toBe('b');
  });

  it('abrir dos seguidos en el mismo render deja solo el último', () => {
    const { result } = renderHook(() => useModalUnico<Clave>());
    act(() => { result.current.abrir('a'); result.current.abrir('c'); });
    expect(result.current.abierto).toBe('c');
  });

  it('cerrar() cierra el actual; cerrar(clave) solo si es ese', () => {
    const { result } = renderHook(() => useModalUnico<Clave>());
    act(() => result.current.abrir('a'));
    act(() => result.current.cerrar('b'));
    expect(result.current.abierto).toBe('a');
    act(() => result.current.cerrar('a'));
    expect(result.current.abierto).toBeNull();
    act(() => result.current.abrir('c'));
    act(() => result.current.cerrar());
    expect(result.current.abierto).toBeNull();
  });

  it('cerrar sin nada abierto no falla', () => {
    const { result } = renderHook(() => useModalUnico<Clave>());
    act(() => result.current.cerrar());
    act(() => result.current.cerrar('a'));
    expect(result.current.abierto).toBeNull();
  });

  it('ponerVisible se comporta como un useState<boolean> por modal', () => {
    const { result } = renderHook(() => useModalUnico<Clave>());
    act(() => result.current.ponerVisible('a')(true));
    expect(result.current.visible('a')).toBe(true);
    act(() => result.current.ponerVisible('b')(true));
    expect(result.current.visible('a')).toBe(false);
    expect(result.current.visible('b')).toBe(true);
    // cerrar uno que no es el abierto no toca al abierto
    act(() => result.current.ponerVisible('a')(false));
    expect(result.current.visible('b')).toBe(true);
    act(() => result.current.ponerVisible('b')(false));
    expect(result.current.abierto).toBeNull();
  });

  it('una clave inexistente nunca aparece abierta', () => {
    const { result } = renderHook(() => useModalUnico<Clave>());
    act(() => result.current.abrir('a'));
    expect(result.current.esta('zzz' as Clave)).toBe(false);
  });

  it('acepta un modal abierto inicial', () => {
    const { result } = renderHook(() => useModalUnico<Clave>('b'));
    expect(result.current.esta('b')).toBe(true);
  });
});
