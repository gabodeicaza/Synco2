// SynCo v2.0 REST client.
// Reads JWT from secure storage on every call.
import { Alert, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { storage } from '@/src/utils/storage';

// [DIAG 2026-07-08] Toggle para mostrar Alert diagnóstico en dispositivo
// cuando falla un upload. Poner en `false` cuando termine la investigación.
const UPLOAD_DIAG_ALERT = true;

/**
 * BASE URL del backend (producción HTTPS).
 *
 * Configuración estándar: lee directamente `EXPO_PUBLIC_BACKEND_URL`
 * inyectada por Expo desde `frontend/.env`. Puede apuntar al endpoint
 * público con o sin `/api` final (ej. `https://apm-app.mx/api/`). Todas las
 * peticiones usan HTTPS y multipart/form-data estándar.
 */
const rawBackendUrl = (process.env.EXPO_PUBLIC_BACKEND_URL || '').replace(/\/$/, '');
export const BASE: string =
  rawBackendUrl.endsWith('/api') ? rawBackendUrl : rawBackendUrl + '/api';

// [DIAG 2026-07-08] Log visible en Metro para verificar la URL en el APK.
// Al abrir la app aparecerá en consola:
//   [SynCo][BASE] rawEnv="<valor real>" BASE="<url final>"
// Si rawEnv sale vacío o undefined → EAS/Emergent NO inyectó la .env.
try {
  // eslint-disable-next-line no-console
  console.log(
    `[SynCo][BASE] rawEnv="${process.env.EXPO_PUBLIC_BACKEND_URL ?? '<undefined>'}" BASE="${BASE}"`,
  );
} catch {
  /* noop */
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const tok = await storage.secureGet<string>('syncsite_token', '');
  return tok ? { Authorization: `Bearer ${tok}` } : {};
}

async function request<T>(method: string, path: string, body?: any): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(await authHeader()),
  };
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const msg = (data && (data as any).detail) || `HTTP ${res.status}`;
    throw new ApiError(res.status, typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return data as T;
}

function safeJson(text: string): any {
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * Normaliza el objeto que va a `FormData.append` en React Native (Android/iOS)
 * para evitar el bug "Network Request Failed" al enviar multipart/form-data.
 *
 * Problema: `expo-document-picker` y `expo-image-picker` devuelven URIs de
 * varios esquemas (`content://`, `ph://`, `assets-library://`, ruta absoluta
 * sin `file://`) que `fetch`/`FormData` de React Native no sabe resolver como
 * archivo binario y provoca `Network Request Failed` al enviar.
 *
 * FIX BULLETPROOF (2026-07-06):
 * - En NATIVO copiamos SIEMPRE a `cacheDirectory` (o `documentDirectory` como
 *   fallback), no sólo cuando el esquema no es `file://`. Motivo: algunas
 *   URIs `file://` que devuelve `expo-image-picker` en iOS/Android apuntan
 *   a rutas temporales que el SO libera antes de que `uploadAsync` termine
 *   de streamear el archivo → "Network request failed" o "file not found".
 *   Copiando primero al sandbox propio de la app garantizamos que el archivo
 *   siga disponible durante toda la subida.
 * - Verificamos con `getInfoAsync` que el archivo exista y tenga size > 0
 *   ANTES de intentar subirlo. Si no existe → error explícito.
 * - En web devolvemos la URI tal cual (blob:/data:).
 *
 * El objeto retornado incluye ESTRICTAMENTE las tres llaves requeridas por
 * el runtime de RN: `{ uri, name, type }` + `size` para diagnóstico.
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
    throw new ApiError(0, 'URI de archivo vacía');
  }

  if (Platform.OS === 'web') {
    return { uri: originalUri, name: safeName, type, size: 0 };
  }

  // === COPY-TO-CACHE (SIEMPRE) ============================================
  // Destino preferido: cacheDirectory. Si por alguna razón el cache es
  // read-only, cae a documentDirectory (más persistente pero también válido).
  const preferredRoot = FileSystem.cacheDirectory || FileSystem.documentDirectory || '';
  if (!preferredRoot) {
    throw new ApiError(0, 'No hay directorio local disponible en este dispositivo (cacheDirectory/documentDirectory vacío).');
  }
  const dest = `${preferredRoot}${cachePrefix}_${Date.now()}_${safeName}`;

  let copiedUri = dest;
  try {
    await FileSystem.copyAsync({ from: originalUri, to: dest });
  } catch (e1: any) {
    // Fallback a documentDirectory si el cache falla
    if (FileSystem.documentDirectory && preferredRoot !== FileSystem.documentDirectory) {
      const dest2 = `${FileSystem.documentDirectory}${cachePrefix}_${Date.now()}_${safeName}`;
      try {
        await FileSystem.copyAsync({ from: originalUri, to: dest2 });
        copiedUri = dest2;
      } catch (e2: any) {
        throw new ApiError(0,
          `Copia a caché falló. from="${originalUri}" ` +
          `err1="${e1?.message || e1}" err2="${e2?.message || e2}"`);
      }
    } else {
      throw new ApiError(0,
        `Copia a caché falló. from="${originalUri}" err="${e1?.message || e1}"`);
    }
  }

  // Refuerzo defensivo Android: cualquier ruta absoluta sin esquema debe
  // llevar file:// para que la stack nativa la abra correctamente.
  if (Platform.OS === 'android' && copiedUri.startsWith('/')) {
    copiedUri = 'file://' + copiedUri;
  }

  // Verificar que la copia realmente existe y tiene tamaño > 0.
  let size = 0;
  try {
    const info = await FileSystem.getInfoAsync(copiedUri, { size: true });
    if (!info.exists) {
      throw new ApiError(0, `Archivo no existe tras copia: ${copiedUri}`);
    }
    size = (info as any).size || 0;
  } catch (e: any) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, `No se pudo verificar el archivo copiado: ${e?.message || e}`);
  }
  if (size <= 0) {
    throw new ApiError(0, `El archivo copiado está vacío (0 bytes) en ${copiedUri}`);
  }

  return { uri: copiedUri, name: safeName, type, size };
}

