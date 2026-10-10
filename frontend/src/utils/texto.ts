// Utilidades de texto para la interfaz.

/** Une partes de metadatos con un separador ("A · B · C"), omitiendo las vacías. */
export function unir(partes: ReadonlyArray<string | number | null | undefined | false>, separador = ' · '): string {
  return partes
    .filter((p): p is string | number => p !== null && p !== undefined && p !== false && String(p).trim() !== '')
    .map((p) => String(p).trim())
    .join(separador);
}

/** Como `unir`, pero devuelve `vacio` (por defecto "—") si no queda ninguna parte. */
export function unirOVacio(
  partes: ReadonlyArray<string | number | null | undefined | false>,
  vacio = '—',
  separador = ' · ',
): string {
  return unir(partes, separador) || vacio;
}
