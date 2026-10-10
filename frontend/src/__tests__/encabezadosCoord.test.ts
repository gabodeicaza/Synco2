// K-01, lote coordinador y autenticación: cada pantalla usa el encabezado común ScreenHeader y
// no conserva un botón de regreso propio. Se lee el código fuente porque el aspecto real solo
// se comprueba en un teléfono; esto evita que alguien reintroduzca un encabezado a mano.
import * as fs from 'fs';
import * as path from 'path';

const RAIZ = path.resolve(__dirname, '..', '..');

const PANTALLAS = [
  'app/(auth)/forgot-password.tsx',
  'app/(auth)/redeem.tsx',
  'app/(coord)/coordinators.tsx',
  'app/(coord)/report-templates.tsx',
  'app/(coord)/projects/new.tsx',
  'app/(coord)/projects/[id]/acceso-predio.tsx',
  'app/(coord)/projects/[id]/areas.tsx',
  'app/(coord)/projects/[id]/equipo.tsx',
  'app/(coord)/projects/[id]/events.tsx',
  'app/(coord)/projects/[id]/fuerza-de-trabajo.tsx',
  'app/(coord)/projects/[id]/index.tsx',
  'app/(coord)/projects/[id]/invitations.tsx',
  'app/(coord)/projects/[id]/modulos.tsx',
  'app/(coord)/projects/[id]/personal.tsx',
  'app/(coord)/projects/[id]/tree.tsx',
];

// Botones "atrás" legítimos que NO son el encabezado de la pantalla: `archivo` -> cantidad permitida.
const EXCEPCIONES: Record<string, { cantidad: number; motivo: string }> = {
  'app/(coord)/projects/[id]/index.tsx': {
    cantidad: 1,
    motivo: 'paso atrás dentro del modal de Exportar reportes (periodo, área, formato), no encabezado de pantalla',
  },
};

const leer = (relativa: string) => fs.readFileSync(path.join(RAIZ, relativa), 'utf8');
const contar = (texto: string, patron: RegExp) => (texto.match(patron) ?? []).length;

describe('K-01: encabezado común en pantallas del coordinador y de autenticación', () => {
  it.each(PANTALLAS)('%s importa y muestra ScreenHeader', (archivo) => {
    const codigo = leer(archivo);
    expect(codigo).toMatch(/import \{ ScreenHeader \} from '@\/src\/components\/ScreenHeader'/);
    expect(codigo).toMatch(/<ScreenHeader[\s>]/);
  });

  it.each(PANTALLAS)('%s no conserva un botón de regreso propio', (archivo) => {
    const codigo = leer(archivo);
    const permitidos = EXCEPCIONES[archivo]?.cantidad ?? 0;
    expect(contar(codigo, /name="chevron-back"/g)).toBe(permitidos);
    expect(contar(codigo, /name="arrow-back(-outline)?"/g)).toBe(0);
  });

  it.each(PANTALLAS)('%s no deja estilos ni imports huérfanos del encabezado antiguo', (archivo) => {
    // En invitations.tsx `backBtn` es el botón "Atrás" del asistente de invitación (paso anterior
    // del formulario), no el encabezado de la pantalla.
    const nombres = archivo.endsWith('invitations.tsx')
      ? 'backIconBtn|topBar|topTitle|headerWrap|headerTopRow|titleBar'
      : 'backBtn|backIconBtn|topBar|topTitle|headerWrap|headerTopRow|titleBar';
    const codigo = leer(archivo);
    expect(codigo).not.toMatch(new RegExp(`styles\\.(${nombres})\\b`));
    expect(codigo).not.toMatch(new RegExp(`^\\s*(${nombres}):`, 'm'));
  });

  it('las excepciones documentadas tienen motivo', () => {
    for (const [archivo, e] of Object.entries(EXCEPCIONES)) {
      expect(PANTALLAS).toContain(archivo);
      expect(e.motivo.length).toBeGreaterThan(10);
    }
  });

  it('las pantallas de (coord) que van dentro de un proyecto regresan al proyecto si no hay historial', () => {
    const dentroDeProyecto = PANTALLAS.filter((p) => p.includes('projects/[id]/') && !p.endsWith('/index.tsx'));
    for (const archivo of dentroDeProyecto) {
      expect(leer(archivo)).toMatch(/fallbackHref=\{\{ pathname: '\/\(coord\)\/projects\/\[id\]'/);
    }
  });

  it('las pantallas de autenticación regresan al inicio de sesión', () => {
    for (const archivo of ['app/(auth)/forgot-password.tsx', 'app/(auth)/redeem.tsx']) {
      expect(leer(archivo)).toMatch(/fallbackHref="\/\(auth\)\/login"/);
    }
  });
});
