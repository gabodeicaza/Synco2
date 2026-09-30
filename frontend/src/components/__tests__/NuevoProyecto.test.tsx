import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import NewProjectScreen from '@/app/(coord)/projects/new';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => {
  const router = { replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
  return { router, useRouter: () => router };
});
jest.mock('@/src/utils/toast', () => ({ showToast: jest.fn() }));
jest.mock('@/src/api', () => ({ api: { createProject: jest.fn(), listTiposObra: jest.fn() } }));

import { router } from 'expo-router';
import { api } from '@/src/api';
import { showToast } from '@/src/utils/toast';

const crearProyecto = api.createProject as jest.Mock;
const listarTipos = api.listTiposObra as jest.Mock;

const CATALOGO = [
  { id: 'generica', nombre: 'Genérica', descripcion: 'Cualquier obra', modulos_por_defecto: {}, plantillas_recomendadas: [] },
  { id: 'carretera', nombre: 'Carretera', descripcion: 'Terracerías y pavimentos', modulos_por_defecto: {}, plantillas_recomendadas: [] },
];

function llenarObligatorios() {
  fireEvent.changeText(screen.getByLabelText('Nombre del proyecto'), 'Libramiento Norte');
  fireEvent.changeText(screen.getByLabelText('Constructora'), 'ICA');
  fireEvent.changeText(screen.getByLabelText('Número de contrato'), 'SCT-1');
}

beforeEach(() => {
  jest.clearAllMocks();
  listarTipos.mockResolvedValue(CATALOGO);
});