/**
 * Ejecuta una subida multipart en React Native usando
 * `FileSystem.uploadAsync` (NO `fetch`/`FormData`).
 *
 * BULLETPROOF (2026-07-06):
 * 1. Copia SIEMPRE el archivo a `cacheDirectory` (paso realizado por
 *    `normalizeFileForFormData`) — evita URIs efímeras de `expo-image-picker`
 *    y `expo-document-picker` que el SO libera antes de terminar la subida.
 * 2. Usa exclusivamente `FileSystem.uploadAsync` con `MULTIPART`, `fieldName`
 *    y `mimeType` explícitos (paridad con lo que espera FastAPI + curl).
 * 3. Errores enriquecidos: incluyen la URL, el tamaño del archivo copiado,
 *    el error nativo original y el body del HTTP si hubo status !== 2xx.
 *    Esto es CRÍTICO para diagnosticar en dispositivos físicos, donde el
 *    consumidor de este helper mostrará el mensaje con `Alert.alert`.
 *
 * Devuelve el JSON parseado. Lanza `ApiError` con detalles ricos si falla.
 */
async function nativeMultipartUpload<T>(
  url: string,
  fileUri: string,
  fileName: string,
  mime: string,
  cachePrefix: string,
): Promise<T> {
  // Paso 1: normalizar (copy-to-cache SIEMPRE en nativo + verificación size).
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
    throw new ApiError(0, `Falló la preparación del archivo: ${err?.message || err}`);
  }

  // Paso 2: verificar que la URL sea absoluta. Si BASE terminó con "/api"
  // solo, significa que EXPO_PUBLIC_BACKEND_URL viene vacía en .env.
  if (!url || url === '/api' || url.startsWith('/api/')) {
    throw new ApiError(0,
      `Backend no configurado. Define EXPO_PUBLIC_BACKEND_URL en frontend/.env (ej. https://apm-app.mx). url="${url}"`);
  }

  const authHeaders = await authHeader();

  // Paso 3: uploadAsync (stack nativa OkHttp / NSURLSession).
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
    // Error DURANTE la subida (red rota, cert inválido, uri no legible).
    const nativeMsg = err?.message || String(err);
    // [DIAG 2026-07-08] Alert visible en dispositivo con toda la info de red.
    // Nos permite discriminar entre: (a) env vacía, (b) URL relativa,
    // (c) fallo TLS/handshake, (d) file:// mal formada, (e) timeout.
    if (UPLOAD_DIAG_ALERT) {
      try {
        Alert.alert(
          'DIAG upload',
          `native="${nativeMsg}"\n\nurl="${url}"\n\nBASE="${BASE}"\nrawEnv="${process.env.EXPO_PUBLIC_BACKEND_URL ?? '<undefined>'}"\n\nlocalUri="${normalized.uri}"\nsize=${normalized.size}\nmime="${normalized.type}"\nplatform=${Platform.OS} ${Platform.Version}`,
        );
      } catch {
        /* noop */
      }
    }
    throw new ApiError(0,
      `uploadAsync falló → ${nativeMsg}. ` +
      `url=${url} localUri=${normalized.uri} size=${normalized.size} mime=${normalized.type}`);
  }

  const { status, body } = response;
  const data = body ? safeJson(body) : null;
  if (status < 200 || status >= 300) {
    // HTTP no-2xx (413 = tamaño, 415 = mime, 401 = token, 500 = server).
    const detail = (data && (data as any).detail) || body?.slice(0, 200) || 'sin cuerpo';
    throw new ApiError(status,
      `HTTP ${status} desde el servidor. detail="${typeof detail === 'string' ? detail : JSON.stringify(detail)}" ` +
      `url=${url} size=${normalized.size} mime=${normalized.type}`);
  }
  return data as T;
}

