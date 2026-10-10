# Fase 3: Indicadores y reportes

Rama `worktree-dirac-tiendas`. Decisiones del usuario aplicadas: la Presentación usa los periodos del tablero
(`mes_actual` por defecto); la meta usa la cadencia del proyecto (con `DIARIA`); el Coordinador General no captura
reportes en esta fase (solo estado vacío explicativo); la captura rápida de fuerza de trabajo crea un reporte mínimo.

## Cómo probar
- Frontend: `cd frontend && npx jest` (47 suites, 439 pruebas). `npx tsc --noEmit`: 10 errores que ya existían (`tree.tsx`, `PlanoMarkerOverlay.tsx`, formato `'map'` y lista de equipo en `projects/[id]/index.tsx`).
- Backend: `cd backend && python -m pytest tests --continue-on-collection-errors` (575 pasan). Las 5 fallas y 53 errores restantes son pruebas de integración que necesitan un servidor vivo en `localhost:8001`.

## IDs corregidos

| ID | Qué se hizo | Dónde |
|---|---|---|
| A-03 | Tres tipos nuevos de excepción: `ajuste_negativo`, `acuerdo_vencido`, `sin_avance_en_ventana`; se quita `sobre_meta` (nunca se emitía). `atrasado` gana sobre `sin_avance_en_ventana`. Servicio único `calcular_excepciones_evm` | `server.py`, `utils/excepcionesMeta.ts`, `DashboardEVM.tsx` |
| A-04 | `variacion_costo` es `None` con AC = 0 (igual que el CPI); el tablero, la Presentación y el PPTX muestran "—" con "Sin gasto real capturado" | `server.py`, `utils/finanzas.ts`, `SlideFinanciero.tsx` |
| A-05 | La Presentación elige `mes_actual`, `ultimos_3_meses` o `proyecto_completo`; una sola función de rango (`resolver_rango_periodo`) para tablero y Presentación; el PPTX imprime el rango; el error del cálculo ya no se traga. Prueba que compara cifras de ambos | `server.py`, `PeriodoFinancieroSelector.tsx`, `PresentacionPreview.tsx` |
| A-09 | Los listados y exports ya incluían la descendencia (ahora con prueba a 3 niveles); los chips de partida muestran la jerarquía por nivel | `VisualizarAvanceScreen.tsx`, `utils/partidasJerarquia.ts` |
| A-11 | El resumen con IA recibe registros de avance, gastos y excepciones del proyecto (con topes y conteo de omitidos) y solo puede citar las cifras del bloque de datos. Proveedor sin cambio (Gemini) | `server.py` (`construir_entrada_resumen_ia`) |
| C-06 | Meta = cantidad ÷ duración en la cadencia (diaria, semanal ÷ (días/7), mensual ÷ (días/30.4)), hasta 4 decimales; vacía sin programa; `DIARIA` en la periodicidad; Nuevo concepto la precalcula | `server.py` (`meta_por_defecto`), `utils/metaPorDefecto.ts`, `NuevoConceptoModal.tsx` |
| R-01 | Estado vacío por rol; el Coordinador ve quién captura y "Invitar a un especialista"; distingue "sin reportes" de "sin reportes para este filtro" | `ReportesVacio.tsx` |
| R-03 | `GET /projects/{pid}/export/reports/count` con la misma consulta que la exportación; aviso "0 reportes en el periodo" antes de generar, con "Cambiar periodo" y "Exportar de todos modos" | `server.py`, `SinReportesAviso.tsx`, `utils/conteoExportacion.ts` |
| R-02 | Captura rápida de fuerza de trabajo (Especialista y Subcoordinador) que crea un reporte mínimo con Personal y Equipo del catálogo | `FuerzaTrabajoCapturaRapida.tsx`, `POST /reports` (`solo_fuerza_trabajo`) |

## Verificación a mano
1. **A-04:** proyecto sin gastos: "Variación de costo: —" en gris con "Sin gasto real capturado". Registra un gasto: pasa a monto con verde o rojo.
2. **A-05:** crea una Presentación con sección Financiero en "Mes actual" y compara con el tablero en el mismo periodo: mismas cifras y el rango impreso. Repite con "Últimos 3 meses" y "Proyecto completo". Exporta PPTX y revisa el rango.
3. **A-03:** captura un ajuste de −3 con motivo; crea una minuta con un acuerdo vencido ayer; deja un concepto en su ventana sin avances; un concepto con `fecha_fin` pasada aparece solo como "atrasado".
4. **A-11:** en un proyecto sin reportes hoy pero con un avance o gasto, el resumen ya no dice "sin datos" y cita cifras exactas (requiere `GEMINI_API_KEY`).
5. **A-09:** en Visualizar avance elige una partida raíz: aparece la fila de hijas y la lista incluye hijas y nietas; exporta a PDF y Excel con el filtro.
6. **C-06:** cadencia semanal, cantidad 1,000 del 2026-10-01 al 2026-10-14: meta sugerida 500 por semana. Sin fechas: meta vacía con la explicación. Un catálogo importado queda "Sin meta".
7. **R-01:** como Coordinador en un proyecto sin reportes: explicación y botón para invitar; con un filtro activo: "para este filtro" y "Quitar filtros".
8. **R-03:** exporta PDF con un periodo sin reportes: aviso con las dos opciones antes de descargar.
9. **R-02:** como Especialista, Fuerza de trabajo > "Captura rápida": el reporte aparece en la tabla con tu nombre; en modo avión avisa que se enviará al reconectar.

## Cambios que conviene tener presentes
- **Presentaciones ya guardadas** pasan de la ventana de 7 días al `mes_actual`: sus cifras financieras cambian al reabrirlas o re-exportarlas.
- **Proyectos fuera de CDMX:** el mes del tablero arranca desde el "hoy" de la zona del proyecto, no desde CDMX fijo; el rango puede moverse un día.
- **`POST /reports`** acepta la bandera opcional `solo_fuerza_trabajo` (no exige medición del nodo). Un reporte normal sigue exigiéndola.
- **Conceptos ya guardados** conservan su meta (no hay migración). El espejo frontend de la meta devuelve "sin meta" con cantidades absurdamente grandes (límite de enteros seguros); el servidor sí las calcula.
- **Estado del PPTX:** no se generó un `.pptx` real en pruebas; queda la verificación a mano 2.

## Pendientes
- **Captura rápida de fuerza de trabajo:** no permite elegir el día (el servidor pone la fecha y hora de la captura). No se probó con la cola sin conexión real.
- **Coordinador General:** el estado vacío explica que no captura, pero el servidor todavía se lo permite; cerrarlo del lado del servidor es otra decisión.
- **Resumen con IA:** no se probó de extremo a extremo con Gemini real.
- **`/excepciones`:** sigue sin filtro de periodo.
- **Sin pruebas de componente** para `DashboardEVM.tsx`; se cubrió `EXCEPCION_META` con una utilidad aparte.
- **Texto del periodo:** el PPTX usa "1 de septiembre de 2026 al 24 de septiembre de 2026" y la vista previa "Del 1 al 24 de septiembre de 2026". Ajuste menor si se quiere igualar.
- **C-13 en otros importadores** (de la Fase 2) sigue pendiente.
