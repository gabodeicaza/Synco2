import React from 'react';
import { Image, Pressable, Text } from 'react-native';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

configure({ asyncUtilTimeout: 8000 });

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => {
  const mockRouter = { back: jest.fn(), replace: jest.fn(), canGoBack: () => true };
  return { router: mockRouter, useRouter: () => mockRouter };
});
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('@/src/auth-context', () => ({ useAuth: () => ({ user: { role: 'coordinador_general' } }) }));
jest.mock('@/src/utils/confirm', () => ({ confirm: jest.fn(async () => true) }));
jest.mock('@/src/utils/permissions', () => ({ requestMediaLibraryPermission: jest.fn(async () => true) }));
jest.mock('@/src/components/PlanoMarkerOverlay', () => {
  const ReactLib = require('react');
  const { Pressable: P, Text: T } = require('react-native');
  return {
    PLANO_MARKER_ESTADO_COLOR: { sin_iniciar: '#f00', en_proceso: '#ff0', terminado: '#0f0' },
    PLANO_MARKER_ESTADO_LABEL: { sin_iniciar: 'Sin iniciar', en_proceso: 'En proceso', terminado: 'Terminado' },
    PlanoMarkerOverlay: ({ markers, onTap }: any) =>
      ReactLib.createElement(
        P,
        { accessibilityRole: 'button', accessibilityLabel: 'Tocar marcador', onPress: () => onTap(markers[0], 0.5, 0.5) },
        ReactLib.createElement(T, null, 'plano'),
      ),
  };
});

const marcador = { id: 'm1', tipo: 'punto', label: 'P-1', x: 0.5, y: 0.5, estatus: 'sin_iniciar' };
const plano = { id: 'pl1', nombre: 'Cimentación', imagen: 'file://plano.png', markers: [marcador] };

jest.mock('@/src/api', () => ({
  api: {
    getProject: jest.fn(async () => ({ id: 'p1', name: 'Proyecto' })),
    listPlanosAvance: jest.fn(async () => [plano]),
    getPlanoAvance: jest.fn(async () => plano),
    updatePlanoMarker: jest.fn(async () => marcador),
  },
}));

import PlanoAvanceScreen from '../PlanoAvanceScreen';

jest.setTimeout(30000);

async function abrirMarcador() {
  jest.spyOn(Image, 'getSize').mockImplementation(((_uri: string, ok: (w: number, h: number) => void) => ok(1000, 800)) as any);
  render(<PlanoAvanceScreen projectId="p1" />);
  fireEvent.press(await screen.findByText('Cimentación'));
  fireEvent.press(await screen.findByLabelText('Tocar marcador'));
  await screen.findByText('Estado');
}

describe('Plano de Avance: un solo modal a la vez (K-06 / A-12)', () => {
  it('al tocar un marcador se ve solo el modal de acciones', async () => {
    await abrirMarcador();
    expect(screen.getByText('P-1')).toBeTruthy();
    expect(screen.getByText('Renombrar')).toBeTruthy();
    expect(screen.queryByText('Renombrar marcador')).toBeNull();
  });

  it('Renombrar oculta el modal del marcador en vez de apilarse encima', async () => {
    await abrirMarcador();
    fireEvent.press(screen.getByText('Renombrar'));
    expect(screen.getByText('Renombrar marcador')).toBeTruthy();
    expect(screen.queryByText('Estado')).toBeNull();
  });

  it('Cancelar el renombrado regresa a las acciones del marcador', async () => {
    await abrirMarcador();
    fireEvent.press(screen.getByText('Renombrar'));
    fireEvent.press(screen.getAllByText('Cancelar')[0]);
    expect(screen.queryByText('Renombrar marcador')).toBeNull();
    expect(screen.getByText('Estado')).toBeTruthy();
  });

  it('cambiar el estado cierra el modal del marcador', async () => {
    await abrirMarcador();
    // 'En proceso' también está en la leyenda del plano; la opción del modal es la última.
    fireEvent.press(screen.getAllByText('En proceso').slice(-1)[0]);
    await waitFor(() => expect(screen.queryByText('Estado')).toBeNull());
  });
});

describe('capas del Plano de Avance (A-12)', () => {
  it('los modales quedan por encima de la imagen, el overlay y los controles', () => {
    const { CAPAS_PLANO } = require('@/src/utils/capasPlano');
    expect(CAPAS_PLANO.modal).toBeGreaterThan(CAPAS_PLANO.controles);
    expect(CAPAS_PLANO.controles).toBeGreaterThan(CAPAS_PLANO.overlay);
    expect(CAPAS_PLANO.overlay).toBeGreaterThan(CAPAS_PLANO.plano);
  });
});
