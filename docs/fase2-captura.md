# Fase 2: Captura y validación (formularios)

Rama `worktree-dirac-tiendas`. Base común: `FormField`, `useFormErrors`, `useEnvio` / `useColaDeEnvios`,
`utils/numeros.ts` y el ajuste `separador_decimal` del proyecto (Configuración > Configuración del catálogo).

## Cómo probar
- Frontend: `cd frontend && npx jest` (38 suites, 337 pruebas). Tipos: `npx tsc --noEmit` (10 errores que ya existían en otras pantallas).
- Backend: `cd backend && python -m pytest tests --continue-on-collection-errors` (473 pasan). Las 5 fallas y 53 errores restantes son pruebas de integración que necesitan un servidor vivo en `localhost:8001`.
- Pruebas de componente con `@testing-library/react-native` (dependencia de desarrollo nueva; `react-test-renderer` fijado en 19.1.0). `babel.config.js` usa el preset de `expo/node_modules` solo bajo Jest.

## IDs corregidos

| ID | Qué se hizo | Dónde |
|---|---|---|
| X-03 | Error en línea por campo y toast para red en Avance, Gasto, Minuta, Área, Equipo, Evento, Proyecto, Invitaciones y Nodo | `FormField.tsx`, `useFormErrors.ts` y cada pantalla |
| A-07 / X-05 | "1,500" y "1500", teclado numérico, formato es-MX (45,000) al salir del campo y en pantalla; separador decimal por proyecto | `numeros.ts`, `money.ts`, `useSeparadorDecimal.ts`, `server.py` (`separador_decimal`) |
| K-04 | Guardar minuta marca todos los campos faltantes y baja al primero | `MinutasView.tsx`, `validacionMinuta.ts` |
| K-07 | Nombre vacío o duplicado (sin acentos, mayúsculas ni espacios) junto al campo en áreas, series de equipo y partidas | `areas.tsx`, `equipo.tsx`, `NuevaPartidaModal.tsx`, `nombres.ts` |
| K-08 | Candado síncrono y botón deshabilitado; cola de capturas rápidas en Equipo (Enter-Enter no pierde ni duplica) | `useEnvio.ts` |
| K-09 | El error se borra al corregir el campo | `useFormErrors.ts` |
| P-01 / G-04 | Nuevo proyecto y Nuevo evento se reinician al crear; scroll al inicio; horas válidas y fin posterior al inicio; un solo formulario de evento | `new.tsx`, `EventoForm.tsx`, `validacionEvento.ts` |
| P-03 | Los dos campos de color nacen prellenados y se comportan igual | `new.tsx`, `index.tsx` |
| K-10 | Input consistente en Invitaciones | `invitations.tsx`, `ImportarInvitacionesModal.tsx` |
| C-04 / C-12 | Unidades del proyecto en filtros, importador y captura; sin repetidas contra la lista base; Configuración valida unidades y niveles repetidos | `unidades.ts`, `index.tsx` |
| C-05 | Modal "Nuevo concepto" (clave, descripción, unidad, cantidad, P.U., extraordinario); clave repetida 409 | `NuevoConceptoModal.tsx`, `server.py` |
| C-07 / C-08 / C-09 / C-13 | Advertencias de unidad vacía, P.U. 0 y clave sin prefijo del padre; duplicada solo se omite si su gemela es válida; convención decimal solo con columnas numéricas | `server.py` (`_validar_archivo_completo`, `_calcular_vista_filas`), `ImportarCatalogoModal.tsx` |
| A-06 | El programa mensual alimenta PV y la Curva S; fechas ilegibles o invertidas no rompen el cálculo (cuentan como "sin programa"); sección conectada en Configuración | `server.py`, `ProgramaObraSection.tsx`, `ImportarProgramaModal.tsx` |
| A-08 | Fecha del gasto validada con el calendario real y "hoy" del proyecto | `GastoRealForm.tsx`, `validacionGasto.ts` |
| A-10 | Lista de conceptos por defecto, búsqueda única, sin quedarse cargando, mensaje de vacío y errores con reintento | `useBusquedaConceptos.ts`, `RegistrarAvanceScreen.tsx`, `server.py` |

## Verificación a mano
1. **Avance:** Registrar avance sin escribir: aparecen 50 conceptos. Buscar `1.1.` y `zzz`: mensaje de vacío. Cantidad `1,500`: guarda 1500. Sin red: error con "Reintentar".
2. **Gasto:** Dashboard EVM > Registrar gasto con fecha `2026-02-31` y monto vacío: errores bajo cada campo; al teclear se quitan; `1,500.5` guarda 1500.5 y deja el formulario limpio.
3. **Minuta:** Guardar vacía marca título, ubicación, acuerdo y responsable. Dos toques rápidos crean una sola.
4. **Área / Equipo:** repetir un nombre ("topografia" contra "Topografía") marca el campo. En Equipo, dos capturas seguidas con Enter guardan las dos; sin red, se restauran los campos.
5. **Evento:** fin anterior al inicio marca "Hora de fin"; crear cierra y reabre vacío. Editar un evento de todo el día ya lo acepta el servidor (`all_day` en el PATCH).
6. **Proyecto:** crear uno reinicia el formulario y vuelve al inicio.
7. **Catálogo:** "Nuevo concepto" con cantidad `1,500` y P.U. `10.5`; clave repetida marca la clave. Importar un Excel con unidad vacía, P.U. 0, clave repetida y prefijo de padre equivocado: salen las advertencias. Claves `1.1.1` con cantidades `1,500.25` proponen "punto decimal".
8. **Configuración:** elegir separador decimal "coma" y volver a Avance: `1,5` significa uno y medio. Agregar una unidad repetida o un nivel repetido: mensaje junto al campo. La sección "Programa de obra" abre el importador mensual.

## Pendientes y decisiones
- **Cantidad de avance con 4 decimales (cerrado tras el "OK fase 2").** La captura de avance, el aviso de excedente y el porcentaje usan enteros escalados a 4 decimales (`decimalStringToScaled` en `money.ts`); el servidor ya guardaba el texto exacto. Los importes (gasto, P.U.) siguen en 2.
- **Fecha futura del gasto:** no se rechaza (A-01 solo lo pide para avances).
- **Editar evento de todo el día en la app:** el servidor ya lo acepta; `EventoForm` aún bloquea la fecha de un evento de todo el día al editarlo.
- **C-13 en otros importadores:** el importador Maestro y el de programa siguen leyendo todas las celdas para detectar la convención decimal. Conviene corregirlos igual.
- **`conceptos_sin_programa`:** el servidor lo devuelve, pero el tablero EVM aún no lo muestra.
- **Formato de miles según separador:** los textos de solo lectura usan el formato es-MX fijo (coma de miles); solo la captura respeta el separador del proyecto.
- **Textos sin acentos fuera de los formularios** (Áreas involucradas, Anadir, Tipo de minuta, etc.): son de la Fase 5 (X-01).
- **Alert.alert restantes** en acciones fuera de los formularios de captura (eliminar, cargar, subir PDF): quedan para revisión en la Fase 4/5.
- **Prueba en teléfono** con `.xlsx` real y teclado numérico: pendiente (no se puede desde aquí).
