// SynCo v2.0 REST client.
// Reads JWT from secure storage on every call.
import { Alert, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { storage } from '@/src/utils/storage';
import { BACKEND_URL, BASE, ApiError, setAuthTokenCache, request, safeJson, getToken, authHeader } from '@/src/httpClient';
import { generateClientId, enqueueReport, isLikelyOnline } from '@/src/utils/offlineQueue';
import { generateAvanceClientId, enqueueAvance, isAvanceLikelyOnline } from '@/src/utils/avanceQueue';

// [DIAG 2026-07-08] Toggle para mostrar Alert diagnostico en dispositivo
// cuando falla un upload. Poner en `false` cuando termine la investigacion.
const UPLOAD_DIAG_ALERT = true;

// Extrae el mensaje real de error de una respuesta no-2xx (el backend manda
// `{"detail": "..."}` via HTTPException). Antes, las descargas de
// PDF/DOCX/PPTX/XLSX descartaban el body y mostraban siempre un texto
// generico ("Error al descargar PDF"), lo que hacia imposible saber la
// causa real (403/404/422/500) tanto para el usuario como para depurar.
async function _downloadErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    const detail = data && (data as any).detail;
    if (typeof detail === 'string' && detail.trim()) return `${fallback} (${res.status}): ${detail}`;
    if (detail) return `${fallback} (${res.status}): ${JSON.stringify(detail)}`;
  } catch {
    // noop: nos quedamos con el fallback
  }
  return `${fallback} (HTTP ${res.status})`;
}

// Re-exports: `BACKEND_URL`/`BASE`/`ApiError`/`setAuthTokenCache` vivian aqui
// antes de moverse a `httpClient.ts` (para que `offlineQueue.ts` pueda usar
// `request`/`ApiError` sin generar un import circular). Se re-exportan para
// que auth-context.tsx y coordinators.tsx no necesiten cambiar su import.
export { BACKEND_URL, BASE, ApiError, setAuthTokenCache };

/**
 * Normaliza el objeto que va a `FormData.append` en React Native (Android/iOS)
 * para evitar el bug "Network Request Failed" al enviar multipart/form-data.
 */
async function normalizeFileForFormData(
  file: { uri: string; name?: string | null; mimeType?: string | null },
  fallbackName: string,
  fallbackMime: string,
  cachePrefix: string = 'upload',
): Promise<{ uri: string; name: string; type: string; size: number }> {
  const rawName = (file.name && file.name.trim()) || fallbackName;
  const safeName = rawName.replace(/[^A-Za-z0-9._-]/g, '_') || fallbackName;
  const type = (file.mimeType && file.mimeType.trim()) || fallbackMime;
  const originalUri = file.uri || '';
  if (!originalUri) {
    throw new ApiError(0, 'URI de archivo vacia');
  }

  if (Platform.OS === 'web') {
    return { uri: originalUri, name: safeName, type, size: 0 };
  }

  const preferredRoot = FileSystem.cacheDirectory || FileSystem.documentDirectory || '';
  if (!preferredRoot) {
    throw new ApiError(0, 'No hay directorio local disponible (cacheDirectory/documentDirectory vacio).');
  }
  const dest = `${preferredRoot}${cachePrefix}_${Date.now()}_${safeName}`;

  let copiedUri = dest;
  try {
    await FileSystem.copyAsync({ from: originalUri, to: dest });
  } catch (e1: any) {
    if (FileSystem.documentDirectory && preferredRoot !== FileSystem.documentDirectory) {
      const dest2 = `${FileSystem.documentDirectory}${cachePrefix}_${Date.now()}_${safeName}`;
      try {
        await FileSystem.copyAsync({ from: originalUri, to: dest2 });
        copiedUri = dest2;
      } catch (e2: any) {
        throw new ApiError(0, `Copia a cache fallo. from="${originalUri}" err1="${e1?.message || e1}" err2="${e2?.message || e2}"`);
      }
    } else {
      throw new ApiError(0, `Copia a cache fallo. from="${originalUri}" err="${e1?.message || e1}"`);
    }
  }

  if (Platform.OS === 'android' && copiedUri.startsWith('/')) {
    copiedUri = 'file://' + copiedUri;
  }

  let size = 0;
  try {
    // `size` ya viene incluido por defecto en FileInfo (expo-file-system 19+);
    // la opcion `{ size: true }` de versiones viejas ya no existe en InfoOptions.
    const info = await FileSystem.getInfoAsync(copiedUri);
    if (!info.exists) {
      throw new ApiError(0, `Archivo no existe tras copia: ${copiedUri}`);
    }
    size = info.size || 0;
  } catch (e: any) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, `No se pudo verificar el archivo copiado: ${e?.message || e}`);
  }
  if (size <= 0) {
    throw new ApiError(0, `El archivo copiado esta vacio (0 bytes) en ${copiedUri}`);
  }

  return { uri: copiedUri, name: safeName, type, size };
}

/**
 * Ejecuta una subida multipart en React Native usando `FileSystem.uploadAsync`.
 */
async function nativeMultipartUpload<T>(
  url: string,
  fileUri: string,
  fileName: string,
  mime: string,
  cachePrefix: string,
): Promise<T> {
  let normalized: { uri: string; name: string; type: string; size: number };
  try {
    normalized = await normalizeFileForFormData(
      { uri: fileUri, name: fileName, mimeType: mime },
      fileName,
      mime,
      cachePrefix,
    );
  } catch (err: any) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(0, `Fallo la preparacion del archivo: ${err?.message || err}`);
  }

  if (!url || url === '/api' || url.startsWith('/api/')) {
    throw new ApiError(0, `Backend no configurado. url="${url}"`);
  }

  const authHeaders = await authHeader();

  let response: FileSystem.FileSystemUploadResult;
  try {
    response = await FileSystem.uploadAsync(url, normalized.uri, {
      fieldName: 'file',
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      mimeType: normalized.type,
      headers: authHeaders,
      parameters: {},
    });
  } catch (err: any) {
    const nativeMsg = err?.message || String(err);
    if (UPLOAD_DIAG_ALERT) {
      try {
        Alert.alert(
          'DIAG upload',
          `native="${nativeMsg}"\n\nurl="${url}"\n\nlocalUri="${normalized.uri}"\nsize=${normalized.size}\nmime="${normalized.type}"\nplatform=${Platform.OS} ${Platform.Version}`,
        );
      } catch { /* noop */ }
    }
    throw new ApiError(0, `uploadAsync fallo -> ${nativeMsg}. url=${url} localUri=${normalized.uri} size=${normalized.size} mime=${normalized.type}`);
  }

  const { status, body } = response;
  const data = body ? safeJson(body) : null;
  if (status < 200 || status >= 300) {
    const detail = (data && (data as any).detail) || body?.slice(0, 200) || 'sin cuerpo';
    throw new ApiError(status, `HTTP ${status}. detail="${typeof detail === 'string' ? detail : JSON.stringify(detail)}" url=${url} size=${normalized.size} mime=${normalized.type}`);
  }
  return data as T;
}

// ---- Types -----------------------------------------------------------------
export interface User {
  id: string;
  email: string;
  name: string;
  role: 'coordinador_general' | 'jefe_proyecto' | 'sub_coordinador' | 'especialista';
  area?: string | null;
  area_id?: string | null;
  puesto?: string | null;
  scope_node_id?: string | null;
  scope_node_ids: string[];
  project_ids: string[];
  expo_push_tokens?: string[];
  created_at: string;
}

export interface ReferenceFile {
  name: string;
  url: string;
  file_id?: string;
  original_name?: string;
  mime_type?: string;
  size?: number;
  uploaded_by?: string;
  uploaded_by_name?: string;
  uploaded_at?: string;
}

export interface Project {
  id: string;
  name: string;
  constructora: string;
  contract_number: string;
  objeto_contrato?: string | null;
  cliente_principal?: string | null;
  color_tema?: string | null;
  report_text_color?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  description?: string | null;
  reference_files?: ReferenceFile[];
  contratistas_list?: string[];
  contratos_list?: string[];
  categorias_personal?: string[];
  categorias_equipo?: string[];
  minuta_code_prefix?: string | null;
  template_pdf?: string | null;
  template_docx?: string | null;
  template_pptx?: string | null;
  template_map?: string | null;
  general_data_images?: string[];
  // Configuración de Catálogo de Conceptos / avance — ver server.py
  // (ProjectOut). tipo_contrato y modo_avance son ejes independientes.
  tipo_contrato?: 'PRECIO_ALZADO' | 'PRECIOS_UNITARIOS';
  modo_avance?: 'CANTIDAD' | 'PORCENTAJE' | 'MATRIZ';
  nombres_niveles_partida?: string[];
  nombre_nivel_concepto?: string;
  unidades_personalizadas?: string[];
  // Título visible del módulo (pantalla, PDF, nombre de archivo). No se
  // deriva — fallback "Catálogo de Conceptos" si vacío (ver nombresNivel.ts
  // para el porqué de no derivarlo).
  titulo_modulo_catalogo?: string;
  created_by: string;
  created_at: string;
  archived?: boolean;
}

