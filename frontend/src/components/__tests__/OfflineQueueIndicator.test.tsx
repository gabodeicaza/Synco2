import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import OfflineQueueIndicator from '../OfflineQueueIndicator';
import { tituloDePendiente } from '../OfflineQueueDetailModal';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/src/utils/confirm', () => ({ confirm: jest.fn() }));
jest.mock('@/src/offline-queue-context', () => ({ useOfflineQueue: jest.fn() }));

import { confirm } from '@/src/utils/confirm';
import { useOfflineQueue } from '@/src/offline-queue-context';

const usarCola = useOfflineQueue as jest.Mock;
const flushNow = jest.fn();
const discardItem = jest.fn();

const reporte = { tipo: 'reporte', item: { client_id: 'r1', created_at: '2026-09-24T10:00:00Z', status: 'pending', payload: { title: 'Inspección diaria' } } };
const avance = { tipo: 'avance', item: { client_id: 'a1', created_at: '2026-09-24T11:00:00Z', status: 'failed', last_error: 'La cantidad debe ser mayor que cero.', payload: { cantidad_ejecutada: '1500' } } };

function cola(pendientes: unknown[]) {
  usarCola.mockReturnValue({
    pendientes, pendingCount: pendientes.length, isFlushing: false, flushNow, discardItem,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (confirm as jest.Mock).mockResolvedValue(true);
});

describe('tituloDePendiente', () => {
  it('reporte: su nombre, o un texto por defecto', () => {
    expect(tituloDePendiente(reporte as any)).toBe('Inspección diaria');
    expect(tituloDePendiente({ tipo: 'reporte', item: { payload: {} } } as any)).toBe('Reporte sin nombre');
  });

  it('avance: "Registro de avance" con la cantidad en formato es-MX', () => {
    expect(tituloDePendiente(avance as any)).toBe('Registro de avance · 1,500');
    expect(tituloDePendiente({ tipo: 'avance', item: { payload: {} } } as any)).toBe('Registro de avance');
  });
});

describe('OfflineQueueIndicator', () => {
  it('no se muestra sin pendientes', () => {
    cola([]);
    render(<OfflineQueueIndicator />);
    expect(screen.queryByText(/pendiente/)).toBeNull();
  });

  it('muestra el total de reportes y avances, en singular y plural', () => {
    cola([avance]);
    const { unmount } = render(<OfflineQueueIndicator />);
    expect(screen.getByText('1 pendiente')).toBeTruthy();
    unmount();
    cola([reporte, avance]);
    render(<OfflineQueueIndicator />);
    expect(screen.getByText('2 pendientes')).toBeTruthy();
  });

  it('al tocarlo lista reportes Y avances, con el error de los rechazados', () => {
    cola([reporte, avance]);
    render(<OfflineQueueIndicator />);
    fireEvent.press(screen.getByLabelText('2 pendientes'));
    expect(screen.getByText('Pendientes de enviar (2)')).toBeTruthy();
    expect(screen.getByText('Inspección diaria')).toBeTruthy();
    expect(screen.getByText('Registro de avance · 1,500')).toBeTruthy();
    expect(screen.getByText('La cantidad debe ser mayor que cero.')).toBeTruthy();
  });

  it('descartar un avance pide confirmación y lo quita de la cola de avances', async () => {
    cola([reporte, avance]);
    render(<OfflineQueueIndicator />);
    fireEvent.press(screen.getByLabelText('2 pendientes'));
    fireEvent.press(screen.getByLabelText('Eliminar: Registro de avance · 1,500'));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect((confirm as jest.Mock).mock.calls[0][1]).toContain('Registro de avance · 1,500');
    await waitFor(() => expect(discardItem).toHaveBeenCalledWith('a1', 'avance'));
  });

  it('si no se confirma no se descarta nada', async () => {
    (confirm as jest.Mock).mockResolvedValue(false);
    cola([reporte]);
    render(<OfflineQueueIndicator />);
    fireEvent.press(screen.getByLabelText('1 pendiente'));
    fireEvent.press(screen.getByLabelText('Eliminar: Inspección diaria'));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(discardItem).not.toHaveBeenCalled();
  });

  it('"Reintentar ahora" vacía las colas', async () => {
    cola([reporte, avance]);
    render(<OfflineQueueIndicator />);
    fireEvent.press(screen.getByLabelText('2 pendientes'));
    await act(async () => { fireEvent.press(screen.getByText('Reintentar ahora')); });
    expect(flushNow).toHaveBeenCalledTimes(1);
  });
});
