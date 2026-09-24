// Validación de los datos de una invitación / miembro del equipo (X-03, K-04). Devuelve
// el mensaje de cada campo con problema; un objeto vacío significa que todo está bien.
import { t } from '@/src/i18n';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validarIdentidad(datos: { name: string; email: string }): { name?: string; email?: string } {
  const errores: { name?: string; email?: string } = {};
  if (!datos.name.trim()) errores.name = t('invitaciones.nombreObligatorio');
  const correo = datos.email.trim();
  if (!correo) errores.email = t('invitaciones.correoObligatorio');
  else if (!EMAIL_RE.test(correo)) errores.email = t('invitaciones.correoInvalido');
  return errores;
}

/** El área es obligatoria solo para el rol de especialista. */
export function validarArea(esEspecialista: boolean, areaId: string | null | undefined): string | undefined {
  return esEspecialista && !areaId ? t('invitaciones.areaObligatoria') : undefined;
}