export interface LocationNode {
  id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  depth: number;
  order: number;
  is_leaf: boolean;
  measurement_type: 'coord_latlon' | 'cadenamiento' | 'eje' | 'nivel' | null;
  target_lat?: number | null;
  target_lon?: number | null;
  target_elev?: number | null;
  meta?: number | null;
  avance_actual?: number | null;
  metadata?: Record<string, any> | null;
  cover_image?: string | null;
  // Estatus de acceso al predio y situacion social/liberacion fisica,
  // capturados a nivel de nodo Subtramo (profundidad 1). Usados en la
  // pagina de resumen por subtramo del export PDF/PPTX.
  acceso_predio?: string | null;
  situacion_social?: string | null;
  // null/undefined = usa el default (antes fijo: solo Subtramo, depth===1);
  // true/false = decisión explícita del Coordinador/Sub-Coordinador sobre
  // si ESTE nodo (a cualquier profundidad) participa en Acceso al Predio.
  acceso_predio_habilitado?: boolean | null;
  // Calculado por el servidor (nunca se envía al guardar): resuelve
  // acceso_predio_habilitado contra el default histórico. Ver
  // _acceso_predio_efectivo en server.py.
  acceso_predio_efectivo?: boolean;
}

export interface LocationNodeTree extends LocationNode {
  children: LocationNodeTree[];
}

export interface Area {
  id: string;
  project_id: string;
  name: string;
  color: string;
}

export interface Invitation {
  id: string;
  token: string;
  project_id: string;
  project_name: string;
  email: string;
  name: string;
  role: 'sub_coordinador' | 'especialista';
  area_id?: string | null;
  puesto?: string | null;
  scope_node_id?: string | null;
  scope_node_ids: string[];
  status: 'pending' | 'accepted' | 'revoked';
  created_at: string;
  expires_at: string;
}

export interface Report {
  id: string;
  project_id: string;
  node_id: string;
  node_path_names: string[];
  node_path_ids?: string[];
  measurement_type: string;
  measurement_value: Record<string, any>;
  title?: string | null;
  nombre?: string | null; // Alias para compatibilidad con backend
  name?: string | null;   // Alias adicional por seguridad
  titulo?: string | null; // [P0] Alias 3
  description?: string | null; // [P0] Alias 4
  descripcion?: string | null; // [P0] Alias 5
  area_id?: string | null;
  area_name?: string | null;
  notes?: string | null;
  actividades?: string | null;
  avance?: string | null;
  observaciones?: string | null;
  incidencias?: string | null;
  // Selección múltiple de jerarquías (p.ej. ["diario", "urgente"] para que
  // el reporte aparezca en el informe Diario Y en el Mensual).
  severidad?: string[];
  contratista?: string | null;
  personnel: string[];
  equipment: string[];
  images: string[];
  photo_captions?: string[];
  files: { filename: string; mime: string; data_base64: string }[];
  primera_lectura?: number | null;
  ultima_lectura?: number | null;
  unidad?: string | null;
  captured_by: string;
  captured_by_name: string;
  created_at: string;
  /** true si el reporte no pudo enviarse y quedo encolado para reintentar
   * cuando haya conexion (ver src/utils/offlineQueue.ts). El `id` en ese
   * caso es un placeholder local (`local-<client_id>`), no un id real del
   * backend todavia. */
  _queued?: boolean;
}

export interface FeedItem {
  id: string;
  project_id: string;
  node_id: string;
  node_path_names: string[];
  measurement_type: string;
  measurement_value: Record<string, any>;
  title?: string | null;
  nombre?: string | null; // Alias para compatibilidad con backend
  name?: string | null;   // Alias adicional por seguridad
  titulo?: string | null; // [P0] Alias 3
  description?: string | null; // [P0] Alias 4
  descripcion?: string | null; // [P0] Alias 5
  area_id?: string | null;
  area_name?: string | null;
  area_color?: string | null;
  avance?: string | null;
  contratista?: string | null;
  incidencias?: string | null;
  severidad?: string[] | null;
  personnel: string[];
  equipment: string[];
  captured_by: string;
  captured_by_name: string;
  is_mine: boolean;
  images_count: number;
  thumbnail_base64?: string | null;
  created_at: string;
  notes?: string | null;
  observaciones?: string | null;
  actividades?: string | null;
  comment?: string | null;
}

export interface FeedResponse {
  range: string;
  skip: number;
  has_more: boolean;
  stats: { total: number; mine: number; others: number };
  reports: FeedItem[];
}

export interface FeedOptions {
  skip?: number;
  node?: string | null;
  area?: string | null;
  date?: string | null; // 'YYYY-MM-DD' (día natural CDMX), prioridad sobre range
  since?: string | null; // ISO datetime: solo reportes creados después de este momento
}

export interface Announcement {
  id: string;
  project_id: string;
  title: string;
  body: string;
  pinned: boolean;
  jerarquia?: 'urgente' | 'importante' | 'informativo' | null;
  audiencia?: string | null;
  node_id?: string | null;
  node_name?: string | null;
  node_path_ids?: string[];
  author_id: string;
  author_name: string;
  author_role?: string;
  created_at: string;
  updated_at: string;
  // Toda noticia vence 24h después de creada (fijada o no); el backend la
  // deja de listar (y Mongo la purga vía TTL index) al llegar esta fecha.
  expires_at?: string;
}

export interface Acuerdo {
  id: string;
  descripcion: string;
  responsable_id: string;
  responsable_name: string;
  responsable_role?: string | null;
  fecha_limite: string;
  estado: boolean;
  completed_at?: string | null;
  completed_by?: string | null;
  completed_by_name?: string | null;
}

export interface Minuta {
  id: string;
  project_id: string;
  codigo?: string;
  tipo?: 'informativo' | 'compromiso';
  titulo: string;
  descripcion: string;
  area_ids: string[];
  area_names: string[];
  involved_ids?: string[];
  involved_names?: string[];
  fecha_reunion: string;
  ubicacion_id?: string | null;
  ubicacion_name?: string | null;
  ubicacion_path_names?: string[];
  author_id: string;
  author_name: string;
  author_role?: string;
  acuerdos: Acuerdo[];
  created_at: string;
  updated_at: string;
}

export interface MinutaBadge {
  assigned_pending: number;
  urgent: number;
}

export interface Message {
  id: string;
  project_id: string;
  channel_id?: string;
  user_id: string;
  user_name: string;
  user_role: string;
  user_area?: string | null;
  text: string;
  created_at: string;
}

export interface ChannelPeer {
  id: string;
  name: string;
  role: string;
}

export interface Channel {
  id: string;
  project_id: string;
  type: 'general' | 'area' | 'direct';
  name: string;
  area_id?: string | null;
  color?: string | null;
  member_ids?: string[] | null;
  peer?: ChannelPeer | null;
  last_message?: {
    id?: string;
    text?: string | null;
    user_id?: string;
    user_name?: string;
    created_at?: string;
  } | null;
  created_at: string;
}

export interface ProjectEvent {
  id: string;
  project_id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  start_at: string;
  end_at?: string | null;
  author_id: string;
  author_name: string;
  author_role?: string;
  area_id?: string | null;
  area_name?: string | null;
  area_color?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailyGoal {
  id: string;
  project_id: string;
  text: string;
  is_completed: boolean;
  created_at: string;
  created_by: string;
  created_by_name?: string;
}

// ---- Clima (Open-Meteo, sin API key) ---------------------------------------
export interface WeatherNow {
  tempC: number;
  code: number;
  label: string;
  icon: string; // nombre de icono Ionicons
}

const WEATHER_CODE_MAP: Record<string, { label: string; icon: string }> = {
  default: { label: 'Clima', icon: 'partly-sunny-outline' },
  '0': { label: 'Despejado', icon: 'sunny-outline' },
  '1': { label: 'Mayormente despejado', icon: 'partly-sunny-outline' },
  '2': { label: 'Parcialmente nublado', icon: 'partly-sunny-outline' },
  '3': { label: 'Nublado', icon: 'cloud-outline' },
  '45': { label: 'Niebla', icon: 'cloud-outline' },
  '48': { label: 'Niebla', icon: 'cloud-outline' },
  '51': { label: 'Llovizna', icon: 'rainy-outline' },
  '53': { label: 'Llovizna', icon: 'rainy-outline' },
  '55': { label: 'Llovizna', icon: 'rainy-outline' },
  '61': { label: 'Lluvia', icon: 'rainy-outline' },
  '63': { label: 'Lluvia', icon: 'rainy-outline' },
  '65': { label: 'Lluvia fuerte', icon: 'rainy-outline' },
  '67': { label: 'Lluvia', icon: 'rainy-outline' },
  '80': { label: 'Chubascos', icon: 'rainy-outline' },
  '81': { label: 'Chubascos', icon: 'rainy-outline' },
  '82': { label: 'Chubascos fuertes', icon: 'rainy-outline' },
  '71': { label: 'Nieve', icon: 'snow-outline' },
  '73': { label: 'Nieve', icon: 'snow-outline' },
  '75': { label: 'Nieve fuerte', icon: 'snow-outline' },
  '77': { label: 'Nieve', icon: 'snow-outline' },
  '85': { label: 'Chubascos de nieve', icon: 'snow-outline' },
  '86': { label: 'Chubascos de nieve', icon: 'snow-outline' },
  '95': { label: 'Tormenta', icon: 'thunderstorm-outline' },
  '96': { label: 'Tormenta con granizo', icon: 'thunderstorm-outline' },
  '99': { label: 'Tormenta con granizo', icon: 'thunderstorm-outline' },
};

// Llamada directa a Open-Meteo (gratis, sin API key) desde el cliente RN —
// mismo patron que `aiSummary` (llamada directa a Gemini), no pasa por el
// backend porque no requiere auth ni datos propios del servidor.
export async function getWeather(lat: number, lon: number): Promise<WeatherNow | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const tempC = data?.current?.temperature_2m;
    const code = data?.current?.weather_code;
    if (tempC == null || code == null) return null;
    const meta = WEATHER_CODE_MAP[String(code)] ?? WEATHER_CODE_MAP.default;
    return { tempC, code, label: meta.label, icon: meta.icon };
  } catch {
    return null;
  }
}

