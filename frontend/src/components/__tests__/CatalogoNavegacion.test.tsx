import React from 'react';
import { StyleSheet } from 'react-native';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.setTimeout(30000);
configure({ asyncUtilTimeout: 8000 });

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 20, left: 0, right: 0 }),
}));
jest.mock('@/src/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'coordinador_general' } }),
}));
jest.mock('@/src/utils/toast', () => ({ showToast: jest.fn() }));
jest.mock('@/src/utils/roles', () => ({ ROLE_SUB: 'subcoordinador', ROLE_COORD: 'coordinador_general', APP_BRAND: 'Dirac' }));
jest.mock('@/src/components/ImportarCatalogoModal', () => ({ ImportarCatalogoModal: () => null }));
jest.mock('@/src/components/ImportarMaestroModal', () => ({ ImportarMaestroModal: () => null }));
jest.mock('@/src/components/NuevaPartidaModal', () => ({ NuevaPartidaModal: () => null }));
jest.mock('@/src/components/NuevoConceptoModal', () => ({ NuevoConceptoModal: () => null }));
jest.mock('@/src/api', () => ({
  api: {
    getProject: jest.fn(),
    listPartidas: jest.fn(),
    listConceptos: jest.fn(),
    searchConceptos: jest.fn(),
  },
}));

import { api } from '@/src/api';
import { margenesCatalogo } from '@/src/utils/navegacionCatalogo';
import CatalogoConceptosScreen from '../CatalogoConceptosScreen';

const partida = (id: string, clave: string, nombre: string, padre: string | null) => ({
  id, clave, nombre, partida_padre_id: padre, numero_conceptos: 1, importe_contratado_partida: '1000.00',
  porcentaje_avance_partida: '0', nombre_pendiente: false,
});
const PARTIDAS = [
  partida('P1', '1', 'Obra civil', null),
  partida('P11', '1.1', 'Cimentación', 'P1'),
  partida('P111', '1.1.1', 'Zapatas', 'P11'),
];
const concepto = (id: string, clave: string, descripcion: string, partidaId: string) => ({
  id, clave, descripcion, partida_id: partidaId, unidad: 'M3', cantidad: '10', precio_unitario: '100', importe_contratado: '1000',
  meta: '', periodicidad_meta: 'SEMANAL', cantidad_ejecutada_acumulada: '0',
});
const CONCEPTOS: Record<string, any[]> = {
  P1: [concepto('C1', '1.A', 'Limpieza del terreno', 'P1')],
  P11: [],
  P111: [concepto('C2', '1.1.1.1', 'Excavación de zapatas', 'P111'), concepto('C3', '1.1.1.2', 'Colado de zapatas', 'P111')],
};

beforeEach(() => {
  jest.clearAllMocks();
  (api.getProject as jest.Mock).mockResolvedValue({ id: 'p1', name: 'Obra', nombres_niveles_partida: [], unidades_personalizadas: [] });
  (api.listPartidas as jest.Mock).mockResolvedValue(PARTIDAS);
  (api.listConceptos as jest.Mock).mockImplementation(async (id: string) => CONCEPTOS[id] ?? []);
  (api.searchConceptos as jest.Mock).mockResolvedValue([
    { ...CONCEPTOS.P111[1], partida_clave: '1.1.1', partida_nombre: 'Zapatas' },
  ]);
});

async function abrirPantalla() {
  render(<CatalogoConceptosScreen projectId="p1" />);
  await screen.findByText(/1 — Obra civil/);
}

