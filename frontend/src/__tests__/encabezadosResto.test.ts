// K-01, lote "resto de componentes": cada pantalla de src/components de este lote usa el
// encabezado estándar (ScreenHeader) y ya no dibuja su propio botón de regreso.
import * as fs from 'fs';
import * as path from 'path';

const RAIZ = path.resolve(__dirname, '..', 'components');
const leer = (archivo: string) => fs.readFileSync(path.join(RAIZ, archivo), 'utf8');

const PANTALLAS = [
  'MigracionCatalogoScreen.tsx',
  'ModulosHubScreen.tsx',
  'PasswordResetRequestsScreen.tsx',
  'PerfilScreen.tsx',
  'ChangePasswordScreen.tsx',
  'PlanoAvanceScreen.tsx',
  'PresentacionPreview.tsx',
  'PresentacionScreen.tsx',
  'RegistrarAvanceScreen.tsx',
  'SeguridadHigieneScreen.tsx',
  'TablaResumenScreen.tsx',
  'VisualizarAvanceScreen.tsx',
  'AnnouncementsView.tsx',
  'MinutasView.tsx',
];

describe('K-01: encabezado estándar en el lote de componentes', () => {
  it.each(PANTALLAS)('%s usa ScreenHeader', (archivo) => {
    const codigo = leer(archivo);
    expect(codigo).toMatch(/import \{ ScreenHeader \} from '@\/src\/components\/ScreenHeader'/);
    expect(codigo).toMatch(/<ScreenHeader\b/);
  });

  it.each(PANTALLAS)('%s no dibuja su propio botón de regreso de encabezado', (archivo) => {
    const codigo = leer(archivo);
    // Un "chevron-back" suelto que llame a router.back() es un encabezado propio.
    const conRegresoPropio = /chevron-back[\s\S]{0,200}?router\.back\(\)|router\.back\(\)[\s\S]{0,200}?chevron-back/.test(codigo);
    expect(conRegresoPropio).toBe(false);
  });

  it('las vistas embebidas de Noticias y Minutas conservan su encabezado sin regreso', () => {
    for (const archivo of ['AnnouncementsView.tsx', 'MinutasView.tsx']) {
      const codigo = leer(archivo);
      expect(codigo).toMatch(/embedded \? \(/);
      expect(codigo).toMatch(/<ScreenHeader[^>]*right=\{botonNueva\}/);
    }
  });

  // SeguridadHigieneScreen conserva headerTextColor solo para el texto de sus pestañas
  // Reportes/Checklist, que viven dentro del mismo fondo de color: no es del encabezado.
  it('el encabezado de color ya no calcula el color del texto a mano', () => {
    for (const archivo of ['ModulosHubScreen.tsx', 'TablaResumenScreen.tsx', 'PlanoAvanceScreen.tsx']) {
      expect(leer(archivo)).not.toMatch(/const headerTextColor = contrastText/);
    }
  });

  it('los encabezados de color pasan el color del proyecto para que el texto contraste', () => {
    for (const archivo of ['ModulosHubScreen.tsx', 'TablaResumenScreen.tsx', 'PlanoAvanceScreen.tsx', 'SeguridadHigieneScreen.tsx', 'PresentacionScreen.tsx']) {
      expect(leer(archivo)).toMatch(/<ScreenHeader[\s\S]{0,200}backgroundColor=\{headerColor\}/);
    }
  });

  it('las vistas de detalle regresan a su lista y no salen de la pantalla', () => {
    expect(leer('PlanoAvanceScreen.tsx')).toMatch(/onBack=\{\(\) => setSelectedId\(null\)\}/);
    expect(leer('PresentacionScreen.tsx')).toMatch(/onBack=\{\(\) => setSelectedId\(null\)\}/);
  });
});
