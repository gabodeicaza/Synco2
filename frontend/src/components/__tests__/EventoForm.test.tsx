import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { EventoForm } from '../EventoForm';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/src/utils/toast', () => ({ showToast: jest.fn() }));
jest.mock('@/src/api', () => ({
  api: {
    getProject: jest.fn(async () => ({ tz_offset_min: -360 })),
    createEvent: jest.fn(),
    updateEvent: jest.fn(),
  },
}));

import { api } from '@/src/api';
import { showToast } from '@/src/utils/toast';

const crearEvento = api.createEvent as jest.Mock;
const actualizarEvento = api.updateEvent as jest.Mock;

function montar(extra: Partial<React.ComponentProps<typeof EventoForm>> = {}) {
  const onSaved = jest.fn();
  const onClose = jest.fn();
  render(
    <EventoForm
      visible
      projectId="p1"
      members={[]}
      fechaInicial="2026-09-23"
      onSaved={onSaved}
      onClose={onClose}
      {...extra}
    />,
  );
  return { onSaved, onClose };
}

async function llenarTitulo(texto = 'Junta de obra') {
  fireEvent.changeText(screen.getByLabelText('Título'), texto);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('EventoForm', () => {
  it('sin título muestra el error junto al campo y no guarda', async () => {
    montar();
    await act(async () => { fireEvent.press(screen.getByText('Crear evento')); });
    expect(screen.getByText('El título es obligatorio.')).toBeTruthy();
    expect(crearEvento).not.toHaveBeenCalled();
  });

  it('la hora de fin anterior al inicio se marca en su campo y el error se borra al corregirla', async () => {
    montar();
    await llenarTitulo();
    fireEvent.changeText(screen.getByLabelText('Hora de inicio'), '10:00');
    fireEvent.changeText(screen.getByLabelText('Hora de fin (opcional)'), '09:00');
    await act(async () => { fireEvent.press(screen.getByText('Crear evento')); });
    expect(screen.getByText('La hora de fin debe ser posterior a la de inicio.')).toBeTruthy();
    expect(crearEvento).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByLabelText('Hora de fin (opcional)'), '11:00');
    expect(screen.queryByText('La hora de fin debe ser posterior a la de inicio.')).toBeNull();
  });

  it('una hora inválida muestra el mensaje con el rango permitido', async () => {
    montar();
    await llenarTitulo();
    fireEvent.changeText(screen.getByLabelText('Hora de inicio'), '25:00');
    await act(async () => { fireEvent.press(screen.getByText('Crear evento')); });
    expect(screen.getByText(/entre 00:00 y 23:59/)).toBeTruthy();
  });

  it('al crear con éxito guarda en la zona del proyecto, avisa, cierra y deja el formulario limpio', async () => {
    crearEvento.mockResolvedValue({});
    const { onSaved } = montar();
    await llenarTitulo();
    fireEvent.changeText(screen.getByLabelText('Hora de inicio'), '10:00');
    fireEvent.changeText(screen.getByLabelText('Hora de fin (opcional)'), '11:30');
    await act(async () => { fireEvent.press(screen.getByText('Crear evento')); });

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(crearEvento).toHaveBeenCalledWith('p1', expect.objectContaining({
      title: 'Junta de obra',
      start_at: '2026-09-23T16:00:00.000Z',
      end_at: '2026-09-23T17:30:00.000Z',
    }));
    expect(showToast).toHaveBeenCalledWith('Evento creado');
    expect(screen.getByLabelText('Título').props.value).toBe('');
    expect(screen.getByLabelText('Hora de fin (opcional)').props.value).toBe('');
  });

  it('un segundo toque mientras guarda no manda el evento dos veces', async () => {
    let terminar!: () => void;
    crearEvento.mockImplementation(() => new Promise((r) => { terminar = () => r({}); }));
    const { onSaved } = montar();
    await llenarTitulo();
    await act(async () => {
      fireEvent.press(screen.getByText('Crear evento'));
      fireEvent(screen.getByLabelText('Título'), 'submitEditing');
    });
    expect(crearEvento).toHaveBeenCalledTimes(1);
    await act(async () => { terminar(); });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it('un error de red da aviso y conserva lo capturado; otro error queda en línea', async () => {
    crearEvento.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 0 }));
    const { onSaved } = montar();
    await llenarTitulo();
    await act(async () => { fireEvent.press(screen.getByText('Crear evento')); });
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/conexión/i));
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Título').props.value).toBe('Junta de obra');

    crearEvento.mockRejectedValueOnce(Object.assign(new Error('Ya existe un evento igual'), { status: 409 }));
    await act(async () => { fireEvent.press(screen.getByText('Crear evento')); });
    expect(screen.getByText('Ya existe un evento igual')).toBeTruthy();
  });

  it('todo el día no pide horas y manda solo la fecha con all_day', async () => {
    crearEvento.mockResolvedValue({});
    montar();
    await llenarTitulo();
    fireEvent(screen.getByLabelText('Todo el día'), 'valueChange', true);
    expect(screen.queryByLabelText('Hora de inicio')).toBeNull();
    await act(async () => { fireEvent.press(screen.getByText('Crear evento')); });
    await waitFor(() => expect(crearEvento).toHaveBeenCalled());
    expect(crearEvento.mock.calls[0][1]).toEqual(expect.objectContaining({
      start_at: '2026-09-23', end_at: null, all_day: true,
    }));
  });

  it('al editar carga los datos del evento y guarda con updateEvent', async () => {
    actualizarEvento.mockResolvedValue({});
    const { onSaved } = montar({
      evento: {
        id: 'e1', project_id: 'p1', title: 'Visita', start_at: '2026-09-23T15:00:00.000Z',
        end_at: '2026-09-23T16:00:00.000Z', author_id: 'u', author_name: 'A', created_at: '', updated_at: '',
      },
    });
    await waitFor(() => expect(screen.getByLabelText('Título').props.value).toBe('Visita'));
    expect(screen.getByLabelText('Hora de inicio').props.value).toBe('09:00');
    expect(screen.getByText('Editar evento')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByText('Guardar')); });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(actualizarEvento).toHaveBeenCalledWith('e1', expect.objectContaining({ title: 'Visita' }));
  });
});
