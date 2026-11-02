// Etiquetas, iconos y orden del selector de los tipos de sección de una presentación.
// Compartido por PresentacionScreen y el editor de plantillas.
import { Ionicons } from '@expo/vector-icons';
import type { PresentacionSeccionTipo } from '@/src/api';

export const TIPO_ICON: Record<PresentacionSeccionTipo, keyof typeof Ionicons.glyphMap> = {
  portada: 'bookmark-outline',
  mapa_general: 'map-outline',
  divisor: 'flag-outline',
  financiero: 'cash-outline',
  seguimiento_estudios: 'analytics-outline',
  croquis_estacion: 'business-outline',
  informacion_particular: 'images-outline',
  avance_grafico: 'construct-outline',
  reportes_semana: 'newspaper-outline',
  cierre: 'checkmark-done-outline',
  ambiental: 'leaf-outline',
  social: 'people-outline',
  seguridad: 'shield-checkmark-outline',
  proyecto: 'document-text-outline',
  calidad: 'ribbon-outline',
  pendientes: 'alert-circle-outline',
  electromecanico: 'hardware-chip-outline',
  lamina_imagenes: 'cloud-upload-outline',
};

export const TIPO_LABEL: Record<PresentacionSeccionTipo, string> = {
  portada: 'Portada',
  mapa_general: 'Mapa General',
  divisor: 'Divisor de sección',
  financiero: 'Financiero',
  seguimiento_estudios: 'Seguimiento a Estudios y Análisis',
  croquis_estacion: 'Croquis General (Estación)',
  informacion_particular: 'Información Particular',
  avance_grafico: 'Avance Gráfico (Plano)',
  reportes_semana: 'Reportes de la semana',
  cierre: 'Cierre (Gracias)',
  ambiental: 'Ambiental (automático)',
  social: 'Social / Impacto urbano (automático)',
  seguridad: 'Seguridad (automático)',
  proyecto: 'Estudios y proyecto ejecutivo (automático)',
  calidad: 'Calidad (automático)',
  pendientes: 'Pendientes generales (automático)',
  electromecanico: 'Sistema electromecánico (automático)',
  lamina_imagenes: 'Imágenes y gráficas (subir las mías)',
};

export const TIPO_ORDEN_PICKER: PresentacionSeccionTipo[] = [
  'portada', 'mapa_general', 'divisor', 'financiero',
  'seguimiento_estudios', 'croquis_estacion', 'informacion_particular', 'avance_grafico',
  'reportes_semana', 'proyecto', 'electromecanico', 'calidad', 'pendientes', 'ambiental', 'social', 'seguridad', 'lamina_imagenes', 'cierre',
];

/** El croquis va ligado a una estación concreta: no puede ir en una plantilla. */
export const TIPOS_PARA_PLANTILLA = TIPO_ORDEN_PICKER.filter((t) => t !== 'croquis_estacion');
