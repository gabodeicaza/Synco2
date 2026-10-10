// Diccionario de ortografía es-MX compartido por scripts/ortografia.js (que corrige el
// texto visible) y por la prueba guardia src/__tests__/ortografia.test.ts.
//
// Regla de oro: SOLO entran palabras inequívocas (la forma sin acento no es otra palabra
// válida del español). Todo lo ambiguo (esta/está, mas/más, si/sí, solo/sólo, termino/término,
// numero/número, publico/público, periodo, calculo, inicio/inició, envio/envió, tramite...)
// se deja fuera y se corrige con reglas de contexto o a mano.
'use strict';

const LEXICO = require('./ortografia-lexico.json');
const LETRA = '\\p{L}\\p{N}_';

// sin acento -> con acento (en minúsculas; la capitalización se conserva al aplicar).
const PARES = {
  // Sustantivos y adjetivos frecuentes en la interfaz
  version: 'versión', sesion: 'sesión', supervision: 'supervisión', revision: 'revisión',
  vision: 'visión', precision: 'precisión', decision: 'decisión', division: 'división',
  extension: 'extensión', dimension: 'dimensión', conexion: 'conexión', impresion: 'impresión',
  expresion: 'expresión', admision: 'admisión', comision: 'comisión', mision: 'misión',
  provision: 'provisión', tension: 'tensión', presion: 'presión', expansion: 'expansión',
  conclusion: 'conclusión', inclusion: 'inclusión', exclusion: 'exclusión', ocasion: 'ocasión',
  razon: 'razón', camion: 'camión', ademas: 'además', tambien: 'también', despues: 'después',
  aqui: 'aquí', ahi: 'ahí', asi: 'así', todavia: 'todavía', segun: 'según', traves: 'través',
  dia: 'día', dias: 'días', area: 'área', areas: 'áreas',
  ultimo: 'último', ultima: 'última', ultimos: 'últimos', ultimas: 'últimas',
  proximo: 'próximo', proxima: 'próxima', proximos: 'próximos', proximas: 'próximas',
  minimo: 'mínimo', minima: 'mínima', maximo: 'máximo', maxima: 'máxima', optimo: 'óptimo',
  telefono: 'teléfono', telefonos: 'teléfonos', codigo: 'código', codigos: 'códigos',
  titulo: 'título', titulos: 'títulos', pagina: 'página', paginas: 'páginas',
  categoria: 'categoría', categorias: 'categorías', energia: 'energía', compania: 'compañía',
  geologia: 'geología', topografia: 'topografía', tecnologia: 'tecnología',
  metodologia: 'metodología', ingenieria: 'ingeniería', albanileria: 'albañilería',
  bitacora: 'bitácora', linea: 'línea', lineas: 'líneas', camara: 'cámara', galeria: 'galería',
  fotografia: 'fotografía', fotografias: 'fotografías', grafica: 'gráfica', graficas: 'gráficas',
  grafico: 'gráfico', analisis: 'análisis', basico: 'básico', basica: 'básica',
  tecnico: 'técnico', tecnica: 'técnica', tecnicos: 'técnicos', electrico: 'eléctrico',
  electronico: 'electrónico', mecanico: 'mecánico', hidraulico: 'hidráulico',
  hidraulica: 'hidráulica', geografico: 'geográfico', topografico: 'topográfico',
  fisico: 'físico', fisica: 'física', quimico: 'químico', economico: 'económico',
  automatico: 'automático', automatica: 'automática', numerico: 'numérico',
  historico: 'histórico', unico: 'único', unica: 'única', unicamente: 'únicamente',
  automaticamente: 'automáticamente', basicamente: 'básicamente', practicamente: 'prácticamente',
  facil: 'fácil', dificil: 'difícil', util: 'útil', utiles: 'útiles', inutil: 'inútil',
  movil: 'móvil', rapido: 'rápido', rapida: 'rápida', pais: 'país', paises: 'países',
  // Nombres con ñ y otros
  contrasena: 'contraseña', contrasenas: 'contraseñas', diseno: 'diseño', disenos: 'diseños',
  manana: 'mañana', senal: 'señal', senales: 'señales', pequeno: 'pequeño', pequena: 'pequeña',
  pequenos: 'pequeños', pequenas: 'pequeñas', ensenanza: 'enseñanza', montana: 'montaña',
  espana: 'España', espanol: 'español', campana: 'campaña', cumpleanos: 'cumpleaños',
  dano: 'daño', danos: 'daños', danado: 'dañado', bano: 'baño', sueno: 'sueño',
  anadir: 'añadir', anadido: 'añadido', anade: 'añade', albanil: 'albañil',
  albaniles: 'albañiles', topografo: 'topógrafo', topografos: 'topógrafos',
  // Otras palabras frecuentes de la interfaz
  catalogo: 'catálogo', catalogos: 'catálogos', imagenes: 'imágenes', arbol: 'árbol',
  alfanumerico: 'alfanumérico', alfanumerica: 'alfanumérica', metodo: 'método', metodos: 'métodos',
  facilmente: 'fácilmente', rapidamente: 'rápidamente', boton: 'botón', tamano: 'tamaño',
  menu: 'menú', ningun: 'ningún', reunion: 'reunión', intentalo: 'inténtalo',
  reintentalo: 'reinténtalo', revisalo: 'revísalo', verificalo: 'verifícalo',
  // Futuros, imperativos con pronombre y otras formas que la corpus no cubre
  abrelo: 'ábrelo', aparecera: 'aparecerá', capitulo: 'capítulo', cargaran: 'cargarán',
  conectate: 'conéctate', dejara: 'dejará', eliminara: 'eliminará', emitiran: 'emitirán',
  exportaran: 'exportarán', imprimiran: 'imprimirán', incluiran: 'incluirán', invalida: 'inválida',
  modulo: 'módulo', modulos: 'módulos', ocultara: 'ocultará', ocurrio: 'ocurrió', pegalo: 'pégalo',
  pidele: 'pídele', podra: 'podrá', podran: 'podrán', proximamente: 'próximamente',
  publicaras: 'publicarás', raiz: 'raíz', semaforo: 'semáforo', subela: 'súbela',
  suspension: 'suspensión', veras: 'verás', volvera: 'volverá', volveran: 'volverán',
  fisicas: 'físicas', fisicos: 'físicos', generica: 'genérica', generico: 'genérico',
  genericas: 'genéricas', genericos: 'genéricos', jerarquia: 'jerarquía', ordenes: 'órdenes',
  // Días de la semana (visibles; los valores de la API van en MAYÚSCULAS y no se tocan)
  miercoles: 'miércoles', sabado: 'sábado', mie: 'mié', sab: 'sáb',
};

