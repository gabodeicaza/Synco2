import React from 'react';
import { Alert } from 'react-native';
import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { GastoRealForm } from '../GastoRealForm';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/src/utils/toast', () => ({ showToast: jest.fn() }));
jest.mock('@/src/api', () => ({
  api: { getProject: jest.fn(), createGastoReal: jest.fn() },
}));
import { api } from '@/src/api';
import { showToast } from '@/src/utils/toast';

// El primer render de un Modal es lento con toda la suite corriendo en paralelo.
jest.setTimeout(30000);
configure({ asyncUtilTimeout: 8000 });

const crear = api.createGastoReal as jest.Mock;
const proyecto = api.getProject as jest.Mock;

function montar(extra: Partial<React.ComponentProps<typeof GastoRealForm>> = {}) {
  const onSaved = jest.fn();
  const onClose = jest.fn();
  render(<GastoRealForm visible projectId="p1" onClose={onClose} onSaved={onSaved} {...extra} />);
  return { onSaved, onClose };
}

async function llenar(monto = '1,500.5', descripcion = 'Nómina semana 12') {
  await act(async () => {});
  fireEvent.changeText(screen.getByLabelText('Monto'), monto);
  fireEvent.changeText(screen.getByLabelText('Descripción'), descripcion);
}

beforeEach(() => {
  jest.clearAllMocks();
  proyecto.mockResolvedValue({ id: 'p1', separador_decimal: '.', zona_horaria: 'America/Mexico_City' });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

describe('GastoRealForm', () => {
  it('muestra los errores junto a cada campo y no usa Alert.alert', async () => {
    montar();
    await act(async () => {});
    fireEvent.changeText(screen.getByLabelText('Fecha'), '2026-02-31');
    fireEvent.press(screen.getByText('Guardar'));
    await waitFor(() => expect(screen.getByText(/fecha no es válida/)).toBeTruthy());
    expect(screen.getByText('Monto es obligatorio.')).toBeTruthy();
    expect(screen.getByText(/Describe brevemente/)).toBeTruthy();
    expect(crear).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('el error de un campo desaparece en cuanto se corrige (K-09)', async () => {
    montar();
    await act(async () => {});
    fireEvent.press(screen.getByText('Guardar'));
    await waitFor(() => expect(screen.getByText('Monto es obligatorio.')).toBeTruthy());
    fireEvent.changeText(screen.getByLabelText('Monto'), '10');
    expect(screen.queryByText('Monto es obligatorio.')).toBeNull();
    expect(screen.getByText(/Describe brevemente/)).toBeTruthy();
  });

  it('envía el monto normalizado con punto y limpia el formulario al guardar', async () => {
    const { onSaved } = montar();
    crear.mockResolvedValue({});
    await llenar('1,500.5');
    fireEvent.press(screen.getByText('Guardar'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(crear).toHaveBeenCalledWith('p1', expect.objectContaining({
      monto: '1500.5', concepto_texto: 'Nómina semana 12', concepto_clave: undefined,
    }));
    expect(showToast).toHaveBeenCalledWith('Gasto registrado');
    expect(screen.getByLabelText('Monto').props.value).toBe('');
    expect(screen.getByLabelText('Descripción').props.value).toBe('');
  });

  it('acepta un gasto que supera cualquier presupuesto (AC > BAC no bloquea)', async () => {
    const { onSaved } = montar();
    crear.mockResolvedValue({});
    await llenar('999,999,999.99');
    fireEvent.press(screen.getByText('Guardar'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(crear.mock.calls[0][1].monto).toBe('999999999.99');
  });

  it('un segundo toque mientras guarda no envía dos veces (K-08)', async () => {
    const { onSaved } = montar();
    let liberar!: () => void;
    crear.mockReturnValue(new Promise<void>((r) => { liberar = r; }));
    await llenar();
    const boton = screen.getByText('Guardar');
    fireEvent.press(boton);
    fireEvent.press(boton);
    expect(screen.queryByText('Guardar')).toBeNull(); // el botón quedó en estado "guardando"
    expect(screen.getByLabelText('Monto').props.editable).toBe(false);
    await act(async () => { liberar(); });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(crear).toHaveBeenCalledTimes(1);
  });

  it('un error de red da toast, conserva lo capturado y no cierra', async () => {
    const { onSaved } = montar();
    crear.mockRejectedValue(Object.assign(new Error('x'), { status: 0 }));
    await llenar();
    fireEvent.press(screen.getByText('Guardar'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/No hay conexión/)));
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Monto').props.value).toBe('1,500.5');
  });

  it('una clave inexistente (404) se avisa junto al campo de la clave', async () => {
    montar();
    crear.mockRejectedValue(Object.assign(new Error("No existe ningún concepto con clave 'X-9'"), { status: 404 }));
    await llenar();
    fireEvent.changeText(screen.getByLabelText('Clave del concepto (opcional)'), 'x-9');
    fireEvent.press(screen.getByText('Guardar'));
    await waitFor(() => expect(screen.getByText(/No existe ningún concepto/)).toBeTruthy());
  });

  it('usa el separador decimal del proyecto (coma)', async () => {
    proyecto.mockResolvedValue({ id: 'p1', separador_decimal: ',', zona_horaria: 'America/Mexico_City' });
    const { onSaved } = montar();
    crear.mockResolvedValue({});
    await llenar('1.500,25');
    fireEvent.press(screen.getByText('Guardar'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(crear.mock.calls[0][1].monto).toBe('1500.25');
  });

  it('el campo de monto abre el teclado numérico', async () => {
    montar();
    await act(async () => {});
    expect(screen.getByLabelText('Monto').props.keyboardType).toBe('decimal-pad');
  });
});
