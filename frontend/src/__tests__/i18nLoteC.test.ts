// Guardia del lote C de la migración a i18n (Fase 5, X-01): en estas pantallas ningún texto visible
// en español puede quedar escrito en el código; todo va en src/i18n/es-MX.ts y se lee con t().
// Recorre cada archivo con el compilador de TypeScript y busca literales con letras en:
//  - texto JSX,
//  - atributos de texto (placeholder, title, label, subtitle, accessibilityLabel, accessibilityHint),
//  - mensajes de Alert.alert / showToast / confirm.
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const RAIZ = path.join(__dirname, '..', '..');

const ARCHIVOS = [
  'src/components/ReportPreviewSheet.tsx',
  'src/components/GestionRiesgosScreen.tsx',
  'app/(auth)/redeem.tsx',
  'src/components/AnnouncementsView.tsx',
  'app/(spec)/noticias.tsx',
  'app/(coord)/report-templates.tsx',
  'src/components/HeaderMenu.tsx',
];

// Literales con letras que se quedan en el código a propósito, por archivo. Hoy no hay ninguno:
// si algún día hace falta uno (nombre propio, formato técnico), se agrega aquí con su motivo.
const EXCEPCIONES: Record<string, string[]> = {};

const ATRIBUTOS_TEXTO = new Set(['placeholder', 'title', 'label', 'subtitle', 'accessibilityLabel', 'accessibilityHint']);
const LLAMADAS_TEXTO = new Set(['Alert.alert', 'showToast', 'confirm']);
const TIENE_LETRAS = /[A-Za-zÁÉÍÓÚÑáéíóúñü]{2,}/;

function textoDe(nodo: ts.Node | undefined): string | null {
  if (!nodo) return null;
  if (ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo)) return nodo.text;
  if (ts.isTemplateExpression(nodo)) {
    return nodo.head.text + nodo.templateSpans.map((s) => s.literal.text).join('');
  }
  if (ts.isJsxExpression(nodo)) return textoDe(nodo.expression);
  if (ts.isParenthesizedExpression(nodo)) return textoDe(nodo.expression);
  if (ts.isConditionalExpression(nodo)) {
    return [textoDe(nodo.whenTrue), textoDe(nodo.whenFalse)].filter(Boolean).join(' | ') || null;
  }
  return null;
}

function revisar(rel: string): string[] {
  const fuente = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
  const sf = ts.createSourceFile(rel, fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const permitidos = EXCEPCIONES[rel] ?? [];
  const hallazgos: string[] = [];
  const anotar = (nodo: ts.Node, texto: string, tipo: string) => {
    const limpio = texto.replace(/\s+/g, ' ').trim();
    if (!TIENE_LETRAS.test(limpio) || permitidos.includes(limpio)) return;
    const { line } = sf.getLineAndCharacterOfPosition(nodo.getStart(sf));
    hallazgos.push(`${rel}:${line + 1} [${tipo}] ${JSON.stringify(limpio.slice(0, 80))}`);
  };

  const visitar = (nodo: ts.Node) => {
    if (ts.isJsxText(nodo)) anotar(nodo, nodo.text, 'texto JSX');
    if (ts.isJsxAttribute(nodo) && nodo.initializer && ATRIBUTOS_TEXTO.has(nodo.name.getText(sf))) {
      const texto = textoDe(nodo.initializer);
      if (texto) anotar(nodo, texto, `atributo ${nodo.name.getText(sf)}`);
    }
    if (ts.isCallExpression(nodo) && LLAMADAS_TEXTO.has(nodo.expression.getText(sf))) {
      nodo.arguments.slice(0, 2).forEach((arg) => {
        const texto = textoDe(arg);
        if (texto) anotar(arg, texto, `llamada ${nodo.expression.getText(sf)}`);
      });
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(sf);
  return hallazgos;
}

describe('lote C: textos visibles en i18n', () => {
  it.each(ARCHIVOS)('%s no tiene texto visible escrito en el código', (rel) => {
    expect(revisar(rel)).toEqual([]);
  });

  it('cada archivo del lote usa t() de @/src/i18n', () => {
    for (const rel of ARCHIVOS) {
      const fuente = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
      expect(fuente).toMatch(/from '@\/src\/i18n'/);
      expect(fuente).toMatch(/\bt\(|\btr\(/);
    }
  });

  it('la guardia detecta un literal escrito en el código (comprobación de la propia prueba)', () => {
    const fuente = `const a = <Text placeholder="Escribe aquí">Hola mundo</Text>; Alert.alert('Error', 'Falló');`;
    const sf = ts.createSourceFile('x.tsx', fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let cuenta = 0;
    const visitar = (n: ts.Node) => {
      if (ts.isJsxText(n) && TIENE_LETRAS.test(n.text)) cuenta += 1;
      if (ts.isJsxAttribute(n) && n.initializer && TIENE_LETRAS.test(textoDe(n.initializer) ?? '')) cuenta += 1;
      if (ts.isCallExpression(n) && LLAMADAS_TEXTO.has(n.expression.getText(sf))) {
        n.arguments.forEach((a) => { if (TIENE_LETRAS.test(textoDe(a) ?? '')) cuenta += 1; });
      }
      ts.forEachChild(n, visitar);
    };
    visitar(sf);
    expect(cuenta).toBe(4);
  });
});