describe('Nuevo proyecto', () => {
  it('marca cada campo obligatorio faltante junto a su campo y no crea nada', async () => {
    render(<NewProjectScreen />);
    await act(async () => { fireEvent.press(screen.getByText('Crear proyecto')); });
    expect(screen.getByText('El nombre del proyecto es obligatorio.')).toBeTruthy();
    expect(screen.getByText('La constructora es obligatoria.')).toBeTruthy();
    expect(screen.getByText('El número de contrato es obligatorio.')).toBeTruthy();
    expect(crearProyecto).not.toHaveBeenCalled();
  });

  it('el error de un campo se borra en cuanto se corrige (K-09)', async () => {
    render(<NewProjectScreen />);
    await act(async () => { fireEvent.press(screen.getByText('Crear proyecto')); });
    fireEvent.changeText(screen.getByLabelText('Nombre del proyecto'), 'X');
    expect(screen.queryByText('El nombre del proyecto es obligatorio.')).toBeNull();
    expect(screen.getByText('La constructora es obligatoria.')).toBeTruthy();
  });

  it('valida fechas: inexistente y término anterior al inicio', async () => {
    render(<NewProjectScreen />);
    llenarObligatorios();
    fireEvent.changeText(screen.getByLabelText('Fecha de inicio (AAAA-MM-DD)'), '2026-02-31');
    await act(async () => { fireEvent.press(screen.getByText('Crear proyecto')); });
    expect(screen.getByText(/formato AAAA-MM-DD/)).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('Fecha de inicio (AAAA-MM-DD)'), '2026-06-01');
    fireEvent.changeText(screen.getByLabelText('Fecha de término (AAAA-MM-DD)'), '2026-05-01');
    await act(async () => { fireEvent.press(screen.getByText('Crear proyecto')); });
    expect(screen.getByText('La fecha de término no puede ser anterior a la de inicio.')).toBeTruthy();
    expect(crearProyecto).not.toHaveBeenCalled();
  });

  it('al crear con éxito el formulario se reinicia y navega al proyecto (P-01)', async () => {
    crearProyecto.mockResolvedValue({ id: 'nuevo1' });
    render(<NewProjectScreen />);
    llenarObligatorios();
    await act(async () => { fireEvent.press(screen.getByText('Crear proyecto')); });

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: '/(coord)/projects/[id]', params: { id: 'nuevo1' } }));
    expect(crearProyecto).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Libramiento Norte', constructora: 'ICA', contract_number: 'SCT-1', start_date: null,
    }));
    expect(showToast).toHaveBeenCalledWith('Proyecto creado');
    expect(screen.getByLabelText('Nombre del proyecto').props.value).toBe('');
    expect(screen.getByLabelText('Constructora').props.value).toBe('');
    expect(screen.getByLabelText('Número de contrato').props.value).toBe('');
  });

  it('los dos colores nacen prellenados con el mismo valor (P-03)', () => {
    render(<NewProjectScreen />);
    const inst = screen.getByLabelText('Color institucional (#RRGGBB)');
    const portada = screen.getByLabelText('Color del título de portada (#RRGGBB)');
    expect(inst.props.value).toBe(portada.props.value);
    expect(inst.props.value).not.toBe('');
  });

  it('un error de red avisa con toast y conserva lo escrito; otros errores quedan en línea', async () => {
    crearProyecto.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 0 }));
    render(<NewProjectScreen />);
    llenarObligatorios();
    await act(async () => { fireEvent.press(screen.getByText('Crear proyecto')); });
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/conexión/i));
    expect(screen.getByLabelText('Nombre del proyecto').props.value).toBe('Libramiento Norte');
    expect(router.replace).not.toHaveBeenCalled();

    crearProyecto.mockRejectedValueOnce(Object.assign(new Error('Ese número de contrato ya existe'), { status: 409 }));
    await act(async () => { fireEvent.press(screen.getByText('Crear proyecto')); });
    expect(screen.getByText('Ese número de contrato ya existe')).toBeTruthy();
  });

  describe('tipo de obra (K-13)', () => {
    it('muestra los tipos del catálogo con «Genérica» elegida y la envía por defecto', async () => {
      crearProyecto.mockResolvedValue({ id: 'n1' });
      render(<NewProjectScreen />);
      const generica = await screen.findByRole('radio', { name: /Genérica/ });
      expect(generica.props.accessibilityState.selected).toBe(true);
      expect(screen.getByRole('radio', { name: /Carretera/ }).props.accessibilityState.selected).toBe(false);
      expect(screen.getByText('El tipo de obra decide qué módulos se activan por defecto; puedes cambiarlo después.')).toBeTruthy();

      llenarObligatorios();
      await act(async () => { fireEvent.press(screen.getByText('Crear proyecto')); });
      expect(crearProyecto).toHaveBeenCalledWith(expect.objectContaining({ tipo_obra: 'generica' }));
    });

    it('envía el tipo elegido', async () => {
      crearProyecto.mockResolvedValue({ id: 'n1' });
      render(<NewProjectScreen />);
      fireEvent.press(await screen.findByRole('radio', { name: /Carretera/ }));
      expect(screen.getByRole('radio', { name: /Carretera/ }).props.accessibilityState.selected).toBe(true);
      llenarObligatorios();
      await act(async () => { fireEvent.press(screen.getByText('Crear proyecto')); });
      expect(crearProyecto).toHaveBeenCalledWith(expect.objectContaining({ tipo_obra: 'carretera' }));
    });

    it('si el catálogo falla avisa en línea, ofrece reintentar y se puede crear igual como «generica»', async () => {
      listarTipos.mockRejectedValueOnce(new Error('sin red'));
      crearProyecto.mockResolvedValue({ id: 'n1' });
      render(<NewProjectScreen />);
      expect(await screen.findByText(/No se pudieron cargar los tipos de obra/)).toBeTruthy();
      llenarObligatorios();
      await act(async () => { fireEvent.press(screen.getByText('Crear proyecto')); });
      expect(crearProyecto).toHaveBeenCalledWith(expect.objectContaining({ tipo_obra: 'generica' }));

      await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Reintentar' })); });
      expect(await screen.findByRole('radio', { name: /Genérica/ })).toBeTruthy();
      expect(screen.queryByText(/No se pudieron cargar los tipos de obra/)).toBeNull();
    });

    it('tras crear con éxito el tipo vuelve a «Genérica»', async () => {
      crearProyecto.mockResolvedValue({ id: 'n1' });
      render(<NewProjectScreen />);
      fireEvent.press(await screen.findByRole('radio', { name: /Carretera/ }));
      llenarObligatorios();
      await act(async () => { fireEvent.press(screen.getByText('Crear proyecto')); });
      await waitFor(() => expect(router.replace).toHaveBeenCalled());
      expect(screen.getByRole('radio', { name: /Genérica/ }).props.accessibilityState.selected).toBe(true);
    });
  });

  it('un doble toque mientras crea no manda dos proyectos', async () => {
    let terminar!: () => void;
    crearProyecto.mockImplementation(() => new Promise((r) => { terminar = () => r({ id: 'n' }); }));
    render(<NewProjectScreen />);
    llenarObligatorios();
    await act(async () => {
      fireEvent.press(screen.getByText('Crear proyecto'));
      fireEvent.press(screen.getByText('Crear proyecto'));
    });
    expect(crearProyecto).toHaveBeenCalledTimes(1);
    await act(async () => { terminar(); });
  });
});
