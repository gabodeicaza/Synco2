// Catálogo FIJO de disciplinas para "Seguimiento a Estudios y Análisis"
// (módulo Presentación) — 10 disciplinas, global y por Estación. Espejo de
// ESTUDIO_DISCIPLINA_AVANCE_KEYS/ESTUDIO_DISCIPLINA_AVANCE_LABEL en
// backend/server.py: agregar una disciplina requiere declararla en AMBOS
// lados. Distinto del catálogo libre de EstudiosProyectoScreen.tsx
// (EstudioActividad/EstudioDisciplina, 4 valores atados a bitácora) — ese
// es texto libre por proyecto, este es un historial editable de % avance
// con clave fija por (proyecto, estación|global, disciplina).
export type EstudioDisciplinaAvanceKey =
  | 'topografia'
  | 'vuelo_lidar'
  | 'msu_mecanica_suelos'
  | 'salvamento_arqueologico'
  | 'urbano'
  | 'ambiental'
  | 'geofisica'
  | 'hidrologico'
  | 'riesgos'
  | 'instalaciones_municipales';

export const ESTUDIO_DISCIPLINA_AVANCE_KEYS: EstudioDisciplinaAvanceKey[] = [
  'topografia',
  'vuelo_lidar',
  'msu_mecanica_suelos',
  'salvamento_arqueologico',
  'urbano',
  'ambiental',
  'geofisica',
  'hidrologico',
  'riesgos',
  'instalaciones_municipales',
];

export const ESTUDIO_DISCIPLINA_AVANCE_LABEL: Record<EstudioDisciplinaAvanceKey, string> = {
  topografia: 'Topografía',
  vuelo_lidar: 'Vuelo Lidar',
  msu_mecanica_suelos: 'MSU',
  salvamento_arqueologico: 'Salvamento Arqueológico',
  urbano: 'Urbano',
  ambiental: 'Ambiental',
  geofisica: 'Geofísica',
  hidrologico: 'Hidrológico',
  riesgos: 'Riesgos',
  instalaciones_municipales: 'Instalaciones Municipales',
};
