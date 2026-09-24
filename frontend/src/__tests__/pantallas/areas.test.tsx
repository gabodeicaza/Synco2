import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => {
  const React = require('react');
  return {
    router: { back: jest.fn() },
    useLocalSearchParams: () => ({ id: 'p1' }),
    useFocusEffect: (cb: () => void) => { React.useEffect(() => { cb(); }, [cb]); },
  };
});
jest.mock('@/src/utils/toast', () => ({ showToast: jest.fn() }));
jest.mock('@/src/api', () => {
  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) { super(message); this.status = status; }
  }
  return { ApiError, api: { listAreas: jest.fn(), createArea: jest.fn(), deleteArea: jest.fn() } };
});

import { api, ApiError } from '@/src/api';
import Areas from '@/app/(coord)/projects/[id]/areas';

const listAreas = api.listAreas as jest.Mock;
const createArea = api.createArea as jest.Mock;

const NOMBRE = 'Nombre de la disciplina';

async function abrirFormulario(areas: any[] = []) {
  listAreas.mockResolvedValue(areas);
  render(<Areas />);
  await waitFor(() => expect(listAreas).toHaveBeenCalled());
  await screen.findByText(areas.length ? areas[0].name : 'Aún no hay áreas');
  fireEvent.press(screen.getByText('Nueva área'));
}

jest.setTimeout(30000);

beforeEach(() => jest.clearAllMocks());

describe('Nueva área', () => {
  it('nombre vacío: error junto al campo y no se llama al servidor (K-07)', async () => {
    await abrirFormulario();
    fireEvent.press(screen.getByText('Crear área'));
    expect(screen.getByText('El nombre del área es obligatorio.')).toBeTruthy();
    expect(createArea).not.toHaveBeenCalled();
  });

  it('duplicado (sin acentos ni mayúsculas) y el error se borra al teclear (K-09)', async () => {
    await abrirFormulario([{ id: 'a1', name: 'Topografía', color: '#0EA5E9', project_id: 'p1' }]);
    fireEvent.changeText(screen.getByLabelText(NOMBRE), '  topografia ');
    fireEvent.press(screen.getByText('Crear área'));
    expect(screen.getByText('Ya existe un área con ese nombre.')).toBeTruthy();
    expect(createArea).not.toHaveBeenCalled();
    await act(async () => {}); // el campo vuelve a ser editable al terminar el intento
    fireEvent.changeText(screen.getByLabelText(NOMBRE), 'Topografía y');
    expect(screen.queryByText('Ya existe un área con ese nombre.')).toBeNull();
  });

  it('crea el área, cierra el formulario y lo deja limpio', async () => {
    await abrirFormulario();
    createArea.mockResolvedValue({ id: 'a2' });
    fireEvent.changeText(screen.getByLabelText(NOMBRE), ' Geotecnia ');
    fireEvent.press(screen.getByText('Crear área'));
    await waitFor(() => expect(createArea).toHaveBeenCalledTimes(1));
    expect(createArea.mock.calls[0][1]).toMatchObject({ name: 'Geotecnia', project_id: 'p1' });
    await waitFor(() => expect(screen.queryByLabelText(NOMBRE)).toBeNull());
    fireEvent.press(screen.getByText('Nueva área'));
    expect(screen.getByLabelText(NOMBRE).props.value).toBe('');
  });

  it('un 409 del servidor se muestra junto al campo', async () => {
    await abrirFormulario();
    createArea.mockRejectedValue(new ApiError(409, 'conflicto'));
    fireEvent.changeText(screen.getByLabelText(NOMBRE), 'Seguridad');
    fireEvent.press(screen.getByText('Crear área'));
    expect(await screen.findByText('Ya existe un área con ese nombre.')).toBeTruthy();
  });

  it('dos toques seguidos solo crean una vez (K-08)', async () => {
    await abrirFormulario();
    let liberar!: () => void;
    createArea.mockImplementation(() => new Promise((r) => { liberar = () => r({ id: 'a3' }); }));
    fireEvent.changeText(screen.getByLabelText(NOMBRE), 'Hidráulica');
    fireEvent.press(screen.getByText('Crear área'));
    // Enter llega antes de que el primer guardado termine (se llama directo: el campo ya está bloqueado)
    await act(async () => { screen.getByLabelText(NOMBRE).props.onSubmitEditing(); });
    expect(createArea).toHaveBeenCalledTimes(1);
    await act(async () => { liberar(); });
    await waitFor(() => expect(screen.queryByLabelText(NOMBRE)).toBeNull());
  });
});