// ---- Catálogo de Conceptos --------------------------------------------------
// Los campos de dinero/cantidades (cantidad, precio_unitario, meta, importe_*)
// viajan como STRING decimal exacto (ver backend/money_utils.py) — nunca los
// parsees con parseFloat para operar; usa src/utils/money.ts.
export interface Partida {
  id: string;
  project_id: string;
  clave: string;
  nombre: string;
  orden: number;
  activo: boolean;
  partida_padre_id?: string | null;
  created_at: string;
  // Calculados por el servidor
  numero_conceptos: number;
  importe_contratado_partida: string;
  porcentaje_avance_partida: string;
}

export interface Concepto {
  id: string;
  partida_id: string;
  project_id: string;
  clave: string;
  descripcion: string;
  unidad: string;
  cantidad: string;
  precio_unitario: string;
  meta: string;
  periodicidad_meta: 'SEMANAL' | 'MENSUAL';
  activo: boolean;
  created_at: string;
  // Calculados por el servidor
  importe_contratado: string;
  cantidad_ejecutada_acumulada: string;
}

export interface ConceptoSearchResult extends Concepto {
  partida_clave: string | null;
  partida_nombre: string | null;
}

// ---- Actividades Generales --------------------------------------------
export type NivelActividad = 'GENERAL' | 'SUBTRAMO' | 'NODO';

export interface ActividadHistorialEntry {
  accion: 'creada' | 'editada' | 'ocultada' | 'restaurada' | 'revertida' | 'movida';
  texto_anterior?: string | null;
  nivel_anterior?: string | null;
  node_id_anterior?: string | null;
  usuario_id: string;
  usuario_nombre?: string | null;
  en: string;
}

export interface ActividadCurada {
  // Id real (uuid) una vez materializada, o `virtual:{reporte_id}` mientras
  // solo exista como texto de un reporte sin tocar — ver backend server.py
  // sección "ACTIVIDADES GENERALES" para el porqué es seguro como clave 1:1.
  id: string;
  project_id: string;
  area_id: string | null;
  area_name?: string | null;
  nivel: NivelActividad;
  node_id: string | null;
  node_name?: string | null;
  node_path_names: string[];
  // Nodo REAL donde se capturó el reporte de origen — inmutable, incluso si
  // `node_id`/`nivel` cambian al "mover" la actividad a otro agrupador.
  node_id_origen: string | null;
  node_path_names_origen: string[];
  reporte_origen_id: string | null;
  texto_original: string;
  texto_editado: string | null;
  texto: string; // efectivo = texto_editado ?? texto_original
  editada: boolean;
  anadida_manual: boolean;
  oculta: boolean;
  orden: number;
  dedup_count: number;
  dedup_report_ids: string[];
  reporte_fecha: string | null;
  reporte_autor: string | null;
  puede_editar: boolean;
  editado_por: string | null;
  editado_en: string | null;
  historial: ActividadHistorialEntry[];
  // El reporte de origen cambió/desapareció desde que se guardó el
  // snapshot: la UI debe ofrecer ver ambos, nunca resolverlo en silencio.
  origen_cambio: boolean;
  origen_eliminado: boolean;
  // El bloque del reporte ya no tiene esa cantidad de líneas (no se
  // intentó realinear por contenido) — distinto de origen_cambio simple
  // (misma línea, texto distinto). Cuando es true, texto_actual_reporte
  // viene null porque no hay una línea correspondiente que mostrar.
  origen_estructura_cambio: boolean;
  texto_actual_reporte: string | null;
}

export interface RegistroAvance {
  id: string;
  concepto_id: string;
  project_id: string;
  fecha: string;
  cantidad_ejecutada: string;
  nodo_id?: string | null;
  reporte_id?: string | null;
  fotos: string[];
  photo_captions: string[];
  capturado_por: string;
  capturado_por_nombre?: string | null;
  creado_en: string;
  sincronizado: boolean;
  editado_en?: string | null;
  // Línea base (ver server.py, sección PROGRAMA DESGLOSADO / línea base).
  origen?: 'APP' | 'LINEA_BASE';
  linea_base_batch_id?: string | null;
  // modo_avance=PORCENTAJE: true si este valor es menor que la captura
  // anterior del mismo concepto — se permite (nunca se rechaza), pero se
  // marca para que la UI lo muestre. Siempre false fuera de ese modo.
  es_retroceso?: boolean;
}

export interface AvancesResumen {
  total_registros: number;
  /** Suma de cantidad_ejecutada x precio_unitario del concepto, en el periodo filtrado — string decimal exacto (ver src/utils/money.ts). */
  importe_total: string;
}

export interface BitacoraCambio {
  id: string;
  project_id: string;
  tipo: string;
  entidad_tipo: string;
  entidad_id: string;
  campo?: string | null;
  valor_anterior?: string | null;
  valor_nuevo?: string | null;
  usuario_id: string;
  usuario_nombre?: string | null;
  fecha: string;
}

export type ConvencionDecimal = 'coma' | 'punto';

export interface ImportSheetsResponse {
  import_id: string;
  sheet_names: string[];
  requiere_seleccion_hoja: boolean;
  convencion_detectada: ConvencionDecimal | null;
}

export interface ImportHeadersResponse {
  sheet: string;
  header_row_index: number;
  headers: string[];
  suggested_mapping: Record<string, string>;
  sample_rows: any[][];
  total_rows: number;
  convencion_detectada: ConvencionDecimal | null;
  // Primeras filas TAL CUAL vienen en el archivo, sin importar cuál se usa
  // como encabezado ahora mismo — para que el usuario elija con un toque
  // si el archivo trae filas de logo/título antes del encabezado real.
  preview_rows: any[][];
}

export interface ImportMapping {
  clave?: string;
  descripcion?: string;
  unidad?: string;
  cantidad?: string;
  precio_unitario?: string;
  importe?: string;
}

// tipo: 'excel_error' | 'numero_ilegible' | 'numero_ambiguo' | 'campo_obligatorio_vacio'
//     | 'unidad_no_reconocida' | 'importe_no_coincide' | 'clave_duplicada_archivo' | 'clave_existente_proyecto'
export interface ImportProblema {
  tipo: string;
  campo: string | null;
  motivo: string;
  lectura_miles?: string;
  lectura_decimal?: string;
}

export type ImportEstadoFila = 'ok' | 'error' | 'advertencia' | 'duplicado' | 'descartado';

export interface ImportFila {
  fila: number;
  clave: string | null;
  descripcion: string | null;
  unidad: string;
  unidad_raw: string | null;
  cantidad: string | null;
  cantidad_raw: any;
  precio_unitario: string | null;
  precio_unitario_raw: any;
  importe_archivo: string | null;
  importe_calculado: string | null;
  concepto_existente_id: string | null;
  problemas: ImportProblema[];
  // Calculados por _calcular_vista_filas (overlay de correcciones aplicado):
  cantidad_efectiva: string | null;
  precio_unitario_efectivo: string | null;
  unidad_efectiva: string;
  problemas_activos: ImportProblema[];
  correccion: { cantidad?: string; precio_unitario?: string; unidad?: string; descartar?: boolean } | null;
  estado: ImportEstadoFila;
}

export interface ImportResumen {
  total: number;
  ok: number;
  advertencia: number;
  error: number;
  duplicado: number;
  descartado: number;
}

export interface ImportValidateResult {
  resumen: ImportResumen;
  convencion_usada: ConvencionDecimal | null;
}

