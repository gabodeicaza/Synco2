// P-05: las pantallas de Minutas y Noticias (y Mensajes/Calendario del Coordinador) comparten el proyecto
// activo: elegirlo en una se refleja en las demás.
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ProyectoActivoProvider } from '@/src/proyecto-activo-context';
import MinutasHubScreen from '@/src/components/MinutasHubScreen';
import AnnouncementsHubScreen from '@/src/components/AnnouncementsHubScreen';

const mockListProjects = jest.fn();
const mockUsuario = { id: 'u1', role: 'coordinador_general', project_ids: [] as string[] };

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-router', () => {
  const R = require('react');
  return { useFocusEffect: (cb: () => void) => R.useEffect(cb, [cb]) };
});
jest.mock('@/src/api', () => ({ api: { listProjects: (...a: any[]) => mockListProjects(...a) } }));
jest.mock('@/src/auth-context', () => ({ useAuth: () => ({ user: mockUsuario }) }));
jest.mock('@/src/utils/storage', () => ({
  storage: { getItem: jest.fn().mockResolvedValue(''), setItem: jest.fn().mockResolvedValue(true) },
}));
jest.mock('@/src/components/MinutasView', () => {
  const { Text } = require('react-native');
  return { __esModule: true, default: ({ pid }: { pid: string }) => <Text>{`minutas:${pid}`}</Text> };
});
jest.mock('@/src/components/AnnouncementsView', () => {
  const { Text } = require('react-native');
  return { __esModule: true, default: ({ pid }: { pid: string }) => <Text>{`noticias:${pid}`}</Text> };
});

beforeEach(() => {
  mockListProjects.mockResolvedValue([
    { id: 'p1', name: 'Alfa' },
    { id: 'p2', name: 'Beta' },
  ]);
});

describe('proyecto activo compartido entre pantallas (P-05)', () => {
  it('Minutas y Noticias muestran el mismo proyecto y cambiarlo en una lo cambia en la otra', async () => {
    render(
      <ProyectoActivoProvider>
        <MinutasHubScreen />
        <AnnouncementsHubScreen />
      </ProyectoActivoProvider>,
    );
    await waitFor(() => expect(screen.getByText('minutas:p1')).toBeTruthy(), { timeout: 5000 });
    expect(screen.getByText('noticias:p1')).toBeTruthy();

    // Los dos hubs tienen su selector: se elige "Beta" en el de Minutas.
    await act(async () => { fireEvent.press(screen.getAllByText('Beta')[0]); });
    await waitFor(() => expect(screen.getByText('minutas:p2')).toBeTruthy(), { timeout: 5000 });
    expect(screen.getByText('noticias:p2')).toBeTruthy();
  });
});