// ---- Types (subset for hints) ---------------------------------------------
export interface User {
  id: string;
  email: string;
  name: string;
  role: 'coordinador_general' | 'jefe_proyecto' | 'sub_coordinador' | 'especialista';
  area?: string | null;
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
  /** Identificador único para descargar/borrar (sólo presente en archivos subidos). */
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
  // Rutas absolutas backend a plantillas base institucionales (null si no hay)
  template_pdf?: string | null;
  template_docx?: string | null;
  template_pptx?: string | null;
  template_map?: string | null;
  general_data_images?: string[];
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
  // Coordenadas objetivo (sólo cuando es hoja con measurement_type = 'coord_latlon')
  target_lat?: number | null;
  target_lon?: number | null;
  target_elev?: number | null;
  // Meta/objetivo numérico para gráficas circulares de avance.
  meta?: number | null;
  // Avance acumulado persistido (MAX ultima_lectura). Inyectado por backend.
  avance_actual?: number | null;
  // Metadatos dinámicos (importación masiva Excel/CSV). Llaves arbitrarias.
  metadata?: Record<string, any> | null;
  // Portada institucional del nodo (data URL base64). Se usa como fondo de la
  // portadilla dinámica del PDF exportado.
  cover_image?: string | null;
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
  area_id?: string | null;
  area_name?: string | null;
  notes?: string | null;
  avance?: string | null;
  observaciones?: string | null;
  incidencias?: string | null;
  severidad?: 'informativo' | 'importante' | 'urgente';
  contratista?: string | null;
  personnel: string[];
  equipment: string[];
  images: string[];
  /** Descripciones individuales por foto (foto 1 → [0], foto 2 → [1]). */
  photo_captions?: string[];
  files: { filename: string; mime: string; data_base64: string }[];
  primera_lectura?: number | null;
  ultima_lectura?: number | null;
  unidad?: string | null;
  captured_by: string;
  captured_by_name: string;
  created_at: string;
}

export interface FeedItem {
  id: string;
  project_id: string;
  node_id: string;
  node_path_names: string[];
  measurement_type: string;
  measurement_value: Record<string, any>;
  area_id?: string | null;
  area_name?: string | null;
  area_color?: string | null;
  avance?: string | null;
  contratista?: string | null;
  personnel: string[];
  equipment: string[];
  captured_by: string;
  captured_by_name: string;
  is_mine: boolean;
  images_count: number;
  thumbnail_base64?: string | null;
  created_at: string;
  // Optional report-detail fields surfaced by the feed/list endpoints.
  notes?: string | null;
  observaciones?: string | null;
  actividades?: string | null;
  comment?: string | null;
}

export interface FeedResponse {
  range: string;
  stats: { total: number; mine: number; others: number };
  reports: FeedItem[];
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
}

// ---- Hub de Minutas ---------------------------------------------------------
export interface Acuerdo {
  id: string;
  descripcion: string;
  responsable_id: string;
  responsable_name: string;
  responsable_role?: string | null;
  fecha_limite: string; // "YYYY-MM-DD"
  estado: boolean;
  completed_at?: string | null;
  completed_by?: string | null;
  completed_by_name?: string | null;
}

