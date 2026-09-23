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

function auditar() {
  const hallazgos = [];
  let total = 0;
  let conRol = 0;
  for (const c of CARPETAS) {
    for (const f of archivos(path.join(RAIZ, c))) {
      const s = fs.readFileSync(f, 'utf8');
      const re = new RegExp('<(' + ETIQUETAS.join('|') + ')\\b', 'g');
      let m;
      while ((m = re.exec(s))) {
        const [fin, auto] = finApertura(s, m.index + m[0].length);
        const apertura = s.slice(m.index, fin);
        total++;
        if (/accessibilityRole|\brole=/.test(apertura)) conRol++;
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
  return { total, conRol, hallazgos };
}

if (require.main === module) {
  const r = auditar();
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    console.log('Elementos táctiles: ' + r.total + ' · con accessibilityRole: ' + r.conRol);
    console.log('Solo ícono y sin accessibilityLabel: ' + r.hallazgos.length);
    for (const h of r.hallazgos) console.log('  ' + h.archivo + ':' + h.linea);
  }
}
module.exports = { auditar };
