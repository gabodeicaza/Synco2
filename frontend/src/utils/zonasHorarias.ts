// Zonas horarias que el Coordinador puede asignar a un proyecto (IANA). El servidor
// valida el nombre y calcula el desfase actual; la app no depende de Intl.
export const ZONAS_HORARIAS_MX: { id: string; etiqueta: string }[] = [
  { id: 'America/Mexico_City', etiqueta: 'Centro de México (CDMX)' },
  { id: 'America/Cancun', etiqueta: 'Quintana Roo (Cancún)' },
  { id: 'America/Chihuahua', etiqueta: 'Chihuahua' },
  { id: 'America/Mazatlan', etiqueta: 'Pacífico (Mazatlán)' },
  { id: 'America/Hermosillo', etiqueta: 'Sonora (Hermosillo)' },
  { id: 'America/Tijuana', etiqueta: 'Baja California (Tijuana)' },
];
