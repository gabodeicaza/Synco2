import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/src/utils/toast', () => ({ showToast: jest.fn() }));
jest.mock('@/src/utils/confirm', () => ({ confirm: jest.fn() }));
jest.mock('@/src/api', () => ({
  api: { listTiposObra: jest.fn(), updateProject: jest.fn(), setProjectModulos: jest.fn() },
}));

import { api } from '@/src/api';
import { confirm } from '@/src/utils/confirm';
import { showToast } from '@/src/utils/toast';
import { ResumenProyecto, filasResumen } from '../ResumenProyecto';
import { SelectorGeneroNivel } from '../SelectorGeneroNivel';
import { TipoObraProyectoModal } from '../TipoObraProyectoModal';

jest.setTimeout(30000);

const proyecto = (extra: Record<string, unknown> = {}): any => ({
  id: 'p1', name: 'Proyecto', constructora: 'Constructora Uno', contract_number: 'C-001',
  cliente_principal: 'Secretaría de Obras', objeto_contrato: 'Supervisión de la construcción',
  color_institucional: '#1E40AF', start_date: '2026-09-01', end_date: '2027-03-15',
  description: 'Descripción del proyecto', tipo_obra: 'carretera', ...extra,
});

const catalogo = [
  { id: 'generica', nombre: 'Genérica', descripcion: 'Uso general', plantillas_recomendadas: [],
    modulos_por_defecto: { reportes_diarios: {}, reportes_semanales: {}, reportes_mensuales: {} } },
  { id: 'carretera', nombre: 'Carretera', descripcion: 'Vías terrestres', plantillas_recomendadas: [],
    modulos_por_defecto: { reportes_diarios: { seguridad_higiene: true }, reportes_semanales: { gestion_riesgos: true }, reportes_mensuales: {} } },
];

beforeEach(() => {
  jest.clearAllMocks();
  (api.listTiposObra as jest.Mock).mockResolvedValue(catalogo);
});

describe('ResumenProyecto (P-06)', () => {
  it('muestra cliente, objeto del contrato, tipo de obra, color y fechas en el formato único', () => {
    render(<ResumenProyecto project={proyecto()} />);
    expect(screen.getByText('Secretaría de Obras')).toBeTruthy();
    expect(screen.getByText('Supervisión de la construcción')).toBeTruthy();
    expect(screen.getByText('Carretera')).toBeTruthy();
    expect(screen.getByTestId('resumen-color-muestra')).toBeTruthy();
    expect(screen.queryByText(/#1E40AF/i)).toBeNull();
    expect(screen.queryByText('2026-09-01')).toBeNull();
    expect(screen.getByTestId('resumen-inicio')).toBeTruthy();
  });

  it('omite los campos vacíos y un color inválido', () => {
    const filas = filasResumen(proyecto({ cliente_principal: '  ', objeto_contrato: null, color_institucional: 'rojo', start_date: null, description: '' }));
    const claves = filas.map((f) => f.clave);
    expect(claves).toEqual(expect.arrayContaining(['constructora', 'contrato', 'tipoObra', 'termino']));
    for (const ausente of ['cliente', 'objeto', 'color', 'inicio', 'descripcion']) expect(claves).not.toContain(ausente);
  });

  it('un proyecto anterior sin tipo se muestra como "Personalizado (proyecto anterior)"', () => {
    render(<ResumenProyecto project={proyecto({ tipo_obra: 'legado' })} />);
    expect(screen.getByText('Personalizado (proyecto anterior)')).toBeTruthy();
  });
});

describe('SelectorGeneroNivel (C-14)', () => {
  it('ofrece Automático, Masculino y Femenino y avisa el género elegido', () => {
    const onChange = jest.fn();
    render(<SelectorGeneroNivel nombre="Frente" valor="auto" onChange={onChange} />);
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: /Automático/, selected: true })).toBeTruthy();
    fireEvent.press(screen.getByRole('radio', { name: /Femenino/ }));
    expect(onChange).toHaveBeenCalledWith('f');
    fireEvent.press(screen.getByRole('radio', { name: /Masculino/ }));
    expect(onChange).toHaveBeenLastCalledWith('m');
  });
});

