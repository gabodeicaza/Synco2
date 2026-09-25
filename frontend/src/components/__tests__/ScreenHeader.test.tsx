import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }),
}));
const mockRouter = { back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

import { ScreenHeader } from '../ScreenHeader';

beforeEach(() => {
  jest.clearAllMocks();
  mockRouter.canGoBack.mockReturnValue(true);
});

describe('ScreenHeader (K-01)', () => {
  it('muestra el título como encabezado accesible y el subtítulo', () => {
    render(<ScreenHeader title="Áreas" subtitle="3 áreas" />);
    expect(screen.getByRole('header').props.children).toBe('Áreas');
    expect(screen.getByText('3 áreas')).toBeTruthy();
  });

  it('el botón de regreso es accesible, mide al menos 44 pt y regresa en el historial', () => {
    render(<ScreenHeader title="Áreas" />);
    const boton = screen.getByRole('button', { name: 'Volver' });
    const estilo = Array.isArray(boton.props.style) ? Object.assign({}, ...boton.props.style) : boton.props.style;
    expect(estilo.width).toBeGreaterThanOrEqual(44);
    expect(estilo.height).toBeGreaterThanOrEqual(44);
    fireEvent.press(boton);
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  it('sin historial va a la ruta de respaldo en vez de quedarse atrapado', () => {
    mockRouter.canGoBack.mockReturnValue(false);
    render(<ScreenHeader title="Áreas" fallbackHref="/(coord)" />);
    fireEvent.press(screen.getByRole('button', { name: 'Volver' }));
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/(coord)');
  });

  it('onBack sustituye al regreso por defecto', () => {
    const onBack = jest.fn();
    render(<ScreenHeader title="Nodo" onBack={onBack} />);
    fireEvent.press(screen.getByRole('button', { name: 'Volver' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('showBack=false oculta el botón y right muestra las acciones', () => {
    render(<ScreenHeader title="Inicio" showBack={false} right={<Text>Acción</Text>} />);
    expect(screen.queryByRole('button', { name: 'Volver' })).toBeNull();
    expect(screen.getByText('Acción')).toBeTruthy();
  });

  it('con fondo de color el texto contrasta (fondo oscuro → texto claro)', () => {
    render(<ScreenHeader title="Proyecto" backgroundColor="#003366" />);
    const titulo = screen.getByRole('header');
    const estilo = Object.assign({}, ...[titulo.props.style].flat());
    expect(estilo.color.toLowerCase()).toBe('#ffffff');
  });

  it('reserva el área segura superior salvo que se pida lo contrario', () => {
    const { toJSON, rerender } = render(<ScreenHeader title="A" testID="h" />);
    const con = Object.assign({}, ...[(toJSON() as any).props.style].flat());
    expect(con.paddingTop).toBeGreaterThanOrEqual(20);
    rerender(<ScreenHeader title="A" testID="h" safeArea={false} />);
    const sin = Object.assign({}, ...[(toJSON() as any).props.style].flat());
    expect(sin.paddingTop).toBeLessThan(20);
  });
});
