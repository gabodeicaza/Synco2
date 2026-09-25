import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { VigenciaSelector } from '../VigenciaSelector';

describe('VigenciaSelector (G-05)', () => {
  it('muestra las 4 vigencias y marca la elegida', () => {
    render(<VigenciaSelector value={24} onChange={() => undefined} />);
    for (const etiqueta of ['6 horas', '24 horas', '48 horas', '7 días']) {
      expect(screen.getByLabelText(etiqueta)).toBeTruthy();
    }
    expect(screen.getByLabelText('24 horas').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('6 horas').props.accessibilityState.selected).toBe(false);
  });

  it('elegir una vigencia avisa el valor en horas', () => {
    const cambios: number[] = [];
    render(<VigenciaSelector value={24} onChange={(v) => cambios.push(v)} />);
    fireEvent.press(screen.getByLabelText('7 días'));
    fireEvent.press(screen.getByLabelText('6 horas'));
    expect(cambios).toEqual([168, 6]);
  });

  it('el texto de ayuda cambia con la vigencia y explica que fijar no la extiende', () => {
    const { rerender } = render(<VigenciaSelector value={6} onChange={() => undefined} />);
    expect(screen.getByText(/durante 6 horas/)).toBeTruthy();
    expect(screen.getByText(/no extiende su vigencia/)).toBeTruthy();
    rerender(<VigenciaSelector value={168} onChange={() => undefined} />);
    expect(screen.getByText(/durante 7 días/)).toBeTruthy();
  });

  it('al editar avisa que el plazo se cuenta desde el momento de guardar', () => {
    render(<VigenciaSelector value={48} onChange={() => undefined} edicion />);
    expect(screen.getByText(/desde este momento/)).toBeTruthy();
  });

  it('deshabilitado no cambia la vigencia', () => {
    const cambios: number[] = [];
    render(<VigenciaSelector value={24} onChange={(v) => cambios.push(v)} disabled />);
    fireEvent.press(screen.getByLabelText('48 horas'));
    expect(cambios).toEqual([]);
  });
});
