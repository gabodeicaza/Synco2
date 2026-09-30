import React from 'react';
import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

configure({ asyncUtilTimeout: 8000 });

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
}));
jest.mock('@/src/utils/toast', () => ({ showToast: jest.fn() }));
jest.mock('@/src/utils/confirm', () => ({ confirm: jest.fn() }));
jest.mock('@/src/utils/downloadBlob', () => ({ downloadBlob: jest.fn() }));

const mockAuth = { user: { id: 'u1', role: 'coordinador_general', name: 'Ana', project_ids: ['p1'] } };
jest.mock('@/src/auth-context', () => ({ useAuth: () => mockAuth }));

jest.mock('@/src/api', () => ({
  api: {
    getProject: jest.fn(),
    listNodes: jest.fn(),
    listCimentacionElementos: jest.fn(),
    listPerforadoras: jest.fn(),
    listPlantillasEtapasPoste: jest.fn(),
    aplicarPlantillaEtapasPoste: jest.fn(),
    updateProject: jest.fn(),
    downloadControlObraXlsx: jest.fn(),
  },
}));

import { api } from '@/src/api';
import { confirm } from '@/src/utils/confirm';
import { showToast } from '@/src/utils/toast';
import ControlObraScreen from '@/src/components/ControlObraScreen';

const getProject = api.getProject as jest.Mock;
const listarPlantillas = api.listPlantillasEtapasPoste as jest.Mock;
const aplicar = api.aplicarPlantillaEtapasPoste as jest.Mock;
const confirmar = confirm as jest.Mock;

jest.setTimeout(30000);

const ETAPAS = [
  { nombre: 'Pilas', actividades: ['Perforación', 'Colado'] },
  { nombre: 'Cabezal', actividades: ['Armado'] },
];
const PLANTILLA = { id: 'cimentacion_postes', nombre: 'Cimentación de postes', descripcion: 'Etapas', etapas: ETAPAS };

const proyecto = (extra: Record<string, unknown> = {}) => ({ id: 'p1', name: 'Obra', etapas_poste: [], ...extra });

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.user = { id: 'u1', role: 'coordinador_general', name: 'Ana', project_ids: ['p1'] };
  getProject.mockResolvedValue(proyecto());
  (api.listNodes as jest.Mock).mockResolvedValue([]);
  (api.listCimentacionElementos as jest.Mock).mockResolvedValue({ elementos: [] });
  (api.listPerforadoras as jest.Mock).mockResolvedValue({ perforadoras: [] });
  listarPlantillas.mockResolvedValue([PLANTILLA]);
});

describe('Control de Obra: etapas de poste opcionales', () => {
  it('un proyecto nuevo (sin etapas) no falla y explica que son opcionales', async () => {
    render(<ControlObraScreen projectId="p1" />);
    expect(await screen.findByText('Etapas de poste (opcionales)')).toBeTruthy();
    expect(screen.getByText(/Son opcionales/)).toBeTruthy();
    expect(screen.getByText('Avance físico general de postes')).toBeTruthy();
  });

  it('el Coordinador General ve la plantilla; al confirmar se aplica y el proyecto se actualiza', async () => {
    confirmar.mockResolvedValue(true);
    aplicar.mockResolvedValue(proyecto({ etapas_poste: ETAPAS }));
    render(<ControlObraScreen projectId="p1" />);
    const boton = await screen.findByRole('button', { name: 'Usar plantilla «Cimentación de postes»' });
    await act(async () => { fireEvent.press(boton); });

    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(confirmar.mock.calls[0][1]).toContain('«Cimentación de postes»');
    expect(confirmar.mock.calls[0][1]).toContain('(2 elementos)');
    expect(aplicar).toHaveBeenCalledWith('p1', 'cimentacion_postes');
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Plantilla aplicada'));
    // Con etapas configuradas desaparece el estado vacío.
    await waitFor(() => expect(screen.queryByText('Etapas de poste (opcionales)')).toBeNull());
  });

  it('si cancela la confirmación no se aplica nada', async () => {
    confirmar.mockResolvedValue(false);
    render(<ControlObraScreen projectId="p1" />);
    const boton = await screen.findByRole('button', { name: 'Usar plantilla «Cimentación de postes»' });
    await act(async () => { fireEvent.press(boton); });
    expect(aplicar).not.toHaveBeenCalled();
    expect(screen.getByText('Etapas de poste (opcionales)')).toBeTruthy();
  });

  it('un error del servidor sale en línea (sin Alert) y un error de red da toast', async () => {
    confirmar.mockResolvedValue(true);
    aplicar.mockRejectedValueOnce(Object.assign(new Error('Solo el Coordinador General puede hacerlo'), { status: 403 }));
    render(<ControlObraScreen projectId="p1" />);
    const boton = await screen.findByRole('button', { name: 'Usar plantilla «Cimentación de postes»' });
    await act(async () => { fireEvent.press(boton); });
    expect(await screen.findByText('Solo el Coordinador General puede hacerlo')).toBeTruthy();

    aplicar.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 0 }));
    await act(async () => { fireEvent.press(boton); });
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/conexión/i));
  });

  it('si las plantillas no cargan avisa en línea y se sigue pudiendo configurar a mano', async () => {
    listarPlantillas.mockRejectedValue(new Error('sin red'));
    render(<ControlObraScreen projectId="p1" />);
    expect(await screen.findByText('No se pudieron cargar las plantillas.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Configurar etapas' })).toBeTruthy();
  });

  it('quien no es Coordinador General no ve el botón de plantilla ni consulta el catálogo', async () => {
    mockAuth.user = { id: 'u2', role: 'especialista', name: 'Luis', project_ids: ['p1'] };
    render(<ControlObraScreen projectId="p1" />);
    expect(await screen.findByText('Solo el Coordinador General puede aplicar una plantilla de etapas.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Usar plantilla/ })).toBeNull();
    expect(listarPlantillas).not.toHaveBeenCalled();
  });

  it('un proyecto anterior con etapas conserva su comportamiento: no muestra el estado vacío', async () => {
    getProject.mockResolvedValue(proyecto({ etapas_poste: ETAPAS }));
    render(<ControlObraScreen projectId="p1" />);
    expect(await screen.findByText('Avance físico general de postes')).toBeTruthy();
    expect(screen.queryByText('Etapas de poste (opcionales)')).toBeNull();
    expect(listarPlantillas).not.toHaveBeenCalled();
  });
});
