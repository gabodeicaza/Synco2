import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'p1' }),
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
}));
jest.mock('@/src/utils/toast', () => ({ showToast: jest.fn() }));
jest.mock('@/src/utils/confirm', () => ({ confirm: jest.fn() }));
jest.mock('@/src/api', () => ({
  api: { getProject: jest.fn(), listTiposObra: jest.fn(), setProjectModulos: jest.fn() },
}));

import { api } from '@/src/api';
import { confirm } from '@/src/utils/confirm';
import { showToast } from '@/src/utils/toast';
import ModulosConfigScreen from '@/app/(coord)/projects/[id]/modulos';

const getProject = api.getProject as jest.Mock;
const listTipos = api.listTiposObra as jest.Mock;
const setModulos = api.setProjectModulos as jest.Mock;
const confirmar = confirm as jest.Mock;

jest.setTimeout(30000);

const CARRETERA = {
  id: 'carretera', nombre: 'Carretera', descripcion: 'Terracerías y pavimentos', plantillas_recomendadas: [],
  modulos_por_defecto: {
    reportes_diarios: { seguridad_higiene: true, estado_tiempo: true },
    reportes_semanales: { seguridad_higiene: true, impacto_ambiental: true },
    reportes_mensuales: { estudios_proyecto: true },
  },
};

const proyecto = (extra: Record<string, unknown> = {}) => ({
  id: 'p1', name: 'Libramiento', tipo_obra: 'carretera',
  modulos: {
    reportes_diarios: { control_obra: true }, reportes_semanales: {}, reportes_mensuales: {},
  },
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  getProject.mockResolvedValue(proyecto());
  listTipos.mockResolvedValue([CARRETERA]);
});

describe('Módulos del proyecto y tipo de obra (K-13 / T-10)', () => {
  it('muestra el tipo de obra del proyecto y textos genéricos, sin vocabulario de un proyecto', async () => {
    render(<ModulosConfigScreen />);
    expect(await screen.findByText('Tipo de obra: Carretera')).toBeTruthy();
    expect(screen.getAllByText('Podas, trasplantes y derribos por ubicación').length).toBeGreaterThan(0);
    for (const prohibido of [/poste/i, /estaci[oó]n/i, /perforadora/i, /intertramo/i, /cablebús/i]) {
      expect(screen.queryAllByText(prohibido)).toHaveLength(0);
    }
  });

  it('restablecer pide confirmación y, al aceptar, manda las 8 claves de cada informe (las no recomendadas en false)', async () => {
    confirmar.mockResolvedValue(true);
    setModulos.mockResolvedValue(proyecto({ modulos: CARRETERA.modulos_por_defecto }));
    render(<ModulosConfigScreen />);
    const boton = await screen.findByRole('button', { name: 'Restablecer a los módulos recomendados del tipo' });
    await act(async () => { fireEvent.press(boton); });

    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(confirmar.mock.calls[0][1]).toContain('«Carretera»');
    const cuerpo = setModulos.mock.calls[0][1];
    expect(setModulos.mock.calls[0][0]).toBe('p1');
    expect(Object.keys(cuerpo.reportes_diarios)).toHaveLength(8);
    expect(cuerpo.reportes_diarios.seguridad_higiene).toBe(true);
    expect(cuerpo.reportes_diarios.control_obra).toBe(false);
    expect(cuerpo.reportes_semanales.impacto_ambiental).toBe(true);
    expect(cuerpo.reportes_mensuales.estudios_proyecto).toBe(true);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Módulos restablecidos'));
  });

  it('si el usuario cancela la confirmación no se guarda nada', async () => {
    confirmar.mockResolvedValue(false);
    render(<ModulosConfigScreen />);
    const boton = await screen.findByRole('button', { name: 'Restablecer a los módulos recomendados del tipo' });
    await act(async () => { fireEvent.press(boton); });
    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(setModulos).not.toHaveBeenCalled();
  });

  it('un proyecto anterior (legado) muestra «Personalizado» y NO ofrece restablecer', async () => {
    getProject.mockResolvedValue(proyecto({ tipo_obra: 'legado' }));
    render(<ModulosConfigScreen />);
    expect(await screen.findByText('Tipo de obra: Personalizado (proyecto anterior)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Restablecer a los módulos recomendados del tipo' })).toBeNull();
  });

  it('un error al restablecer se muestra en línea (sin Alert) y un error de red da toast', async () => {
    confirmar.mockResolvedValue(true);
    setModulos.mockRejectedValueOnce(Object.assign(new Error('Sin permiso'), { status: 403 }));
    render(<ModulosConfigScreen />);
    const boton = await screen.findByRole('button', { name: 'Restablecer a los módulos recomendados del tipo' });
    await act(async () => { fireEvent.press(boton); });
    expect(await screen.findByText('Sin permiso')).toBeTruthy();

    setModulos.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 0 }));
    await act(async () => { fireEvent.press(boton); });
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/conexión/i));
  });

  it('si el catálogo de tipos no carga la pantalla sigue y no ofrece restablecer', async () => {
    listTipos.mockRejectedValue(new Error('sin red'));
    render(<ModulosConfigScreen />);
    expect(await screen.findByText('Tipo de obra: Carretera')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Restablecer a los módulos recomendados del tipo' })).toBeNull();
  });
});
