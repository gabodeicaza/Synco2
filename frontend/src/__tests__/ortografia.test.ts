// Guardia de ortografía del texto visible (X-01, X-02, R-04/R-05, marca).
// Usa el mismo script que corrige (scripts/ortografia.js): si esta prueba falla, ejecuta
// `node scripts/ortografia.js --dry-run` para ver qué falta y `node scripts/ortografia.js` para corregirlo.
import fs from 'fs';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { revisarTodo, listarArchivos } = require('../../scripts/ortografia.js');

jest.setTimeout(120000);

const RAIZ = path.join(__dirname, '..', '..');

describe('ortografía del texto visible', () => {
  const { hallazgos, manual } = revisarTodo();

  it('no queda texto visible sin acento, con "_" como separador o placeholder, ni signos ¿ ¡ perdidos', () => {
    const lista = hallazgos.map(
      (h: any) => `${h.archivo}:${h.linea} [${h.cats.join(',')}] ${JSON.stringify(h.antes.slice(0, 70))} -> ${JSON.stringify(h.despues.slice(0, 70))}`,
    );
    expect(lista).toEqual([]);
  });

  it('no quedan residuos manuales (símbolo "_" suelto ni la marca anterior)', () => {
    const lista = manual.map((m: any) => `${m.archivo}:${m.linea} ${m.tipo}: ${m.texto}`);
    expect(lista).toEqual([]);
  });

  it('las claves de almacenamiento con la marca anterior son las únicas que quedan (no se renombran a propósito)', () => {
    // Renombrarlas perdería la cola sin conexión y sesiones guardadas: se conservan en minúsculas.
    const permitida = /^(syncsite|synco)_[a-z0-9_.]+$/;
    const fallos: string[] = [];
    for (const rel of listarArchivos()) {
      const lineas = fs.readFileSync(path.join(RAIZ, rel), 'utf8').split('\n');
      lineas.forEach((l, i) => {
        for (const m of l.matchAll(/[A-Za-z0-9_.-]*(?:synco|syncsite)[A-Za-z0-9_.-]*/gi)) {
          if (!permitida.test(m[0])) fallos.push(`${rel}:${i + 1} ${m[0]}`);
        }
      });
    }
    expect(fallos).toEqual([]);
  });

  it('los textos que dejó el script destructivo anterior ya están restaurados en sitio', () => {
    const leer = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    const personal = leer('app/(coord)/projects/[id]/personal.tsx');
    expect(personal).toContain("'Albañiles'");
    expect(personal).toContain("'Topógrafos'");
    expect(leer('app/(spec)/mensajes.tsx')).toContain('Sé el primero en escribir.');
    expect(leer('src/components/AnnouncementsView.tsx')).toContain('Los saltos de línea se respetan.');
    expect(leer('src/components/HistoryCalendarModal.tsx')).toContain("'Mié'");
  });
});
