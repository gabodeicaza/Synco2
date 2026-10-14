// Autoguardado del formulario Nuevo: guarda tras una pausa o al ir a segundo plano,
// reutiliza el id (no duplica), y tras enviar borra el borrador sin que se recree.
import React from 'react';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;
import { AppState } from 'react-native';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Mini renderHook (sin depender de @testing-library): monta un componente que expone el hook.
function renderHook<P, R>(hook: (p: P) => R, opts: { initialProps: P } = { initialProps: undefined as any }) {
  const result = { current: undefined as any as R };
  function Arnes({ p }: { p: P }) { result.current = hook(p); return null; }
  let r: any;
  act(() => { r = TestRenderer.create(React.createElement(Arnes, { p: opts.initialProps })); });
  return { result, rerender: (p: P) => act(() => { r.update(React.createElement(Arnes, { p })); }) };
}

jest.mock('@/src/utils/borradores', () => {
  const real = jest.requireActual('@/src/utils/borradores');
  return { ...real, guardarBorrador: jest.fn(async () => true), eliminarBorrador: jest.fn(async () => undefined) };
});

import { guardarBorrador, eliminarBorrador, BorradorDatos } from '@/src/utils/borradores';
import { BorradorSnapshot, ESPERA_AUTOGUARDADO_MS, useBorradorAutoguardado } from '../useBorradorAutoguardado';

const datos = (extra: Partial<BorradorDatos> = {}): BorradorDatos => ({
  nombre: '', severidad: ['informativo'], registrarLecturas: false, unidad: 'm',
  primeraLectura: '', ultimaLectura: '', actividades: '', observaciones: '', incidencias: '',
  personal: [], equipo: [], camposExtra: {}, images: [], captions: ['', ''],
  templateId: '', dynamicData: {}, ...extra,
});
const snap = (extra: Partial<BorradorDatos> = {}): BorradorSnapshot => ({
  projectId: 'p1', nodeId: 'n1', ubicacion: ['A'], datos: datos(extra),
});

const guardar = guardarBorrador as jest.Mock;
const eliminar = eliminarBorrador as jest.Mock;

beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
afterEach(() => { jest.useRealTimers(); });

describe('useBorradorAutoguardado', () => {
  it('no guarda un formulario vacío', async () => {
    const { result } = renderHook(() => useBorradorAutoguardado('u1', snap(), true));
    expect(await result.current.guardarAhora()).toBe('vacio');
    act(() => { jest.advanceTimersByTime(ESPERA_AUTOGUARDADO_MS + 10); });
    expect(guardar).not.toHaveBeenCalled();
  });

  it('guarda tras la pausa de captura', async () => {
    renderHook(() => useBorradorAutoguardado('u1', snap({ actividades: 'Colado' }), true));
    expect(guardar).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(ESPERA_AUTOGUARDADO_MS + 10); });
    expect(guardar).toHaveBeenCalledTimes(1);
    expect(guardar.mock.calls[0][1].datos.actividades).toBe('Colado');
  });

  it('seguir capturando reinicia la espera', async () => {
    const { rerender } = renderHook((p: BorradorSnapshot) => useBorradorAutoguardado('u1', p, true), {
      initialProps: snap({ actividades: 'a' }),
    });
    await act(async () => { jest.advanceTimersByTime(ESPERA_AUTOGUARDADO_MS - 500); });
    rerender(snap({ actividades: 'ab' }));
    await act(async () => { jest.advanceTimersByTime(ESPERA_AUTOGUARDADO_MS - 500); });
    expect(guardar).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(600); });
    expect(guardar).toHaveBeenCalledTimes(1);
    expect(guardar.mock.calls[0][1].datos.actividades).toBe('ab');
  });

  it('guardados sucesivos reutilizan el mismo id', async () => {
    const { result } = renderHook(() => useBorradorAutoguardado('u1', snap({ actividades: 'x' }), true));
    await act(async () => { await result.current.guardarAhora(); await result.current.guardarAhora(); });
    expect(guardar.mock.calls[0][1].id).toBe(guardar.mock.calls[1][1].id);
  });

  it('al retomar un borrador lo actualiza con su id', async () => {
    const { result } = renderHook(() => useBorradorAutoguardado('u1', snap({ actividades: 'x' }), true));
    act(() => result.current.adoptar('viejo'));
    await act(async () => { await result.current.guardarAhora(); });
    expect(guardar.mock.calls[0][1].id).toBe('viejo');
  });

  it('tras soltar, lo siguiente es un borrador nuevo (no pisa el anterior)', async () => {
    const { result } = renderHook(() => useBorradorAutoguardado('u1', snap({ actividades: 'x' }), true));
    act(() => result.current.adoptar('viejo'));
    await act(async () => { await result.current.guardarAhora(); });
    act(() => result.current.soltar());
    // soltar descarta la foto del formulario: sin render nuevo no hay nada que guardar
    expect(await result.current.guardarAhora()).toBe('vacio');
  });

  it('al enviar borra el borrador y ya no se vuelve a crear', async () => {
    const { result } = renderHook(() => useBorradorAutoguardado('u1', snap({ actividades: 'x' }), true));
    act(() => result.current.adoptar('b1'));
    await act(async () => { await result.current.marcarEnviado(); });
    expect(eliminar).toHaveBeenCalledWith('u1', 'b1');
    expect(await result.current.guardarAhora()).toBe('vacio');
    await act(async () => { jest.advanceTimersByTime(ESPERA_AUTOGUARDADO_MS + 10); });
    expect(guardar).not.toHaveBeenCalled();
  });

  it('al pasar a segundo plano guarda de inmediato', async () => {
    let oyente: ((s: string) => void) | undefined;
    const sub = { remove: jest.fn() };
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, fn: any) => { oyente = fn; return sub; }) as any);
    renderHook(() => useBorradorAutoguardado('u1', snap({ actividades: 'x' }), true));
    await act(async () => { oyente?.('background'); });
    expect(guardar).toHaveBeenCalledTimes(1);
  });

  it('inactivo (cargando) no guarda', async () => {
    renderHook(() => useBorradorAutoguardado('u1', snap({ actividades: 'x' }), false));
    await act(async () => { jest.advanceTimersByTime(ESPERA_AUTOGUARDADO_MS + 10); });
    expect(guardar).not.toHaveBeenCalled();
  });
});