export interface Minuta {
  id: string;
  project_id: string;
  titulo: string;
  descripcion: string;
  area_ids: string[];
  area_names: string[];
  involved_ids?: string[];
  involved_names?: string[];
  fecha_reunion: string;
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
  // Disciplina/área asociada (universal: refleja la jerarquía de colores)
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

// ---- API client -----------------------------------------------------------
export const api = {
  // Auth
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>('POST', '/auth/login', { email, password }),
  me: () => request<User>('GET', '/auth/me'),

  // Admin — Coordinadores Generales (sólo accesible por coord_general)
  listCoordinators: () => request<User[]>('GET', '/admin/coordinators'),
  createCoordinator: (body: { name: string; email: string; password: string }) =>
    request<User>('POST', '/admin/coordinators', body),

  // Mensajes — conteo de no leídos por proyecto.
  unreadCounts: () => request<Record<string, number>>('GET', '/messages/unread_counts'),
  markProjectMessagesSeen: (pid: string) =>
    request<{ ok: boolean; last_read_at: string }>('POST', `/projects/${pid}/messages/seen`, {}),

  // Push notifications
  registerPushToken: (token: string, platform?: string) =>
    request<{ ok: boolean; count: number }>('POST', '/users/push-token', { token, platform }),
  unregisterPushToken: (token: string) =>
    request<{ ok: boolean }>('DELETE', '/users/push-token', { token }),

  // Invitations
  invitePreview: (token: string) =>
    request<{ project_name: string; email: string; name: string; role: string; puesto?: string | null; area_name?: string | null }>(
      'GET', `/invitations/by-token/${encodeURIComponent(token)}`,
    ),
  acceptInvite: (token: string, password: string) =>
    request<{ token: string; user: User }>('POST', '/invitations/accept', { token, password }),

  // Projects
  listProjects: () => request<Project[]>('GET', '/projects'),
  getProject: (pid: string) => request<Project>('GET', `/projects/${pid}`),
  createProject: (body: {
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
  }) => request<Project>('POST', '/projects', body),
  updateProject: (pid: string, body: any) => request<Project>('PUT', `/projects/${pid}`, body),
  setProjectReferenceFiles: (pid: string, files: ReferenceFile[]) =>
    request<{ ok: boolean; reference_files: ReferenceFile[] }>(
      'PUT', `/projects/${pid}/reference-files`, { reference_files: files }
    ),
  archiveProject: (pid: string) => request<{ ok: boolean; archived: boolean }>('DELETE', `/projects/${pid}`),

  // Nodes
  listNodes: (pid: string) => request<LocationNode[]>('GET', `/projects/${pid}/nodes`),
  getTree: (pid: string) => request<LocationNodeTree[]>('GET', `/projects/${pid}/nodes/tree`),
  createNode: (pid: string, body: {
    project_id: string;
    parent_id?: string | null;
    name: string;
    order?: number;
    is_leaf?: boolean;
    measurement_type?: 'coord_latlon' | 'cadenamiento' | 'eje' | 'nivel' | null;
    target_lat?: number | null;
    target_lon?: number | null;
    target_elev?: number | null;
    meta?: number | null;
  }) => request<LocationNode>('POST', `/projects/${pid}/nodes`, body),
  updateNode: (nid: string, body: {
    name?: string;
    order?: number;
    is_leaf?: boolean;
    measurement_type?: 'coord_latlon' | 'cadenamiento' | 'eje' | 'nivel' | null;
    target_lat?: number | null;
    target_lon?: number | null;
    target_elev?: number | null;
    meta?: number | null;
  }) => request<LocationNode>('PATCH', `/nodes/${nid}`, body),
  deleteNode: (nid: string) => request<{ ok: boolean; deleted_count: number }>('DELETE', `/nodes/${nid}`),

  // ── Portadilla institucional del nodo (cover_image) ─────────────────────
  // Sube una imagen JPG/PNG/WebP (máx 8MB) que se usará como fondo de la
  // portadilla dinámica del PDF exportado. La imagen aplica al nodo y a todos
  // sus descendientes (a menos que un descendiente tenga su propia portada).
  uploadNodeCover: async (
    pid: string,
    nid: string,
    file: { uri: string; name: string; mimeType?: string | null },
  ): Promise<LocationNode> => {
    const isWeb = typeof window !== 'undefined' && typeof (globalThis as any).Blob !== 'undefined';
    const fileName = file.name || 'cover.jpg';
    const mime = file.mimeType || 'image/jpeg';
    const url = `${BASE}/projects/${pid}/nodes/${nid}/cover`;

    // React Native (Android/iOS): usamos FileSystem.uploadAsync (multipart nativo)
    // para evitar el bug crónico "Network Request Failed" de fetch+FormData en Android.
    if (!isWeb) {
      return nativeMultipartUpload<LocationNode>(url, file.uri, fileName, mime, 'cover');
    }

    // Web: mantenemos FormData con File/Blob (uploadAsync no existe en web).
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
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: form as any,
    });
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

