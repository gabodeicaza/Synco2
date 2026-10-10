import React from 'react';
import { Text } from 'react-native';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { ProyectoActivoProvider, useProyectoActivo } from '@/src/proyecto-activo-context';

const mockListProjects = jest.fn();
const mockGetItem = jest.fn();
const mockSetItem = jest.fn();
let mockUsuario: any = null;

jest.mock('@/src/api', () => ({ api: { listProjects: (...a: any[]) => mockListProjects(...a) } }));
jest.mock('@/src/auth-context', () => ({ useAuth: () => ({ user: mockUsuario }) }));
jest.mock('@/src/utils/storage', () => ({
  storage: { getItem: (...a: any[]) => mockGetItem(...a), setItem: (...a: any[]) => mockSetItem(...a) },
}));

let ctx: ReturnType<typeof useProyectoActivo>;
function Sonda() {
  ctx = useProyectoActivo();
  return <Text testID="activo">{ctx.proyectoId ?? 'ninguno'}</Text>;
}

const P = (id: string) => ({ id, name: `Proyecto ${id}` });

function montar() {
  return render(<ProyectoActivoProvider><Sonda /></ProyectoActivoProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUsuario = { id: 'u1', role: 'coordinador_general', project_ids: [] };
  mockListProjects.mockResolvedValue([P('p1'), P('p2'), P('p3')]);
  mockGetItem.mockResolvedValue('');
  mockSetItem.mockResolvedValue(true);
});

describe('ProyectoActivoProvider (P-05)', () => {
  it('sin proyecto recordado usa el primero', async () => {
    montar();
    await waitFor(() => expect(screen.getByTestId('activo').props.children).toBe('p1'));
  });

  it('recuerda el último proyecto elegido por el mockUsuario', async () => {
    mockGetItem.mockResolvedValue('p2');
    montar();
    await waitFor(() => expect(screen.getByTestId('activo').props.children).toBe('p2'));
    expect(mockGetItem).toHaveBeenCalledWith('dirac_proyecto_activo_u1', '');
  });

  it('si el recordado ya no existe, cae al primero', async () => {
    mockGetItem.mockResolvedValue('borrado');
    montar();
    await waitFor(() => expect(screen.getByTestId('activo').props.children).toBe('p1'));
  });

  it('Especialista y Subcoordinador solo ven sus project_ids', async () => {
    mockUsuario = { id: 'u2', role: 'especialista', project_ids: ['p2'] };
    montar();
    await waitFor(() => expect(screen.getByTestId('activo').props.children).toBe('p2'));
    expect(ctx.proyectos.map((p) => p.id)).toEqual(['p2']);
    // Aunque tenía recordado uno ajeno, no lo usa.
    mockGetItem.mockResolvedValue('p3');
  });

  it('cambiar de proyecto se refleja en todos los que leen el contexto y se guarda por mockUsuario', async () => {
    montar();
    await waitFor(() => expect(ctx.proyectoId).toBe('p1'));
    act(() => ctx.setProyectoId('p3'));
    expect(screen.getByTestId('activo').props.children).toBe('p3');
    expect(mockSetItem).toHaveBeenCalledWith('dirac_proyecto_activo_u1', 'p3');
  });

  it('ignora un proyecto que no existe', async () => {
    montar();
    await waitFor(() => expect(ctx.proyectoId).toBe('p1'));
    act(() => ctx.setProyectoId('fantasma'));
    expect(screen.getByTestId('activo').props.children).toBe('p1');
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it('si el almacenamiento falla, sigue funcionando con el primer proyecto', async () => {
    mockGetItem.mockRejectedValue(new Error('storage roto'));
    mockSetItem.mockRejectedValue(new Error('storage roto'));
    montar();
    await waitFor(() => expect(ctx.proyectoId).toBe('p1'));
    act(() => ctx.setProyectoId('p2'));
    expect(screen.getByTestId('activo').props.children).toBe('p2');
  });

  it('mientras llega la primera respuesta se considera cargando (no "sin proyectos")', async () => {
    let resolver!: (v: any) => void;
    mockListProjects.mockReturnValue(new Promise((r) => { resolver = r; }));
    montar();
    expect(ctx.cargando).toBe(true);
    await act(async () => { resolver([P('p1')]); });
    await waitFor(() => expect(ctx.cargando).toBe(false));
    expect(ctx.proyectoId).toBe('p1');
  });

  it('sin sesión no hay proyectos ni proyecto activo', async () => {
    mockUsuario = null;
    montar();
    await waitFor(() => expect(ctx.cargando).toBe(false));
    expect(ctx.proyectoId).toBeNull();
    expect(mockListProjects).not.toHaveBeenCalled();
  });

  it('si la red falla conserva lo que había y deja de cargar', async () => {
    mockListProjects.mockRejectedValue(new Error('sin red'));
    montar();
    await waitFor(() => expect(ctx.cargando).toBe(false));
    expect(ctx.proyectos).toEqual([]);
  });
});