describe('TipoObraProyectoModal (K-13 / T-10)', () => {
  const abrir = (extra: Record<string, unknown> = {}) => {
    const onClose = jest.fn();
    const onProjectUpdated = jest.fn();
    render(<TipoObraProyectoModal visible project={proyecto(extra)} onClose={onClose} onProjectUpdated={onProjectUpdated} />);
    return { onClose, onProjectUpdated };
  };

  it('explica que cambiar el tipo no modifica los módulos ni las etapas ya configurados', async () => {
    abrir();
    await screen.findByRole('radio', { name: /Genérica/ });
    expect(screen.getByText(/NO modifica los módulos ni las etapas/)).toBeTruthy();
  });

  it('el botón de guardar está deshabilitado mientras no haya un cambio', async () => {
    abrir({ tipo_obra: 'carretera' });
    await screen.findByRole('radio', { name: /Genérica/ });
    expect(screen.getByRole('button', { name: 'Guardar tipo' }).props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByRole('radio', { name: /Genérica/ }));
    expect(screen.getByRole('button', { name: 'Guardar tipo' }).props.accessibilityState.disabled).toBe(false);
  });

  it('guarda el tipo elegido, avisa al padre y cierra', async () => {
    (api.updateProject as jest.Mock).mockResolvedValue({ id: 'p1', tipo_obra: 'generica' });
    const { onClose, onProjectUpdated } = abrir({ tipo_obra: 'carretera' });
    fireEvent.press(await screen.findByRole('radio', { name: /Genérica/ }));
    fireEvent.press(screen.getByRole('button', { name: 'Guardar tipo' }));
    await waitFor(() => expect(api.updateProject).toHaveBeenCalledWith('p1', { tipo_obra: 'generica' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onProjectUpdated).toHaveBeenCalledWith({ id: 'p1', tipo_obra: 'generica' });
    expect(showToast).toHaveBeenCalledWith('Tipo de obra actualizado');
  });

  it('un proyecto anterior (legado) abre sin tipo elegido y exige elegir uno', async () => {
    abrir({ tipo_obra: 'legado' });
    await screen.findByRole('radio', { name: /Carretera/ });
    expect(screen.getByRole('button', { name: 'Guardar tipo' }).props.accessibilityState.disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Aplicar módulos recomendados' }).props.accessibilityState.disabled).toBe(true);
  });

  it('un error del servidor se ve en línea y no cierra', async () => {
    (api.updateProject as jest.Mock).mockRejectedValue(Object.assign(new Error('Tipo de obra no válido'), { status: 422 }));
    const { onClose } = abrir({ tipo_obra: 'carretera' });
    fireEvent.press(await screen.findByRole('radio', { name: /Genérica/ }));
    fireEvent.press(screen.getByRole('button', { name: 'Guardar tipo' }));
    expect(await screen.findByText('Tipo de obra no válido')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('aplicar módulos recomendados pide confirmación y manda las 8 claves por informe', async () => {
    (confirm as jest.Mock).mockResolvedValue(true);
    (api.setProjectModulos as jest.Mock).mockResolvedValue({ id: 'p1', modulos: {} });
    const { onProjectUpdated } = abrir({ tipo_obra: 'carretera' });
    await screen.findByRole('radio', { name: /Carretera/ });
    fireEvent.press(screen.getByRole('button', { name: 'Aplicar módulos recomendados' }));
    await waitFor(() => expect(api.setProjectModulos).toHaveBeenCalledTimes(1));
    const [pid, cuerpo] = (api.setProjectModulos as jest.Mock).mock.calls[0];
    expect(pid).toBe('p1');
    expect(cuerpo.reportes_diarios.seguridad_higiene).toBe(true);
    expect(cuerpo.reportes_diarios.gestion_riesgos).toBe(false);
    expect(cuerpo.reportes_semanales.gestion_riesgos).toBe(true);
    expect(Object.keys(cuerpo.reportes_mensuales)).toHaveLength(8);
    expect(confirm).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('Carretera'), expect.anything());
    expect(onProjectUpdated).toHaveBeenCalled();
  });

  it('si se cancela la confirmación no se toca ningún módulo', async () => {
    (confirm as jest.Mock).mockResolvedValue(false);
    abrir({ tipo_obra: 'carretera' });
    await screen.findByRole('radio', { name: /Carretera/ });
    fireEvent.press(screen.getByRole('button', { name: 'Aplicar módulos recomendados' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(api.setProjectModulos).not.toHaveBeenCalled();
  });
});
