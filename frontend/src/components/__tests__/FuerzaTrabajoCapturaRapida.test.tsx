import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { FuerzaTrabajoCapturaRapida } from '../FuerzaTrabajoCapturaRapida';

jest.setTimeout(30000);
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/src/utils/toast', () => ({ showToast: jest.fn() }));
jest.mock('@/src/auth-context', () => ({ useAuth: () => ({ user: { id: 'u2', scope_node_ids: [] } }) }));
jest.mock('@/src/utils/storage', () => ({
  storage: { getItem: jest.fn(async (_k: string, f: string) => f) },
}));
jest.mock('@/src/api', () => ({
  api: { getProject: jest.fn(), getTree: jest.fn(), createReport: jest.fn() },
}));

import { api } from '@/src/api';
import { showToast } from '@/src/utils/toast';

const hoja = { id: 'h1', name: 'Hoja A', is_leaf: true, children: [] };
const arbol = [{ id: 't1', name: 'Tramo 1', is_leaf: false, children: [hoja] }];

async function avanzar() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function abrir(props: Partial<React.ComponentProps<typeof FuerzaTrabajoCapturaRapida>> = {}) {
  const onClose = jest.fn();
  const onSaved = jest.fn();
  render(<FuerzaTrabajoCapturaRapida projectId="p1" visible onClose={onClose} onSaved={onSaved} {...props} />);
  await avanzar();
  await avanzar();
  return { onClose, onSaved };
}

async function elegirUbicacion() {
  fireEvent.press(screen.getByLabelText('Elegir ubicación'));
  fireEvent.press(screen.getByLabelText('Tramo 1 › Hoja A'));
}

beforeEach(() => {
  jest.clearAllMocks();
  (api.getProject as jest.Mock).mockResolvedValue({
    id: 'p1', constructora: 'Constructora X',
    categorias_personal: ['Albañiles', 'Peones'],
    categorias_equipo: ['Grúa :: :: :: '],
  });
  (api.getTree as jest.Mock).mockResolvedValue(arbol);
  (api.createReport as jest.Mock).mockResolvedValue({ id: 'r1' });
});

describe('FuerzaTrabajoCapturaRapida', () => {
  it('muestra las categorías del catálogo del proyecto', async () => {
    await abrir();
    expect(screen.getByLabelText('Cantidad de Albañiles')).toBeTruthy();
    expect(screen.getByLabelText('Cantidad de Peones')).toBeTruthy();
    expect(screen.getByLabelText('Cantidad de Grúa')).toBeTruthy();
  });

  it('guardar sin ubicación ni cantidades marca los errores junto a cada campo y no envía nada', async () => {
    await abrir();
    fireEvent.press(screen.getByLabelText('Guardar reporte'));
    await avanzar();
    expect(screen.getByText('Elige la ubicación donde se trabajó.')).toBeTruthy();
    expect(screen.getByText('Escribe la cantidad de al menos una categoría.')).toBeTruthy();
    expect(api.createReport).not.toHaveBeenCalled();
  });

  it('una cantidad inválida se marca en su categoría y se borra al corregirla', async () => {
    await abrir();
    await elegirUbicacion();
    fireEvent.changeText(screen.getByLabelText('Cantidad de Albañiles'), '2.5');
    fireEvent.press(screen.getByLabelText('Guardar reporte'));
    await avanzar();
    expect(screen.getByText(/Albañiles.*no admite decimales|Albañiles no admite decimales/)).toBeTruthy();
    expect(api.createReport).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByLabelText('Cantidad de Albañiles'), '4');
    expect(screen.queryByText(/no admite decimales/)).toBeNull();
  });

  it('envía un reporte mínimo con el payload esperado', async () => {
    const { onClose, onSaved } = await abrir();
    await elegirUbicacion();
    fireEvent.changeText(screen.getByLabelText('Cantidad de Albañiles'), '4');
    fireEvent.changeText(screen.getByLabelText('Cantidad de Grúa'), '1');
    fireEvent.press(screen.getByLabelText('Guardar reporte'));
    await avanzar();
    expect(api.createReport).toHaveBeenCalledTimes(1);
    expect((api.createReport as jest.Mock).mock.calls[0][0]).toEqual({
      project_id: 'p1',
      node_id: 'h1',
      title: 'Fuerza de trabajo',
      severidad: ['informativo'],
      personnel: ['4 Albañiles'],
      equipment: ['1 Grúa'],
      images: [],
      actividades: '',
      contratista: 'Constructora X',
      measurement_value: {},
      solo_fuerza_trabajo: true,
    });
    expect(showToast).toHaveBeenCalledWith('Reporte de fuerza de trabajo guardado');
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sin conexión el reporte queda encolado y se avisa', async () => {
    (api.createReport as jest.Mock).mockResolvedValue({ id: 'local-1', _queued: true });
    await abrir();
    await elegirUbicacion();
    fireEvent.changeText(screen.getByLabelText('Cantidad de Peones'), '3');
    fireEvent.press(screen.getByLabelText('Guardar reporte'));
    await avanzar();
    expect(showToast).toHaveBeenCalledWith('Sin conexión: el reporte se enviará cuando vuelva la señal.');
  });

  it('un error de red da toast y conserva lo capturado; otro error sale en línea', async () => {
    const { onClose } = await abrir();
    await elegirUbicacion();
    fireEvent.changeText(screen.getByLabelText('Cantidad de Peones'), '3');
    (api.createReport as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('x'), { status: 0 }));
    fireEvent.press(screen.getByLabelText('Guardar reporte'));
    await avanzar();
    expect(showToast).toHaveBeenCalledWith('No hay conexión. Revisa tu internet e inténtalo de nuevo.');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Cantidad de Peones').props.value).toBe('3');

    (api.createReport as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('Tu rol no puede capturar reportes'), { status: 403 }));
    fireEvent.press(screen.getByLabelText('Guardar reporte'));
    await avanzar();
    expect(screen.getByText('Tu rol no puede capturar reportes')).toBeTruthy();
  });

  it('doble toque envía una sola vez', async () => {
    await abrir();
    await elegirUbicacion();
    fireEvent.changeText(screen.getByLabelText('Cantidad de Peones'), '3');
    let liberar!: () => void;
    (api.createReport as jest.Mock).mockImplementationOnce(() => new Promise((r) => { liberar = () => r({ id: 'r1' }); }));
    fireEvent.press(screen.getByLabelText('Guardar reporte'));
    fireEvent.press(screen.getByLabelText('Guardar reporte'));
    await avanzar();
    expect(api.createReport).toHaveBeenCalledTimes(1);
    await act(async () => { liberar(); });
  });

  it('sin categorías avisa y bloquea el guardado', async () => {
    (api.getProject as jest.Mock).mockResolvedValue({ id: 'p1', constructora: '', categorias_personal: [], categorias_equipo: [] });
    await abrir();
    expect(screen.getByText(/aún no tiene categorías/)).toBeTruthy();
    expect(screen.getByLabelText('Guardar reporte').props.accessibilityState.disabled).toBe(true);
  });
});
