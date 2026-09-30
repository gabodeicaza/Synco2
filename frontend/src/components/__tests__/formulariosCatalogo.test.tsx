import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/src/utils/toast', () => ({ showToast: jest.fn() }));
jest.mock('@/src/api', () => ({
  api: { createPartida: jest.fn(), createConcepto: jest.fn() },
}));

import { api } from '@/src/api';
import { showToast } from '@/src/utils/toast';
import { NuevaPartidaModal } from '../NuevaPartidaModal';
import { NuevoConceptoModal } from '../NuevoConceptoModal';

const crearPartida = api.createPartida as jest.Mock;
const crearConcepto = api.createConcepto as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

function partidaModal(extra: Partial<React.ComponentProps<typeof NuevaPartidaModal>> = {}) {
  const props = {
    visible: true, project: null, depth: 0, projectId: 'p1', ordenSugerido: 3,
    partidaPadreId: null, partidaPadreNombre: null,
    hermanas: [{ clave: '1', nombre: 'Obra civil' }] as any,
    todas: [{ clave: '1', nombre: 'Obra civil' }, { clave: '2', nombre: 'Otra' }] as any,
    onClose: jest.fn(), onCreada: jest.fn(), ...extra,
  };
  render(<NuevaPartidaModal {...props} />);
  return props;
}

describe('NuevaPartidaModal: concordancia con el nombre de nivel configurado (C-14)', () => {
  const niveles = ['Frente', 'Tramo', 'Estructura', 'Zona'];
  it.each([
    [0, 'Nuevo frente'], [1, 'Nuevo tramo'], [2, 'Nueva estructura'], [3, 'Nueva zona'],
  ])('en la profundidad %s el título es "%s"', (depth, titulo) => {
    partidaModal({ project: { nombres_niveles_partida: niveles } as any, depth });
    expect(screen.getByText(titulo)).toBeTruthy();
  });

  it('sin nombres configurados conserva "Nueva partida" y nunca dice "nivel 3s"', () => {
    partidaModal({ project: null, depth: 0 });
    expect(screen.getByText('Nueva partida')).toBeTruthy();
  });

  it('un nivel más profundo que los configurados es masculino ("Nuevo nivel 5")', () => {
    partidaModal({ project: { nombres_niveles_partida: ['Frente'] } as any, depth: 4 });
    expect(screen.getByText('Nuevo nivel 5')).toBeTruthy();
  });

  it('el género forzado del proyecto cambia el artículo ("Nueva frente")', () => {
    partidaModal({ project: { nombres_niveles_partida: ['Frente'], genero_niveles: { Frente: 'f' } } as any, depth: 0 });
    expect(screen.getByText('Nueva frente')).toBeTruthy();
  });

  it('el aviso de éxito concuerda ("Tramo creado", "Estructura creada")', async () => {
    const props = partidaModal({ project: { nombres_niveles_partida: ['Frente', 'Tramo', 'Estructura'] } as any, depth: 2 });
    crearPartida.mockResolvedValue({});
    fireEvent.changeText(screen.getByLabelText('Clave'), '9');
    fireEvent.changeText(screen.getByLabelText('Nombre'), 'Cimentación');
    fireEvent.press(screen.getByText('Crear'));
    await waitFor(() => expect(props.onCreada).toHaveBeenCalled());
    expect(showToast).toHaveBeenCalledWith('Estructura creada');
  });
});

