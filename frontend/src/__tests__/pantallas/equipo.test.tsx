import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  useLocalSearchParams: () => ({ id: 'p1' }),
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({ readAsStringAsync: jest.fn() }));
jest.mock('@/src/utils/excel', () => ({ parseExcel: jest.fn(), mapEquipoRows: jest.fn() }));
jest.mock('@/src/utils/toast', () => ({ showToast: jest.fn() }));
jest.mock('@/src/api', () => ({
  api: { getProject: jest.fn(), setProjectCatalogos: jest.fn() },
}));

import { api } from '@/src/api';
import Equipo from '@/app/(coord)/projects/[id]/equipo';

const getProject = api.getProject as jest.Mock;
const setCatalogos = api.setProjectCatalogos as jest.Mock;

const NOMBRE = 'Nombre / Descripción';
const SERIE = 'Serie / Placas';
const AGREGAR = 'Agregar al catálogo';

async function abrir(existentes: string[] = []) {
  getProject.mockResolvedValue({ id: 'p1', categorias_equipo: existentes });
  render(<Equipo />);
  await waitFor(() => expect(getProject).toHaveBeenCalled());
  await screen.findByText(existentes.length ? existentes[0].split(' :: ')[0] : 'Aún no hay equipo registrado.');
}

function escribir(etiqueta: string, texto: string) {
  fireEvent.changeText(screen.getByLabelText(etiqueta), texto);
}

jest.setTimeout(30000);

beforeEach(() => {
  jest.clearAllMocks();
  setCatalogos.mockImplementation(async (_pid: string, body: any) => ({ id: 'p1', categorias_equipo: body.categorias_equipo }));
});

describe('Equipo (series)', () => {
  it('nombre vacío: el mensaje sale junto al campo, no en un Alert, y se borra al teclear (K-07, K-09)', async () => {
    await abrir();
    fireEvent.press(screen.getByText(AGREGAR));
    expect(screen.getByText('El nombre del equipo es obligatorio.')).toBeTruthy();
    expect(setCatalogos).not.toHaveBeenCalled();
    escribir(NOMBRE, 'G');
    expect(screen.queryByText('El nombre del equipo es obligatorio.')).toBeNull();
  });

  it('duplicado (sin acentos ni mayúsculas): el mensaje sale junto a la serie', async () => {
    await abrir(['Grúa :: CAT :: 320 :: A1']);
    escribir(NOMBRE, 'grua');
    escribir(SERIE, ' a1 ');
    fireEvent.press(screen.getByText(AGREGAR));
    expect(screen.getByText('Ya existe un equipo con ese nombre y serie.')).toBeTruthy();
    expect(setCatalogos).not.toHaveBeenCalled();
    escribir(SERIE, 'A2');
    expect(screen.queryByText('Ya existe un equipo con ese nombre y serie.')).toBeNull();
  });

  it('guarda el equipo y limpia el formulario', async () => {
    await abrir();
    escribir(NOMBRE, 'Retroexcavadora');
    escribir(SERIE, 'R-1');
    fireEvent.press(screen.getByText(AGREGAR));
    expect(screen.getByLabelText(NOMBRE).props.value).toBe('');
    await waitFor(() => expect(setCatalogos).toHaveBeenCalledTimes(1));
    expect(setCatalogos.mock.calls[0][1]).toEqual({ categorias_equipo: ['Retroexcavadora ::  ::  :: R-1'] });
    await screen.findByText('S/N: R-1');
  });

  it('si el guardado falla, devuelve lo capturado y avisa con el nombre (K-08)', async () => {
    await abrir();
    setCatalogos.mockRejectedValueOnce(Object.assign(new Error('Servidor caído'), { status: 500 }));
    escribir(NOMBRE, 'Grúa');
    escribir(SERIE, 'G-9');
    fireEvent.press(screen.getByText(AGREGAR));
    expect(screen.getByLabelText(NOMBRE).props.value).toBe('');
    await screen.findByText('No se guardó «Grúa». Vuelve a intentarlo. Servidor caído');
    expect(screen.getByLabelText(NOMBRE).props.value).toBe('Grúa');
    expect(screen.getByLabelText(SERIE).props.value).toBe('G-9');
  });

  it('dos capturas seguidas (Enter-Enter) se guardan las dos, en orden y sin pisarse', async () => {
    await abrir();
    let liberar!: () => void;
    setCatalogos.mockImplementationOnce(
      (_pid: string, body: any) => new Promise((r) => { liberar = () => r({ id: 'p1', categorias_equipo: body.categorias_equipo }); }),
    );
    escribir(NOMBRE, 'Grúa');
    fireEvent(screen.getByLabelText(NOMBRE), 'submitEditing');
    escribir(NOMBRE, 'Compresor');
    fireEvent(screen.getByLabelText(NOMBRE), 'submitEditing');
    await waitFor(() => expect(setCatalogos).toHaveBeenCalledTimes(1));
    expect(screen.getByText('2 por guardar…')).toBeTruthy();
    liberar();
    await waitFor(() => expect(setCatalogos).toHaveBeenCalledTimes(2));
    expect(setCatalogos.mock.calls[0][1].categorias_equipo).toEqual(['Grúa ::  ::  :: ']);
    expect(setCatalogos.mock.calls[1][1].categorias_equipo).toEqual(['Grúa ::  ::  :: ', 'Compresor ::  ::  :: ']);
    await waitFor(() => expect(screen.queryByText(/por guardar/)).toBeNull());
  });

  it('una captura repetida mientras la primera sigue pendiente se rechaza en línea', async () => {
    await abrir();
    setCatalogos.mockImplementationOnce(() => new Promise(() => undefined));
    escribir(NOMBRE, 'Grúa');
    fireEvent.press(screen.getByText(AGREGAR));
    escribir(NOMBRE, 'GRÚA');
    fireEvent.press(screen.getByText(AGREGAR));
    expect(screen.getByText('Ya existe un equipo con ese nombre y serie.')).toBeTruthy();
  });
});
