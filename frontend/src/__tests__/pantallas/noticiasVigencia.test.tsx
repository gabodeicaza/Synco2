import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('@/src/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'coordinador_general', name: 'Ana', project_ids: ['p1'] } }),
}));
jest.mock('@/src/proyecto-activo-context', () => ({ useProyectoActivo: () => ({ proyectoId: 'p1' }) }));
jest.mock('@/src/utils/pushNotifications', () => ({ triggerLocalNotification: jest.fn() }));
jest.mock('@/src/api', () => ({
  api: {
    listAnnouncements: jest.fn(),
    listAreas: jest.fn(),
    listNodes: jest.fn(),
    createAnnouncement: jest.fn(),
    updateAnnouncement: jest.fn(),
    deleteAnnouncement: jest.fn(),
  },
}));

import { api } from '@/src/api';
import Noticias from '@/app/(spec)/noticias';

const listar = api.listAnnouncements as jest.Mock;
const crear = api.createAnnouncement as jest.Mock;
const editar = api.updateAnnouncement as jest.Mock;

jest.setTimeout(30000);

const noticia = (extra: Record<string, unknown> = {}) => ({
  id: 'n1', project_id: 'p1', title: 'Corte de agua', body: 'Mañana', pinned: false,
  author_id: 'u1', author_name: 'Ana', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 3 * 3600 * 1000).toISOString(), ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  (api.listAreas as jest.Mock).mockResolvedValue([]);
  (api.listNodes as jest.Mock).mockResolvedValue([]);
  crear.mockResolvedValue(noticia());
  editar.mockResolvedValue(noticia());
});

describe('Noticias: vigencia (G-05)', () => {
  it('cada noticia muestra su vigencia y el tiempo que le queda', async () => {
    listar.mockResolvedValue([noticia({ vigencia_horas: 6 })]);
    render(<Noticias />);
    expect(await screen.findByText(/Dura 6 horas · Vence en 3 h/)).toBeTruthy();
  });

  it('una noticia anterior sin el campo se muestra con 24 horas', async () => {
    listar.mockResolvedValue([noticia()]);
    render(<Noticias />);
    expect(await screen.findByText(/Dura 24 horas/)).toBeTruthy();
  });

  it('al crear, publica con la vigencia elegida (24 h por defecto)', async () => {
    listar.mockResolvedValue([]);
    render(<Noticias />);
    fireEvent.press(await screen.findByLabelText('Agregar'));
    expect(screen.getByLabelText('24 horas').props.accessibilityState.selected).toBe(true);
    fireEvent.changeText(screen.getByPlaceholderText('Ej. Suspensión de actividades 18-jul'), 'Aviso');
    fireEvent.changeText(screen.getByPlaceholderText('Contenido completo del anuncio…'), 'Texto');
    fireEvent.press(screen.getByLabelText('48 horas'));
    fireEvent.press(screen.getByText('Publicar'));
    await waitFor(() => expect(crear).toHaveBeenCalledTimes(1));
    expect(crear.mock.calls[0][1].vigencia_horas).toBe(48);
  });

  it('al editar sin tocar la vigencia NO la envía (no reinicia el plazo)', async () => {
    listar.mockResolvedValue([noticia({ vigencia_horas: 48 })]);
    render(<Noticias />);
    fireEvent.press(await screen.findByLabelText('Editar'));
    expect(screen.getByLabelText('48 horas').props.accessibilityState.selected).toBe(true);
    fireEvent.press(screen.getByText('Guardar cambios'));
    await waitFor(() => expect(editar).toHaveBeenCalledTimes(1));
    expect(editar.mock.calls[0][1]).not.toHaveProperty('vigencia_horas');
  });

  it('al editar y cambiar la vigencia la envía y avisa que el plazo se cuenta desde ahora', async () => {
    listar.mockResolvedValue([noticia({ vigencia_horas: 24 })]);
    render(<Noticias />);
    fireEvent.press(await screen.findByLabelText('Editar'));
    fireEvent.press(screen.getByLabelText('7 días'));
    expect(screen.getByText(/desde este momento/)).toBeTruthy();
    fireEvent.press(screen.getByText('Guardar cambios'));
    await waitFor(() => expect(editar).toHaveBeenCalledTimes(1));
    expect(editar.mock.calls[0][1].vigencia_horas).toBe(168);
  });
});
