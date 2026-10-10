import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { AnalisisPeriodo } from '@/src/api';
import { SlideFinanciero } from '@/src/components/presentacion/SlideFinanciero';
import { PeriodoFinancieroSelector } from '@/src/components/PeriodoFinancieroSelector';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const base: AnalisisPeriodo = {
  project_id: 'p1', start: '2026-09-01', end: '2026-09-24', pv: '1000.00', ev: '400.00',
  ev_contractual: '400.00', ev_total: '400.00', ac: '0.00', spi: '0.4000', cpi: null,
  variacion_cronograma: '-600.00', variacion_costo: null, bac: '5000.00',
  eac: null, etc: null, vac: null,
};

describe('SlideFinanciero', () => {
  it('con AC = 0 muestra "—" en la variación de costo, la nota y el periodo impreso', () => {
    render(
      <SlideFinanciero
        analisis={base} presupuestoTotal="5000.00" colorTema="#003366"
        periodoTexto="Periodo: Del 1 al 24 de septiembre de 2026"
      />,
    );
    expect(screen.getByText('Periodo: Del 1 al 24 de septiembre de 2026')).toBeTruthy();
    expect(screen.getByText('Sin gasto real capturado en el periodo: el CPI y la variación de costo no se calculan.')).toBeTruthy();
    expect(screen.getAllByText('$400.00')).toHaveLength(2); // EV contractual y total siguen visibles
    // CPI, variación de costo, EAC, ETC y VAC quedan en "—" mientras no hay gasto real.
    expect(screen.getAllByText('—')).toHaveLength(5);
    expect(screen.getByText('Variación costo')).toBeTruthy();
  });

  it('con gasto muestra el monto de la variación y no la nota', () => {
    render(
      <SlideFinanciero
        analisis={{ ...base, ac: '100.00', cpi: '4.0000', variacion_costo: '300.00' }}
        presupuestoTotal="5000.00" colorTema="#003366"
      />,
    );
    expect(screen.getByText('$300.00')).toBeTruthy();
    expect(screen.queryByText(/Sin gasto real capturado en el periodo/)).toBeNull();
  });

  it('sin datos dice que no hay datos financieros', () => {
    render(<SlideFinanciero analisis={null} presupuestoTotal={null} colorTema="#003366" />);
    expect(screen.getByText('Sin datos financieros (EVM) disponibles para este periodo.')).toBeTruthy();
  });
});

describe('PeriodoFinancieroSelector', () => {
  it('ofrece los 3 periodos del tablero y avisa el elegido', () => {
    const cambios: string[] = [];
    render(<PeriodoFinancieroSelector value="mes_actual" onChange={(p) => cambios.push(p)} />);
    expect(screen.getByText('Mes actual')).toBeTruthy();
    expect(screen.getByText('Proyecto completo')).toBeTruthy();
    fireEvent.press(screen.getByText('Últimos 3 meses'));
    expect(cambios).toEqual(['ultimos_3_meses']);
  });

  it('deshabilitado no cambia el periodo', () => {
    const cambios: string[] = [];
    render(<PeriodoFinancieroSelector value="mes_actual" onChange={(p) => cambios.push(p)} disabled />);
    fireEvent.press(screen.getByText('Últimos 3 meses'));
    expect(cambios).toEqual([]);
  });
});
