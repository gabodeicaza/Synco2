// K-01, lote de módulos de obra: cada pantalla usa el encabezado común y ya no dibuja el suyo.
import * as fs from 'fs';
import * as path from 'path';

const COMPONENTES = path.resolve(__dirname, '..', 'components');

const PANTALLAS = [
  'CatalogoConceptosHubScreen.tsx',
  'CatalogoConceptosScreen.tsx',
  'ControlObraScreen.tsx',
  'DashboardEVM.tsx',
  'EstadoTiempoScreen.tsx',
  'EstudiosProyectoScreen.tsx',
  'ForestalArboladoScreen.tsx',
  'GestionRiesgosScreen.tsx',
  'ImpactoAmbientalScreen.tsx',
];

const leer = (archivo: string) => fs.readFileSync(path.join(COMPONENTES, archivo), 'utf8');

describe('encabezados del lote de módulos (K-01)', () => {
  it.each(PANTALLAS)('%s usa ScreenHeader', (archivo) => {
    const codigo = leer(archivo);
    expect(codigo).toMatch(/from '@\/src\/components\/ScreenHeader'/);
    expect(codigo).toMatch(/<ScreenHeader[\s>]/);
  });

  it.each(PANTALLAS)('%s ya no dibuja su propio botón de regreso', (archivo) => {
    const codigo = leer(archivo);
    expect(codigo).not.toMatch(/name="chevron-back"/);
    expect(codigo).not.toMatch(/router\.back\(\)/);
    expect(codigo).not.toMatch(/styles\.(headerWrap|headerTopRow|titleBar|headerBackBtn)/);
  });

  it('el catálogo conserva el regreso que sube un nivel de partida', () => {
    const codigo = leer('CatalogoConceptosScreen.tsx');
    expect(codigo).toMatch(/onBack=\{mode === 'partidas' && breadcrumb\.length > 0 \? subirUnNivel : undefined\}/);
  });

  it('Control de Obra conserva su acción de descarga en la zona derecha', () => {
    const codigo = leer('ControlObraScreen.tsx');
    expect(codigo).toMatch(/right=\{[\s\S]*a11y\('descargar'\)/);
  });
});
