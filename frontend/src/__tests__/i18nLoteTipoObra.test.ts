// Guardia de i18n (lote tipo de obra, Fase 5 / X-01, K-13, T-10): en las pantallas de este lote ningún
// texto visible en español queda escrito en el código; todo pasa por t('...') de "@/src/i18n". Además, los
// textos genéricos de módulos y tipos de obra no usan vocabulario de un proyecto específico.
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { esMX } from '@/src/i18n';

const RAIZ = path.join(__dirname, '..', '..');

const PANTALLAS = [
  'app/(coord)/projects/new.tsx',
  'app/(coord)/projects/[id]/modulos.tsx',
  'src/components/SelectorTipoObra.tsx',
  'src/components/ControlObraScreen.tsx',
];

const UTILIDADES = ['src/utils/modulos.ts', 'src/utils/tipoObraModulos.ts'];

const ATRIBUTOS_TEXTO = new Set(['placeholder', 'title', 'label', 'subtitle', 'accessibilityLabel', 'accessibilityHint']);
const LLAMADAS_TEXTO = new Set(['Alert.alert', 'showToast', 'confirm']);

// Excepciones documentadas: texto visible que NO se traduce a propósito.
//  - Ninguna por ahora: los símbolos y formatos no contienen dos letras seguidas.
const EXCEPCIONES = new Set<string>([]);

const TIENE_LETRAS = /\p{L}{2,}/u;

interface Hallazgo {
  archivo: string;
  linea: number;
  texto: string;
}

function nombreLlamada(expr: ts.Expression): string {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return `${nombreLlamada(expr.expression)}.${expr.name.text}`;
  return '';
}

function abrir(rel: string): ts.SourceFile {
  const fuente = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
  return ts.createSourceFile(rel, fuente, ts.ScriptTarget.Latest, true, rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function escanearPantalla(rel: string): Hallazgo[] {
  const sf = abrir(rel);
  const hallazgos: Hallazgo[] = [];
  const agregar = (nodo: ts.Node, texto: string) => {
    const limpio = texto.replace(/\s+/g, ' ').trim();
    if (!limpio || !TIENE_LETRAS.test(limpio) || EXCEPCIONES.has(limpio)) return;
    const { line } = sf.getLineAndCharacterOfPosition(nodo.getStart(sf));
    hallazgos.push({ archivo: rel, linea: line + 1, texto: limpio.slice(0, 70) });
  };

  const visitar = (n: ts.Node) => {
    if (ts.isJsxText(n)) agregar(n, n.getText(sf));
    if (ts.isJsxAttribute(n) && ATRIBUTOS_TEXTO.has(n.name.getText(sf)) && n.initializer) {
      if (ts.isStringLiteral(n.initializer)) agregar(n.initializer, n.initializer.text);
      else if (ts.isJsxExpression(n.initializer) && n.initializer.expression) {
        const e = n.initializer.expression;
        if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) agregar(e, e.text);
        if (ts.isTemplateExpression(e)) agregar(e, e.head.text + e.templateSpans.map((s) => s.literal.text).join(' '));
      }
    }
    if (ts.isCallExpression(n)) {
      const nombre = nombreLlamada(n.expression);
      if (LLAMADAS_TEXTO.has(nombre) || /^set[A-Za-z]*(Error|Err|Aviso|Msg)$/.test(nombre)) {
        n.arguments.slice(0, 2).forEach((a) => {
          if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) agregar(a, a.text);
          if (ts.isTemplateExpression(a)) agregar(a, a.head.text + a.templateSpans.map((s) => s.literal.text).join(' '));
        });
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return hallazgos;
}

/** En utilidades (sin JSX) cualquier cadena con espacios y letras es texto en lenguaje natural. */
function escanearUtilidad(rel: string): Hallazgo[] {
  const sf = abrir(rel);
  const hallazgos: Hallazgo[] = [];
  const visitar = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && /\s/.test(n.text) && TIENE_LETRAS.test(n.text)) {
      const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
      hallazgos.push({ archivo: rel, linea: line + 1, texto: n.text.slice(0, 70) });
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return hallazgos;
}

const formato = (h: Hallazgo[]) => h.map((x) => `${x.archivo}:${x.linea} ${JSON.stringify(x.texto)}`);

describe('i18n del lote tipo de obra (X-01, K-13, T-10)', () => {
  it.each(PANTALLAS)('%s no tiene texto visible escrito en el código', (rel) => {
    expect(formato(escanearPantalla(rel))).toEqual([]);
  });

  it.each(UTILIDADES)('%s no tiene texto en lenguaje natural escrito en el código', (rel) => {
    expect(formato(escanearUtilidad(rel))).toEqual([]);
  });

  it('todos los archivos del lote existen e importan t() (salvo el selector, que la usa igual)', () => {
    for (const rel of [...PANTALLAS, ...UTILIDADES]) {
      expect(fs.existsSync(path.join(RAIZ, rel))).toBe(true);
      expect(fs.readFileSync(path.join(RAIZ, rel), 'utf8')).toMatch(/from '@\/src\/i18n'/);
    }
  });

  it('los textos genéricos de módulos y tipos de obra no usan vocabulario de un proyecto específico', () => {
    const texto = JSON.stringify({ tipoObra: esMX.tipoObra, modulosObra: esMX.modulosObra });
    expect(texto).not.toMatch(/poste|estaci[oó]n|perforadora|intertramo|cablebús|cablebus/i);
  });

  it('cada módulo del catálogo tiene título y subtítulo en i18n', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MODULOS } = require('@/src/utils/modulos');
    expect(MODULOS).toHaveLength(8);
    for (const m of MODULOS) {
      expect(m.label).toBeTruthy();
      expect(m.subtitle).toBeTruthy();
      expect(m.label).not.toMatch(/^modulosObra\./);
      expect(m.subtitle).not.toMatch(/^modulosObra\./);
    }
  });
});