// Terminación general: los sustantivos en -cion (singular) siempre llevan tilde.
// (-sion y -ticamente van curados en PARES: hay palabras en inglés visibles como "Session".)
const RE_CION = new RegExp(`(?<![${LETRA}])(\\p{L}{2,}?)(cion)(?![${LETRA}])`, 'giu');

// Raíces de verbos frecuentes en avisos ("se actualizó", "se guardó", "se recibió").
const VERBOS_O = 'actualiz|guard|cre|elimin|agreg|sincroniz|registr|aplic|cancel|complet|revoc|program|import|export|descarg|carg|gener|proces|asign|marc|modific|archiv|restaur|valid|verific|encontr|cambi|mov|copi|inici|finaliz|termin|ejecut|cerr|borr|habilit|deshabilit|adjunt|vincul|desvincul|renombr|reorden|filtr|envi|rechaz|autoriz|notific|sustituy|reemplaz|reinici|ocult|mostr|abort|incluy|excluy|guard|actu|sub|baj|conect|desconect|cop|impr|movi|habilit';
const VERBOS_IO = 'recib|abr|cumpl|escrib|permit|decid|ocurr|cubr|elig|emit|part|sub|imprim|compart|descubr|redujer|persist|resid|vid';

// Frases con contexto: la palabra sola es ambigua, con su entorno no lo es.
const REGLAS_CONTEXTO = [
  { re: /(?<![\p{L}\p{N}_])(Aun)(?=\s+(?:no|sin|hay|se|existe|existen|tiene|tienes|cuenta|esta|estan)\b)/gu, nuevo: 'Aún' },
  { re: /(?<![\p{L}\p{N}_])(aun)(?=\s+(?:no|sin|hay|se|existe|existen|tiene|tienes|cuenta|esta|estan)\b)/gu, nuevo: 'aún' },
  { re: /(?<![\p{L}\p{N}_])(Se)(?=\s+el\s+primero\b)/gu, nuevo: 'Sé' },
  { re: /(?<![\p{L}\p{N}_])(N)(umero)(?=\s+(?:de|del)\b)/gu, nuevo: 'Número', completa: true },
  { re: /(?<![\p{L}\p{N}_])(n)(umero)(?=\s+(?:de|del)\b)/gu, nuevo: 'número', completa: true },
  { re: /(?<=\b(?:[Vv]er|[Mm]ostrar|[Cc]argar|[Cc]argando|[Nn]ecesitas|[Nn]o))\s+(mas)(?![\p{L}\p{N}_])/gu, nuevo: 'más', soloPalabra: true },
  // Pretéritos de 3.ª persona con "se"/"te envió": la forma sin acento es la 1.ª persona del presente.
  { re: new RegExp(`(?<![\\p{L}\\p{N}_])((?:[Nn]o\\s+)?(?:[Ss]e|[Yy]a\\s+se)\\s+(?:${VERBOS_O}))o(?![\\p{L}\\p{N}_])`, 'gu'), pret: 'ó' },
  { re: new RegExp(`(?<![\\p{L}\\p{N}_])((?:[Nn]o\\s+)?(?:[Ss]e|[Yy]a\\s+se)\\s+(?:${VERBOS_IO}))io(?![\\p{L}\\p{N}_])`, 'gu'), pret: 'ió' },
  { re: /(?<![\p{L}\p{N}_])((?:te|le|les|nos|me)\s+envi)o(?=\s+(?:tu|su|el|la|un|una|los|las)(?![\p{L}\p{N}_]))/gu, pret: 'ó' },
  { re: /(?<![\p{L}\p{N}_])((?:[Nn]o|[Ee]s|[Ss]ea|[Ss]on|[Dd]e|[Ee]l|[Uu]n)\s+)(valid)([oa]s?)(?![\p{L}\p{N}_])/gu, valido: true },
  { re: /(?<![\p{L}\p{N}_])(Estas)(?=\s+(?:seguro|segura|listo|lista|conectado|conectada)(?![\p{L}\p{N}_]))/gu, nuevo: 'Estás' },
  { re: /(?<![\p{L}\p{N}_])(estas)(?=\s+(?:seguro|segura|listo|lista|conectado|conectada)(?![\p{L}\p{N}_]))/gu, nuevo: 'estás' },
  // ñ con contexto claro (año/años)
  { re: /(?<=(?:\b[Ee]ste|\b[Cc]ada|\b[Dd]el|\b[Ee]l|\b[Uu]n|\b[Ll]os|\b[Ee]se|\b[Tt]odo|\b[Tt]odos|\b[Hh]ace|\b[Mm]ismo|\b\d+)\s)(anos?)(?![\p{L}\p{N}_])/gu, nuevo: null, ano: true },
];

