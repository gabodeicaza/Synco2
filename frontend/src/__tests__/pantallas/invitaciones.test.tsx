import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => {
  const React = require('react');
  const router = { back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
  return {
    router,
    useRouter: () => router,
    useLocalSearchParams: () => ({ id: 'p1' }),
    useFocusEffect: (cb: () => void) => { React.useEffect(() => { cb(); }, [cb]); },
  };
});
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('@/src/components/ImportarInvitacionesModal', () => ({ ImportarInvitacionesModal: () => null }));
jest.mock('@/src/utils/toast', () => ({ showToast: jest.fn() }));
jest.mock('@/src/api', () => {
  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) { super(message); this.status = status; }
  }
  return {
    ApiError,
    api: {
      listInvitations: jest.fn(), listAreas: jest.fn(), createInvitation: jest.fn(),
      revokeInvitation: jest.fn(), updateTeamMember: jest.fn(),
    },
  };
});

import { api, ApiError } from '@/src/api';
import Invitaciones from '@/app/(coord)/projects/[id]/invitations';

const createInvitation = api.createInvitation as jest.Mock;

jest.setTimeout(30000);

async function abrirAsistente() {
  (api.listInvitations as jest.Mock).mockResolvedValue([]);
  (api.listAreas as jest.Mock).mockResolvedValue([{ id: 'a1', name: 'Topografía', color: '#0EA5E9', project_id: 'p1' }]);
  render(<Invitaciones />);
  await screen.findByText('Aún no hay invitaciones.');
  fireEvent.press(screen.getByText('Nueva invitación'));
  await act(async () => {});
  fireEvent.press(screen.getByText('Continuar')); // paso 0 (rol) -> paso 1 (datos)
}

beforeEach(() => jest.clearAllMocks());

describe('Asistente de invitación', () => {
  it('con los datos vacíos marca nombre y correo junto a cada campo (X-03)', async () => {
    await abrirAsistente();
    fireEvent.press(screen.getByText('Continuar'));
    expect(screen.getByText('El nombre es obligatorio.')).toBeTruthy();
    expect(screen.getByText('El correo es obligatorio.')).toBeTruthy();
  });

  it('el error de cada campo se borra en cuanto se corrige (K-09) y un correo mal escrito se explica', async () => {
    await abrirAsistente();
    fireEvent.press(screen.getByText('Continuar'));
    fireEvent.changeText(screen.getByLabelText('Nombre completo'), 'Ana Pérez');
    expect(screen.queryByText('El nombre es obligatorio.')).toBeNull();
    expect(screen.getByText('El correo es obligatorio.')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'ana@empresa');
    fireEvent.press(screen.getByText('Continuar'));
    expect(screen.getByText('Escribe un correo válido, por ejemplo nombre@empresa.com.')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'ana@empresa.com');
    expect(screen.queryByText(/Escribe un correo válido/)).toBeNull();
  });

  it('el especialista debe elegir área: el aviso sale en el paso del área', async () => {
    await abrirAsistente();
    fireEvent.changeText(screen.getByLabelText('Nombre completo'), 'Ana Pérez');
    fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'ana@empresa.com');
    fireEvent.press(screen.getByText('Continuar'));
    fireEvent.press(screen.getByText('Continuar'));
    expect(screen.getByText('Selecciona el área.')).toBeTruthy();
    fireEvent.press(screen.getByText('Topografía'));
    expect(screen.queryByText('Selecciona el área.')).toBeNull();
  });

  it('un correo ya usado (409) regresa a los datos y lo marca junto al correo', async () => {
    await abrirAsistente();
    fireEvent.changeText(screen.getByLabelText('Nombre completo'), 'Ana Pérez');
    fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'ana@empresa.com');
    fireEvent.press(screen.getByText('Continuar'));
    fireEvent.press(screen.getByText('Topografía'));
    fireEvent.press(screen.getByText('Continuar'));
    createInvitation.mockRejectedValue(new ApiError(409, 'conflicto'));
    fireEvent.press(screen.getByText('Generar'));
    expect(await screen.findByText('Ya existe un usuario con ese correo.')).toBeTruthy();
    expect(screen.getByLabelText('Correo electrónico')).toBeTruthy();
  });

  it('un fallo del servidor se muestra en línea, no en un Alert', async () => {
    await abrirAsistente();
    fireEvent.changeText(screen.getByLabelText('Nombre completo'), 'Ana Pérez');
    fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'ana@empresa.com');
    fireEvent.press(screen.getByText('Continuar'));
    fireEvent.press(screen.getByText('Topografía'));
    fireEvent.press(screen.getByText('Continuar'));
    createInvitation.mockRejectedValue(Object.assign(new Error('Sin cupo de invitaciones'), { status: 400 }));
    fireEvent.press(screen.getByText('Generar'));
    await waitFor(() => expect(screen.getByText('Sin cupo de invitaciones')).toBeTruthy());
  });
});