  // Bulk upload de nodos desde Excel/CSV. En nativo usa FileSystem.uploadAsync
  // (multipart nativo estable); en web usa FormData.
  bulkUploadNodes: async (
    pid: string,
    file: { uri: string; name: string; mimeType?: string | null },
  ): Promise<{
    total_rows: number;
    created: number;
    updated: number;
    skipped: number;
    errors: { row: number; error: string }[];
    name_column: string;
    parent_column: string | null;
    metadata_columns: string[];
  }> => {
    const isWeb = typeof window !== 'undefined' && typeof (globalThis as any).Blob !== 'undefined';
    const fileName = file.name || 'nodos.xlsx';
    const mime =
      file.mimeType ||
      (fileName.toLowerCase().endsWith('.csv')
        ? 'text/csv'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const url = `${BASE}/projects/${pid}/nodes/bulk-upload`;

    if (!isWeb) {
      return nativeMultipartUpload<any>(url, file.uri, fileName, mime, 'bulknodes');
    }

    // Web: DocumentPicker devuelve blob: URL o data URL → materializamos.
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
    const res = await fetch(url, {
      method: 'POST',
      headers, // sin Content-Type: fetch añade boundary automático.
      body: form as any,
    });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      const msg = (data && (data as any).detail) || `HTTP ${res.status}`;
      throw new ApiError(res.status, typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return data as any;
  },

  // URL absoluta para descargar la plantilla Excel de nodos (incluye token en header en native).
  bulkUploadNodesTemplateUrl: (pid: string) => `${BASE}/projects/${pid}/nodes/bulk-upload/template`,

  /**
   * Sube un archivo genérico al proyecto (multipart/form-data).
   * - Si es Excel/CSV → ejecuta carga masiva de nodos y devuelve `summary`.
   * - Si es PDF/Word → lo guarda y devuelve la metadata del archivo (con file_id + url descargable).
   */
  uploadProjectFile: async (
    pid: string,
    file: { uri: string; name: string; mimeType?: string | null },
  ): Promise<{
    type: 'nodes_bulk' | 'stored';
    filename: string;
    mime_type?: string;
    size?: number;
    summary?: {
      total_rows: number;
      created: number;
      updated: number;
      skipped: number;
      errors: { row: number; error: string }[];
    };
    file?: ReferenceFile;
  }> => {
    const isWeb = typeof window !== 'undefined' && typeof (globalThis as any).Blob !== 'undefined';
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
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: form as any,
    });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      const msg = (data && (data as any).detail) || `HTTP ${res.status}`;
      throw new ApiError(res.status, typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return data as any;
  },

  /** Elimina un archivo del proyecto por su file_id (sólo Coord/Jefe). */
  deleteProjectFile: (pid: string, fileId: string) =>
    request<{ ok: boolean; file_id: string }>('DELETE', `/projects/${pid}/files/${fileId}`),

  // ── Plantillas de exportación (PDF / DOCX / PPTX / MAP) ────────────────
  uploadProjectTemplate: async (
    pid: string,
    kind: 'pdf' | 'docx' | 'pptx' | 'map',
    file: { uri: string; name: string; mimeType?: string | null },
  ): Promise<Project> => {
    const isWeb = typeof window !== 'undefined' && typeof (globalThis as any).Blob !== 'undefined';
    const fileName = file.name || `template.${kind === 'map' ? 'jpg' : kind}`;
    const mime =
      file.mimeType ||
      (kind === 'pdf'
        ? 'application/pdf'
        : kind === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : kind === 'pptx'
        ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        : 'image/jpeg');
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
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: form as any,
    });
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

  // ==========================================================================
  // Datos Generales (ex-Mapa) — array de imágenes base64 por proyecto.
  // Se emiten como slides/páginas dedicadas al inicio de PPTX/PDF.
  // ==========================================================================
  addGeneralDataImage: (pid: string, imageDataUrl: string) =>
    request<Project>('POST', `/projects/${pid}/general-data-images`, {
      image: imageDataUrl,
    }),

