import React from 'react';
import { Modal } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useFocusEffect: jest.fn() }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('@/src/auth-context', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('@/src/utils/downloadBlob', () => ({ downloadBlob: jest.fn() }));
jest.mock('@/src/utils/confirm', () => ({ confirm: jest.fn() }));
jest.mock('@/src/utils/pushNotifications', () => ({
  triggerLocalNotification: jest.fn(),
  scheduleMinuteReminder: jest.fn(async () => undefined),
}));
jest.mock('@/src/utils/toast', () => ({ showToast: jest.fn() }));
jest.mock('@/src/api', () => ({
  api: { createMinuta: jest.fn(), uploadMinutaPdf: jest.fn() },
}));

import { CreateMinutaModal } from '../MinutasView';

jest.setTimeout(30000);

const nodes: any[] = [{ id: 'n1', name: 'Frente 1', order: 1 }];
const members: any[] = [{ id: 'u1', name: 'Ana Pérez', role: 'especialista' }];

function abrir() {
  render(
    <CreateMinutaModal
      visible
      onClose={jest.fn()}
      onCreated={jest.fn()}
      projectId="p1"
      areas={[]}
      nodes={nodes}
      members={members}
    />,
  );
}

const hojaAbierta = () => screen.queryAllByLabelText('Cerrar selector').length > 0;

describe('Nueva minuta: selectores como hojas dentro del mismo modal (K-06)', () => {
  it('sin selector abierto solo hay un Modal y ninguna hoja', () => {
    abrir();
    expect(screen.UNSAFE_getAllByType(Modal)).toHaveLength(1);
    expect(hojaAbierta()).toBe(false);
  });

  it.each([
    ['ubicación', 'Ubicación', 'Frente 1'],
    ['responsable', 'Seleccionar responsable', 'Contratista'],
  ])('la hoja de %s se abre dentro del mismo modal (no hay Modals anidados)', (_n, etiqueta, contenido) => {
    abrir();
    fireEvent.press(screen.getByLabelText(etiqueta));
    expect(screen.getByText(contenido)).toBeTruthy();
    expect(hojaAbierta()).toBe(true);
    expect(screen.UNSAFE_getAllByType(Modal)).toHaveLength(1);
  });

  it('la hoja de involucrados también es interna y muestra a los miembros', () => {
    abrir();
    fireEvent.press(screen.getByLabelText('Seleccionar involucrados'));
    expect(screen.getByText('Ana Pérez')).toBeTruthy();
    expect(screen.UNSAFE_getAllByType(Modal)).toHaveLength(1);
  });

  it('abrir otra hoja cierra la anterior: solo una a la vez', () => {
    abrir();
    fireEvent.press(screen.getByLabelText('Ubicación'));
    expect(screen.getByText('Frente 1')).toBeTruthy();
    // Con la hoja abierta el fondo queda oculto para lectores de pantalla (accessibilityViewIsModal):
    // se alcanza con hidden:true para forzar una segunda apertura y comprobar la exclusividad.
    fireEvent.press(screen.getByLabelText('Seleccionar responsable', { hidden: true }));
    expect(screen.getByText('Contratista')).toBeTruthy();
    expect(screen.queryByText('Frente 1')).toBeNull();
    expect(screen.getAllByLabelText('Cerrar selector').length).toBeGreaterThan(0);
  });

  it('elegir una opción cierra la hoja y conserva lo demás del formulario', () => {
    abrir();
    fireEvent.changeText(screen.getByLabelText('Título'), 'Arranque de obra');
    fireEvent.press(screen.getByLabelText('Ubicación'));
    fireEvent.press(screen.getByText('Frente 1'));
    expect(hojaAbierta()).toBe(false);
    expect(screen.getByLabelText('Título').props.value).toBe('Arranque de obra');
  });

  it('el botón de cerrar de la hoja la cierra sin elegir nada', () => {
    abrir();
    fireEvent.press(screen.getByLabelText('Seleccionar responsable'));
    expect(hojaAbierta()).toBe(true);
    fireEvent.press(screen.getAllByLabelText('Cerrar selector')[0]);
    expect(hojaAbierta()).toBe(false);
    expect(screen.queryByText('Contratista')).toBeNull();
  });
});
