// C-14: la pantalla del catálogo usa el nombre y el género configurados por el proyecto
// ("Nuevo frente", "Nueva estructura", "Esta actividad…"), nunca "Nuevo partida" ni "nivel 3s".
import React from 'react';
import { configure, fireEvent, render, screen } from '@testing-library/react-native';

jest.setTimeout(30000);
configure({ asyncUtilTimeout: 8000 });

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => {
  const router = { back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
  return { router, useRouter: () => router };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
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
import CatalogoConceptosScreen from '../CatalogoConceptosScreen';

const partida = (id: string, clave: string, nombre: string, padre: string | null) => ({
  id, clave, nombre, partida_padre_id: padre, numero_conceptos: 0, importe_contratado_partida: '0',
  porcentaje_avance_partida: '0', nombre_pendiente: false,
});

const PROYECTO = {
  id: 'p1', name: 'Obra', unidades_personalizadas: [],
  nombres_niveles_partida: ['Frente', 'Tramo', 'Estructura'],
  nombre_nivel_concepto: 'Actividad',
};

function montar(proyecto: any, partidas: any[]) {
  (api.getProject as jest.Mock).mockResolvedValue(proyecto);
  (api.listPartidas as jest.Mock).mockResolvedValue(partidas);
  (api.listConceptos as jest.Mock).mockResolvedValue([]);
  (api.searchConceptos as jest.Mock).mockResolvedValue([]);
  render(<CatalogoConceptosScreen projectId="p1" />);
}

beforeEach(() => jest.clearAllMocks());

describe('catálogo con nombres de nivel configurados (C-14)', () => {
  it('en la raíz el botón concuerda con el nombre del primer nivel: "Nuevo frente"', async () => {
    montar(PROYECTO, []);
    expect(await screen.findByText('Nuevo frente')).toBeTruthy();
    expect(screen.queryByText(/Nueva frente/)).toBeNull();
    expect(screen.getByText('Este proyecto aún no tiene frentes en su catálogo.')).toBeTruthy();
  });

  it('con género forzado por el proyecto el artículo cambia: "Nueva frente"', async () => {
    montar({ ...PROYECTO, genero_niveles: { Frente: 'f' } }, []);
    expect(await screen.findByText('Nueva frente')).toBeTruthy();
    expect(screen.queryByText('Nuevo frente')).toBeNull();
  });

  it('sin nombres configurados conserva los históricos: "Nueva partida" y "partidas"', async () => {
    montar({ id: 'p1', name: 'Obra', unidades_personalizadas: [], nombres_niveles_partida: [] }, []);
    expect(await screen.findByText('Nueva partida')).toBeTruthy();
    expect(screen.getByText('Este proyecto aún no tiene partidas en su catálogo.')).toBeTruthy();
  });

  it('dentro de un nodo sin hijos, el vacío usa el nivel del nodo y el plural correcto', async () => {
    montar(PROYECTO, [partida('P1', '1', 'Cimentación', null)]);
    fireEvent.press(await screen.findByText(/1 — Cimentación/));
    // Un nodo sin hijos abre en Conceptos (C-11): se pasa a Estructura para ver su vacío.
    fireEvent.press(await screen.findByRole('tab', { name: /Estructura/ }));
    // Estamos dentro de un Frente: el siguiente nivel es "Tramo" y "Este frente" es masculino.
    expect(await screen.findByText('Nuevo tramo aquí')).toBeTruthy();
    expect(screen.getByText('Este frente aún no tiene tramos.')).toBeTruthy();
  });

  it('un nodo de nivel femenino dice "Esta estructura" y "Nuevo nivel" no aparece', async () => {
    montar(PROYECTO, [
      partida('P1', '1', 'Norte', null),
      partida('P11', '1.1', 'Eje A', 'P1'),
      partida('P111', '1.1.1', 'Losa', 'P11'),
    ]);
    fireEvent.press(await screen.findByText(/1 — Norte/));
    fireEvent.press(await screen.findByText(/1\.1 — Eje A/));
    // Dentro de un Tramo (nivel 2) el siguiente nivel es "Estructura" (femenino).
    expect(await screen.findByText('Nueva estructura aquí')).toBeTruthy();
    expect(screen.queryByText('Nuevo estructura aquí')).toBeNull();
  });

  it('la pestaña de conceptos usa el plural del nombre configurado (nunca "actividads")', async () => {
    montar(PROYECTO, [partida('P1', '1', 'Norte', null)]);
    fireEvent.press(await screen.findByText(/1 — Norte/));
    expect(await screen.findByRole('tab', { name: /Actividades/ })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: /Actividads/ })).toBeNull();
  });

  it('en la lista de conceptos vacía el aviso concuerda con el nodo abierto', async () => {
    montar(PROYECTO, [partida('P1', '1', 'Norte', null)]);
    fireEvent.press(await screen.findByText(/1 — Norte/));
    fireEvent.press(await screen.findByRole('tab', { name: /Actividades/ }));
    expect(await screen.findByText('Este frente aún no tiene actividades.')).toBeTruthy();
    expect(await screen.findByText('Nueva actividad')).toBeTruthy();
  });

  it('un nombre de nivel genérico con número no produce "nivel 3s"', async () => {
    montar({ id: 'p1', name: 'Obra', unidades_personalizadas: [], nombres_niveles_partida: ['Frente'] }, [
      partida('P1', '1', 'Norte', null),
      partida('P11', '1.1', 'Eje', 'P1'),
    ]);
    fireEvent.press(await screen.findByText(/1 — Norte/));
    fireEvent.press(await screen.findByText(/1\.1 — Eje/));
    fireEvent.press(await screen.findByRole('tab', { name: /Estructura/ }));
    // 1.1 está en la profundidad 1: sin nombre configurado, cae al histórico "Sub-partida"
    expect(await screen.findByText('Esta sub-partida aún no tiene niveles.')).toBeTruthy();
    expect(screen.queryByText(/nivel \d+s/i)).toBeNull();
  });
});
