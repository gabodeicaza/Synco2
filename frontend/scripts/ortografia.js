// Corrector de ortografía y símbolos del texto visible (X-01, X-02, R-04/R-05, marca).
//
// Un script anterior (fix_encoding_node.js) quitó acentos y ñ y convirtió …, —, · y
// emojis en "_" o ".". Este script los restaura SIN tocar código: recorre el AST con
// `typescript` y solo modifica el contenido de literales de texto visible y JsxText.
//
// Uso (desde frontend/):
//   node scripts/ortografia.js --dry-run     informa qué cambiaría, sin escribir
//   node scripts/ortografia.js               aplica los cambios
//   node scripts/ortografia.js --json        informe en JSON (con --dry-run)
//
// También se usa como guardia: src/__tests__/ortografia.test.ts llama a `revisarTodo()`
// y falla si queda algo por corregir. Solo rutas relativas al repo.
'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { corregirPalabras } = require('./ortografia-diccionario.js');

const RAIZ = path.join(__dirname, '..');
const CARPETAS = ['app', 'src'];
const NO_REESCRIBIR = new Set(['src/i18n/es-MX.ts']);

const OP_COMPARACION = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
]);
// Llamadas cuyos argumentos de texto son código (claves, búsquedas, rutas, claves i18n).
const LLAMADAS_CODIGO = new Set([
  'includes', 'indexOf', 'lastIndexOf', 'startsWith', 'endsWith', 'has', 'get', 'set', 'delete',
  'getItem', 'setItem', 'removeItem', 'multiGet', 'hasOwnProperty', 'replace', 'replaceAll', 'split',
  'test', 'match', 'matchAll', 'require', 'import', 't', 'a11y', 'emit', 'on', 'off',
  'addEventListener', 'removeEventListener', 'getElementById', 'querySelector', 'mock', 'requireActual',
]);
const ATTR_TEXTO = new Set([
  'label', 'title', 'subtitle', 'placeholder', 'description', 'text', 'message', 'accessibilityLabel',
  'accessibilityHint', 'headerTitle', 'tabBarLabel', 'alt', 'hint', 'helper', 'ayuda', 'cta', 'emptyText',
]);
const ATTR_CODIGO = new Set([
  'name', 'key', 'testID', 'keyboardType', 'accessibilityRole', 'role', 'autoCapitalize', 'returnKeyType',
  'resizeMode', 'source', 'uri', 'href', 'pathname', 'id', 'type', 'mode', 'behavior', 'animationType',
  'presentationStyle', 'textContentType', 'inputMode', 'autoComplete', 'textAlign', 'variant', 'size',
  'color', 'tone', 'icon', 'iconName', 'fontWeight', 'textTransform', 'position', 'accessibilityLiveRegion',
  'importantForAccessibility', 'pointerEvents', 'status', 'kind', 'scope', 'slug', 'code', 'field',
]);
const PROPS_CODIGO = new Set([
  'id', 'key', 'type', 'kind', 'icon', 'iconName', 'role', 'href', 'pathname', 'route', 'to', 'testID',
  'value', 'status', 'estado', 'tipo', 'scope', 'field', 'code', 'slug', 'mode', 'variant', 'size',
  'color', 'tone', 'fontWeight', 'textTransform', 'position', 'align', 'alignItems', 'justifyContent',
  'flexDirection', 'source', 'uri', 'severity', 'severidad', 'periodicidad', 'accessibilityRole',
]);
const PROPS_TEXTO = new Set([
  'label', 'title', 'subtitle', 'placeholder', 'description', 'text', 'message', 'accessibilityLabel',
  'accessibilityHint', 'headerTitle', 'tabBarLabel', 'hint', 'helper', 'ayuda',
]);

// ---------------------------------------------------------------------------------------------
function listarArchivos() {
  const salida = [];
  function rec(dirRel) {
    for (const e of fs.readdirSync(path.join(RAIZ, dirRel), { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '__tests__' || e.name.startsWith('.')) continue;
      const rel = dirRel + '/' + e.name;
      if (e.isDirectory()) rec(rel);
      else if (/\.tsx?$/.test(e.name)) salida.push(rel);
    }
  }
  for (const c of CARPETAS) rec(c);
  return salida.sort();
}

function nombreLlamada(llamada) {
  const c = llamada.expression;
  if (ts.isIdentifier(c)) return c.text;
  if (ts.isPropertyAccessExpression(c)) return c.name.text;
  if (c.kind === ts.SyntaxKind.ImportKeyword) return 'import';
  return '';
}

function nombreProp(p) {
  const n = p.name;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n)) return n.text;
  return '';
}

