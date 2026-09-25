// Genera scripts/ortografia-lexico.json: palabras sin acento -> con acento derivadas del texto
// ya bien escrito del propio repo (literales y comentarios del frontend con acentos y mensajes
// del backend). Una palabra solo entra si NUNCA aparece sin acento en ese corpus, así se evita
// todo lo ambiguo (esta/está, solo/sólo, termino/término...).
// Uso (desde frontend/): node scripts/ortografia-lexico.js
'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const orto = require('./ortografia.js');

const RAIZ = path.join(__dirname, '..');
const BACKEND = path.join(RAIZ, '..', 'backend', 'server.py');
const SALIDA = path.join(__dirname, 'ortografia-lexico.json');

const ACENTOS = /[áéíóúüñ]/;
const quitar = (s) => s.normalize('NFD').replace(/[̀-́̈]/g, '').replace(/ñ/g, 'n').normalize('NFC');
const sinAcento = (w) => w.replace(/á/g, 'a').replace(/é/g, 'e').replace(/í/g, 'i').replace(/ó/g, 'o').replace(/ú/g, 'u').replace(/ü/g, 'u').replace(/ñ/g, 'n');

const conAcento = new Map(); // sin acento -> Map(forma con acento -> veces)
const sinAcentoCont = new Map(); // sin acento -> veces (aparece así escrita)

function contar(texto) {
  for (const m of texto.matchAll(/\p{L}+/gu)) {
    const w = m[0].toLowerCase();
    if (w.length < 4) continue;
    if (ACENTOS.test(w)) {
      const s = sinAcento(w);
      if (!conAcento.has(s)) conAcento.set(s, new Map());
      const mm = conAcento.get(s);
      mm.set(w, (mm.get(w) || 0) + 1);
    } else {
      sinAcentoCont.set(w, (sinAcentoCont.get(w) || 0) + 1);
    }
  }
}

// Frontend: literales de texto visible y comentarios (solo de archivos que conservan acentos).
for (const rel of orto.listarArchivos()) {
  const texto = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
  if (!ACENTOS.test(texto)) continue; // archivo dañado: no sirve de corpus
  const sf = ts.createSourceFile(rel, texto, ts.ScriptTarget.Latest, true, rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  (function visitar(n) {
    if (ts.isJsxText(n)) contar(n.text);
    else if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && /\s/.test(n.text.trim())) contar(n.text);
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) { if (/\s/.test(n.text)) contar(n.text); }
    ts.forEachChild(n, visitar);
  })(sf);
  for (const l of texto.split('\n')) {
    const c = l.match(/\/\/(.*)$/);
    if (c) contar(c[1]);
  }
}

// Backend: cadenas con espacios y comentarios de server.py.
if (fs.existsSync(BACKEND)) {
  const py = fs.readFileSync(BACKEND, 'utf8');
  for (const m of py.matchAll(/(["'])((?:\\.|(?!\1)[^\\\n])*)\1/g)) if (/\s/.test(m[2])) contar(m[2]);
  for (const m of py.matchAll(/#([^\n]*)/g)) contar(m[1]);
  for (const m of py.matchAll(/"""([\s\S]*?)"""/g)) contar(m[1]);
}

// Homógrafas o relativas/interrogativas que sí se escriben sin acento en otros usos.
const BLOQUEADAS = new Set(['formula', 'cuales', 'cuantas', 'cuantos', 'cuanta', 'cuanto', 'como', 'donde', 'cuando', 'quien', 'quienes', 'sabado']);
const lexico = {};
let ambiguas = 0;
for (const [s, formas] of conAcento) {
  if (formas.size !== 1) { ambiguas++; continue; } // dos formas con acento distintas (publico/público/publicó)
  if (sinAcentoCont.get(s)) { ambiguas++; continue; } // también se escribe sin acento en texto correcto
  const w = [...formas.keys()][0];
  // Pretéritos de 3.ª persona (creó, cargó, marcó...): la forma sin acento es la 1.ª persona del presente
  // ("creo", "cargo", "marco"), que es válida. Se corrigen solo con reglas de contexto ("se guardó").
  if (w.endsWith('ó') && s.endsWith('o')) { ambiguas++; continue; }
  if (BLOQUEADAS.has(s)) { ambiguas++; continue; }
  lexico[s] = w;
}

const ordenado = Object.fromEntries(Object.entries(lexico).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(SALIDA, JSON.stringify(ordenado, null, 1) + '\n', 'utf8');
console.log(`Léxico: ${Object.keys(ordenado).length} palabras (${ambiguas} descartadas por ambiguas).`);
