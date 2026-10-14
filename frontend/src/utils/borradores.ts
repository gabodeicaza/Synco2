// Borradores del reporte "Nuevo": el formulario se autoguarda en el teléfono para
// no perder lo capturado si la app se cierra, se mata por memoria o se sale del
// formulario a medias. Un borrador vive hasta que se envía el reporte o se
// descarta a mano (nunca se borra solo).
//
// Almacenamiento: un índice liviano en el storage general (lista de resúmenes,
// para pintar el inicio sin leer fotos) y el cuerpo completo (con las fotos en
// data URL) en un archivo por borrador, igual que la cola sin conexión: las
// fotos pueden sumar varios MB y no caben bien en una fila de AsyncStorage. En
// web (sin documentDirectory) el cuerpo cae al storage general.
import * as FileSystem from 'expo-file-system/legacy';
import { storage } from '@/src/utils/storage';

export const MAX_BORRADORES = 20;

export interface BorradorItem {
  id: string;
  desc: any;
  qty: number;
}

/** Todo lo capturado en el formulario que se puede retomar. */
export interface BorradorDatos {
  nombre: string;
  severidad: string[];
  registrarLecturas: boolean;
  unidad: 'km' | 'm' | 'cm';
  primeraLectura: string;
  ultimaLectura: string;
  actividades: string;
  observaciones: string;
  incidencias: string;
  personal: BorradorItem[];
  equipo: BorradorItem[];
  camposExtra: Record<string, string>;
  images: string[];
  captions: string[];
  templateId: string;
  dynamicData: Record<string, any>;
}

export interface BorradorResumen {
  id: string;
  projectId: string;
  nodeId: string;
  /** Nombres de la ubicación elegida, de la raíz a la hoja. */
  ubicacion: string[];
  titulo: string;
  fotos: number;
  /** Epoch ms de la última vez que se guardó. */
  actualizado: number;
}

export interface Borrador extends BorradorResumen {
  datos: BorradorDatos;
}

const hayTexto = (v: unknown) => typeof v === 'string' && v.trim() !== '';

/** ¿Hay algo capturado que valga la pena guardar? Elegir ubicación/plantilla solo no cuenta. */
export function datosConContenido(d: BorradorDatos): boolean {
  if (hayTexto(d.nombre) || hayTexto(d.actividades) || hayTexto(d.observaciones) || hayTexto(d.incidencias)) return true;
  if (d.registrarLecturas && (hayTexto(d.primeraLectura) || hayTexto(d.ultimaLectura))) return true;
  if (d.images.length > 0) return true;
  if (d.captions.some(hayTexto)) return true;
  if ([...d.personal, ...d.equipo].some((i) => !!i.desc)) return true;
  if (Object.values(d.camposExtra).some(hayTexto)) return true;
  return Object.values(d.dynamicData).some((v) =>
    Array.isArray(v) ? v.length > 0 : typeof v === 'boolean' ? v : v !== undefined && v !== null && String(v).trim() !== '',
  );
}