  /**
   * Sube UNA imagen a Datos Generales usando **multipart/form-data** (path
   * recomendado en móvil). Evita el bug "Network Request Failed" en Android
   * y el bloqueo de memoria en iPhone al enviar strings base64 gigantes.
   */
  addGeneralDataImageFile: async (
    pid: string,
    file: { uri: string; name?: string; mimeType?: string | null },
  ): Promise<Project> => {
    const isWeb = typeof window !== 'undefined' && typeof (globalThis as any).Blob !== 'undefined';
    const fileName = file.name || `gd_${Date.now()}.jpg`;
    const mime = file.mimeType || 'image/jpeg';
    const url = `${BASE}/projects/${pid}/general-data-images/upload-file`;
    if (!isWeb) {
      return nativeMultipartUpload<Project>(url, file.uri, fileName, mime, 'gd');
    }
    // Web: FormData directo con Blob.
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

  /**
   * Sube UNA foto de reporte vía **multipart/form-data** y devuelve el
   * `data_url` base64 que se usa dentro del array `images` en `createReport`.
   *
   * ¿Por qué preferir esto sobre mandar el base64 dentro del JSON de
   * `POST /reports`?
   *   • Android RN sufre "Network Request Failed" con JSONs > ~5-10 MB.
   *   • iOS congela la UI al serializar strings tan grandes en JS.
   *   • Multipart usa la stack nativa (OkHttp/NSURLSession) y libera el bridge.
   */
  uploadReportPhoto: async (file: {
    uri: string;
    name?: string;
    mimeType?: string | null;
  }): Promise<{ data_url: string }> => {
    const isWeb = typeof window !== 'undefined' && typeof (globalThis as any).Blob !== 'undefined';
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
    request<Project>('PUT', `/projects/${pid}/general-data-images`, {
      images,
    }),
  deleteGeneralDataImage: (pid: string, index: number) =>
    request<Project>('DELETE', `/projects/${pid}/general-data-images/${index}`),


  /** URL absoluta para descargar un archivo del proyecto (requiere Bearer token en header). */
  projectFileUrl: (pid: string, fileId: string) => `${BASE}/projects/${pid}/files/${fileId}`,

  // Descarga la plantilla y devuelve un Blob (web) o la guarda en cacheDirectory (native).
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

  // Descarga un archivo del proyecto (con Bearer token). Devuelve Blob + filename.
  downloadProjectFile: async (
    pid: string,
    fileId: string,
    fallbackFilename?: string,
  ): Promise<{ blob: Blob; filename: string; mime?: string }> => {
    const headers = await authHeader();
    const url = `${BASE}/projects/${pid}/files/${fileId}`;
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
      throw new ApiError(res.status, `HTTP ${res.status} al descargar el archivo`);
    }
    // Intentar extraer filename del Content-Disposition.
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

  // Areas
  listAreas: (pid: string) => request<Area[]>('GET', `/projects/${pid}/areas`),
  createArea: (pid: string, body: { project_id: string; name: string; color?: string }) =>
    request<Area>('POST', `/projects/${pid}/areas`, body),
  deleteArea: (aid: string) => request<{ ok: boolean }>('DELETE', `/areas/${aid}`),

  // Catálogos dinámicos del Proyecto (sólo Coordinador General)
  setProjectCatalogos: (pid: string, body: {
    contratistas_list?: string[];
    contratos_list?: string[];
    categorias_personal?: string[];
    categorias_equipo?: string[];
  }) => request<Project>('PUT', `/projects/${pid}/catalogos`, body),

  // Invitations (admin)
  listInvitations: (pid: string) => request<Invitation[]>('GET', `/projects/${pid}/invitations`),
  createInvitation: (pid: string, body: {
    project_id: string;
    email: string;
    name: string;
    role: 'sub_coordinador' | 'especialista';
    scope_node_id?: string | null;
    area_id?: string | null;
    puesto?: string | null;
    scope_node_ids?: string[];
  }) => request<Invitation>('POST', `/projects/${pid}/invitations`, body),
  revokeInvitation: (iid: string) => request<{ ok: boolean }>('DELETE', `/invitations/${iid}`),

  // Reports
  createReport: (body: {
    project_id: string;
    node_id: string;
    measurement_value: Record<string, any>;
    area_id?: string | null;
    notes?: string | null;
    avance?: string | null;
    observaciones?: string | null;
    incidencias?: string | null;
    severidad?: 'informativo' | 'importante' | 'urgente';
    contratista?: string | null;
    personnel?: string[];
    equipment?: string[];
    images?: string[];
    /**
     * Descripciones individuales por foto (foto 1 → [0], foto 2 → [1]).
     * Sólo las 2 primeras se exportan a PPTX/PDF (tope ejecutivo).
     */
    photo_captions?: string[];
    files?: { filename: string; mime: string; data_base64: string }[];
    primera_lectura?: number | null;
    ultima_lectura?: number | null;
    unidad?: string | null;
  }) => request<Report>('POST', '/reports', body),
  /**
   * Edita únicamente las descripciones individuales por foto de un reporte
   * existente. Permitido para el autor original y para roles supervisores
   * (Coordinador General / Jefe de Proyecto).
   */
  updateReportCaptions: (rid: string, photo_captions: string[]) =>
    request<Report>('PATCH', `/reports/${rid}/captions`, { photo_captions }),
  nodeHistory: (pid: string, nid: string) =>
    request<{
      node_id: string;
      measurement_type: string | null;
      has_previous: boolean;
      last_report: null | {
        id: string;
        created_at: string;
        captured_by_name: string;
        measurement_value: Record<string, any>;
        primera_lectura: number | null;
        ultima_lectura: number | null;
        avance: string | null;
        notes: string | null;
      };
    }>('GET', `/projects/${pid}/nodes/${nid}/history`),
  listReports: (pid: string) => request<Report[]>('GET', `/projects/${pid}/reports`),
  feed: (pid: string, range: 'today' | 'week' | 'month' | 'all' = 'today', limit = 50) =>
    request<FeedResponse>('GET', `/projects/${pid}/reports/feed?range=${range}&limit=${limit}`),
  getReport: (rid: string) => request<Report>('GET', `/reports/${rid}`),

  // ---- AI Summary (Resumen Ejecutivo con IA) ------------------------------
  aiSummary: (pid: string) =>
    request<{
      summary: string;
      reports_count: number;
      period_hours: number;
      generated_at: string;
    }>('POST', `/projects/${pid}/ai_summary`),

  // ---- Announcements (Noticias) -------------------------------------------
  listAnnouncements: (pid: string) =>
    request<Announcement[]>('GET', `/projects/${pid}/announcements`),
  createAnnouncement: (pid: string, payload: { title: string; body: string; pinned?: boolean; jerarquia?: 'urgente' | 'importante' | 'informativo' | null; severidad?: 'urgente' | 'importante' | 'informativo' | null; audiencia?: string | null; node_id?: string | null }) =>
    request<Announcement>('POST', `/projects/${pid}/announcements`, payload),
  updateAnnouncement: (aid: string, payload: { title?: string; body?: string; pinned?: boolean; jerarquia?: 'urgente' | 'importante' | 'informativo' | null; severidad?: 'urgente' | 'importante' | 'informativo' | null; audiencia?: string | null; node_id?: string | null }) =>
    request<Announcement>('PATCH', `/announcements/${aid}`, payload),
  deleteAnnouncement: (aid: string) =>
    request<{ ok: boolean }>('DELETE', `/announcements/${aid}`),

  // ---- Messages (chat) ----------------------------------------------------
  listMessages: (pid: string, params: { since?: string; before?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.since) qs.set('since', params.since);
    if (params.before) qs.set('before', params.before);
    qs.set('limit', String(params.limit ?? 100));
    return request<Message[]>('GET', `/projects/${pid}/messages?${qs.toString()}`);
  },
  sendMessage: (pid: string, text: string) =>
    request<Message>('POST', `/projects/${pid}/messages`, { text }),
  deleteMessage: (mid: string) =>
    request<{ ok: boolean }>('DELETE', `/messages/${mid}`),

  // ---- Channels (canales: General / Áreas / Directos) --------------------
  listChannels: (pid: string) =>
    request<Channel[]>('GET', `/projects/${pid}/channels`),
  getChannel: (cid: string) =>
    request<Channel>('GET', `/channels/${cid}`),
  listChannelMessages: (cid: string, params: { since?: string; before?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.since) qs.set('since', params.since);
    if (params.before) qs.set('before', params.before);
    qs.set('limit', String(params.limit ?? 100));
    return request<Message[]>('GET', `/channels/${cid}/messages?${qs.toString()}`);
  },
  sendChannelMessage: (cid: string, text: string) =>
    request<Message>('POST', `/channels/${cid}/messages`, { text }),
  createDirectChannel: (pid: string, target_user_id: string) =>
    request<Channel>('POST', `/projects/${pid}/channels/direct`, { target_user_id }),
  listProjectMembers: (pid: string) =>
    request<User[]>('GET', `/projects/${pid}/members`),

  // ---- Export ------------------------------------------------------------
  /** Devuelve URL absoluta para descargar el Excel (Coord). El backend exige Bearer token. */
  exportReportsXlsxUrl: (pid: string) => `${BASE}/projects/${pid}/export/reports.xlsx`,
  /** Descarga el Excel autenticado. En Web abre el archivo (download), en native devuelve Blob. */
  downloadReportsXlsx: async (pid: string): Promise<{ blob: Blob; filename: string }> => {
    const tok = await storage.secureGet<string>('syncsite_token', '');
    const res = await fetch(`${BASE}/projects/${pid}/export/reports.xlsx`, {
      method: 'GET',
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    });
    if (!res.ok) {
      const txt = await res.text();
      let msg = `HTTP ${res.status}`;
      try { const j = JSON.parse(txt); msg = j?.detail || msg; } catch {}
      throw new ApiError(res.status, msg);
    }
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename="?([^"]+)"?/);
    const filename = (m && m[1]) || `synco_reportes.xlsx`;
    const blob = await res.blob();
    return { blob, filename };
  },

