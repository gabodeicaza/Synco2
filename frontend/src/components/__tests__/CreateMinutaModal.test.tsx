import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

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

import { api } from '@/src/api';
import { showToast } from '@/src/utils/toast';
import { CreateMinutaModal } from '../MinutasView';

const nodes: any[] = [{ id: 'n1', name: 'Frente 1', order: 1 }];
const members: any[] = [{ id: 'u1', name: 'Ana Pérez', role: 'especialista' }];

function abrir() {
  const onCreated = jest.fn();
  const onClose = jest.fn();
  render(
    <CreateMinutaModal
      visible
      onClose={onClose}
      onCreated={onCreated}
      projectId="p1"
      areas={[]}
      nodes={nodes}
      members={members}
    />,
  );
  return { onCreated, onClose };
}

const guardar = () => screen.getByLabelText('Guardar minuta');

function llenarFormularioValido() {
  fireEvent.changeText(screen.getByLabelText('Título'), 'Arranque de obra');
  fireEvent.press(screen.getByLabelText('Ubicación'));
  fireEvent.press(screen.getByText('Frente 1'));
  fireEvent.changeText(screen.getByLabelText('Descripción del acuerdo 1'), 'Entregar planos');
  fireEvent.press(screen.getByLabelText('Seleccionar responsable'));
  fireEvent.press(screen.getByText('Contratista'));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Nueva minuta: campos obligatorios (K-04)', () => {
  it('guardar vacío marca cada campo faltante junto al campo y no llama al servidor', async () => {
    abrir();
    await act(async () => { fireEvent.press(guardar()); });

    expect(screen.getByText('Escribe el título de la minuta.')).toBeTruthy();
    expect(screen.getByText('Selecciona la ubicación (nodo del proyecto).')).toBeTruthy();
    expect(screen.getByText('Describe el acuerdo.')).toBeTruthy();
    expect(screen.getByText('Selecciona un responsable.')).toBeTruthy();
    expect(screen.getByText('Revisa los campos marcados.')).toBeTruthy();
    expect(api.createMinuta).not.toHaveBeenCalled();
  });

  it('corregir un campo borra solo su error (K-09)', async () => {
    abrir();
    await act(async () => { fireEvent.press(guardar()); });

    fireEvent.changeText(screen.getByLabelText('Título'), 'Arranque');
    expect(screen.queryByText('Escribe el título de la minuta.')).toBeNull();
    expect(screen.getByText('Selecciona la ubicación (nodo del proyecto).')).toBeTruthy();
    expect(screen.getByText('Describe el acuerdo.')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('Descripción del acuerdo 1'), 'Entregar planos');
    expect(screen.queryByText('Describe el acuerdo.')).toBeNull();
    expect(screen.getByText('Selecciona un responsable.')).toBeTruthy();
  });

  it('elegir ubicación y responsable borra sus errores', async () => {
    abrir();
    await act(async () => { fireEvent.press(guardar()); });
    fireEvent.press(screen.getByLabelText('Ubicación'));
    fireEvent.press(screen.getByText('Frente 1'));
    expect(screen.queryByText('Selecciona la ubicación (nodo del proyecto).')).toBeNull();
    fireEvent.press(screen.getByLabelText('Seleccionar responsable'));
    fireEvent.press(screen.getByText('Contratista'));
    expect(screen.queryByText('Selecciona un responsable.')).toBeNull();
  });

  it('K-03 sigue vigente: fecha límite anterior a la reunión se marca en el acuerdo', async () => {
    abrir();
    llenarFormularioValido();
    fireEvent.changeText(screen.getByLabelText('Fecha de reunión'), '2026-09-23');
    fireEvent.changeText(screen.getByLabelText('Fecha límite del acuerdo 1'), '2026-09-22');
    await act(async () => { fireEvent.press(guardar()); });
    expect(screen.getByText(/no puede ser anterior a la fecha de la reunión/)).toBeTruthy();
    expect(api.createMinuta).not.toHaveBeenCalled();
  });
});

describe('Nueva minuta: guardado (K-08)', () => {
  it('un doble toque guarda una sola minuta y bloquea el botón mientras guarda', async () => {
    let terminar!: (m: { id: string }) => void;
    (api.createMinuta as jest.Mock).mockImplementation(() => new Promise((r) => { terminar = r; }));
    const { onCreated } = abrir();
    llenarFormularioValido();

    await act(async () => {
      fireEvent.press(guardar());
      fireEvent.press(guardar());
    });
    expect(api.createMinuta).toHaveBeenCalledTimes(1);
    expect(guardar().props.accessibilityState).toMatchObject({ disabled: true, busy: true });

    await act(async () => { terminar({ id: 'm1' }); });
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(api.createMinuta).toHaveBeenCalledTimes(1);
  });

  it('envía los datos ya recortados y con el responsable elegido', async () => {
    (api.createMinuta as jest.Mock).mockResolvedValue({ id: 'm1' });
    abrir();
    llenarFormularioValido();
    fireEvent.changeText(screen.getByLabelText('Título'), '  Arranque  ');
    await act(async () => { fireEvent.press(guardar()); });
    const [pid, payload] = (api.createMinuta as jest.Mock).mock.calls[0];
    expect(pid).toBe('p1');
    expect(payload).toMatchObject({
      titulo: 'Arranque',
      ubicacion_id: 'n1',
      acuerdos: [{ descripcion: 'Entregar planos', responsable_id: 'contratista' }],
    });
  });

  it('un error del servidor se muestra en línea y deja volver a intentar', async () => {
    (api.createMinuta as jest.Mock)
      .mockRejectedValueOnce(Object.assign(new Error('Ya existe una minuta con ese título.'), { status: 409 }))
      .mockResolvedValueOnce({ id: 'm1' });
    const { onCreated } = abrir();
    llenarFormularioValido();

    await act(async () => { fireEvent.press(guardar()); });
    expect(screen.getByText('Ya existe una minuta con ese título.')).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();

    await act(async () => { fireEvent.press(guardar()); });
    expect(api.createMinuta).toHaveBeenCalledTimes(2);
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it('un fallo de red da un aviso (toast), no un error en línea', async () => {
    (api.createMinuta as jest.Mock).mockRejectedValue(Object.assign(new Error('Network request failed'), { status: 0 }));
    abrir();
    llenarFormularioValido();
    await act(async () => { fireEvent.press(guardar()); });
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/conexión/i));
    expect(screen.queryByText('Network request failed')).toBeNull();
  });

  it('si el PDF no se sube, avisa con un toast y la minuta queda creada', async () => {
    (api.createMinuta as jest.Mock).mockResolvedValue({ id: 'm1' });
    (api.uploadMinutaPdf as jest.Mock).mockRejectedValue(new Error('falla'));
    const DocumentPicker = require('expo-document-picker');
    DocumentPicker.getDocumentAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///a.pdf', name: 'a.pdf' }] });
    const { onCreated } = abrir();
    llenarFormularioValido();
    await act(async () => { fireEvent.press(screen.getByText('Seleccionar PDF (una hoja)')); });
    await act(async () => { fireEvent.press(guardar()); });
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/PDF no se subió/));
    expect(onCreated).toHaveBeenCalledTimes(1);
  });
});