describe('pestañas del nodo (C-11)', () => {
  it('un nodo con subniveles abre en Estructura y una hoja abre en Conceptos', async () => {
    await abrirPantalla();
    fireEvent.press(screen.getByText(/1 — Obra civil/));
    // 1 tiene subnivel 1.1 → Estructura
    const estructura = await screen.findByRole('tab', { name: /Estructura/ });
    expect(estructura.props.accessibilityState.selected).toBe(true);
    expect(screen.getByText(/1\.1 — Cimentación/)).toBeTruthy();
    fireEvent.press(screen.getByText(/1\.1 — Cimentación/));
    fireEvent.press(await screen.findByText(/1\.1\.1 — Zapatas/));
    // 1.1.1 es una hoja → Conceptos
    const conceptos = await screen.findByRole('tab', { name: /Conceptos/ });
    await waitFor(() => expect(conceptos.props.accessibilityState.selected).toBe(true));
    expect(await screen.findByText('Excavación de zapatas')).toBeTruthy();
  });

  it('las pestañas muestran cuántos elementos tiene cada una', async () => {
    await abrirPantalla();
    fireEvent.press(screen.getByText(/1 — Obra civil/));
    expect(await screen.findByRole('tab', { name: 'Estructura (1)' })).toBeTruthy();
    expect(await screen.findByRole('tab', { name: 'Conceptos (1)' })).toBeTruthy();
  });

  it('cambiar de pestaña muestra los conceptos directos y se recuerda al volver al nodo', async () => {
    await abrirPantalla();
    fireEvent.press(screen.getByText(/1 — Obra civil/));
    fireEvent.press(await screen.findByRole('tab', { name: /Conceptos/ }));
    expect(await screen.findByText('Limpieza del terreno')).toBeTruthy();
    // sale del nodo (breadcrumb "Catálogo") y vuelve a entrar: sigue en Conceptos
    fireEvent.press(screen.getByText('Catálogo'));
    fireEvent.press(await screen.findByText(/1 — Obra civil/));
    const conceptos = await screen.findByRole('tab', { name: /Conceptos/ });
    expect(conceptos.props.accessibilityState.selected).toBe(true);
  });
});

describe('resultados de búsqueda que navegan al concepto (C-10)', () => {
  async function buscarYAbrirResultado() {
    await abrirPantalla();
    fireEvent.changeText(screen.getByPlaceholderText(/Buscar por clave/), 'colado');
    const resultado = await screen.findByRole('button', { name: /Abrir 1\.1\.1\.2/ });
    fireEvent.press(resultado);
  }

  it('al tocar un resultado se abre su partida (a 3 niveles) y aparece el concepto expandido', async () => {
    await buscarYAbrirResultado();
    await waitFor(() => expect(api.listConceptos).toHaveBeenCalledWith('P111'));
    // ruta completa en el breadcrumb: 1 › 1.1 › 1.1.1
    // el concepto encontrado quedó expandido (su descripción sale en la fila y en el detalle); el otro, colapsado
    expect(await screen.findAllByText('Colado de zapatas')).toHaveLength(2);
    expect(screen.getAllByText('Excavación de zapatas')).toHaveLength(1);
    expect(screen.getAllByText('Cantidad contratada')).toHaveLength(1);
    const conceptos = await screen.findByRole('tab', { name: /Conceptos/ });
    expect(conceptos.props.accessibilityState.selected).toBe(true);
    // ya no se ven los resultados de la búsqueda
    expect(screen.queryByRole('button', { name: /Abrir 1\.1\.1\.2/ })).toBeNull();
  });

  it('ofrece volver a los resultados y los recupera', async () => {
    await buscarYAbrirResultado();
    const volver = await screen.findByRole('button', { name: 'Volver a los resultados de la búsqueda' });
    fireEvent.press(volver);
    expect(await screen.findByRole('button', { name: /Abrir 1\.1\.1\.2/ })).toBeTruthy();
    expect(screen.getByPlaceholderText(/Buscar por clave/).props.value).toBe('colado');
    expect(screen.queryByRole('button', { name: 'Volver a los resultados de la búsqueda' })).toBeNull();
  });

  it('la navegación manual descarta el botón de volver a los resultados', async () => {
    await buscarYAbrirResultado();
    await screen.findByRole('button', { name: 'Volver a los resultados de la búsqueda' });
    fireEvent.press(screen.getByText('Catálogo'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Volver a los resultados de la búsqueda' })).toBeNull());
  });
});

describe('margen del botón flotante (C-15)', () => {
  it('el botón "Importar catálogo" se coloca sobre el pie fijo y la barra de gestos', async () => {
    await abrirPantalla();
    const boton = screen.getByRole('button', { name: /Importar catálogo/ });
    const estilo = StyleSheet.flatten(boton.props.style);
    expect(estilo.bottom).toBe(margenesCatalogo(20, true).botonBottom);
    expect(estilo.bottom).toBeGreaterThan(64); // más alto que el margen fijo de antes (hay inset inferior)
  });
});
