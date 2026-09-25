// A-12: capas explícitas del Plano de Avance. La imagen del plano y su overlay quedan por
// debajo; los modales (backdrop y tarjeta) siempre por encima de imagen, overlay y controles.
// `elevation` es el equivalente de zIndex en Android.
export const CAPAS_PLANO = { plano: 0, overlay: 1, controles: 2, modal: 1000 } as const;

export const ESTILO_CAPA_PLANO = { zIndex: CAPAS_PLANO.plano, elevation: CAPAS_PLANO.plano } as const;
export const ESTILO_CAPA_OVERLAY = { zIndex: CAPAS_PLANO.overlay, elevation: CAPAS_PLANO.overlay } as const;
export const ESTILO_CAPA_CONTROLES = { zIndex: CAPAS_PLANO.controles, elevation: CAPAS_PLANO.controles } as const;
export const ESTILO_CAPA_MODAL = { zIndex: CAPAS_PLANO.modal, elevation: CAPAS_PLANO.modal } as const;