// Literales completos ambiguos que son etiquetas de botón.
const LITERALES_COMPLETOS = { Si: 'Sí', Mas: 'Más', Termino: 'Término', Ultimo: 'Último', Aun: 'Aún', Numero: 'Número' };

function conservarCaso(orig, con) {
  if (orig.length > 1 && orig === orig.toUpperCase() && /\p{L}/u.test(orig)) return con.toUpperCase();
  if (orig[0] !== orig[0].toLowerCase()) return con[0].toUpperCase() + con.slice(1);
  return con;
}

// Léxico derivado del corpus (scripts/ortografia-lexico.js) + curado; lo curado manda.
const TODOS = Object.assign({}, LEXICO, PARES);
const RE_PARES = new RegExp(`(?<![${LETRA}])(${Object.keys(TODOS).join('|')})(?![${LETRA}])`, 'giu');

// Enmascara escapes (\n, \', \\) para que la letra de un escape no cuente como parte de una palabra.
// También enmascara los nombres de variables entre llaves ({minimo}, {dia}): son código i18n.
function enmascarar(texto) {
  return texto
    .replace(/\\[\s\S]/g, '  ')
    .replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, (m) => ' '.repeat(m.length));
}

// Aplica una regex sobre el texto enmascarado y reconstruye con el original.
function reemplazar(texto, re, fn) {
  const mask = enmascarar(texto);
  let salida = '';
  let ultimo = 0;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(mask))) {
    if (m[0] === '') { re.lastIndex++; continue; }
    const original = texto.slice(m.index, m.index + m[0].length);
    const nuevo = fn(m, original);
    if (nuevo == null) continue;
    salida += texto.slice(ultimo, m.index) + nuevo;
    ultimo = m.index + m[0].length;
  }
  return salida + texto.slice(ultimo);
}

// Corrige ortografía de un fragmento de texto visible. `completo` = el literal entero es esta palabra.
function corregirPalabras(texto, { completo = false } = {}) {
  let t = texto;
  if (completo && Object.prototype.hasOwnProperty.call(LITERALES_COMPLETOS, t)) return LITERALES_COMPLETOS[t];
  t = reemplazar(t, RE_PARES, (m, orig) => conservarCaso(orig, TODOS[m[1].toLowerCase()]));
  t = reemplazar(t, RE_CION, (m) => m[1] + (m[2] === m[2].toUpperCase() ? 'CIÓN' : 'ción'));
  for (const r of REGLAS_CONTEXTO) {
    if (r.ano) {
      t = reemplazar(t, r.re, (m, orig) => (orig.toLowerCase() === 'anos' ? 'años' : 'año'));
    } else if (r.pret) {
      t = reemplazar(t, r.re, (m) => m[1] + r.pret);
    } else if (r.valido) {
      t = reemplazar(t, r.re, (m) => m[1] + 'válid' + m[3]);
    } else if (r.completa) {
      t = reemplazar(t, r.re, () => r.nuevo);
    } else if (r.soloPalabra) {
      t = reemplazar(t, r.re, (m, orig) => orig.replace(/mas$/, 'más'));
    } else {
      t = reemplazar(t, r.re, () => r.nuevo);
    }
  }
  return t;
}

module.exports = { PARES, LITERALES_COMPLETOS, corregirPalabras, conservarCaso, enmascarar };
