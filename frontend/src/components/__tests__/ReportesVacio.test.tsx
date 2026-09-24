import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { contenidoReportesVacio, ReportesVacio } from '../ReportesVacio';
import { SinReportesAviso } from '../SinReportesAviso';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

describe('ReportesVacio (R-01)', () => {
  it('coordinador sin filtros: explica quién captura y ofrece invitar', () => {
    const onInvitar = jest.fn();
    render(<ReportesVacio variante="coord" onInvitar={onInvitar} onQuitarFiltros={jest.fn()} />);
    expect(screen.getByText('Aún no hay reportes en este proyecto')).toBeTruthy();
    expect(screen.getByText(/Especialistas y Subcoordinadores/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Invitar a un especialista'));
    expect(onInvitar).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Quitar filtros')).toBeNull();
    expect(screen.queryByLabelText('Crear nuevo reporte')).toBeNull();
  });

  it('coordinador con filtros: dice "para este filtro" y quita los filtros, sin invitar', () => {
    const onQuitar = jest.fn();
    render(<ReportesVacio variante="coord" hayFiltros onQuitarFiltros={onQuitar} onInvitar={jest.fn()} />);
    expect(screen.getByText('No hay reportes para este filtro.')).toBeTruthy();
    expect(screen.queryByLabelText('Invitar a un especialista')).toBeNull();
    fireEvent.press(screen.getByLabelText('Quitar filtros'));
    expect(onQuitar).toHaveBeenCalledTimes(1);
  });

  it('con búsqueda muestra el texto buscado', () => {
    render(<ReportesVacio variante="sub" busqueda="zanja" onQuitarFiltros={jest.fn()} />);
    expect(screen.getByText('No encontramos reportes que coincidan con «zanja».')).toBeTruthy();
  });

  it('especialista: puede crear su primer reporte', () => {
    const onCrear = jest.fn();
    render(<ReportesVacio variante="spec" onCrear={onCrear} />);
    fireEvent.press(screen.getByLabelText('Crear nuevo reporte'));
    expect(onCrear).toHaveBeenCalledTimes(1);
  });

  it('subcoordinador sin filtros: solo informa', () => {
    render(<ReportesVacio variante="sub" onInvitar={jest.fn()} onCrear={jest.fn()} />);
    expect(screen.getByText('Aún sin reportes hoy')).toBeTruthy();
    expect(screen.queryByLabelText('Invitar a un especialista')).toBeNull();
    expect(screen.queryByLabelText('Crear nuevo reporte')).toBeNull();
  });

  it('el contenido depende de rol, filtros y búsqueda', () => {
    expect(contenidoReportesVacio({ variante: 'coord' }).titulo).toBe('Aún no hay reportes en este proyecto');
    expect(contenidoReportesVacio({ variante: 'coord', hayFiltros: true }).titulo).toBe('Sin resultados');
    expect(contenidoReportesVacio({ variante: 'spec', busqueda: '  ' }).titulo).toBe('Sin reportes');
  });
});

describe('SinReportesAviso (R-03)', () => {
  it('avisa "0 reportes en el periodo" y ofrece cambiar el periodo o exportar', () => {
    const onCambiar = jest.fn();
    const onExportar = jest.fn();
    render(<SinReportesAviso otros={0} onCambiarPeriodo={onCambiar} onExportarDeTodosModos={onExportar} />);
    expect(screen.getByText('0 reportes en el periodo')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Cambiar periodo'));
    fireEvent.press(screen.getByLabelText('Exportar de todos modos'));
    expect(onCambiar).toHaveBeenCalledTimes(1);
    expect(onExportar).toHaveBeenCalledTimes(1);
  });

  it('explica cuando hay reportes de otra severidad que solo cuentan en fuerza de trabajo', () => {
    render(<SinReportesAviso otros={5} onCambiarPeriodo={jest.fn()} onExportarDeTodosModos={jest.fn()} />);
    expect(screen.getByText(/Hay 5 de otra severidad/)).toBeTruthy();
  });
});