// ¿El literal es código (clave, comparación, ruta, clave i18n...) y no texto visible?
function esCodigo(nodo) {
  const p = nodo.parent;
  if (!p) return false;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p)) return true;
  if (ts.isLiteralTypeNode(p) || ts.isEnumMember(p) || ts.isImportTypeNode(p)) return true;
  if (ts.isPropertyAssignment(p) && p.name === nodo) return true;
  if (ts.isPropertySignature(p) || ts.isMethodDeclaration(p)) return true;
  if (ts.isComputedPropertyName(p)) return true;
  if (ts.isElementAccessExpression(p) && p.argumentExpression === nodo) return true;
  if (ts.isCaseClause(p) && p.expression === nodo) return true;
  if (ts.isBinaryExpression(p) && OP_COMPARACION.has(p.operatorToken.kind)) return true;
  if (ts.isCallExpression(p) && p.arguments.includes(nodo)) {
    if (LLAMADAS_CODIGO.has(nombreLlamada(p))) return true;
  }
  if (ts.isNewExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === 'RegExp') return true;
  if (ts.isJsxAttribute(p) && ATTR_CODIGO.has(p.name.getText())) return true;
  if (ts.isPropertyAssignment(p) && p.initializer === nodo && PROPS_CODIGO.has(nombreProp(p))) return true;
  if (ts.isVariableDeclaration(p) && p.initializer === nodo && ts.isIdentifier(p.name)
    && /^(?:[A-Z][A-Z0-9_]*|.*(?:KEY|Key|CLAVE|Clave))$/.test(p.name.text)) return true;
  return false;
}

