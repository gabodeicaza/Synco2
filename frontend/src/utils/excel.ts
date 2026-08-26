import * as XLSX from 'xlsx';

export interface EquipoRow {
  nombre: string;
  marca?: string;
  modelo?: string;
  serie?: string;
}

/**
 * Normaliza y limpia un string para comparaciones seguras.
 */
function cleanStr(s: any): string {
  if (s === null || s === undefined) return '';
  let res = String(s).toLowerCase().trim();
  // Quitar acentos si el entorno lo soporta (fallback seguro)
  try {
    if (res.normalize) {
      res = res.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }
  } catch (e) {
    /* noop */
  }
  return res;
}

/**
 * Lee un archivo Excel (.xlsx) y lo convierte en una matriz de arreglos.
 */
export async function parseExcel(base64: string): Promise<any[][]> {
  // En algunos entornos React Native, XLSX.read con type: 'base64'
  // es mas estable si el input es un string limpio.
  const workbook = XLSX.read(base64.replace(/\s/g, ''), { type: 'base64' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json(worksheet, { header: 1 });
}

/**
 * Mapea matriz cruda a Personal.
 */
export function mapPersonalRows(rows: any[][]): string[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  // Buscar primera fila con datos
  const firstDataRow = rows.find(r => r && r[0]);
  if (!firstDataRow) return [];

  const startIdx = cleanStr(firstDataRow[0]).includes('nombre') ||
                  cleanStr(firstDataRow[0]).includes('personal') ? rows.indexOf(firstDataRow) + 1 : rows.indexOf(firstDataRow);

  return rows.slice(startIdx)
    .map((row) => (row && row[0] ? String(row[0]).trim() : ''))
    .filter(Boolean);
}

/**
 * Mapea matriz cruda a Equipo estructurado.
 */
export function mapEquipoRows(rows: any[][]): EquipoRow[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  // 1. Encontrar la fila de encabezados (buscando "nombre" o "equipo")
  let headerRowIdx = rows.findIndex(row =>
    row && Array.isArray(row) && row.some(cell => {
      const c = cleanStr(cell);
      return c.includes('nombre') || c.includes('equipo') || c.includes('descrip');
    })
  );

  let idxNombre = 0, idxMarca = 1, idxModelo = 2, idxSerie = 3;
  let startDataIdx = 0;

  if (headerRowIdx !== -1) {
    const headers = rows[headerRowIdx];
    const findIdx = (keywords: string[]) => headers.findIndex(h => {
      const c = cleanStr(h);
      return c && keywords.some(kw => c.includes(kw));
    });

    const n = findIdx(['nombre', 'descrip', 'equipo', 'item', 'maquinaria']);
    const m = findIdx(['marca', 'brand']);
    const mod = findIdx(['modelo', 'model']);
    const s = findIdx(['serie', 'placa', 'sn', 'serial']);

    if (n !== -1) idxNombre = n;
    if (m !== -1) idxMarca = m;
    if (mod !== -1) idxModelo = mod;
    if (s !== -1) idxSerie = s;

    startDataIdx = headerRowIdx + 1;
  } else {
    // Si no hay encabezados claros, asumimos A,B,C,D desde el inicio
    startDataIdx = 0;
  }

  const result: EquipoRow[] = [];
  const seen = new Set<string>();

  rows.slice(startDataIdx).forEach((row) => {
    if (!row || !Array.isArray(row)) return;

    const nombre = row[idxNombre] ? String(row[idxNombre]).trim().replace(/\r?\n|\r/g, ' ') : '';
    if (!nombre) return;

    const marca = row[idxMarca] ? String(row[idxMarca]).trim() : '';
    const modelo = row[idxModelo] ? String(row[idxModelo]).trim() : '';
    const serie = row[idxSerie] ? String(row[idxSerie]).trim() : '';

    const ukey = `${nombre}|${marca}|${modelo}|${serie}`.toLowerCase();
    if (seen.has(ukey)) return;
    seen.add(ukey);

    result.push({ nombre, marca, modelo, serie });
  });

  return result;
}