/** Nuevo id de borrador (único en el teléfono). */
export function nuevoIdBorrador(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Más reciente primero. */
export function ordenarBorradores<T extends { actualizado: number }>(lista: T[]): T[] {
  return [...lista].sort((a, b) => b.actualizado - a.actualizado);
}

/** Inserta o reemplaza por id; si pasa de MAX_BORRADORES descarta los más viejos. */
export function upsertResumen(lista: BorradorResumen[], r: BorradorResumen): BorradorResumen[] {
  const sin = lista.filter((x) => x.id !== r.id);
  return ordenarBorradores([r, ...sin]).slice(0, MAX_BORRADORES);
}

export function resumenDe(b: Borrador): BorradorResumen {
  const { datos: _datos, ...resumen } = b;
  return { ...resumen, fotos: b.datos.images.length };
}

// --- Persistencia ------------------------------------------------------------

const limpia = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');
const claveIndice = (userId: string) => `dirac_borradores_idx_${limpia(userId)}`;
const claveCuerpo = (userId: string, id: string) => `dirac_borrador_${limpia(userId)}_${limpia(id)}`;
const archivoCuerpo = (userId: string, id: string) =>
  FileSystem.documentDirectory ? `${FileSystem.documentDirectory}${claveCuerpo(userId, id)}.json` : null;

async function leerIndice(userId: string): Promise<BorradorResumen[]> {
  const raw = await storage.getItem<string>(claveIndice(userId), '[]');
  try {
    const lista = JSON.parse(raw || '[]');
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

async function escribirIndice(userId: string, lista: BorradorResumen[]): Promise<boolean> {
  return storage.setItem(claveIndice(userId), JSON.stringify(lista));
}

async function escribirCuerpo(userId: string, b: Borrador): Promise<boolean> {
  const texto = JSON.stringify(b);
  const archivo = archivoCuerpo(userId, b.id);
  if (!archivo) return storage.setItem(claveCuerpo(userId, b.id), texto);
  try {
    // Escritura "atómica": si la app muere a medio escribir, el borrador anterior sigue intacto.
    const tmp = `${archivo}.tmp`;
    await FileSystem.writeAsStringAsync(tmp, texto, { encoding: FileSystem.EncodingType.UTF8 });
    await FileSystem.deleteAsync(archivo, { idempotent: true });
    await FileSystem.moveAsync({ from: tmp, to: archivo });
    return true;
  } catch {
    return false;
  }
}

async function leerCuerpo(userId: string, id: string): Promise<Borrador | null> {
  try {
    const archivo = archivoCuerpo(userId, id);
    let texto: string | null;
    if (archivo) {
      const info = await FileSystem.getInfoAsync(archivo);
      texto = info.exists
        ? await FileSystem.readAsStringAsync(archivo, { encoding: FileSystem.EncodingType.UTF8 })
        : null;
    } else {
      texto = await storage.getItem<string>(claveCuerpo(userId, id), '');
    }
    return texto ? (JSON.parse(texto) as Borrador) : null;
  } catch {
    return null;
  }
}

async function borrarCuerpo(userId: string, id: string): Promise<void> {
  const archivo = archivoCuerpo(userId, id);
  if (archivo) {
    try { await FileSystem.deleteAsync(archivo, { idempotent: true }); } catch { /* ya no está */ }
  } else {
    await storage.removeItem(claveCuerpo(userId, id));
  }
}

// Las escrituras se encadenan: el autoguardado, el guardado al salir y el borrado
// tras enviar pueden coincidir y no deben pisar el índice unas a otras.
let cola: Promise<unknown> = Promise.resolve();
function enCola<T>(tarea: () => Promise<T>): Promise<T> {
  const p = cola.then(tarea, tarea);
  cola = p.catch(() => undefined);
  return p;
}

// Aviso de cambios: la tarjeta de Inicio y la lista se refrescan solas, y el formulario
// abierto se entera si el borrador que está editando se descarta desde la lista.
export interface CambioBorrador { tipo: 'guardado' | 'eliminado'; id: string }
const oyentes = new Set<(c: CambioBorrador) => void>();
export function suscribirBorradores(fn: (c: CambioBorrador) => void): () => void {
  oyentes.add(fn);
  return () => { oyentes.delete(fn); };
}
function avisar(c: CambioBorrador) {
  oyentes.forEach((fn) => { try { fn(c); } catch { /* un oyente roto no frena a los demás */ } });
}

/** Borradores del usuario, el más reciente primero. */
export async function listarBorradores(userId: string): Promise<BorradorResumen[]> {
  if (!userId) return [];
  return ordenarBorradores(await leerIndice(userId));
}

export async function leerBorrador(userId: string, id: string): Promise<Borrador | null> {
  if (!userId || !id) return null;
  return leerCuerpo(userId, id);
}

/** Guarda (crea o reemplaza) el borrador. Devuelve false si no se pudo escribir. */
export function guardarBorrador(userId: string, b: Borrador): Promise<boolean> {
  if (!userId) return Promise.resolve(false);
  return enCola(async () => {
    if (!(await escribirCuerpo(userId, b))) return false;
    const previos = await leerIndice(userId);
    const lista = upsertResumen(previos, resumenDe(b));
    const salieron = previos.filter((p) => !lista.some((x) => x.id === p.id));
    const ok = await escribirIndice(userId, lista);
    for (const s of salieron) await borrarCuerpo(userId, s.id);
    if (ok) avisar({ tipo: 'guardado', id: b.id });
    return ok;
  });
}

export function eliminarBorrador(userId: string, id: string): Promise<void> {
  if (!userId || !id) return Promise.resolve();
  return enCola(async () => {
    const lista = (await leerIndice(userId)).filter((x) => x.id !== id);
    await escribirIndice(userId, lista);
    await borrarCuerpo(userId, id);
    avisar({ tipo: 'eliminado', id });
  });
}

export async function contarBorradores(userId: string): Promise<number> {
  return (await listarBorradores(userId)).length;
}

/** "hace 5 min", "hace 2 h", "ayer"… para la lista de borradores. */
export function textoHace(epochMs: number, ahora: number = Date.now()): string {
  const min = Math.max(0, Math.floor((ahora - epochMs) / 60000));
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}
