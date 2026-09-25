import React from 'react';
import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import RegistrarAvanceScreen from '../RegistrarAvanceScreen';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('expo-image-picker', () => ({
  MediaTypeOptions: { Images: 'Images' }, launchImageLibraryAsync: jest.fn(), launchCameraAsync: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/src/utils/permissions', () => ({ requestMediaLibraryPermission: jest.fn(), requestCameraPermission: jest.fn() }));
jest.mock('@/src/utils/comprimirFoto', () => ({ prepararFotoEvidencia: jest.fn() }));
jest.mock('@/src/utils/confirm', () => ({ confirm: jest.fn() }));
jest.mock('@/src/utils/toast', () => ({ showToast: jest.fn() }));
jest.mock('@/src/api', () => ({
  api: { getProject: jest.fn(), getTree: jest.fn(), searchConceptos: jest.fn(), createAvance: jest.fn() },
}));
import { api } from '@/src/api';
import { showToast } from '@/src/utils/toast';
import { RETRASO_BUSQUEDA_MS } from '@/src/hooks/useBusquedaConceptos';

jest.setTimeout(30000);
configure({ asyncUtilTimeout: 8000 });

const buscar = api.searchConceptos as jest.Mock;
const crear = api.createAvance as jest.Mock;

const concepto = (id: string, clave: string, extra: Record<string, unknown> = {}) => ({
  id, clave, descripcion: `Descripción ${clave}`, unidad: 'M3', cantidad: '100', meta: '10',
  cantidad_ejecutada_acumulada: '20', partida_clave: '1', partida_nombre: 'Terracerías', ...extra,
});

async function avanzar(ms: number) {
  await act(async () => { jest.advanceTimersByTime(ms); });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  (api.getProject as jest.Mock).mockResolvedValue({ id: 'p1', name: 'Proyecto', modo_avance: 'CANTIDAD', separador_decimal: '.' });
  (api.getTree as jest.Mock).mockResolvedValue([]);
});
afterEach(() => { jest.useRealTimers(); });

describe('Registrar avance: lista y búsqueda (A-10)', () => {
  it('muestra la lista de conceptos por defecto sin escribir nada', async () => {
    buscar.mockResolvedValue([concepto('a', '1.1'), concepto('b', '1.2')]);
    render(<RegistrarAvanceScreen projectId="p1" />);
    await avanzar(0);
    expect(buscar).toHaveBeenCalledWith('p1', { limit: 50 });
    expect(screen.getByText(/1\.1 · Descripción 1\.1/)).toBeTruthy();
    expect(screen.getByText(/1\.2 · Descripción 1\.2/)).toBeTruthy();
    expect(screen.getByText('Primeros conceptos del catálogo. Escribe para buscar.')).toBeTruthy();
  });

  it('una búsqueda sin coincidencias muestra un mensaje (no se queda cargando)', async () => {
    buscar.mockResolvedValueOnce([concepto('a', '1.1')]).mockResolvedValueOnce([]);
    render(<RegistrarAvanceScreen projectId="p1" />);
    await avanzar(0);
    fireEvent.changeText(screen.getByLabelText(/Buscar/), '1.1.');
    await avanzar(RETRASO_BUSQUEDA_MS);
    expect(screen.getByText('No hay conceptos que coincidan con «1.1.».')).toBeTruthy();
    expect(screen.queryByLabelText('Buscando…')).toBeNull();
  });

  it('el cuadro de búsqueda y el estado interno coinciden', async () => {
    buscar.mockResolvedValue([]);
    render(<RegistrarAvanceScreen projectId="p1" />);
    await avanzar(0);
    fireEvent.changeText(screen.getByLabelText(/Buscar/), 'acero');
    expect(screen.getByLabelText(/Buscar/).props.value).toBe('acero');
    await avanzar(RETRASO_BUSQUEDA_MS);
    expect(buscar).toHaveBeenLastCalledWith('p1', { q: 'acero' });
  });

  it('un error de red se muestra en línea y se puede reintentar', async () => {
    buscar.mockRejectedValueOnce(Object.assign(new Error('No hay conexión.'), { status: 0 }));
    render(<RegistrarAvanceScreen projectId="p1" />);
    await avanzar(0);
    expect(screen.getByText('No hay conexión.')).toBeTruthy();
    buscar.mockResolvedValueOnce([concepto('a', '1.1')]);
    fireEvent.press(screen.getByText('Reintentar'));
    await avanzar(0);
    expect(screen.queryByText('No hay conexión.')).toBeNull();
    expect(screen.getByText(/1\.1 · Descripción 1\.1/)).toBeTruthy();
  });

  it('descarta la respuesta tardía de una búsqueda anterior', async () => {
    let soltarLenta!: (v: unknown[]) => void;
    buscar.mockResolvedValueOnce([]);
    render(<RegistrarAvanceScreen projectId="p1" />);
    await avanzar(0);
    buscar.mockReturnValueOnce(new Promise((r) => { soltarLenta = r; }));
    fireEvent.changeText(screen.getByLabelText(/Buscar/), '1.');
    await avanzar(RETRASO_BUSQUEDA_MS);
    buscar.mockResolvedValueOnce([concepto('b', '1.1.1')]);
    fireEvent.changeText(screen.getByLabelText(/Buscar/), '1.1.');
    await avanzar(RETRASO_BUSQUEDA_MS);
    await act(async () => { soltarLenta([concepto('a', '1.9')]); });
    expect(screen.getByText(/1\.1\.1 · Descripción 1\.1\.1/)).toBeTruthy();
    expect(screen.queryByText(/1\.9 · Descripción 1\.9/)).toBeNull();
  });
});

describe('Registrar avance: captura numérica (A-07 / X-05)', () => {
  async function abrirConcepto(clave = '1.1') {
    buscar.mockResolvedValue([concepto('a', clave)]);
    render(<RegistrarAvanceScreen projectId="p1" />);
    await avanzar(0);
    fireEvent.press(screen.getByText(new RegExp(`${clave} · Descripción`)));
  }

  it('acepta "1,500" y envía 1500 (decimal con punto) con teclado numérico', async () => {
    crear.mockResolvedValue({ es_retroceso: false });
    await abrirConcepto();
    const campo = screen.getByLabelText('Cantidad ejecutada');
    expect(campo.props.keyboardType).toBe('decimal-pad');
    fireEvent.changeText(campo, '1,500');
    fireEvent.press(screen.getByText('Registrar avance'));
    await avanzar(0);
    expect(crear).toHaveBeenCalledWith(expect.objectContaining({ concepto_id: 'a', cantidad_ejecutada: '1500', tipo: 'normal' }));
    expect(showToast).toHaveBeenCalled();
  });

  it('da formato es-MX al salir del campo (45000 -> 45,000)', async () => {
    await abrirConcepto();
    const campo = screen.getByLabelText('Cantidad ejecutada');
    fireEvent.changeText(campo, '45000');
    fireEvent(campo, 'blur');
    expect(screen.getByLabelText('Cantidad ejecutada').props.value).toBe('45,000');
  });

  it('muestra el error junto al campo y lo borra al corregir', async () => {
    await abrirConcepto();
    const campo = screen.getByLabelText('Cantidad ejecutada');
    fireEvent.changeText(campo, '0');
    fireEvent.press(screen.getByText('Registrar avance'));
    await avanzar(0);
    expect(screen.getByText(/mayor que cero/)).toBeTruthy();
    expect(crear).not.toHaveBeenCalled();
    fireEvent.changeText(campo, '5');
    expect(screen.queryByText(/mayor que cero/)).toBeNull();
  });

  it('más de 4 decimales se avisa con su propio mensaje', async () => {
    await abrirConcepto();
    fireEvent.changeText(screen.getByLabelText('Cantidad ejecutada'), '1.23456');
    fireEvent.press(screen.getByText('Registrar avance'));
    await avanzar(0);
    expect(screen.getByText('La cantidad admite hasta 4 decimales.')).toBeTruthy();
    expect(crear).not.toHaveBeenCalled();
  });

  it('acepta hasta 4 decimales y los envía completos', async () => {
    await abrirConcepto();
    fireEvent.changeText(screen.getByLabelText('Cantidad ejecutada'), '1.2345');
    fireEvent.press(screen.getByText('Registrar avance'));
    await avanzar(0);
    expect(crear).toHaveBeenCalledTimes(1);
    expect(crear.mock.calls[0][0].cantidad_ejecutada).toBe('1.2345');
  });

  it('un avance que pasa de lo contratado se permite y solo se avisa (A-02)', async () => {
    crear.mockResolvedValue({ es_retroceso: false });
    await abrirConcepto();
    fireEvent.changeText(screen.getByLabelText('Cantidad ejecutada'), '500');
    expect(screen.getByText(/volumen excedente/)).toBeTruthy();
    fireEvent.press(screen.getByText('Registrar avance'));
    await avanzar(0);
    expect(crear).toHaveBeenCalledWith(expect.objectContaining({ cantidad_ejecutada: '500' }));
  });

  it('un error de red al guardar da toast y conserva lo capturado', async () => {
    crear.mockRejectedValue(Object.assign(new Error('x'), { status: 0 }));
    await abrirConcepto();
    fireEvent.changeText(screen.getByLabelText('Cantidad ejecutada'), '7');
    fireEvent.press(screen.getByText('Registrar avance'));
    await avanzar(0);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/No hay conexión/)));
    expect(screen.getByLabelText('Cantidad ejecutada').props.value).toBe('7');
  });
});
