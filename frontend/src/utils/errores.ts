// Convierte el `detail` de un error del backend en un texto legible en es-MX.
// FastAPI/Pydantic responde 422 con una lista `[{loc:[body, precio_unitario],
// msg:"Field required", type:"missing"}]`; mostrarla cruda enseñaba nombres
// internos como `precio_unitario`. Aquí se traducen al nombre que ve el usuario.
import { t } from '@/src/i18n';

// Nombres de campo del backend -> etiqueta que ve el usuario. Lo que no esté
// aquí se humaniza (snake_case -> "Snake case"), pero los campos con acento o
// nombre propio se declaran para que salgan bien escritos.
export const ETIQUETAS_CAMPO: Record<string, string> = {
  precio_unitario: 'Precio unitario',
  cantidad: 'Cantidad',
  clave: 'Clave',
  descripcion: 'Descripción',
  unidad: 'Unidad',
  nombre: 'Nombre',
  titulo: 'Título',
  contenido: 'Contenido',
  ubicacion: 'Ubicación',
  fecha: 'Fecha',
  fecha_inicio: 'Fecha de inicio',
  fecha_fin: 'Fecha de fin',
  fecha_limite: 'Fecha límite',
  hora_inicio: 'Hora de inicio',
  hora_fin: 'Hora de fin',
  responsable: 'Responsable',
  correo: 'Correo electrónico',
  email: 'Correo electrónico',
  password: 'Contraseña',
  contrasena: 'Contraseña',
  new_password: 'Contraseña nueva',
  old_password: 'Contraseña actual',
  telefono: 'Teléfono',
  cliente: 'Cliente',
  color: 'Color',
  monto: 'Monto',
  importe: 'Importe',
  concepto: 'Concepto',
  partida: 'Partida',
  motivo: 'Motivo',
  observaciones: 'Observaciones',
};

const MENSAJES_PYDANTIC: Array<[RegExp, () => string]> = [
  [/field required|missing/i, () => t('errores.campoObligatorio')],
  [/valid (number|decimal|float)|not a valid (float|decimal)/i, () => t('errores.numeroInvalido')],
  [/valid integer|not a valid integer/i, () => t('errores.enteroInvalido')],
  [/valid email|not a valid email/i, () => t('errores.correoInvalido')],
  [/valid (date|datetime)|invalid date/i, () => t('errores.fechaInvalida')],
  [/at least \d+ character|too short/i, () => t('errores.muyCorto')],
  [/at most \d+ character|too long/i, () => t('errores.muyLargo')],
  [/greater than|at least|ge=|must be >=/i, () => t('errores.menorAlMinimo')],
  [/less than|at most|le=|must be <=/i, () => t('errores.mayorAlMaximo')],
];

export function etiquetaDeCampo(campo: string): string {
  const conocido = ETIQUETAS_CAMPO[campo];
  if (conocido) return conocido;
  const limpio = campo.replace(/_/g, ' ').trim();
  return limpio ? limpio.charAt(0).toUpperCase() + limpio.slice(1) : campo;
}

function traducirMensaje(msg: string, tipo?: string): string {
  const base = `${tipo ?? ''} ${msg}`;
  for (const [patron, texto] of MENSAJES_PYDANTIC) if (patron.test(base)) return texto();
  return t('errores.valorInvalido');
}

/** `detail` del backend (string, lista de Pydantic u otra cosa) -> texto es-MX. */
export function mensajeDeError(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const partes = detail
      .map((e: any) => {
        if (!e || typeof e !== 'object') return typeof e === 'string' ? e : '';
        const loc: unknown[] = Array.isArray(e.loc) ? e.loc : [];
        // Ignora "body"/"query" y los índices de lista al elegir el nombre.
        const campo = [...loc].reverse().find((x) => typeof x === 'string' && !['body', 'query', 'path'].includes(x));
        const texto = traducirMensaje(String(e.msg ?? ''), e.type);
        return campo ? `${etiquetaDeCampo(String(campo))}: ${texto}` : texto;
      })
      .filter(Boolean);
    if (partes.length) return partes.join('. ');
    return t('errores.solicitudInvalida');
  }
  if (detail && typeof detail === 'object') return t('errores.solicitudInvalida');
  return t('errores.solicitudInvalida');
}

/** ¿El fallo es de red (sin internet / servidor inalcanzable) y no una respuesta del backend? */
export function esErrorDeRed(e: unknown): boolean {
  const err = e as any;
  if (err?.status === 0) return true;
  if (typeof err?.status === 'number' && err.status > 0) return false;
  const msg = String(err?.message ?? '');
  return err instanceof TypeError || /network request failed|failed to fetch|network error|load failed/i.test(msg);
}