  /** Motor PDF unificado. period: today | yesterday | week | month */
  downloadReportsPdf: async (
    pid: string,
    period: 'today' | 'yesterday' | 'week' | 'month',
    opts?: { area_id?: string | null; scope?: 'mine' | 'area' | null },
  ): Promise<{ blob: Blob; filename: string }> => {
    const tok = await storage.secureGet<string>('syncsite_token', '');
    const qs = new URLSearchParams({ period });
    if (opts?.area_id) qs.set('area_id', opts.area_id);
    if (opts?.scope) qs.set('scope', opts.scope);
    const res = await fetch(`${BASE}/projects/${pid}/export/reports.pdf?${qs.toString()}`, {
      method: 'GET',
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    });
    if (!res.ok) {
      const txt = await res.text();
      let msg = `HTTP ${res.status}`;
      try { const j = JSON.parse(txt); msg = j?.detail || msg; } catch {}
      throw new ApiError(res.status, msg);
    }
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename="?([^"]+)"?/);
    const filename = (m && m[1]) || `reporte_${period}.pdf`;
    const blob = await res.blob();
    return { blob, filename };
  },

  /** Exportar a Word (.docx). period: today | yesterday | week | month */
  downloadReportsDocx: async (
    pid: string,
    period: 'today' | 'yesterday' | 'week' | 'month',
    opts?: { area_id?: string | null; scope?: 'mine' | 'area' | null },
  ): Promise<{ blob: Blob; filename: string }> => {
    const tok = await storage.secureGet<string>('syncsite_token', '');
    const qs = new URLSearchParams({ period });
    if (opts?.area_id) qs.set('area_id', opts.area_id);
    if (opts?.scope) qs.set('scope', opts.scope);
    const res = await fetch(`${BASE}/projects/${pid}/export/reports.docx?${qs.toString()}`, {
      method: 'GET',
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    });
    if (!res.ok) {
      const txt = await res.text();
      let msg = `HTTP ${res.status}`;
      try { const j = JSON.parse(txt); msg = j?.detail || msg; } catch {}
      throw new ApiError(res.status, msg);
    }
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename="?([^"]+)"?/);
    const filename = (m && m[1]) || `reporte_${period}.docx`;
    const blob = await res.blob();
    return { blob, filename };
  },

  /** Exportar a PowerPoint (.pptx). period: today | yesterday | week | month */
  downloadReportsPptx: async (
    pid: string,
    period: 'today' | 'yesterday' | 'week' | 'month',
    opts?: { area_id?: string | null; scope?: 'mine' | 'area' | null },
  ): Promise<{ blob: Blob; filename: string }> => {
    const tok = await storage.secureGet<string>('syncsite_token', '');
    const qs = new URLSearchParams({ period });
    if (opts?.area_id) qs.set('area_id', opts.area_id);
    if (opts?.scope) qs.set('scope', opts.scope);
    const res = await fetch(`${BASE}/projects/${pid}/export/reports.pptx?${qs.toString()}`, {
      method: 'GET',
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    });
    if (!res.ok) {
      const txt = await res.text();
      let msg = `HTTP ${res.status}`;
      try { const j = JSON.parse(txt); msg = j?.detail || msg; } catch {}
      throw new ApiError(res.status, msg);
    }
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename="?([^"]+)"?/);
    const filename = (m && m[1]) || `reporte_${period}.pptx`;
    const blob = await res.blob();
    return { blob, filename };
  },

  // ---- Events (Calendario) ------------------------------------------------
  listEvents: (pid: string, range: 'upcoming' | 'past' | 'all' = 'upcoming', limit = 500) =>
    request<ProjectEvent[]>('GET', `/projects/${pid}/events?range=${range}&limit=${limit}`),
  createEvent: (pid: string, payload: {
    title: string; start_at: string; end_at?: string | null;
    description?: string | null; location?: string | null;
    area_id?: string | null;
  }) => request<ProjectEvent>('POST', `/projects/${pid}/events`, payload),
  updateEvent: (eid: string, payload: Partial<{
    title: string; start_at: string; end_at: string | null;
    description: string | null; location: string | null;
    area_id: string | null;
  }>) => request<ProjectEvent>('PATCH', `/events/${eid}`, payload),
  deleteEvent: (eid: string) =>
    request<{ ok: boolean }>('DELETE', `/events/${eid}`),
  deleteReport: (rid: string) => request<{ ok: boolean }>('DELETE', `/reports/${rid}`),

  // Users (admin)
  listProjectUsers: (pid: string) => request<User[]>('GET', `/projects/${pid}/users`),

  // ---- Daily Goals (Metas del día) ----------------------------------------
  listDailyGoals: (pid: string) =>
    request<DailyGoal[]>('GET', `/projects/${pid}/daily_goals`),
  createDailyGoal: (pid: string, text: string) =>
    request<DailyGoal>('POST', `/projects/${pid}/daily_goals`, { text }),
  updateDailyGoal: (pid: string, gid: string, payload: { text?: string; is_completed?: boolean }) =>
    request<DailyGoal>('PATCH', `/projects/${pid}/daily_goals/${gid}`, payload),
  deleteDailyGoal: (pid: string, gid: string) =>
    request<{ ok: boolean }>('DELETE', `/projects/${pid}/daily_goals/${gid}`),

  // ---- Minutas (Hub de acuerdos) -----------------------------------------
  listMinutas: (
    pid: string,
    opts: { status?: 'all' | 'pending' | 'done'; mine?: boolean; q?: string; area_ids?: string[] } = {},
  ) => {
    const qs = new URLSearchParams();
    if (opts.status) qs.set('status', opts.status);
    if (opts.mine) qs.set('mine', '1');
    if (opts.q && opts.q.trim()) qs.set('q', opts.q.trim());
    if (opts.area_ids && opts.area_ids.length) qs.set('area_ids', opts.area_ids.join(','));
    const suffix = qs.toString();
    return request<Minuta[]>('GET', `/projects/${pid}/minutas${suffix ? `?${suffix}` : ''}`);
  },
  createMinuta: (
    pid: string,
    payload: {
      titulo: string;
      descripcion?: string;
      area_ids?: string[];
      involved_ids?: string[];
      fecha_reunion?: string;
      acuerdos: { descripcion: string; responsable_id: string; fecha_limite: string }[];
    },
  ) => request<Minuta>('POST', `/projects/${pid}/minutas`, payload),
  getMinuta: (mid: string) => request<Minuta>('GET', `/minutas/${mid}`),
  toggleAcuerdo: (mid: string, aid: string, estado: boolean) =>
    request<Minuta>('PATCH', `/minutas/${mid}/acuerdos/${aid}`, { estado }),
  deleteMinuta: (mid: string) => request<{ ok: boolean }>('DELETE', `/minutas/${mid}`),
  minutasBadge: (pid: string) => request<MinutaBadge>('GET', `/projects/${pid}/minutas/badge`),
};
