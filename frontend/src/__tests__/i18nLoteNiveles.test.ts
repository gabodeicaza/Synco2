// Guardia de i18n del lote "niveles y género" (C-14): en estas pantallas ningún texto visible en
// español queda escrito en el código; todo pasa por `t('seccion.clave')` de es-MX.ts, para que
// los nombres de nivel configurados por el proyecto y su género se apliquen en un solo lugar.
//
// Recorre el AST con el compilador de TypeScript y reporta archivo:línea de cada literal que se
// vería en pantalla: texto JSX, atributos de texto (placeholder, title, label, subtitle,
// accessibilityLabel/Hint…), literales dentro de expresiones JSX y el primer argumento de
// Alert.alert / showToast / confirm.
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const RAIZ = path.resolve(__dirname, '..', '..');

const ARCHIVOS = [
  'src/components/CatalogoConceptosScreen.tsx',
  'src/components/NuevaPartidaModal.tsx',
  'src/components/NuevoConceptoModal.tsx',
  'src/components/RegistrarAvanceScreen.tsx',
  'src/components/VisualizarAvanceScreen.tsx',
  'src/components/ImportarCatalogoModal.tsx',
  'src/components/ImportarMaestroModal.tsx',
  'src/components/ImportarProgramaModal.tsx',
  'src/components/MigracionCatalogoScreen.tsx',
];

const ATRIBUTOS_DE_TEXTO = new Set([
  'placeholder', 'title', 'label', 'subtitle', 'description', 'message', 'accessibilityLabel',
  'accessibilityHint', 'headerTitle', 'text', 'caption',
]);
const LLAMADAS_DE_TEXTO = new Set([
  'showToast', 'confirm', 'Alert.alert', 'alert', 'setError', 'setErr', 'setErrorCorreccion', 'setErrorGeneral',
]);

/** Textos que NO se traducen, con su motivo. Comparación exacta contra el texto ya recortado. */
const EXCEPCIONES: Record<string, string> = {
  Dirac: 'nombre propio de la marca',
  Excel: 'nombre de un producto',
  XLSX: 'formato de archivo',
  UNIVERSAL: 'valor técnico de unidad',
  'AAAA-MM-DD': 'formato técnico de fecha',
  'YYYY-MM-DD': 'formato técnico de fecha',
};

const TIENE_LETRAS = /[A-Za-zÁÉÍÓÚáéíóúñÑüÜ]{2,}/;

interface Hallazgo { archivo: string; linea: number; texto: string }

function esVisible(texto: string): boolean {
  const t = texto.replace(/\s+/g, ' ').trim();
  if (!t || !TIENE_LETRAS.test(t)) return false;
  if (t in EXCEPCIONES) return false;
  return true;
}

function nombreDeLlamada(expr: ts.Expression): string {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return `${nombreDeLlamada(expr.expression)}.${expr.name.text}`;
  return '';
}

/** Literales de texto alcanzables desde una expresión SIN entrar en llamadas (t(), api.*, etc.). */
function literalesDeExpresion(expr: ts.Expression | undefined, salida: ts.Node[]): void {
  if (!expr) return;
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) { salida.push(expr); return; }
  if (ts.isTemplateExpression(expr)) { salida.push(expr.head); expr.templateSpans.forEach((s) => salida.push(s.literal)); return; }
  if (ts.isParenthesizedExpression(expr)) { literalesDeExpresion(expr.expression, salida); return; }
  if (ts.isConditionalExpression(expr)) {
    literalesDeExpresion(expr.whenTrue, salida);
    literalesDeExpresion(expr.whenFalse, salida);
    return;
  }
  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    if (op === ts.SyntaxKind.PlusToken || op === ts.SyntaxKind.AmpersandAmpersandToken
      || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
      literalesDeExpresion(expr.left, salida);
      literalesDeExpresion(expr.right, salida);
    }
  }
}