export interface ImportPreviewResponse {
  resumen: ImportResumen;
  filas: ImportFila[];
  page: number;
  page_size: number;
  total_pages: number;
  total_rows: number;
  sheet: string | null;
  partida_id: string | null;
  convencion_usada: ConvencionDecimal | null;
  duplicados_accion: 'omitir' | 'actualizar';
}

export interface ImportCommitResult {
  creados: number;
  actualizados: number;
  omitidos: number;
  con_error: number;
  descartados: number;
  import_batch_id: string;
}

export interface SesionPendiente {
  import_id: string;
  filename: string | null;
  created_at: string;
  sheet_names: string[];
  validado: boolean;
  validated_sheet: string | null;
  validated_header_row_index: number | null;
  validated_mapping: ImportMapping | null;
  validated_partida_id: string | null;
  convencion_usada: ConvencionDecimal | null;
}

// ---- Programa desglosado (Etapa 2 de la Ampliación del Catálogo) ----------
// Segundo destino del MISMO wizard de importación (subir -> hoja -> mapear ->
// validar/preview -> commit) — no crea/edita conceptos, adjunta una
// distribución mensual a conceptos que YA existen (emparejados por clave),
// agrupada en una ProgramaVersion versionada. Ver server.py, sección
// "PROGRAMA DESGLOSADO".
export interface ProgramaImportMapping {
  codigo?: string;
  importe?: string;
  inicio?: string;
  fin?: string;
  meses: string[];
}

export interface ProgramaImportHeadersResponse {
  sheet: string;
  header_row_index: number;
  headers: string[];
  suggested_mapping: { codigo?: string; importe?: string; inicio?: string; fin?: string; meses: string[] };
  fila_rango_fechas: any[];
  sample_rows: any[][];
  total_rows: number;
  convencion_detectada: ConvencionDecimal | null;
  preview_rows: any[][];
}

// tipo: 'importe_ilegible' | 'concepto_no_encontrado' | 'celda_mes_ilegible' | 'distribucion_no_cuadra'
export interface ProgramaImportProblema {
  tipo: string;
  campo: string | null;
  motivo: string;
  importe_concepto?: string;
  suma_distribucion?: string;
  diferencia?: string;
}

export type ProgramaImportEstadoFila = 'ok' | 'error' | 'descartado' | 'sin_distribucion';

export interface ProgramaImportMes {
  fecha_inicio: string | null;
  fecha_fin: string | null;
  importe: string;
}

export interface ProgramaImportFila {
  fila: number;
  clave: string;
  concepto_id: string | null;
  importe_concepto: string;
  fecha_inicio_contractual: string | null;
  fecha_fin_contractual: string | null;
  tiene_distribucion_propia: boolean;
  meses: ProgramaImportMes[];
  problemas: ProgramaImportProblema[];
  correccion: { descartar?: boolean } | null;
  estado: ProgramaImportEstadoFila;
}

export interface ProgramaImportResumen {
  total: number;
  ok: number;
  error: number;
  descartado: number;
  sin_distribucion: number;
}

export interface ProgramaImportValidateResult {
  resumen: ProgramaImportResumen;
  etiqueta: string;
}

export interface ProgramaImportPreviewResponse {
  resumen: ProgramaImportResumen;
  filas: ProgramaImportFila[];
  page: number;
  page_size: number;
  total_pages: number;
  total_rows: number;
  sheet: string | null;
  etiqueta: string | null;
  convencion_usada: ConvencionDecimal | null;
}

export interface ProgramaImportCommitResult {
  version_id: string;
  conceptos_importados: number;
  sin_distribucion: number;
}

export interface ProgramaSesionPendiente {
  import_id: string;
  filename: string | null;
  created_at: string;
  sheet_names: string[];
  validado: boolean;
  validated_sheet: string | null;
  validated_header_row_index: number | null;
  validated_mapping: ProgramaImportMapping | null;
  convencion_usada: ConvencionDecimal | null;
}

export interface ProgramaVersion {
  id: string;
  project_id: string;
  etiqueta: string;
  fecha_importacion: string;
  vigente: boolean;
  creado_por: string;
  filename: string | null;
}

