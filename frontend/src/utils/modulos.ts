// Sistema Multi-Proyecto Modular — catálogo de plantillas del lado del
// frontend. Espejo de MODULOS_CATALOG en backend/server.py: agregar una
// plantilla nueva requiere declararla en AMBOS lados (aquí para que la
// pantalla de configuración y el menú hamburguesa sepan pintarla; en el
// backend para que la sanitización de `modulos` no la descarte).
import type { Ionicons } from '@expo/vector-icons';
import type { ModuloCategoria } from '@/src/api';

export type ModuloDef = {
  key: string;
  label: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  // Nombre de ruta bajo cada grupo de rol — igual en (coord)/projects/[id]/,
  // (subcoord)/ y (spec)/ (ver app/(subcoord)/<screen>.tsx).
  screen: string;
};

export const MODULOS_CATALOG: Record<ModuloCategoria, ModuloDef[]> = {
  reportes_diarios: [
    {
      key: 'seguridad_higiene',
      label: 'Seguridad e Higiene',
      subtitle: 'Reporte de accidentes y checklist preventivo/correctivo',
      icon: 'shield-checkmark-outline',
      screen: 'seguridad-higiene',
    },
  ],
  reportes_semanales: [
    {
      key: 'forestal_arbolado',
      label: 'Forestal y Arbolado',
      subtitle: 'Podas, trasplantes y derribos por estación',
      icon: 'leaf-outline',
      screen: 'forestal-arbolado',
    },
  ],
  reportes_mensuales: [],
};

export const CATEGORIA_LABEL: Record<ModuloCategoria, string> = {
  reportes_diarios: 'Diario',
  reportes_semanales: 'Semanal',
  reportes_mensuales: 'Mensual',
};

export const CATEGORIA_ORDEN: ModuloCategoria[] = ['reportes_diarios', 'reportes_semanales', 'reportes_mensuales'];
