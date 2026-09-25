// K-01: las pantallas que antes NO tenían botón de regreso (Actividades generales, calendarios y la
// lista de mensajes) ahora muestran el botón "Volver" accesible; sin historial van al inicio del rol.
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));

const mockRouter = { back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true), push: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => ({}),
}));
jest.mock('@/src/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'especialista', name: 'Ana', project_ids: ['p1'] } }),
}));
jest.mock('@/src/proyecto-activo-context', () => ({ useProyectoActivo: () => ({ proyectoId: 'p1' }) }));
jest.mock('@/src/components/UniversalCalendar', () => ({ __esModule: true, default: () => null }));
jest.mock('@/src/components/RangoFechasPicker', () => ({ RangoFechasPicker: () => null }));
jest.mock('@/src/api', () => ({
  api: {
    listAreas: jest.fn().mockResolvedValue([]),
    listNodes: jest.fn().mockResolvedValue([]),
    getProject: jest.fn().mockResolvedValue({ id: 'p1', color_institucional: '#003366' }),
    listActividadesGenerales: jest.fn().mockResolvedValue([]),
    listChannels: jest.fn().mockResolvedValue([]),
  },
}));

import { ActividadesGeneralesScreen } from '@/src/components/ActividadesGeneralesScreen';
import CalendarioEsp from '@/app/(spec)/calendario';
import CalendarioSub from '@/app/(subcoord)/calendario';
import { MensajesView } from '@/app/(spec)/mensajes';

jest.setTimeout(30000);

beforeEach(() => {
  jest.clearAllMocks();
  mockRouter.canGoBack.mockReturnValue(true);
});

const botonVolver = () => screen.getByRole('button', { name: 'Volver' });

describe('K-01: pantallas que antes no tenían regreso', () => {
  it('Actividades generales muestra Volver y regresa en el historial', async () => {
    render(<ActividadesGeneralesScreen projectId="p1" />);
    fireEvent.press(await screen.findByRole('button', { name: 'Volver' }));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  it('Actividades generales sin historial va al inicio del rol (no queda atrapado)', async () => {
    mockRouter.canGoBack.mockReturnValue(false);
    render(<ActividadesGeneralesScreen projectId="p1" />);
    fireEvent.press(await screen.findByRole('button', { name: 'Volver' }));
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/(spec)');
  });

  it('Actividades generales respeta un fallbackHref explícito', async () => {
    mockRouter.canGoBack.mockReturnValue(false);
    render(<ActividadesGeneralesScreen projectId="p1" fallbackHref="/(coord)" />);
    fireEvent.press(await screen.findByRole('button', { name: 'Volver' }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/(coord)');
  });

  it('el calendario del Especialista muestra Volver', () => {
    render(<CalendarioEsp />);
    expect(botonVolver()).toBeTruthy();
    expect(screen.getByText('Calendario')).toBeTruthy();
  });

  it('el calendario del Subcoordinador muestra Volver y su respaldo es su propio inicio', () => {
    mockRouter.canGoBack.mockReturnValue(false);
    render(<CalendarioSub />);
    fireEvent.press(botonVolver());
    expect(mockRouter.replace).toHaveBeenCalledWith('/(subcoord)');
  });

  it('la lista de Mensajes con regreso muestra Volver', async () => {
    render(<MensajesView projectId="p1" conRegreso />);
    expect(await screen.findByRole('button', { name: 'Volver' })).toBeTruthy();
    expect(screen.getByText('Mensajes')).toBeTruthy();
  });

  it('la lista de Mensajes sin regreso (pestaña raíz del Coordinador) no lo muestra', async () => {
    render(<MensajesView projectId="p1" />);
    expect(await screen.findByText('Mensajes')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Volver' })).toBeNull();
  });
});