function textoDe(nodo: ts.Node): string {
  if (ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo)) return nodo.text;
  if (ts.isTemplateHead(nodo) || ts.isTemplateMiddle(nodo) || ts.isTemplateTail(nodo)) return nodo.text;
  return '';
}

export function hallazgosDeArchivo(rel: string): Hallazgo[] {
  const abs = path.join(RAIZ, rel);
  const codigo = fs.readFileSync(abs, 'utf8');
  const sf = ts.createSourceFile(abs, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Hallazgo[] = [];
  const agregar = (nodo: ts.Node, texto: string) => {
    if (!esVisible(texto)) return;
    const { line } = sf.getLineAndCharacterOfPosition(nodo.getStart(sf));
    out.push({ archivo: rel, linea: line + 1, texto: texto.replace(/\s+/g, ' ').trim().slice(0, 70) });
  };

  const visitar = (nodo: ts.Node) => {
    if (ts.isJsxText(nodo)) agregar(nodo, nodo.text);

    if (ts.isJsxExpression(nodo) && nodo.expression && !ts.isJsxAttribute(nodo.parent)) {
      const lits: ts.Node[] = [];
      literalesDeExpresion(nodo.expression, lits);
      lits.forEach((l) => agregar(l, textoDe(l)));
    }

    if (ts.isJsxAttribute(nodo) && ATRIBUTOS_DE_TEXTO.has(nodo.name.getText(sf)) && nodo.initializer) {
      if (ts.isStringLiteral(nodo.initializer)) agregar(nodo.initializer, nodo.initializer.text);
      else if (ts.isJsxExpression(nodo.initializer)) {
        const lits: ts.Node[] = [];
        literalesDeExpresion(nodo.initializer.expression, lits);
        lits.forEach((l) => agregar(l, textoDe(l)));
      }
    }

    if (ts.isCallExpression(nodo) && LLAMADAS_DE_TEXTO.has(nombreDeLlamada(nodo.expression))) {
      const lits: ts.Node[] = [];
      nodo.arguments.slice(0, 2).forEach((a) => literalesDeExpresion(a, lits));
      lits.forEach((l) => agregar(l, textoDe(l)));
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(sf);
  return out;
}

describe('i18n del lote de niveles y género (C-14): sin textos visibles escritos en el código', () => {
  it.each(ARCHIVOS)('%s', (rel) => {
    const hallazgos = hallazgosDeArchivo(rel);
    const resumen = hallazgos.map((h) => `${h.archivo}:${h.linea}  «${h.texto}»`).join('\n');
    expect(resumen).toBe('');
  });
});

describe('el propio escáner', () => {
  const tmp = path.join(RAIZ, 'src', '__tests__', '__tmp_i18n_lote_niveles.tsx');
  afterAll(() => { try { fs.unlinkSync(tmp); } catch { /* ya no existe */ } });

  it('detecta texto JSX, atributos, expresiones y llamadas, y respeta las excepciones y t()', () => {
    fs.writeFileSync(tmp, [
      "import React from 'react';",
      'export function X() {',
      "  showToast('Guardado con éxito');",
      '  return (',
      '    <View>',
      '      <Text>Hola mundo</Text>',
      "      <Text>{esRaiz ? `Nueva ${x}` : 'Otra cosa'}</Text>",
      '      <TextInput placeholder="Escribe aquí" />',
      "      <Text>{t('catalogo.guardar')}</Text>",
      '      <Text>Dirac</Text>',
      '      <Text>{n}</Text>',
      '    </View>',
      '  );',
      '}',
    ].join('\n'));
    const encontrados = hallazgosDeArchivo('src/__tests__/__tmp_i18n_lote_niveles.tsx').map((h) => h.texto);
    expect(encontrados).toEqual(expect.arrayContaining(['Guardado con éxito', 'Hola mundo', 'Nueva', 'Otra cosa', 'Escribe aquí']));
    expect(encontrados).not.toContain('Dirac');
    expect(encontrados.some((t) => t.includes('catalogo.guardar'))).toBe(false);
    expect(encontrados).toHaveLength(5);
  });
});