describe('NuevaPartidaModal (X-03, K-07, K-08, K-09)', () => {
  it('con campos vacíos muestra el error junto a cada campo y no llama al servidor', async () => {
    partidaModal();
    fireEvent.press(screen.getByText('Crear'));
    expect(await screen.findByText('La clave es obligatoria.')).toBeTruthy();
    expect(screen.getByText('El nombre es obligatorio.')).toBeTruthy();
    expect(crearPartida).not.toHaveBeenCalled();
  });

  it('el error de un campo desaparece en cuanto se corrige (K-09)', async () => {
    partidaModal();
    fireEvent.press(screen.getByText('Crear'));
    await screen.findByText('La clave es obligatoria.');
    fireEvent.changeText(screen.getByLabelText('Clave'), '3');
    expect(screen.queryByText('La clave es obligatoria.')).toBeNull();
    expect(screen.getByText('El nombre es obligatorio.')).toBeTruthy(); // el otro campo sigue marcado
  });

  it('avisa clave y nombre repetidos junto al campo (K-07)', async () => {
    partidaModal();
    fireEvent.changeText(screen.getByLabelText('Clave'), '2');
    fireEvent.changeText(screen.getByLabelText('Nombre'), 'obra civil');
    fireEvent.press(screen.getByText('Crear'));
    expect(await screen.findByText('La clave «2» ya está en uso.')).toBeTruthy();
    expect(screen.getByText('El nombre «obra civil» ya está en uso en este nivel.')).toBeTruthy();
    expect(crearPartida).not.toHaveBeenCalled();
  });

  it('crea la partida con los datos recortados y avisa al terminar', async () => {
    crearPartida.mockResolvedValue({ id: 'nueva' });
    const props = partidaModal({ partidaPadreId: 'pa', partidaPadreNombre: 'Padre' });
    expect(screen.getByText('Se creará dentro de «Padre»')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Clave'), ' 1.1 ');
    fireEvent.changeText(screen.getByLabelText('Nombre'), ' Muros ');
    fireEvent.press(screen.getByText('Crear'));
    await waitFor(() => expect(props.onCreada).toHaveBeenCalledTimes(1));
    expect(crearPartida).toHaveBeenCalledWith({
      project_id: 'p1', clave: '1.1', nombre: 'Muros', orden: 3, partida_padre_id: 'pa',
    });
    expect(showToast).toHaveBeenCalledWith('Partida creada');
  });

  it('Enter-Enter seguidos guardan una sola vez (K-08)', async () => {
    let terminar!: () => void;
    crearPartida.mockReturnValue(new Promise((r) => { terminar = () => r({ id: 'x' }); }));
    const props = partidaModal();
    fireEvent.changeText(screen.getByLabelText('Clave'), '5');
    const nombre = screen.getByLabelText('Nombre');
    fireEvent.changeText(nombre, 'Acabados');
    fireEvent(nombre, 'submitEditing');
    fireEvent(nombre, 'submitEditing');
    expect(crearPartida).toHaveBeenCalledTimes(1);
    await act(async () => { terminar(); });
    await waitFor(() => expect(props.onCreada).toHaveBeenCalledTimes(1));
  });

  it('un error del servidor se muestra en línea; uno de red da toast', async () => {
    crearPartida.mockRejectedValueOnce(Object.assign(new Error('La clave ya existe en el catálogo'), { status: 400 }));
    partidaModal();
    fireEvent.changeText(screen.getByLabelText('Clave'), '7');
    fireEvent.changeText(screen.getByLabelText('Nombre'), 'Otra cosa');
    fireEvent.press(screen.getByText('Crear'));
    expect(await screen.findByText('La clave ya existe en el catálogo')).toBeTruthy();

    crearPartida.mockRejectedValueOnce(Object.assign(new Error('Network request failed'), { status: 0 }));
    fireEvent.press(screen.getByText('Crear'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('No hay conexión. Revisa tu internet e inténtalo de nuevo.'));
  });
});

const proyecto: any = { id: 'p1', separador_decimal: '.', unidades_personalizadas: ['SACO', 'pza'], nombre_nivel_concepto: 'Actividad' };
const partidaDestino = { id: 'pa1', clave: '1', nombre: 'Obra civil' };

function conceptoModal(extra: Partial<React.ComponentProps<typeof NuevoConceptoModal>> = {}) {
  const props = { visible: true, project: proyecto, partida: partidaDestino, onClose: jest.fn(), onCreado: jest.fn(), ...extra };
  render(<NuevoConceptoModal {...props} />);
  return props;
}

function llenarConcepto(valores: { clave?: string; descripcion?: string; cantidad?: string; precio?: string }) {
  if (valores.clave !== undefined) fireEvent.changeText(screen.getByLabelText('Clave'), valores.clave);
  if (valores.descripcion !== undefined) fireEvent.changeText(screen.getByLabelText('Descripción'), valores.descripcion);
  if (valores.cantidad !== undefined) fireEvent.changeText(screen.getByLabelText('Cantidad contratada'), valores.cantidad);
  if (valores.precio !== undefined) fireEvent.changeText(screen.getByLabelText('Precio unitario'), valores.precio);
}

describe('NuevoConceptoModal (C-05, C-04)', () => {
  it('usa el nombre de nivel configurado por el proyecto', () => {
    conceptoModal();
    expect(screen.getByText('Nueva actividad')).toBeTruthy(); // C-14: "actividad" es femenino
    expect(screen.queryByText('Nuevo actividad')).toBeNull();
    expect(screen.getByText('Se creará en «1 — Obra civil»')).toBeTruthy();
  });

  it('el género forzado por el proyecto manda sobre la palabra (C-14)', () => {
    conceptoModal({ project: { ...proyecto, genero_niveles: { actividad: 'm' } } });
    expect(screen.getByText('Nuevo actividad')).toBeTruthy();
  });

  it('ofrece unidades base y personalizadas sin repetir la que ya existe en la base (C-04 / C-12)', () => {
    conceptoModal();
    expect(screen.getByLabelText('SACO')).toBeTruthy();
    expect(screen.getAllByLabelText('Pieza')).toHaveLength(1);
  });

  it('marca cada campo obligatorio y no llama al servidor', async () => {
    conceptoModal();
    fireEvent.press(screen.getByText('Crear'));
    expect(await screen.findByText('La clave es obligatoria.')).toBeTruthy();
    expect(screen.getByText('La descripción es obligatoria.')).toBeTruthy();
    expect(screen.getByText('Cantidad contratada es obligatorio.')).toBeTruthy();
    expect(screen.getByText('Precio unitario es obligatorio.')).toBeTruthy();
    expect(crearConcepto).not.toHaveBeenCalled();
  });

  it('acepta "1,500" y manda el decimal exacto; una unidad personalizada es elegible', async () => {
    crearConcepto.mockResolvedValue({ id: 'c9', clave: '1.1' });
    const props = conceptoModal();
    llenarConcepto({ clave: '1.1', descripcion: 'Muro de block', cantidad: '1,500', precio: '25.5' });
    fireEvent.press(screen.getByLabelText('SACO'));
    fireEvent.press(screen.getByText('Crear'));
    await waitFor(() => expect(props.onCreado).toHaveBeenCalledWith({ id: 'c9', clave: '1.1' }));
    expect(crearConcepto).toHaveBeenCalledWith({
      partida_id: 'pa1', clave: '1.1', descripcion: 'Muro de block', unidad: 'SACO', cantidad: '1500',
      precio_unitario: '25.5', meta: '', periodicidad_meta: 'MENSUAL', fecha_inicio: null, fecha_fin: null,
      extraordinario: false,
    });
  });

  it('C-06: sin fechas no hay programa, así que la meta queda vacía y se explica por qué', async () => {
    crearConcepto.mockResolvedValue({ id: 'c11' });
    conceptoModal();
    llenarConcepto({ clave: '1.1', descripcion: 'Muro', cantidad: '1,500', precio: '25' });
    expect(screen.getByText(/la meta queda vacía/)).toBeTruthy();
    fireEvent.press(screen.getByText('Crear'));
    await waitFor(() => expect(crearConcepto).toHaveBeenCalled());
    expect(crearConcepto.mock.calls[0][0]).toMatchObject({ meta: '', fecha_inicio: null, fecha_fin: null });
  });

  it('C-06: con cantidad y fechas precalcula la meta en la cadencia del proyecto y la manda', async () => {
    crearConcepto.mockResolvedValue({ id: 'c12' });
    conceptoModal({ project: { ...proyecto, cadencia_reporte: 'SEMANAL' } });
    llenarConcepto({ clave: '1.1', descripcion: 'Muro', cantidad: '1,000', precio: '25' });
    fireEvent.changeText(screen.getByLabelText('Fecha de inicio (opcional)'), '2026-10-01');
    fireEvent.changeText(screen.getByLabelText('Fecha de fin (opcional)'), '2026-10-14');
    // 14 días = 2 semanas: 1,000 / 2 = 500 por semana.
    expect(screen.getByText(/Calculada con la cantidad y las fechas: 500 \S+ por semana/)).toBeTruthy();
    expect(screen.getByLabelText('Meta por semana').props.placeholder).toBe('500');
    fireEvent.press(screen.getByText('Crear'));
    await waitFor(() => expect(crearConcepto).toHaveBeenCalled());
    expect(crearConcepto.mock.calls[0][0]).toMatchObject({
      meta: '500', periodicidad_meta: 'SEMANAL', fecha_inicio: '2026-10-01', fecha_fin: '2026-10-14',
    });
  });

  it('C-06: la meta capturada a mano manda sobre la calculada', async () => {
    crearConcepto.mockResolvedValue({ id: 'c13' });
    conceptoModal({ project: { ...proyecto, cadencia_reporte: 'DIARIA' } });
    llenarConcepto({ clave: '1.1', descripcion: 'Muro', cantidad: '100', precio: '25' });
    fireEvent.changeText(screen.getByLabelText('Fecha de inicio (opcional)'), '2026-10-01');
    fireEvent.changeText(screen.getByLabelText('Fecha de fin (opcional)'), '2026-10-10');
    fireEvent.changeText(screen.getByLabelText('Meta por día'), '7.5');
    fireEvent.press(screen.getByText('Crear'));
    await waitFor(() => expect(crearConcepto).toHaveBeenCalled());
    expect(crearConcepto.mock.calls[0][0]).toMatchObject({ meta: '7.5', periodicidad_meta: 'DIARIA' });
  });

  it('C-06: fechas inválidas o fin anterior al inicio se marcan junto al campo', async () => {
    conceptoModal();
    llenarConcepto({ clave: '1.1', descripcion: 'Muro', cantidad: '10', precio: '25' });
    fireEvent.changeText(screen.getByLabelText('Fecha de inicio (opcional)'), '2026-02-31');
    fireEvent.changeText(screen.getByLabelText('Fecha de fin (opcional)'), '2026-01-01');
    fireEvent.press(screen.getByText('Crear'));
    expect(await screen.findByText('La fecha de inicio debe ser una fecha válida (AAAA-MM-DD).')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Fecha de inicio (opcional)'), '2026-03-01');
    fireEvent.press(screen.getByText('Crear'));
    expect(await screen.findByText('La fecha de fin no puede ser anterior a la de inicio.')).toBeTruthy();
    expect(crearConcepto).not.toHaveBeenCalled();
  });

  it('un extraordinario deja el P.U. opcional y lo manda como pendiente de autorización', async () => {
    crearConcepto.mockResolvedValue({ id: 'c10' });
    const props = conceptoModal();
    fireEvent.press(screen.getByLabelText('Extraordinario (no está en el catálogo contratado)'));
    expect(screen.getByText('Su precio unitario queda pendiente de autorización.')).toBeTruthy();
    expect(screen.getByText('Precio unitario propuesto')).toBeTruthy();
    llenarConcepto({ clave: 'EXT-1', descripcion: 'Trabajo nuevo', cantidad: '4' });
    fireEvent.press(screen.getByText('Crear'));
    await waitFor(() => expect(props.onCreado).toHaveBeenCalled());
    expect(crearConcepto.mock.calls[0][0]).toMatchObject({ extraordinario: true, precio_unitario: '0', cantidad: '4' });
  });

  it('una clave repetida (409) se marca junto al campo Clave', async () => {
    crearConcepto.mockRejectedValue(Object.assign(new Error('Ya existe un concepto con la clave 1.1'), { status: 409 }));
    const props = conceptoModal();
    llenarConcepto({ clave: '1.1', descripcion: 'Muro', cantidad: '2', precio: '3' });
    fireEvent.press(screen.getByText('Crear'));
    expect(await screen.findByText('La clave «1.1» ya está en uso.')).toBeTruthy();
    expect(props.onCreado).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByLabelText('Clave'), '1.2');
    expect(screen.queryByText('La clave «1.1» ya está en uso.')).toBeNull();
  });

  it('Enter-Enter en el último campo no duplica el concepto (K-08)', async () => {
    let terminar!: () => void;
    crearConcepto.mockReturnValue(new Promise((r) => { terminar = () => r({ id: 'c11' }); }));
    const props = conceptoModal();
    llenarConcepto({ clave: '2.1', descripcion: 'Losa', cantidad: '10', precio: '100' });
    const pu = screen.getByLabelText('Precio unitario');
    fireEvent(pu, 'submitEditing');
    fireEvent(pu, 'submitEditing');
    expect(crearConcepto).toHaveBeenCalledTimes(1);
    await act(async () => { terminar(); });
    await waitFor(() => expect(props.onCreado).toHaveBeenCalledTimes(1));
  });

  it('al salir del campo reformatea la cantidad (45,000)', () => {
    conceptoModal();
    const cantidad = screen.getByLabelText('Cantidad contratada');
    fireEvent.changeText(cantidad, '45000');
    fireEvent(cantidad, 'blur');
    expect(screen.getByLabelText('Cantidad contratada').props.value).toBe('45,000');
  });
});
