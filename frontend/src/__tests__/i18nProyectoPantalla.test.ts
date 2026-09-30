// Guardia de i18n de la pantalla del proyecto (Fase 5, X-01): todo texto visible en español
// debe salir del archivo de idioma (`t('seccion.clave')`), no de literales en el JSX.
// Recorre el código con el compilador de TypeScript y falla si queda un literal visible fuera
// de la lista de excepciones (cada una con su motivo).
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const ARCHIVOS = [
  'app/(coord)/projects/[id]/index.tsx',
  'src/components/ResumenProyecto.tsx',
  'src/components/SelectorGeneroNivel.tsx',
  'src/components/TipoObraProyectoModal.tsx',
];

/** Excepciones: literales que NO son texto de interfaz traducible. Cada una lleva su motivo. */
const EXCEPCIONES: Array<{ texto: RegExp; motivo: string }> = [
  { texto: /^(PDF|Word|PowerPoint|Excel)$/, motivo: 'nombres propios de formatos de archivo' },
];

const ATRIBUTOS = new Set([
  'placeholder', 'title', 'label', 'subtitle', 'accessibilityLabel', 'accessibilityHint', 'sub', 'description', 'text',
]);
const LLAMADAS = /^(Alert\.alert|showToast|confirm)$/;
const SETTERS_DE_MENSAJE = /^set\w*(Err|Msg|Mensaje|Aviso)\w*$/;

const tieneLetras = (s: string) => /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,}/.test(s);

export interface Literal { linea: number; texto: string }

function textoEstatico(nodo: ts.Node): string | null {
  if (ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo)) return nodo.text;
  if (ts.isTemplateExpression(nodo)) return [nodo.head.text, ...nodo.templateSpans.map((s) => s.literal.text)].join(' ');
  return null;
}

/** Literales alcanzables como valor mostrado (ramas de ?:, ||, ??, &&, paréntesis). */
function ramasVisibles(nodo: ts.Node, salida: ts.Node[]) {
  if (ts.isParenthesizedExpression(nodo)) return ramasVisibles(nodo.expression, salida);
  if (ts.isConditionalExpression(nodo)) {
    ramasVisibles(nodo.whenTrue, salida);
    ramasVisibles(nodo.whenFalse, salida);
    return;
  }
  if (ts.isBinaryExpression(nodo)) {
    const op = nodo.operatorToken.kind;
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.AmpersandAmpersandToken) {
      ramasVisibles(nodo.right, salida);
      if (op !== ts.SyntaxKind.AmpersandAmpersandToken) ramasVisibles(nodo.left, salida);
      return;
    }
  }
  if (textoEstatico(nodo) !== null) salida.push(nodo);
}

export function literalesVisibles(archivo: string): Literal[] {
  const codigo = fs.readFileSync(archivo, 'utf8');
  const sf = ts.createSourceFile(archivo, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const salida: Literal[] = [];
  const linea = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const agregar = (n: ts.Node, texto: string) => {
    const limpio = texto.replace(/\s+/g, ' ').trim();
    if (limpio && tieneLetras(limpio)) salida.push({ linea: linea(n), texto: limpio });
  };
  const agregarRamas = (expr: ts.Node) => {
    const ramas: ts.Node[] = [];
    ramasVisibles(expr, ramas);
    for (const r of ramas) agregar(r, textoEstatico(r) as string);
  };

  const visitar = (nodo: ts.Node) => {
    if (ts.isJsxText(nodo)) agregar(nodo, nodo.text);

    if (ts.isJsxAttribute(nodo) && ATRIBUTOS.has(nodo.name.getText(sf)) && nodo.initializer) {
      if (ts.isStringLiteral(nodo.initializer)) agregar(nodo.initializer, nodo.initializer.text);
      else if (ts.isJsxExpression(nodo.initializer) && nodo.initializer.expression) agregarRamas(nodo.initializer.expression);
    }

    if (ts.isJsxExpression(nodo) && nodo.expression && (ts.isJsxElement(nodo.parent) || ts.isJsxFragment(nodo.parent))) {
      agregarRamas(nodo.expression);
    }

    if (ts.isPropertyAssignment(nodo) && ATRIBUTOS.has(nodo.name.getText(sf))) agregarRamas(nodo.initializer);

    if (ts.isCallExpression(nodo)) {
      const nombre = nodo.expression.getText(sf);
      if (LLAMADAS.test(nombre)) for (const arg of nodo.arguments.slice(0, 2)) agregarRamas(arg);
      if (SETTERS_DE_MENSAJE.test(nombre) && nodo.arguments[0]) agregarRamas(nodo.arguments[0]);
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(sf);
  return salida;
}

describe('i18n de la pantalla del proyecto (X-01)', () => {
  for (const relativo of ARCHIVOS) {
    it(`${relativo} no tiene literales de texto visible fuera de i18n`, () => {
      const restantes = literalesVisibles(path.join(__dirname, '..', '..', relativo)).filter(
        (l) => !EXCEPCIONES.some((e) => e.texto.test(l.texto)),
      );
      expect(restantes.map((l) => `${l.linea}: ${l.texto}`)).toEqual([]);
    });
  }

  it('el escáner detecta literales en JSX, atributos, ramas y llamadas', () => {
    const tmp = path.join(__dirname, '__literales_tmp__.tsx');
    fs.writeFileSync(
      tmp,
      [
        "import React from 'react';",
        'export function A({ x }: { x: boolean }) {',
        "  Alert.alert('Título', 'Mensaje largo');",
        "  return <View><Text>Hola mundo</Text><Input placeholder=\"Buscar aquí\" /><Text>{x ? 'Sí guardado' : 'No guardado'}</Text><Text>{t('a.b')}</Text><Ionicons name=\"chevron-back\" /></View>;",
        '}',
      ].join('\n'),
    );
    try {
      const textos = literalesVisibles(tmp).map((l) => l.texto);
      expect(textos).toEqual(expect.arrayContaining(['Título', 'Mensaje largo', 'Hola mundo', 'Buscar aquí', 'Sí guardado', 'No guardado']));
      expect(textos).not.toContain('a.b');
      expect(textos).not.toContain('chevron-back');
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});
