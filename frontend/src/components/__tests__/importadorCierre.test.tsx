import React from 'react';
import { configure, fireEvent, render, screen } from '@testing-library/react-native';

jest.setTimeout(30000);
configure({ asyncUtilTimeout: 8000 });

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('@/src/utils/confirm', () => ({ confirm: jest.fn() }));
jest.mock('@/src/api', () => ({
  api: {
    getProject: jest.fn(),
    importCatalogoSesionPendiente: jest.fn(),
    importCatalogoDescartarSesion: jest.fn(),
  },
}));

import { api } from '@/src/api';
import { ImportarCatalogoModal } from '../ImportarCatalogoModal';

const sesion = (extra: object = {}) => ({
  import_id: 'imp1', filename: 'catalogo.xlsx', created_at: '2026-09-24T10:00:00Z', sheet_names: ['Hoja 1', 'Hoja 2'],
  validado: false, validated_sheet: null, validated_header_row_index: null, validated_mapping: null,
  validated_partida_id: null, convencion_usada: null, ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  (api.getProject as jest.Mock).mockResolvedValue({ id: 'p1', unidades_personalizadas: [], separador_decimal: '.' });
  (api.importCatalogoSesionPendiente as jest.Mock).mockResolvedValue(null);
});

function abrir(onClose = jest.fn()) {
  render(<ImportarCatalogoModal visible projectId="p1" partidas={[]} onClose={onClose} onImported={jest.fn()} />);
  return onClose;
}

describe('importador de catálogo: botones de cierre (C-15)', () => {
  it('en el primer paso hay UN solo botón de cerrar y ningún "Atrás"', async () => {
    const onClose = abrir();
    await screen.findByText('Seleccionar archivo');
    expect(screen.getAllByRole('button', { name: 'Cerrar el importador' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Volver al paso anterior' })).toBeNull();
    expect(screen.queryByText('Atrás')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Cerrar el importador' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('en un paso posterior aparece "Atrás", claramente distinto del cierre, y solo hay un cerrar', async () => {
    (api.importCatalogoSesionPendiente as jest.Mock).mockResolvedValue(sesion());
    abrir();
    fireEvent.press(await screen.findByText('Continuar donde quedé'));
    // paso "hoja": varias hojas
    await screen.findByText(/varias hojas/);
    const atras = screen.getByRole('button', { name: 'Volver al paso anterior' });
    expect(atras).toBeTruthy();
    expect(screen.getByText('Atrás')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Cerrar el importador' })).toHaveLength(1);
  });

  it('"Atrás" regresa al paso anterior sin cerrar el importador', async () => {
    (api.importCatalogoSesionPendiente as jest.Mock).mockResolvedValue(sesion());
    const onClose = abrir();
    fireEvent.press(await screen.findByText('Continuar donde quedé'));
    await screen.findByText(/varias hojas/);
    fireEvent.press(screen.getByRole('button', { name: 'Volver al paso anterior' }));
    expect(await screen.findByText('Seleccionar archivo')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Volver al paso anterior' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});
