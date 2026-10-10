import React from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { FormField } from '@/src/components/FormField';
import { useColaDeEnvios, useEnvio } from '../useEnvio';
import { useFormErrors } from '../useFormErrors';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/src/utils/toast', () => ({ showToast: jest.fn() }));
import { showToast } from '@/src/utils/toast';

describe('useFormErrors', () => {
  it('pone y borra el error de un campo (K-09)', () => {
    const { result } = renderHook(() => useFormErrors<'nombre' | 'clave'>());
    act(() => { result.current.poner('nombre', 'Falta el nombre'); result.current.poner('clave', 'Falta la clave'); });
    expect(result.current.errores).toEqual({ nombre: 'Falta el nombre', clave: 'Falta la clave' });
    act(() => result.current.limpiar('nombre'));
    expect(result.current.errores).toEqual({ clave: 'Falta la clave' });
  });

  it('alCambiar borra el error al corregir el campo y guarda el valor', () => {
    const valores: string[] = [];
    const { result } = renderHook(() => useFormErrors<'nombre'>());
    act(() => result.current.poner('nombre', 'Falta'));
    act(() => result.current.alCambiar<string>('nombre', (v) => valores.push(v))('Norte'));
    expect(result.current.errores.nombre).toBeUndefined();
    expect(valores).toEqual(['Norte']);
  });

  it('ponerTodos indica si hubo errores e ignora los vacíos', () => {
    const { result } = renderHook(() => useFormErrors<'a' | 'b'>());
    let hubo = false;
    act(() => { hubo = result.current.ponerTodos({ a: 'mal', b: undefined }); });
    expect(hubo).toBe(true);
    expect(result.current.errores).toEqual({ a: 'mal' });
    act(() => { hubo = result.current.ponerTodos({}); });
    expect(hubo).toBe(false);
  });

  it('un error de red da toast y no error en línea; otro error queda en línea', () => {
    const { result } = renderHook(() => useFormErrors());
    act(() => result.current.errorDeGuardado(Object.assign(new Error('x'), { status: 0 })));
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(result.current.errorGeneral).toBeNull();
    act(() => result.current.errorDeGuardado(Object.assign(new Error('Ya existe esa clave'), { status: 409 })));
    expect(result.current.errorGeneral).toBe('Ya existe esa clave');
  });
});

describe('useEnvio', () => {
  it('ignora un segundo envío mientras el primero sigue en curso (Enter-Enter)', async () => {
    const { result } = renderHook(() => useEnvio());
    let liberar!: () => void;
    const tarea = jest.fn(() => new Promise<void>((r) => { liberar = r; }));
    let primero!: Promise<unknown>;
    let segundo: unknown = 'sin-correr';
    await act(async () => {
      primero = result.current.ejecutar(tarea);
      segundo = await result.current.ejecutar(tarea);
    });
    expect(segundo).toBeUndefined();
    expect(tarea).toHaveBeenCalledTimes(1);
    expect(result.current.guardando).toBe(true);
    await act(async () => { liberar(); await primero; });
    expect(result.current.guardando).toBe(false);
  });

  it('se libera aunque la tarea falle', async () => {
    const { result } = renderHook(() => useEnvio());
    await act(async () => {
      await result.current.ejecutar(async () => { throw new Error('falla'); }).catch(() => undefined);
    });
    expect(result.current.guardando).toBe(false);
    const ok = jest.fn(async () => 1);
    await act(async () => { await result.current.ejecutar(ok); });
    expect(ok).toHaveBeenCalledTimes(1);
  });
});

describe('useColaDeEnvios', () => {
  it('guarda todas las capturas rápidas, en orden y una a la vez', async () => {
    const guardadas: string[] = [];
    let activas = 0;
    let maxActivas = 0;
    const guardar = async (c: string) => {
      activas += 1; maxActivas = Math.max(maxActivas, activas);
      await new Promise((r) => setTimeout(r, 5));
      guardadas.push(c);
      activas -= 1;
    };
    const { result } = renderHook(() => useColaDeEnvios<string>(guardar, () => undefined));
    await act(async () => {
      await Promise.all(['A', 'B', 'C'].map((c) => result.current.encolar(c)));
    });
    expect(guardadas).toEqual(['A', 'B', 'C']);
    expect(maxActivas).toBe(1);
    expect(result.current.pendientes).toBe(0);
  });

  it('una captura que falla se reporta y no detiene a las siguientes', async () => {
    const fallidas: string[] = [];
    const guardadas: string[] = [];
    const guardar = async (c: string) => { if (c === 'B') throw new Error('no'); guardadas.push(c); };
    const { result } = renderHook(() => useColaDeEnvios<string>(guardar, (c) => fallidas.push(c)));
    await act(async () => {
      await Promise.all(['A', 'B', 'C'].map((c) => result.current.encolar(c)));
    });
    expect(guardadas).toEqual(['A', 'C']);
    expect(fallidas).toEqual(['B']);
  });
});

describe('FormField', () => {
  it('muestra el error junto al campo y marca el campo obligatorio', () => {
    render(<FormField label="Nombre" value="" onChangeText={() => undefined} error="Falta el nombre" obligatorio />);
    expect(screen.getByText('Falta el nombre')).toBeTruthy();
    expect(screen.getByLabelText('Nombre')).toBeTruthy();
  });

  it('en un campo numérico abre el teclado decimal y reformatea al salir', () => {
    const cambios: string[] = [];
    render(<FormField label="Cantidad" value="1500" onChangeText={(v) => cambios.push(v)} numero={{ maxDecimales: 4 }} />);
    const input = screen.getByLabelText('Cantidad');
    expect(input.props.keyboardType).toBe('decimal-pad');
    fireEvent(input, 'blur');
    expect(cambios).toEqual(['1,500']);
  });

  it('no toca un valor inválido al salir (el error lo decide el formulario)', () => {
    const cambios: string[] = [];
    render(<FormField label="Cantidad" value="1,5" onChangeText={(v) => cambios.push(v)} numero={{}} />);
    fireEvent(screen.getByLabelText('Cantidad'), 'blur');
    expect(cambios).toEqual([]);
  });
});
