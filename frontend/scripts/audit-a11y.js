// Auditoría estática de accesibilidad (T-11): lista los Pressable/TouchableOpacity
// que solo contienen un ícono y no tienen accessibilityLabel (un lector de pantalla
// no sabría qué anunciar). Uso: node scripts/audit-a11y.js [--json]
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const CARPETAS = ['app', 'src'];
const ETIQUETAS = ['Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback'];
const BARRA = String.fromCharCode(92);

function archivos(dir, salida = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '__tests__') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) archivos(p, salida);
    else if (p.endsWith('.tsx')) salida.push(p);
  }
  return salida;
}

// Devuelve [posición del ">" que cierra la etiqueta de apertura, ¿es autocerrada?]
function finApertura(s, i) {
  let llaves = 0;
  let comilla = null;
  for (; i < s.length; i++) {
    const c = s[i];
    if (comilla) {
      if (c === comilla && s[i - 1] !== BARRA) comilla = null;
      continue;
    }
    if (llaves > 0 && (c === '"' || c === "'" || c === '`')) { comilla = c; continue; }
    if (c === '{') llaves++;
    else if (c === '}') llaves--;
    else if (c === '>' && llaves === 0) return [i, s[i - 1] === '/'];
  }
  return [s.length, true];
}

// Estilos de StyleSheet con ancho o alto fijo menor a 44 pt: { nombre: {width:32,...} }
function estilosPequenos(s) {
  const pequenos = new Set();
  const re = /(\w+):\s*\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(s))) {
    const w = /\bwidth:\s*(\d+)/.exec(m[2]);
    const h = /\bheight:\s*(\d+)/.exec(m[2]);
    const menor = (x) => x && Number(x[1]) < 44;
    if (menor(w) || menor(h)) pequenos.add(m[1]);
  }
  return pequenos;
}

function auditar() {
  const hallazgos = [];
  const pequenos = [];
  let total = 0;
  let conRol = 0;
  for (const c of CARPETAS) {
    for (const f of archivos(path.join(RAIZ, c))) {
      const s = fs.readFileSync(f, 'utf8');
      const chicos = estilosPequenos(s);
      const re = new RegExp('<(' + ETIQUETAS.join('|') + ')\\b', 'g');
      let m;
      while ((m = re.exec(s))) {
        const [fin, auto] = finApertura(s, m.index + m[0].length);
        const apertura = s.slice(m.index, fin);
        total++;
        if (/accessibilityRole|\brole=/.test(apertura)) conRol++;
        // Área táctil menor a 44 pt sin hitSlop que la compense.
        const ref = /styles\.(\w+)/g;
        let r2;
        while ((r2 = ref.exec(apertura))) {
          if (chicos.has(r2[1]) && !/hitSlop/.test(apertura)) {
            pequenos.push({ archivo: path.relative(RAIZ, f).split(path.sep).join('/'), linea: s.slice(0, m.index).split('\n').length, estilo: r2[1] });
            break;
          }
        }
        if (/accessibilityLabel|aria-label/.test(apertura)) continue;
        let cuerpo = '';
        if (!auto) {
          const cierre = s.indexOf('</' + m[1] + '>', fin);
          cuerpo = s.slice(fin, cierre < 0 ? fin : cierre);
        }
        const tieneIcono = /<(Ionicons|MaterialIcons|Feather|AntDesign|Icon)\b/.test(cuerpo);
        const tieneTexto = /<Text\b|<Button\b/.test(cuerpo);
        if (tieneIcono && !tieneTexto) {
          const linea = s.slice(0, m.index).split('\n').length;
          hallazgos.push({ archivo: path.relative(RAIZ, f).split(path.sep).join('/'), linea });
        }
      }
    }
  }
  return { total, conRol, hallazgos, pequenos };
}

if (require.main === module) {
  const r = auditar();
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    console.log('Elementos táctiles: ' + r.total + ' · con accessibilityRole: ' + r.conRol);
    console.log('Solo ícono y sin accessibilityLabel: ' + r.hallazgos.length);
    for (const h of r.hallazgos) console.log('  ' + h.archivo + ':' + h.linea);
    console.log('Áreas táctiles menores a 44 pt sin hitSlop: ' + r.pequenos.length);
    for (const h of r.pequenos) console.log('  ' + h.archivo + ':' + h.linea + ' (' + h.estilo + ')');
  }
}
module.exports = { auditar };
