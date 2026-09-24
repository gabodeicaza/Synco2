import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ProgramaObraSection } from '../ProgramaObraSection';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/src/utils/toast', () => ({ showToast: jest.fn() }));
jest.mock('@/src/api', () => ({ api: { programaListVersiones: jest.fn() } }));
jest.mock('@/src/components/ImportarProgramaModal', () => {
  const React = require('react');
  const { Text, Pressable } = require('react-native');
  return {
    ImportarProgramaModal: ({ visible, onImported }: { visible: boolean; onImported: () => void }) =>
      visible ? (
        <Pressable onPress={onImported}>
          <Text>MODAL ABIERTO</Text>
        </Pressable>
      ) : null,
  };
});

import { api } from '@/src/api';
import { showToast } from '@/src/utils/toast';

const listar = api.programaListVersiones as jest.Mock;

const version = (extra = {}) => ({
  id: 'v1', project_id: 'p1', etiqueta: 'Programa 27-05-26', fecha_importacion: '2026-09-23T15:30:00Z',
  vigente: true, creado_por: 'u1', filename: 'programa.xlsx', ...extra,
});

beforeEach(() => { jest.clearAllMocks(); });

describe('ProgramaObraSection', () => {
  it('sin programa importado explica que el PV usa las fechas de cada concepto', async () => {
    listar.mockResolvedValue([]);
    render(<ProgramaObraSection projectId="p1" />);
    expect(await screen.findByText(/Todavía no hay un programa importado/)).toBeTruthy();
    expect(screen.getByLabelText('Importar programa desde Excel')).toBeTruthy();
  });

  it('muestra la versión vigente con su fecha en la zona del proyecto', async () => {
    listar.mockResolvedValue([version({ id: 'v0', etiqueta: 'Vieja', vigente: false }), version()]);
    render(<ProgramaObraSection projectId="p1" />);
    expect(await screen.findByText('Versión vigente: Programa 27-05-26')).toBeTruthy();
    expect(screen.getByText('Importada el 23 sep 2026, 09:30')).toBeTruthy();
    expect(screen.queryByText(/Vieja/)).toBeNull();
  });

  it('el botón abre el importador y al terminar avisa y recarga las versiones', async () => {
    listar.mockResolvedValue([]);
    const alImportar = jest.fn();
    render(<ProgramaObraSection projectId="p1" onImported={alImportar} />);
    await screen.findByText(/Todavía no hay/);
    expect(screen.queryByText('MODAL ABIERTO')).toBeNull();

    fireEvent.press(screen.getByLabelText('Importar programa desde Excel'));
    listar.mockResolvedValue([version()]);
    fireEvent.press(screen.getByText('MODAL ABIERTO'));

    await waitFor(() => expect(screen.getByText('Versión vigente: Programa 27-05-26')).toBeTruthy());
    expect(showToast).toHaveBeenCalledWith('Programa importado');
    expect(alImportar).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('MODAL ABIERTO')).toBeNull();
  });

  it('si no se puede consultar muestra el error en línea, sin Alert, y deja importar', async () => {
    listar.mockRejectedValue(new Error('boom'));
    render(<ProgramaObraSection projectId="p1" />);
    expect(await screen.findByText('No se pudo consultar el programa importado.')).toBeTruthy();
    expect(screen.getByLabelText('Importar programa desde Excel')).toBeTruthy();
  });

  it('sin permiso no ofrece el botón de importar', async () => {
    listar.mockResolvedValue([]);
    render(<ProgramaObraSection projectId="p1" puedeImportar={false} />);
    await screen.findByText(/Todavía no hay/);
    expect(screen.queryByLabelText('Importar programa desde Excel')).toBeNull();
  });
});