function esTextoVisible(nodo, cocido) {
  if (esCodigo(nodo)) return false;
  const p = nodo.parent;
  if (p && ts.isJsxAttribute(p) && ATTR_TEXTO.has(p.name.getText())) return true;
  if (p && ts.isPropertyAssignment(p) && p.initializer === nodo && PROPS_TEXTO.has(nombreProp(p))) return true;
  const t = cocido.trim();
  if (/\s/.test(t) && /\p{L}/u.test(t)) return true;
  if (/^[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ]+[.:]?$/.test(t) && !/^[A-Z]+$/.test(t)) return true;
  if (/^_+$/.test(t) || t === '_') return true;
  if (/^ [_.] $/.test(cocido)) return true; // separador " _ " / " . " (p. ej. en join)
  if (/[A-Za-zÁ-ú]_$/.test(t) && /^[A-ZÁÉÍÓÚÑ]/.test(t)) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------
// Transformaciones sobre el texto CRUDO de un literal (con sus escapes).
function conSignos(texto) {
  const inicio = texto.length - texto.trimStart().length;
  const cuerpo = texto.trim();
  if (cuerpo.length < 8 || !/\s/.test(cuerpo) || /[\r\n]|\\n/.test(cuerpo)) return texto;
  if (/^https?:/i.test(cuerpo) || /[¿¡]/.test(cuerpo)) return texto;
  const m = /([?!])(['"”]?)$/.exec(cuerpo);
  if (!m) return texto;
  const sinFinal = cuerpo.slice(0, cuerpo.length - m[0].length);
  if (/[.!?¿¡]/.test(sinFinal) || !/^[A-ZÁÉÍÓÚÑ]/.test(cuerpo)) return texto;
  return texto.slice(0, inicio) + (m[1] === '?' ? '¿' : '¡') + texto.slice(inicio);
}

// "?Continuar?" -> "¿Continuar?" y "!Listo!" -> "¡Listo!". `raw` es el texto crudo del literal:
// un salto de línea puede aparecer como la secuencia \n (dos caracteres) o como salto real.
function restaurarAperturas(raw, esInicio) {
  const antes = esInicio ? '(^|[.!?:]\\s+|\\\\n|\\n)' : '([.!?:]\\s+|\\\\n|\\n)';
  const antesAdmiracion = esInicio ? '(^|[.?:]\\s+|\\\\n|\\n)' : '([.?:]\\s+|\\\\n|\\n)';
  return raw
    .replace(new RegExp(antes + '\\?(?=[A-ZÁÉÍÓÚÑ])', 'g'), '$1¿')
    .replace(new RegExp(antesAdmiracion + '!(?=[A-ZÁÉÍÓÚÑ])', 'g'), '$1¡');
}

function transformar(raw, { completo = false, permitirSignos = true, esInicio = true } = {}) {
  const cats = new Set();
  let t = raw;
  const paso = (cat, nuevo) => { if (nuevo !== t) { cats.add(cat); t = nuevo; } };

  if (/^_{6,}$/.test(t)) paso('mascara', '••••••••');
  else if (t === '_') paso('vacio', '—');
  // Prefijos "_ ", "__ " o "___ " que sustituyeron a un emoji al inicio del texto: se quitan.
  if (esInicio) paso('prefijo', t.replace(/^_{1,3} (?=[A-ZÁÉÍÓÚÑ¿¡*])/, ''));
  paso('separador', t.replace(/ _ /g, ' · ').replace(/ \. /g, ' · '));
  paso('placeholder', t.replace(/([\p{L}\p{N}.,)])_$/u, '$1…').replace(/(\p{L}\p{N}*\s)_$/u, '$1…'));
  paso('marca', t.replace(/\bSynCo\b|\bSyncSite\b|\bSyncsite\b/g, 'Dirac'));
  paso('ortografia', corregirPalabras(t, { completo }));
  // El script anterior convirtió ¿ y ¡ de apertura en "?" y "!": "?Continuar?" -> "¿Continuar?".
  paso('signos', restaurarAperturas(t, esInicio));
  if (permitirSignos) paso('signos', conSignos(t));
  return { texto: t, cats };
}

function lineaDe(sf, pos) {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

function analizarFuente(texto, nombre = 'archivo.tsx') {
  const kind = nombre.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(nombre, texto, ts.ScriptTarget.Latest, true, kind);
  const ediciones = [];

  function proponer(inicio, fin, opciones, contexto) {
    const raw = texto.slice(inicio, fin);
    const { texto: nuevo, cats } = transformar(raw, opciones);
    if (nuevo === raw) return;
    ediciones.push({ inicio, fin, antes: raw, despues: nuevo, cats: [...cats], linea: lineaDe(sf, inicio), contexto });
  }

  function visitar(nodo) {
    if (ts.isJsxText(nodo)) {
      if (nodo.text.trim()) proponer(nodo.pos, nodo.end, {}, 'jsx');
      return;
    }
    if (ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo)) {
      const cocido = nodo.text;
      // '_' como argumento de join/padStart/concat es código (relleno o unión), no un valor vacío.
      if (cocido === '_' && ts.isCallExpression(nodo.parent) && ['join', 'padStart', 'padEnd', 'concat', 'repeat'].includes(nombreLlamada(nodo.parent))) return;
      // La marca se corrige en cualquier literal que no sea código; lo demás, solo en texto visible.
      if (esCodigo(nodo)) return;
      const visible = esTextoVisible(nodo, cocido);
      const inicio = nodo.getStart() + 1;
      const fin = nodo.getEnd() - 1;
      const raw = texto.slice(inicio, fin);
      if (visible) {
        proponer(inicio, fin, { completo: true }, 'literal');
      } else if (/\bSynCo\b|\bSyncSite\b|\bSyncsite\b/.test(raw)) {
        proponer(inicio, fin, { permitirSignos: false }, 'marca');
      }
      return;
    }
    if (ts.isTemplateExpression(nodo)) {
      if (!esCodigo(nodo)) {
        const partes = [nodo.head, ...nodo.templateSpans.map((s) => s.literal)];
        const rangos = partes.map((n, i) => {
          const inicio = n.getStart() + 1;
          const fin = n.getEnd() - (i === partes.length - 1 ? 1 : 2);
          return { n, inicio, fin };
        });
        for (const [indice, { n, inicio, fin }] of rangos.entries()) {
          const cocido = n.text;
          if ((/\s/.test(cocido) && /\p{L}/u.test(cocido)) || / _ /.test(cocido)) proponer(inicio, fin, { permitirSignos: false, esInicio: indice === 0 }, 'plantilla');
          else if (/\bSynCo\b|\bSyncSite\b/.test(texto.slice(inicio, fin))) proponer(inicio, fin, { permitirSignos: false }, 'marca');
        }
        // ¿ ¡ del conjunto: la oración empieza en la cabeza y termina en la cola.
        const unido = partes.map((n) => n.text).join('#');
        const arreglado = conSignos(unido);
        if (arreglado !== unido && !/\\n/.test(unido) && !/\s\s$/.test(unido)) {
          const signo = arreglado.trimStart()[0];
          const cab = rangos[0];
          const cabezaTxt = texto.slice(cab.inicio, cab.fin);
          const desplazamiento = cabezaTxt.length - cabezaTxt.trimStart().length;
          const yaTiene = ediciones.some((e) => e.inicio === cab.inicio);
          if (!yaTiene) {
            ediciones.push({
              inicio: cab.inicio + desplazamiento, fin: cab.inicio + desplazamiento, antes: '', despues: signo,
              cats: ['signos'], linea: lineaDe(sf, cab.inicio), contexto: 'plantilla',
            });
          }
        }
      }
      ts.forEachChild(nodo, (h) => { if (!ts.isTemplateHead(h) && !ts.isTemplateSpan(h)) visitar(h); });
      for (const s of nodo.templateSpans) visitar(s.expression);
      return;
    }
    ts.forEachChild(nodo, visitar);
  }
  visitar(sf);

  // Comentarios de cabecera con la marca anterior: "// SynCo v2.0 _ Tab ..." -> "// Dirac · Tab ...".
  const lineas = texto.split('\n');
  let offset = 0;
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    if (/^\s*(\/\/|\/\*|\*)/.test(l) && /\bSynCo\b|\bSyncSite\b|\bSyncsite\b/.test(l)) {
      const nuevo = l
        .replace(/\b(?:SynCo|SyncSite|Syncsite)(?: v\d+(?:\.\d+)*)?\s+[_\-.]\s+/, 'Dirac · ')
        .replace(/\b(?:SynCo|SyncSite|Syncsite)\b/g, 'Dirac');
      if (nuevo !== l) {
        ediciones.push({ inicio: offset, fin: offset + l.length, antes: l, despues: nuevo, cats: ['marca'], linea: i + 1, contexto: 'comentario' });
      }
    }
    offset += l.length + 1;
  }

  ediciones.sort((a, b) => a.inicio - b.inicio);
  return { ediciones, sf };
}

function aplicar(texto, ediciones) {
  let salida = texto;
  for (const e of [...ediciones].sort((a, b) => b.inicio - a.inicio)) {
    salida = salida.slice(0, e.inicio) + e.despues + salida.slice(e.fin);
  }
  return salida;
}

// Residuos que el script no arregla solo (prefijo "_ ", "_" tras una expresión, marca en código...).
function residuos(texto, nombre) {
  const salida = [];
  const lineas = texto.split('\n');
  lineas.forEach((l, i) => {
    if (/(['"`>])_ [A-ZÁÉÍÓÚÑ¿¡]/.test(l) || /\}_['"`<]/.test(l) || /['"`]_ ?\$\{/.test(l)) {
      salida.push({ archivo: nombre, linea: i + 1, tipo: 'símbolo "_" suelto', texto: l.trim().slice(0, 120) });
    }
    if (/\b(?:SynCo|SyncSite|Syncsite)\b/.test(l)) {
      salida.push({ archivo: nombre, linea: i + 1, tipo: 'marca anterior', texto: l.trim().slice(0, 120) });
    }
  });
  return salida;
}

// Revisa todos los archivos y devuelve lo que habría que cambiar (sin escribir).
function revisarTodo({ archivos = listarArchivos(), leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8') } = {}) {
  const hallazgos = [];
  const manual = [];
  for (const rel of archivos) {
    const texto = leer(rel);
    const { ediciones } = analizarFuente(texto, rel);
    for (const e of ediciones) hallazgos.push({ archivo: rel, linea: e.linea, cats: e.cats, antes: e.antes, despues: e.despues, contexto: e.contexto });
    const resultado = ediciones.length ? aplicar(texto, ediciones) : texto;
    manual.push(...residuos(resultado, rel));
  }
  return { hallazgos, manual };
}

function aplicarTodo({ archivos = listarArchivos() } = {}) {
  const cambiados = [];
  for (const rel of archivos) {
    if (NO_REESCRIBIR.has(rel)) continue;
    const ruta = path.join(RAIZ, rel);
    const texto = fs.readFileSync(ruta, 'utf8');
    const { ediciones } = analizarFuente(texto, rel);
    if (!ediciones.length) continue;
    fs.writeFileSync(ruta, aplicar(texto, ediciones), 'utf8');
    cambiados.push({ archivo: rel, ediciones: ediciones.length });
  }
  return cambiados;
}

// Palabras (solo ASCII) del texto visible que quedarían tras aplicar las correcciones: sirve para
// revisar a ojo lo que el diccionario no cubre (verbos, nombres propios, inglés técnico...).
function palabrasVisibles({ archivos = listarArchivos() } = {}) {
  const cuenta = new Map();
  for (const rel of archivos) {
    let texto = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    const { ediciones } = analizarFuente(texto, rel);
    texto = aplicar(texto, ediciones);
    const kind = rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(rel, texto, ts.ScriptTarget.Latest, true, kind);
    const anotar = (t, donde) => {
      for (const m of t.matchAll(/\p{L}+/gu)) {
        const w = m[0].toLowerCase();
        if (w.length < 4 || !/^[a-z]+$/.test(w)) continue;
        const e = cuenta.get(w) || { n: 0, donde };
        e.n++;
        cuenta.set(w, e);
      }
    };
    (function visitar(n) {
      if (ts.isJsxText(n)) { if (n.text.trim()) anotar(n.text, rel); }
      else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) { if (esTextoVisible(n, n.text)) anotar(n.text, rel); }
      else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) { if (/\s/.test(n.text)) anotar(n.text, rel); }
      ts.forEachChild(n, visitar);
    })(sf);
  }
  return [...cuenta.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function corto(s) {
  return s.replace(/\s+/g, ' ').trim().slice(0, 70);
}

function informe({ hallazgos, manual }, json) {
  const porCat = {};
  const porArchivo = {};
  for (const h of hallazgos) {
    for (const c of h.cats) porCat[c] = (porCat[c] || 0) + 1;
    porArchivo[h.archivo] = (porArchivo[h.archivo] || 0) + 1;
  }
  if (json) return JSON.stringify({ porCat, porArchivo, hallazgos, manual }, null, 2);
  const out = [];
  out.push('Por categoría: ' + JSON.stringify(porCat));
  out.push('Archivos con cambios: ' + Object.keys(porArchivo).length + ' / ediciones: ' + hallazgos.length);
  out.push('');
  for (const [a, n] of Object.entries(porArchivo).sort((x, y) => y[1] - x[1])) out.push(String(n).padStart(4) + '  ' + a);
  out.push('');
  out.push('--- Ejemplos (archivo:línea [categorías]  antes => después) ---');
  for (const h of hallazgos) out.push(`${h.archivo}:${h.linea} [${h.cats.join(',')}]  ${JSON.stringify(corto(h.antes))} => ${JSON.stringify(corto(h.despues))}`);
  out.push('');
  out.push('--- Residuos para revisión manual ---');
  for (const m of manual) out.push(`${m.archivo}:${m.linea}  ${m.tipo}  ${m.texto}`);
  return out.join('\n');
}

module.exports = { esTextoVisible, palabrasVisibles, listarArchivos, analizarFuente, aplicar, revisarTodo, aplicarTodo, transformar, conSignos, esCodigo };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--palabras')) {
    for (const [w, e] of palabrasVisibles()) console.log(w + ' ' + e.n);
  } else if (args.includes('--dry-run')) {
    console.log(informe(revisarTodo(), args.includes('--json')));
  } else {
    const cambiados = aplicarTodo();
    console.log(`Archivos modificados: ${cambiados.length}`);
    for (const c of cambiados) console.log(String(c.ediciones).padStart(4) + '  ' + c.archivo);
  }
}
