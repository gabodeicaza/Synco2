// Guardia de i18n (lote B, Fase 5 / X-01): en las pantallas de este lote ningún texto visible en
// español queda escrito en el código; todo pasa por t('...') de "@/src/i18n".
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const RAIZ = path.join(__dirname, '..', '..');

const ARCHIVOS = [
  'app/(coord)/projects/[id]/tree.tsx',
  'src/components/PlanoAvanceScreen.tsx',
  'app/(subcoord)/dashboard.tsx',
  'app/(coord)/projects/[id]/invitations.tsx',
  'src/components/SeguridadHigieneScreen.tsx',
  'src/components/EstudiosProyectoScreen.tsx',
  'src/components/DashboardEVM.tsx',
];

const ATRIBUTOS_TEXTO = new Set(['placeholder', 'title', 'label', 'subtitle', 'accessibilityLabel', 'accessibilityHint']);
const LLAMADAS_TEXTO = new Set(['Alert.alert', 'showToast', 'confirm']);

// Excepciones documentadas: texto visible que NO se traduce a propósito.
//  - Símbolos, unidades, formatos y siglas técnicas que no son lenguaje natural.
const EXCEPCIONES = new Set<string>([
  'm',
  'km',
  'PDF',
  'XLSX',
]);

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

function escanear(rel: string): Hallazgo[] {
  const fuente = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
  const sf = ts.createSourceFile(rel, fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
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

describe('i18n del lote B (X-01)', () => {
  it.each(ARCHIVOS)('%s no tiene texto visible escrito en el código', (rel) => {
    const lista = escanear(rel).map((h) => `${h.archivo}:${h.linea} ${JSON.stringify(h.texto)}`);
    expect(lista).toEqual([]);
  });

  it('todos los archivos del lote existen', () => {
    for (const rel of ARCHIVOS) expect(fs.existsSync(path.join(RAIZ, rel))).toBe(true);
  });

  it('cada archivo del lote importa t() de i18n', () => {
    for (const rel of ARCHIVOS) {
      const fuente = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
      expect(fuente).toMatch(/from '@\/src\/i18n'/);
    }
  });
});