// ---- API client -----------------------------------------------------------
export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>('POST', '/auth/login', { email, password }),
  me: () => request<User>('GET', '/auth/me'),

  listCoordinators: () => request<User[]>('GET', '/admin/coordinators'),
  createCoordinator: (body: { name: string; email: string; password: string }) =>
    request<User>('POST', '/admin/coordinators', body),

  unreadCounts: () => request<Record<string, number>>('GET', '/messages/unread_counts'),
  markProjectMessagesSeen: (pid: string) =>
    request<{ ok: boolean; last_read_at: string }>('POST', `/projects/${pid}/messages/seen`, {}),

  registerPushToken: (token: string, platform?: string) =>
    request<{ ok: boolean; count: number }>('POST', '/users/push-token', { token, platform }),
  unregisterPushToken: (token: string) =>
    request<{ ok: boolean }>('DELETE', '/users/push-token', { token }),

  invitePreview: (token: string) =>
    request<{ project_name: string; email: string; name: string; role: string; puesto?: string | null; area_name?: string | null }>(
      'GET', `/invitations/by-token/${encodeURIComponent(token)}`,
    ),
  acceptInvite: (token: string, password: string) =>
    request<{ token: string; user: User }>('POST', '/invitations/accept', { token, password }),

  listProjects: () => request<Project[]>('GET', '/projects'),
  getProject: (pid: string) => request<Project>('GET', `/projects/${pid}`),
  createProject: (body: any) => request<Project>('POST', '/projects', body),
  updateProject: (pid: string, body: any) => request<Project>('PUT', `/projects/${pid}`, body),
  setProjectReferenceFiles: (pid: string, files: ReferenceFile[]) =>
    request<{ ok: boolean; reference_files: ReferenceFile[] }>(
      'PUT', `/projects/${pid}/reference-files`, { reference_files: files }
    ),
  archiveProject: (pid: string) => request<{ ok: boolean; archived: boolean }>('DELETE', `/projects/${pid}`),

  listNodes: (pid: string) => request<LocationNode[]>('GET', `/projects/${pid}/nodes`),
  getTree: (pid: string) => request<LocationNodeTree[]>('GET', `/projects/${pid}/nodes/tree`),
  createNode: (pid: string, body: any) => request<LocationNode>('POST', `/projects/${pid}/nodes`, body),
  updateNode: (nid: string, body: any) => request<LocationNode>('PATCH', `/nodes/${nid}`, body),
  deleteNode: (nid: string) => request<{ ok: boolean; deleted_count: number }>('DELETE', `/nodes/${nid}`),

  uploadNodeCover: async (
    pid: string,
    nid: string,
    file: { uri: string; name: string; mimeType?: string | null },
  ): Promise<LocationNode> => {
    if (!file || !file.uri) {
      Alert.alert('Error de Subida', 'No se ha seleccionado ninguna imagen para la portada.');
      throw new ApiError(0, 'Archivo o URI no proporcionado');
    }
    const isWeb = Platform.OS === 'web';
    const fileName = file.name || 'cover.jpg';
    const mime = file.mimeType || 'image/jpeg';
    const url = `${BASE}/projects/${pid}/nodes/${nid}/cover`;

    if (!isWeb) {
      return nativeMultipartUpload<LocationNode>(url, file.uri, fileName, mime, 'cover');
    }

    const form = new FormData();
    const resBlob = await fetch(file.uri);
    const blob = await resBlob.blob();
    try {
      const f = new File([blob], fileName, { type: mime });
      form.append('file', f);
    } catch {
      form.append('file', blob, fileName);
    }
    const headers = await authHeader();
    const res = await fetch(url, { method: 'POST', headers, body: form as any });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      const msg = (data && (data as any).detail) || `HTTP ${res.status}`;
      throw new ApiError(res.status, typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return data as LocationNode;
  },

  deleteNodeCover: (pid: string, nid: string) =>
    request<LocationNode>('DELETE', `/projects/${pid}/nodes/${nid}/cover`),

  bulkUploadNodes: async (
    pid: string,
    file: { uri: string; name: string; mimeType?: string | null },
  ): Promise<any> => {
    if (!file || !file.uri) {
      Alert.alert('Error de Subida', 'No se ha seleccionado ningun archivo para la carga masiva.');
      throw new ApiError(0, 'Archivo o URI no proporcionado');
    }
    const isWeb = Platform.OS === 'web';
    const fileName = file.name || 'nodos.xlsx';
    const mime = file.mimeType || (fileName.toLowerCase().endsWith('.csv') ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const url = `${BASE}/projects/${pid}/nodes/bulk-upload`;

    if (!isWeb) {
      return nativeMultipartUpload<any>(url, file.uri, fileName, mime, 'bulknodes');
    }

    const form = new FormData();
    const resBlob = await fetch(file.uri);
    const blob = await resBlob.blob();
    try {
      const f = new File([blob], fileName, { type: mime });
      form.append('file', f);
    } catch {
      form.append('file', blob, fileName);
    }
    const headers = await authHeader();
    const res = await fetch(url, { method: 'POST', headers, body: form as any });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      const msg = (data && (data as any).detail) || `HTTP ${res.status}`;
      throw new ApiError(res.status, typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return data as any;
  },

  bulkUploadNodesTemplateUrl: (pid: string) => `${BASE}/projects/${pid}/nodes/bulk-upload/template`,

  uploadProjectFile: async (
    pid: string,
    file: { uri: string; name: string; mimeType?: string | null },
  ): Promise<any> => {
    if (!file || !file.uri) {
      Alert.alert('Error de Subida', 'No se ha seleccionado ningun archivo para subir al proyecto.');
      throw new ApiError(0, 'Archivo o URI no proporcionado');
    }
    const isWeb = Platform.OS === 'web';
    const fileName = file.name || 'archivo';
    const mime = file.mimeType || 'application/octet-stream';
    const url = `${BASE}/projects/${pid}/upload-file`;

    if (!isWeb) {
      return nativeMultipartUpload<any>(url, file.uri, fileName, mime, 'upload');
    }

    const form = new FormData();
    const resBlob = await fetch(file.uri);
    const blob = await resBlob.blob();
    try {
      const f = new File([blob], fileName, { type: mime });
      form.append('file', f);
    } catch {
      form.append('file', blob, fileName);
    }
    const headers = await authHeader();
    const res = await fetch(url, { method: 'POST', headers, body: form as any });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      const msg = (data && (data as any).detail) || `HTTP ${res.status}`;
      throw new ApiError(res.status, typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return data as any;
  },

  deleteProjectFile: (pid: string, fileId: string) =>
    request<{ ok: boolean; file_id: string }>('DELETE', `/projects/${pid}/files/${fileId}`),

  uploadProjectTemplate: async (
    pid: string,
    kind: 'pdf' | 'docx' | 'pptx' | 'map',
    file: { uri: string; name: string; mimeType?: string | null },
  ): Promise<Project> => {
    if (!file || !file.uri) {
      Alert.alert('Error de Subida', 'No se ha seleccionado ninguna plantilla para subir.');
      throw new ApiError(0, 'Archivo o URI no proporcionado');
    }
    const isWeb = Platform.OS === 'web';
    const fileName = file.name || `template.${kind === 'map' ? 'jpg' : kind}`;
    const mime = file.mimeType || (kind === 'pdf' ? 'application/pdf' : kind === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : kind === 'pptx' ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation' : 'image/jpeg');
    const url = `${BASE}/projects/${pid}/template/${kind}`;

    if (!isWeb) {
      return nativeMultipartUpload<Project>(url, file.uri, fileName, mime, `template_${kind}`);
    }

    const form = new FormData();
    const resBlob = await fetch(file.uri);
    const blob = await resBlob.blob();
    try {
      const f = new File([blob], fileName, { type: mime });
      form.append('file', f);
    } catch {
      form.append('file', blob, fileName);
    }
    const headers = await authHeader();
    const res = await fetch(url, { method: 'POST', headers, body: form as any });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      const msg = (data && (data as any).detail) || `HTTP ${res.status}`;
      throw new ApiError(res.status, typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return data as Project;
  },

  deleteProjectTemplate: (pid: string, kind: 'pdf' | 'docx' | 'pptx' | 'map') =>
    request<Project>('DELETE', `/projects/${pid}/template/${kind}`),

  addGeneralDataImage: (pid: string, imageDataUrl: string) =>
    request<Project>('POST', `/projects/${pid}/general-data-images`, { image: imageDataUrl }),

  addGeneralDataImageFile: async (
    pid: string,
    file: { uri: string; name?: string; mimeType?: string | null },
  ): Promise<Project> => {
    if (!file || !file.uri) {
      Alert.alert('Error de Subida', 'No se ha seleccionado ninguna imagen para Datos Generales.');
      throw new ApiError(0, 'Archivo o URI no proporcionado');
    }
    const isWeb = Platform.OS === 'web';
    const fileName = file.name || `gd_${Date.now()}.jpg`;
    const mime = file.mimeType || 'image/jpeg';
    const url = `${BASE}/projects/${pid}/general-data-images/upload-file`;
    if (!isWeb) {
      return nativeMultipartUpload<Project>(url, file.uri, fileName, mime, 'gd');
    }
    const form = new FormData();
    const resBlob = await fetch(file.uri);
    const blob = await resBlob.blob();
    try {
      const f = new File([blob], fileName, { type: mime });
      form.append('file', f);
    } catch {
      form.append('file', blob, fileName);
    }
    const headers = await authHeader();
    const res = await fetch(url, { method: 'POST', headers, body: form as any });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      const msg = (data && (data as any).detail) || `HTTP ${res.status}`;
      throw new ApiError(res.status, typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return data as Project;
  },

  uploadReportPhoto: async (file: { uri: string; name?: string; mimeType?: string | null }): Promise<{ data_url: string }> => {
    if (!file || !file.uri) {
      Alert.alert('Error de Subida', 'No se ha capturado o seleccionado ninguna foto para el reporte.');
      throw new ApiError(0, 'Archivo o URI no proporcionado');
    }
    const isWeb = Platform.OS === 'web';
    const fileName = file.name || `photo_${Date.now()}.jpg`;
    const mime = file.mimeType || 'image/jpeg';
    const url = `${BASE}/upload/photo`;
    if (!isWeb) {
      return nativeMultipartUpload<{ data_url: string }>(url, file.uri, fileName, mime, 'photo');
    }
    const form = new FormData();
    const resBlob = await fetch(file.uri);
    const blob = await resBlob.blob();
    try {
      const f = new File([blob], fileName, { type: mime });
      form.append('file', f);
    } catch {
      form.append('file', blob, fileName);
    }
    const headers = await authHeader();
    const res = await fetch(url, { method: 'POST', headers, body: form as any });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      const msg = (data && (data as any).detail) || `HTTP ${res.status}`;
      throw new ApiError(res.status, typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return data as { data_url: string };
  },

  replaceGeneralDataImages: (pid: string, images: string[]) =>
    request<Project>('PUT', `/projects/${pid}/general-data-images`, { images }),
  deleteGeneralDataImage: (pid: string, index: number) =>
    request<Project>('DELETE', `/projects/${pid}/general-data-images/${index}`),

  projectFileUrl: (pid: string, fileId: string) => `${BASE}/projects/${pid}/files/${fileId}`,

  downloadNodesTemplate: async (pid: string): Promise<{ blob?: Blob; uri?: string; filename: string }> => {
    const headers = await authHeader();
    const url = `${BASE}/projects/${pid}/nodes/bulk-upload/template`;
    const filename = 'plantilla_nodos_synco.xlsx';
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
      throw new ApiError(res.status, `HTTP ${res.status} al descargar la plantilla`);
    }
    const blob = await res.blob();
    return { blob, filename };
  },

  downloadProjectFile: async (pid: string, fileId: string, fallbackFilename?: string): Promise<{ blob: Blob; filename: string; mime?: string }> => {
    const headers = await authHeader();
    const url = `${BASE}/projects/${pid}/files/${fileId}`;
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
      throw new ApiError(res.status, `HTTP ${res.status} al descargar el archivo`);
    }
    let filename = fallbackFilename || 'archivo';
    const cd = res.headers.get('content-disposition') || res.headers.get('Content-Disposition') || '';
    const m = /filename\*?=(?:UTF-8'')?"?([^";\n]+)"?/i.exec(cd);
    if (m && m[1]) {
      try { filename = decodeURIComponent(m[1]); } catch { filename = m[1]; }
    }
    const mime = res.headers.get('content-type') || undefined;
    const blob = await res.blob();
    return { blob, filename, mime: mime || undefined };
  },

  listAreas: (pid: string) => request<Area[]>('GET', `/projects/${pid}/areas`),
  createArea: (pid: string, body: any) => request<Area>('POST', `/projects/${pid}/areas`, body),
  deleteArea: (aid: string) => request<{ ok: boolean }>('DELETE', `/areas/${aid}`),

  setProjectCatalogos: (pid: string, body: any) => request<Project>('PUT', `/projects/${pid}/catalogos`, body),

  listInvitations: (pid: string) => request<Invitation[]>('GET', `/projects/${pid}/invitations`),
  createInvitation: (pid: string, body: any) => request<Invitation>('POST', `/projects/${pid}/invitations`, body),
  revokeInvitation: (iid: string) => request<{ ok: boolean }>('DELETE', `/invitations/${iid}`),

  createReport: async (body: any): Promise<Report> => {
    // [OFFLINE 2026-08-07] Los especialistas capturan en obra, donde a
    // menudo no hay senal. `client_id` es la clave de idempotencia: se manda
    // siempre (tanto en el envio inmediato como en el reintento desde la
    // cola) para que el backend pueda deduplicar si un reintento en realidad
    // ya habia llegado a insertarse.
    const payload = { ...body, client_id: body.client_id || generateClientId() };

    if (!(await isLikelyOnline())) {
      const q = await enqueueReport(payload);
      return { ...payload, id: `local-${q.client_id}`, created_at: q.created_at, _queued: true } as Report;
    }
    try {
      return await request<Report>('POST', '/reports', payload);
    } catch (e: any) {
      if (!(e instanceof ApiError)) {
        // Error de red crudo (no ApiError -> el servidor nunca respondio):
        // se encola en vez de perder el reporte y sus fotos.
        const q = await enqueueReport(payload);
        return { ...payload, id: `local-${q.client_id}`, created_at: q.created_at, _queued: true } as Report;
      }
      throw e; // ApiError real (400/403/404/422/500...): igual que antes.
    }
  },
  updateReportCaptions: (rid: string, photo_captions: string[]) =>
    request<Report>('PATCH', `/reports/${rid}/captions`, { photo_captions }),
  // `severidad` es una lista: el reporte puede pertenecer a varios informes
  // a la vez (p.ej. ["diario", "urgente"] = Diario + Mensual).
  updateReportSeverity: (rid: string, severidad: string[]) =>
    request<Report>('PATCH', `/reports/${rid}/severity`, { severidad }),
  updateWorkforceEntry: (rid: string, field: 'personnel' | 'equipment', index: number, value: string | null) =>
    request<Report>('PATCH', `/reports/${rid}/workforce-entry`, { field, index, value }),
  nodeHistory: (pid: string, nid: string) =>
    request<{
      node_id: string;
      measurement_type: string | null;
      has_previous: boolean;
      last_report: null | any;
    }>('GET', `/projects/${pid}/nodes/${nid}/history`),
  listReports: (pid: string) => request<Report[]>('GET', `/projects/${pid}/reports`),
  feed: (
    pid: string,
    range: 'today' | 'week' | 'month' | 'all' = 'today',
    limit = 50,
    q?: string,
    opts?: FeedOptions,
  ) => {
    const params = new URLSearchParams({ range, limit: String(limit) });
    if (q && q.trim()) params.set('q', q.trim());
    if (opts?.skip) params.set('skip', String(opts.skip));
    if (opts?.node) params.set('node', opts.node);
    if (opts?.area) params.set('area', opts.area);
    if (opts?.date) params.set('date', opts.date);
    if (opts?.since) params.set('since', opts.since);
    return request<FeedResponse>('GET', `/projects/${pid}/reports/feed?${params.toString()}`);
  },
  getReport: (rid: string) => request<Report>('GET', `/reports/${rid}`),

  // Resumen ejecutivo generado por el backend (endpoint /ai_summary, via
  // emergentintegrations + EMERGENT_LLM_KEY del servidor). No requiere ni
  // expone ninguna API key en el cliente — evita el problema de variables
  // EXPO_PUBLIC_* que no se empaquetan en builds nativos de EAS, y de
  // llamar a un proveedor de IA directo desde el telefono con una key/modelo
  // que puede quedar invalido sin que el cliente se entere.
  aiSummary: (pid: string) =>
    request<{ summary: string; reports_count: number; period_hours: number; generated_at: string }>(
      'POST', `/projects/${pid}/ai_summary`,
    ),

  listAnnouncements: (pid: string) => request<Announcement[]>('GET', `/projects/${pid}/announcements`),
  createAnnouncement: (pid: string, payload: any) => request<Announcement>('POST', `/projects/${pid}/announcements`, payload),
  updateAnnouncement: (aid: string, payload: any) => request<Announcement>('PATCH', `/announcements/${aid}`, payload),
  deleteAnnouncement: (aid: string) => request<{ ok: boolean }>('DELETE', `/announcements/${aid}`),

  listMessages: (pid: string, params: any = {}) => {
    const qs = new URLSearchParams();
    if (params.since) qs.set('since', params.since);
    if (params.before) qs.set('before', params.before);
    qs.set('limit', String(params.limit ?? 100));
    return request<Message[]>('GET', `/projects/${pid}/messages?${qs.toString()}`);
  },
  sendMessage: (pid: string, text: string) => request<Message>('POST', `/projects/${pid}/messages`, { text }),
  deleteMessage: (mid: string) => request<{ ok: boolean }>('DELETE', `/messages/${mid}`),

  listChannels: (pid: string) => request<Channel[]>('GET', `/projects/${pid}/channels`),
  getChannel: (cid: string) => request<Channel>('GET', `/channels/${cid}`),
  listChannelMessages: (cid: string, params: any = {}) => {
    const qs = new URLSearchParams();
    if (params.since) qs.set('since', params.since);
    if (params.before) qs.set('before', params.before);
    qs.set('limit', String(params.limit ?? 100));
    return request<Message[]>('GET', `/channels/${cid}/messages?${qs.toString()}`);
  },
  sendChannelMessage: (cid: string, text: string) => request<Message>('POST', `/channels/${cid}/messages`, { text }),
  createDirectChannel: (pid: string, target_user_id: string) => request<Channel>('POST', `/projects/${pid}/channels/direct`, { target_user_id }),
  listProjectMembers: (pid: string) => request<User[]>('GET', `/projects/${pid}/members`),

  exportReportsXlsxUrl: (pid: string) => `${BASE}/projects/${pid}/export/reports.xlsx`,
  downloadReportsXlsx: async (pid: string): Promise<{ blob: Blob; filename: string }> => {
    const tok = await getToken();
    const res = await fetch(`${BASE}/projects/${pid}/export/reports.xlsx`, {
      method: 'GET',
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, await _downloadErrorMessage(res, 'Error al descargar XLSX'));
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename="?([^"]+)"?/);
    return { blob: await res.blob(), filename: (m && m[1]) || 'reportes.xlsx' };
  },

  downloadReportsPdf: async (pid: string, period: string, opts?: any): Promise<{ blob: Blob; filename: string }> => {
    const tok = await getToken();
    const qs = new URLSearchParams({ period });
    if (opts?.area_id) qs.set('area_id', opts.area_id);
    if (opts?.scope) qs.set('scope', opts.scope);
    if (opts?.period_type) qs.set('period_type', opts.period_type);
    const res = await fetch(`${BASE}/projects/${pid}/export/reports.pdf?${qs.toString()}`, {
      method: 'GET',
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, await _downloadErrorMessage(res, 'Error al descargar PDF'));
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename="?([^"]+)"?/);
    return { blob: await res.blob(), filename: (m && m[1]) || `reporte_${period}.pdf` };
  },

  downloadReportsDocx: async (pid: string, period: string, opts?: any): Promise<{ blob: Blob; filename: string }> => {
    const tok = await getToken();
    const qs = new URLSearchParams({ period });
    if (opts?.area_id) qs.set('area_id', opts.area_id);
    if (opts?.scope) qs.set('scope', opts.scope);
    if (opts?.period_type) qs.set('period_type', opts.period_type);
    const res = await fetch(`${BASE}/projects/${pid}/export/reports.docx?${qs.toString()}`, {
      method: 'GET',
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, await _downloadErrorMessage(res, 'Error al descargar DOCX'));
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename="?([^"]+)"?/);
    return { blob: await res.blob(), filename: (m && m[1]) || `reporte_${period}.docx` };
  },

  downloadReportsPptx: async (pid: string, period: string, opts?: any): Promise<{ blob: Blob; filename: string }> => {
    const tok = await getToken();
    const qs = new URLSearchParams({ period });
    if (opts?.area_id) qs.set('area_id', opts.area_id);
    if (opts?.scope) qs.set('scope', opts.scope);
    if (opts?.period_type) qs.set('period_type', opts.period_type);
    const res = await fetch(`${BASE}/projects/${pid}/export/reports.pptx?${qs.toString()}`, {
      method: 'GET',
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, await _downloadErrorMessage(res, 'Error al descargar PPTX'));
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename="?([^"]+)"?/);
    return { blob: await res.blob(), filename: (m && m[1]) || `reporte_${period}.pptx` };
  },

  listEvents: (pid: string, range: string = 'upcoming', limit = 500) =>
    request<ProjectEvent[]>('GET', `/projects/${pid}/events?range=${range}&limit=${limit}`),
  createEvent: (pid: string, payload: any) => request<ProjectEvent>('POST', `/projects/${pid}/events`, payload),
  updateEvent: (eid: string, payload: any) => request<ProjectEvent>('PATCH', `/events/${eid}`, payload),
  deleteEvent: (eid: string) => request<{ ok: boolean }>('DELETE', `/events/${eid}`),
  deleteReport: (rid: string) => request<{ ok: boolean }>('DELETE', `/reports/${rid}`),

  listProjectUsers: (pid: string) => request<User[]>('GET', `/projects/${pid}/users`),

  listDailyGoals: (pid: string) => request<DailyGoal[]>('GET', `/projects/${pid}/daily_goals`),
  createDailyGoal: (pid: string, text: string) => request<DailyGoal>('POST', `/projects/${pid}/daily_goals`, { text }),
  updateDailyGoal: (pid: string, gid: string, payload: any) => request<DailyGoal>('PATCH', `/projects/${pid}/daily_goals/${gid}`, payload),
  deleteDailyGoal: (pid: string, gid: string) => request<{ ok: boolean }>('DELETE', `/projects/${pid}/daily_goals/${gid}`),

  listMinutas: (pid: string, opts: any = {}) => {
    const qs = new URLSearchParams();
    if (opts.status) qs.set('status', opts.status);
    if (opts.mine) qs.set('mine', '1');
    if (opts.q && opts.q.trim()) qs.set('q', opts.q.trim());
    if (opts.area_ids && opts.area_ids.length) qs.set('area_ids', opts.area_ids.join(','));
    if (opts.ubicacion_ids && opts.ubicacion_ids.length) qs.set('ubicacion_ids', opts.ubicacion_ids.join(','));
    if (opts.tipo && opts.tipo !== 'all') qs.set('tipo', opts.tipo);
    const suffix = qs.toString();
    return request<Minuta[]>('GET', `/projects/${pid}/minutas${suffix ? `?${suffix}` : ''}`);
  },
  createMinuta: (pid: string, payload: any) => request<Minuta>('POST', `/projects/${pid}/minutas`, payload),
  getMinuta: (mid: string) => request<Minuta>('GET', `/minutas/${mid}`),
  toggleAcuerdo: (mid: string, aid: string, estado: boolean) =>
    request<Minuta>('PATCH', `/minutas/${mid}/acuerdos/${aid}`, { estado }),
  deleteMinuta: (mid: string) => request<{ ok: boolean }>('DELETE', `/minutas/${mid}`),
  minutasBadge: (pid: string) => request<MinutaBadge>('GET', `/projects/${pid}/minutas/badge`),

  // ---- Catálogo de Conceptos ------------------------------------------------
  listPartidas: (pid: string, incluirInactivas = false) =>
    request<Partida[]>('GET', `/projects/${pid}/partidas${incluirInactivas ? '?incluir_inactivas=true' : ''}`),
  createPartida: (payload: { project_id: string; clave: string; nombre: string; orden?: number; partida_padre_id?: string | null }) =>
    request<Partida>('POST', '/partidas', payload),
  updatePartida: (id: string, payload: { clave?: string; nombre?: string; orden?: number; activo?: boolean; partida_padre_id?: string; quitar_padre?: boolean }) =>
    request<Partida>('PATCH', `/partidas/${id}`, payload),

  listConceptos: (partidaId: string, incluirInactivos = false) =>
    request<Concepto[]>('GET', `/partidas/${partidaId}/conceptos${incluirInactivos ? '?incluir_inactivos=true' : ''}`),
  createConcepto: (payload: {
    partida_id: string; clave: string; descripcion: string; unidad: string;
    cantidad: string; precio_unitario: string; meta: string; periodicidad_meta: 'SEMANAL' | 'MENSUAL';
  }) => request<Concepto>('POST', '/conceptos', payload),
  updateConcepto: (id: string, payload: Partial<{
    clave: string; descripcion: string; unidad: string; cantidad: string;
    precio_unitario: string; meta: string; periodicidad_meta: 'SEMANAL' | 'MENSUAL'; activo: boolean;
  }>) => request<Concepto>('PATCH', `/conceptos/${id}`, payload),
  conceptoBitacora: (conceptoId: string) => request<BitacoraCambio[]>('GET', `/conceptos/${conceptoId}/bitacora`),

  searchConceptos: (pid: string, opts: { q?: string; unidad?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.q && opts.q.trim()) qs.set('q', opts.q.trim());
    if (opts.unidad) qs.set('unidad', opts.unidad);
    const suffix = qs.toString();
    return request<ConceptoSearchResult[]>('GET', `/projects/${pid}/conceptos/search${suffix ? `?${suffix}` : ''}`);
  },

  // ---- Actividades Generales ----------------------------------------------
  listActividadesGenerales: (
    pid: string,
    opts: { area_id?: string; desde?: string; hasta?: string; incluir_ocultas?: boolean } = {},
  ) => {
    const qs = new URLSearchParams();
    if (opts.area_id) qs.set('area_id', opts.area_id);
    if (opts.desde) qs.set('desde', opts.desde);
    if (opts.hasta) qs.set('hasta', opts.hasta);
    if (opts.incluir_ocultas) qs.set('incluir_ocultas', 'true');
    const suffix = qs.toString();
    return request<ActividadCurada[]>('GET', `/projects/${pid}/actividades_generales${suffix ? `?${suffix}` : ''}`);
  },
  createActividadGeneral: (pid: string, payload: {
    area_id: string; nivel: NivelActividad; node_id?: string | null; texto: string;
  }) => request<ActividadCurada>('POST', `/projects/${pid}/actividades_generales`, payload),
  updateActividadGeneral: (pid: string, aid: string, payload: Partial<{
    texto_editado: string | null; oculta: boolean; orden: number;
  }>) => request<ActividadCurada>('PATCH', `/projects/${pid}/actividades_generales/${encodeURIComponent(aid)}`, payload),
  revertActividadGeneral: (pid: string, aid: string) =>
    request<ActividadCurada>('POST', `/projects/${pid}/actividades_generales/${encodeURIComponent(aid)}/revertir`),
  moveActividadGeneral: (pid: string, aid: string, payload: { nivel: NivelActividad; node_id?: string | null }) =>
    request<ActividadCurada>('POST', `/projects/${pid}/actividades_generales/${encodeURIComponent(aid)}/mover`, payload),

  // Sesión de importación sin terminar (si existe) de este usuario en este
  // proyecto — el modal la consulta al abrirse para ofrecer "Continuar" o
  // "Empezar de nuevo". null si no hay ninguna pendiente.
  importCatalogoSesionPendiente: (pid: string) =>
    request<SesionPendiente | null>('GET', `/projects/${pid}/conceptos/import/pendiente`),
  // "Empezar de nuevo": borra explícitamente la sesión anterior.
  importCatalogoDescartarSesion: (pid: string, importId: string) =>
    request<{ ok: boolean }>('DELETE', `/projects/${pid}/conceptos/import/${importId}`),

  // Paso 1 del wizard de importación: sube el archivo (multipart, mismo
  // patrón que uploadProjectTemplate — nativeMultipartUpload en nativo,
  // FormData+fetch en web).
  importCatalogoUploadSheets: async (
    pid: string,
    file: { uri: string; name: string; mimeType?: string | null },
  ): Promise<ImportSheetsResponse> => {
    if (!file || !file.uri) throw new ApiError(0, 'Archivo o URI no proporcionado');
    const isWeb = Platform.OS === 'web';
    const fileName = file.name || 'catalogo.xlsx';
    const mime = file.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const url = `${BASE}/projects/${pid}/conceptos/import/sheets`;

    if (!isWeb) {
      return nativeMultipartUpload<ImportSheetsResponse>(url, file.uri, fileName, mime, 'import_catalogo');
    }
    const form = new FormData();
    const resBlob = await fetch(file.uri);
    const blob = await resBlob.blob();
    try {
      const f = new File([blob], fileName, { type: mime });
      form.append('file', f);
    } catch {
      form.append('file', blob, fileName);
    }
    const headers = await authHeader();
    const res = await fetch(url, { method: 'POST', headers, body: form as any });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      const msg = (data && (data as any).detail) || `HTTP ${res.status}`;
      throw new ApiError(res.status, typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return data as ImportSheetsResponse;
  },
  // Paso 2 (lectura ligera, sin validar): encabezados + mapeo propuesto + muestra de filas de la hoja elegida.
  // header_row_index es opcional: si no se manda, el backend propone una fila
  // automáticamente (y de todos modos regresa preview_rows para corregirla).
  importCatalogoHeaders: (importId: string, sheet?: string, headerRowIndex?: number) => {
    const qs = new URLSearchParams();
    if (sheet) qs.set('sheet', sheet);
    if (headerRowIndex !== undefined) qs.set('header_row_index', String(headerRowIndex));
    const suffix = qs.toString();
    return request<ImportHeadersResponse>('GET', `/conceptos/import/${importId}/headers${suffix ? `?${suffix}` : ''}`);
  },
  // Paso 3: valida TODAS las filas una sola vez. Volver a llamar (ej. al
  // cambiar la convención, o "aplicar esta interpretación a todas las
  // filas ambiguas") re-valida el archivo completo desde cero.
  importCatalogoValidate: (pid: string, importId: string, payload: {
    sheet: string; header_row_index?: number; mapping: ImportMapping; partida_id: string; convencion?: ConvencionDecimal;
  }) => request<ImportValidateResult>('POST', `/projects/${pid}/conceptos/import/${importId}/validate`, payload),
  // Vista previa paginada del resultado ya validado — no procesa nada.
  importCatalogoPreview: (importId: string, opts: { page?: number; page_size?: number } = {}) => {
    const qs = new URLSearchParams();
    if (opts.page) qs.set('page', String(opts.page));
    if (opts.page_size) qs.set('page_size', String(opts.page_size));
    const suffix = qs.toString();
    return request<ImportPreviewResponse>('GET', `/conceptos/import/${importId}/preview${suffix ? `?${suffix}` : ''}`);
  },
  // 3.b — corrección en línea de una fila (o descartarla). Para número
  // ambiguo, el usuario elige una de las dos lecturas ya calculadas
  // (fila.problemas_activos[].lectura_miles / lectura_decimal), nunca
  // teclea el número de nuevo.
  importCatalogoCorrectRow: (importId: string, fila: number, payload: {
    cantidad?: string; precio_unitario?: string; unidad?: string; descartar?: boolean;
  }) => request<{ fila: ImportFila; resumen: ImportResumen }>('PUT', `/conceptos/import/${importId}/rows/${fila}`, payload),
  // Revierte una fila a su valor original de validated_rows (deshace la corrección).
  importCatalogoRevertRow: (importId: string, fila: number) =>
    request<{ fila: ImportFila; resumen: ImportResumen }>('DELETE', `/conceptos/import/${importId}/rows/${fila}`),
  // Opción por archivo: qué hacer con claves que ya existen en el proyecto.
  importCatalogoSetDuplicadosAccion: (importId: string, accion: 'omitir' | 'actualizar') =>
    request<{ duplicados_accion: string }>('PUT', `/conceptos/import/${importId}/duplicados-accion`, { accion }),
  // Paso 4: aplica el resultado ya validado + las correcciones. Sin body:
  // todo lo necesario ya quedó confirmado en la sesión de staging.
  importCatalogoCommit: (pid: string, importId: string) =>
    request<ImportCommitResult>('POST', `/projects/${pid}/conceptos/import/${importId}/commit`),

  // ---- Programa desglosado — mismo wizard, segundo destino -----------------
  programaImportSesionPendiente: (pid: string) =>
    request<ProgramaSesionPendiente | null>('GET', `/projects/${pid}/programa/import/pendiente`),
  programaImportDescartarSesion: (pid: string, importId: string) =>
    request<{ ok: boolean }>('DELETE', `/projects/${pid}/programa/import/${importId}`),
  programaImportUploadSheets: async (
    pid: string,
    file: { uri: string; name: string; mimeType?: string | null },
  ): Promise<ImportSheetsResponse> => {
    if (!file || !file.uri) throw new ApiError(0, 'Archivo o URI no proporcionado');
    const isWeb = Platform.OS === 'web';
    const fileName = file.name || 'programa.xlsx';
    const mime = file.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const url = `${BASE}/projects/${pid}/programa/import/sheets`;

    if (!isWeb) {
      return nativeMultipartUpload<ImportSheetsResponse>(url, file.uri, fileName, mime, 'import_programa');
    }
    const form = new FormData();
    const resBlob = await fetch(file.uri);
    const blob = await resBlob.blob();
    try {
      const f = new File([blob], fileName, { type: mime });
      form.append('file', f);
    } catch {
      form.append('file', blob, fileName);
    }
    const headers = await authHeader();
    const res = await fetch(url, { method: 'POST', headers, body: form as any });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      const msg = (data && (data as any).detail) || `HTTP ${res.status}`;
      throw new ApiError(res.status, typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return data as ImportSheetsResponse;
  },
  programaImportHeaders: (importId: string, sheet?: string, headerRowIndex?: number) => {
    const qs = new URLSearchParams();
    if (sheet) qs.set('sheet', sheet);
    if (headerRowIndex !== undefined) qs.set('header_row_index', String(headerRowIndex));
    const suffix = qs.toString();
    return request<ProgramaImportHeadersResponse>('GET', `/programa/import/${importId}/headers${suffix ? `?${suffix}` : ''}`);
  },
  programaImportValidate: (pid: string, importId: string, payload: {
    sheet: string; header_row_index?: number; mapping: ProgramaImportMapping; convencion?: ConvencionDecimal; etiqueta?: string;
  }) => request<ProgramaImportValidateResult>('POST', `/projects/${pid}/programa/import/${importId}/validate`, payload),
  programaImportPreview: (importId: string, opts: { page?: number; page_size?: number } = {}) => {
    const qs = new URLSearchParams();
    if (opts.page) qs.set('page', String(opts.page));
    if (opts.page_size) qs.set('page_size', String(opts.page_size));
    const suffix = qs.toString();
    return request<ProgramaImportPreviewResponse>('GET', `/programa/import/${importId}/preview${suffix ? `?${suffix}` : ''}`);
  },
  // Única corrección posible en este wizard: descartar una fila (no crea ni
  // edita conceptos, solo adjunta una distribución a uno existente).
  programaImportCorrectRow: (importId: string, fila: number, descartar: boolean) =>
    request<{ fila: ProgramaImportFila; resumen: ProgramaImportResumen }>('PUT', `/programa/import/${importId}/rows/${fila}`, { descartar }),
  programaImportCommit: (pid: string, importId: string) =>
    request<ProgramaImportCommitResult>('POST', `/projects/${pid}/programa/import/${importId}/commit`),
  programaListVersiones: (pid: string) =>
    request<ProgramaVersion[]>('GET', `/projects/${pid}/programa/versiones`),

  // "Registrar avance" es de uso diario en campo — mismo criterio offline-first
  // que createReport: si no hay señal (o el POST falla por error de red crudo),
  // se encola en avanceQueue.ts en vez de perder la captura.
  createAvance: async (payload: {
    concepto_id: string; fecha: string; cantidad_ejecutada: string;
    nodo_id?: string; reporte_id?: string; fotos?: string[]; photo_captions?: string[]; client_id?: string;
  }): Promise<RegistroAvance> => {
    const finalPayload = { ...payload, client_id: payload.client_id || generateAvanceClientId() };
    const localEcho = (createdAt: string): RegistroAvance => ({
      id: `local-${finalPayload.client_id}`,
      concepto_id: finalPayload.concepto_id,
      project_id: '',
      fecha: finalPayload.fecha,
      cantidad_ejecutada: finalPayload.cantidad_ejecutada,
      nodo_id: finalPayload.nodo_id ?? null,
      reporte_id: finalPayload.reporte_id ?? null,
      fotos: finalPayload.fotos || [],
      photo_captions: finalPayload.photo_captions || [],
      capturado_por: '',
      creado_en: createdAt,
      sincronizado: false,
    });

    if (!(await isAvanceLikelyOnline())) {
      const q = await enqueueAvance(finalPayload);
      return localEcho(q.created_at);
    }
    try {
      return await request<RegistroAvance>('POST', '/avances', finalPayload);
    } catch (e: any) {
      if (!(e instanceof ApiError)) {
        const q = await enqueueAvance(finalPayload);
        return localEcho(q.created_at);
      }
      throw e;
    }
  },
  updateAvance: (id: string, payload: Partial<{ cantidad_ejecutada: string; fotos: string[]; photo_captions: string[] }>) =>
    request<RegistroAvance>('PATCH', `/avances/${id}`, payload),
  listAvances: (pid: string, opts: { desde?: string; hasta?: string; partida_id?: string; concepto_id?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.desde) qs.set('desde', opts.desde);
    if (opts.hasta) qs.set('hasta', opts.hasta);
    if (opts.partida_id) qs.set('partida_id', opts.partida_id);
    if (opts.concepto_id) qs.set('concepto_id', opts.concepto_id);
    const suffix = qs.toString();
    return request<RegistroAvance[]>('GET', `/projects/${pid}/avances${suffix ? `?${suffix}` : ''}`);
  },
  avancesResumen: (pid: string, opts: { desde?: string; hasta?: string; partida_id?: string; concepto_id?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.desde) qs.set('desde', opts.desde);
    if (opts.hasta) qs.set('hasta', opts.hasta);
    if (opts.partida_id) qs.set('partida_id', opts.partida_id);
    if (opts.concepto_id) qs.set('concepto_id', opts.concepto_id);
    const suffix = qs.toString();
    return request<AvancesResumen>('GET', `/projects/${pid}/avances/resumen${suffix ? `?${suffix}` : ''}`);
  },

  downloadCatalogoPdf: async (pid: string): Promise<{ blob: Blob; filename: string }> => {
    const tok = await getToken();
    const res = await fetch(`${BASE}/projects/${pid}/export/catalogo.pdf`, {
      method: 'GET',
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, await _downloadErrorMessage(res, 'Error al descargar PDF'));
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename="?([^"]+)"?/);
    return { blob: await res.blob(), filename: (m && m[1]) || 'catalogo_conceptos.pdf' };
  },
};
