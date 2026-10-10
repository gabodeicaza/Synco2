import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { MyMeetingsPanel } from '../MyMeetingsPanel';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const ev = (id: string, title: string, start_at: string, extra: Record<string, unknown> = {}) => ({
  id, project_id: 'p1', title, start_at, author_id: 'u', author_name: 'Ana', ...extra,
}) as any;

describe('MyMeetingsPanel (G-02)', () => {
  it('muestra el día además de la hora y respeta el orden por fecha y hora', () => {
    render(
      <MyMeetingsPanel
        items={[
          ev('c', 'Tercera', '2026-12-05T20:00:00Z'),
          ev('a', 'Primera', '2026-12-03T15:30:00Z'),
          ev('b', 'Segunda', '2026-12-04', { all_day: true, fecha: '2026-12-04' }),
        ]}
      />,
    );
    const titulos = screen.getAllByText(/Primera|Segunda|Tercera/).map((n) => n.props.children);
    expect(titulos).toEqual(['Primera', 'Segunda', 'Tercera']);
    expect(screen.getByText('03 dic 2026')).toBeTruthy();
    expect(screen.getByText('09:30')).toBeTruthy();
    expect(screen.getByText('Todo el día')).toBeTruthy();
  });

  it('estado vacío y accesibilidad de cada reunión', () => {
    const { rerender } = render(<MyMeetingsPanel items={[]} />);
    expect(screen.getByText('Sin reuniones próximas asignadas.')).toBeTruthy();
    rerender(<MyMeetingsPanel items={[ev('a', 'Reunión de obra', '2026-12-03T15:30:00Z')]} />);
    expect(screen.getByLabelText('Reunión de obra. 03 dic 2026, 09:30')).toBeTruthy();
  });
});
