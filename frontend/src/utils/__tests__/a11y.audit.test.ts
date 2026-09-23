import { auditar } from '../../../scripts/audit-a11y';

// Regresión de accesibilidad (T-11): ningún botón que solo tenga ícono puede
// quedar sin accessibilityLabel y casi todos los elementos táctiles anuncian su rol.
describe('auditoría de accesibilidad', () => {
  const r = auditar();

  it('no hay botones solo-ícono sin accessibilityLabel', () => {
    expect(r.hallazgos).toEqual([]);
  });

  it('los elementos táctiles declaran accessibilityRole (salvo fondos de modal y contenedores con inputs)', () => {
    expect(r.conRol / r.total).toBeGreaterThan(0.95);
  });
});
