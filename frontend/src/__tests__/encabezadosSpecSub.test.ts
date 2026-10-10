// K-01 (lote Especialista / Subcoordinador): cada pantalla del lote usa el encabezado común
// ScreenHeader y ya no dibuja su propio botón de regreso.
import * as fs from 'fs';
import * as path from 'path';

const RAIZ = path.resolve(__dirname, '..', '..');
const leer = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

const MIGRADAS = [
  'app/(spec)/archivos-consulta.tsx',
  'app/(spec)/fuerza-de-trabajo.tsx',
  'app/(spec)/calendario.tsx',
  'app/(spec)/mensajes.tsx',
  'app/(subcoord)/acceso-predio.tsx',
  'app/(subcoord)/archivos-consulta.tsx',
  'app/(subcoord)/fuerza-de-trabajo.tsx',
  'app/(subcoord)/calendario.tsx',
  'src/components/ActividadesGeneralesScreen.tsx',
];

// Pantallas del lote que NO se migran, con el motivo.
const EXCEPCIONES: Record<string, string> = {
  'app/(spec)/nuevo.tsx':
    'Formulario de captura: su "cerrar" (X) descarta el reporte y no es un regreso de navegación; es además el botón central de la barra de pestañas.',
  'app/(subcoord)/mensajes.tsx': 'Reexporta app/(spec)/mensajes.tsx (ya migrado).',
  'app/(spec)/actividades-generales.tsx': 'Envoltorio de ruta: el encabezado lo pone ActividadesGeneralesScreen (migrado).',
  'app/(subcoord)/actividades-generales.tsx': 'Envoltorio de ruta: el encabezado lo pone ActividadesGeneralesScreen (migrado).',
};

describe('K-01: encabezado común en el lote Especialista/Subcoordinador', () => {
  it.each(MIGRADAS)('%s usa ScreenHeader', (rel) => {
    expect(leer(rel)).toMatch(/from '@\/src\/components\/ScreenHeader'/);
    expect(leer(rel)).toMatch(/<ScreenHeader/);
  });

  it.each(MIGRADAS)('%s ya no dibuja su propio chevron-back', (rel) => {
    expect(leer(rel)).not.toMatch(/name="chevron-back"/);
  });

  it('las excepciones existen y tienen motivo documentado', () => {
    for (const [rel, motivo] of Object.entries(EXCEPCIONES)) {
      expect(fs.existsSync(path.join(RAIZ, rel))).toBe(true);
      expect(motivo.length).toBeGreaterThan(10);
    }
  });

  it('cada fallbackHref de un envoltorio de rol apunta a su propio inicio', () => {
    for (const rel of MIGRADAS.filter((r) => r.startsWith('app/(spec)/'))) {
      const codigo = leer(rel);
      if (/fallbackHref="/.test(codigo)) expect(codigo).toMatch(/fallbackHref="\/\(spec\)"/);
    }
    for (const rel of MIGRADAS.filter((r) => r.startsWith('app/(subcoord)/'))) {
      const codigo = leer(rel);
      if (/fallbackHref="/.test(codigo)) expect(codigo).toMatch(/fallbackHref="\/\(subcoord\)"/);
    }
  });
});
