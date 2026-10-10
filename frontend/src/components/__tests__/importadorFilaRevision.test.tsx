import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-document-picker', () => ({}));
jest.mock('@/src/api', () => ({ api: {} }));

import { FilaRevision } from '../ImportarCatalogoModal';

function fila(extra: any = {}) {
  return {
    fila: 5, tipo_fila: 'concepto', clave: '1.1', descripcion: 'Muro', estado: 'advertencia',
    unidad_efectiva: 'UNIVERSAL', cantidad_efectiva: '10', precio_unitario_efectivo: '0', correccion: null,
    problemas_activos: [], ...extra,
  } as any;
}

function abrir(f: any, extra: any = {}) {
  const props = {
    fila: f, expanded: true, onToggle: jest.fn(), onCorregir: jest.fn(), onDescartar: jest.fn(), onRevertir: jest.fn(),
    unidades: ['PZA', 'M2', 'SACO'], separador: '.' as const, ...extra,
  };
  render(<FilaRevision {...props} />);
  return props;
}

describe('FilaRevision — reglas nuevas del importador', () => {
  it('unidad vacía (C-07): explica y ofrece las unidades del proyecto, incluidas las personalizadas (C-04)', () => {
    const props = abrir(fila({ problemas_activos: [{ tipo: 'unidad_vacia', campo: 'unidad', motivo: 'La unidad está vacía; se usará UNIVERSAL si no se corrige' }] }));
    expect(screen.getByText('La unidad viene vacía. Elige la correcta o déjala así para usar «Universal».')).toBeTruthy();
    fireEvent.press(screen.getByText('SACO'));
    expect(props.onCorregir).toHaveBeenCalledWith(5, { unidad: 'SACO' });
  });

  it('P.U. en 0 (C-07): permite corregirlo con formato es-MX', () => {
    const props = abrir(fila({ problemas_activos: [{ tipo: 'precio_unitario_cero', campo: 'precio_unitario', motivo: 'El precio unitario es 0' }] }));
    expect(screen.getByText('Un precio unitario en 0 deja el importe de este concepto en 0. Corrígelo o déjalo así si es intencional.')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Valor correcto'), '1,250.5');
    fireEvent.press(screen.getByLabelText('Confirmar'));
    expect(props.onCorregir).toHaveBeenCalledWith(5, { precio_unitario: '1250.5' });
  });

  it('un valor inválido se marca en línea (no con Alert) y se limpia al teclear', () => {
    const props = abrir(fila({ problemas_activos: [{ tipo: 'precio_unitario_cero', campo: 'precio_unitario', motivo: 'x' }] }));
    fireEvent.changeText(screen.getByLabelText('Valor correcto'), '1,5');
    fireEvent.press(screen.getByLabelText('Confirmar'));
    expect(screen.getByText('El precio unitario debe ser un número válido.')).toBeTruthy();
    expect(props.onCorregir).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByLabelText('Valor correcto'), '15');
    expect(screen.queryByText('El precio unitario debe ser un número válido.')).toBeNull();
  });

  it('clave repetida con gemela válida (C-08) y clave sin prefijo del padre (C-09) traen su ayuda', () => {
    abrir(fila({
      estado: 'duplicado',
      problemas_activos: [
        { tipo: 'clave_duplicada_archivo', campo: null, motivo: "La clave '1.1' ya aparece en la fila 4, que es válida; esta fila se omitirá" },
        { tipo: 'clave_sin_prefijo_padre', campo: null, motivo: "La clave '7.1' no empieza con la de su partida padre '3.3'" },
      ],
    }));
    expect(screen.getByText('Se importará la primera fila válida con esta clave y esta se omitirá. Si prefieres esta, descarta la otra.')).toBeTruthy();
    expect(screen.getByText('Confirma que la clave es correcta, o descarta la fila.')).toBeTruthy();
  });

  it('sin gemela válida pide corregir una y descartar las demás', () => {
    abrir(fila({ estado: 'error', problemas_activos: [{ tipo: 'clave_duplicada_sin_gemela_valida', campo: null, motivo: 'm' }] }));
    expect(screen.getByText('Corrige una de las filas repetidas y descarta las demás.')).toBeTruthy();
  });
});
