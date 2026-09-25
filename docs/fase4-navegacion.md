# Fase 4: Navegación y experiencia nativa

Rama `worktree-dirac-tiendas`. Las 7 decisiones del usuario se aplicaron como se recomendaron: K-01 migra todas las
pantallas al `ScreenHeader`; K-06 usa grupos de modales exclusivos por pantalla y hojas internas en Nueva minuta;
K-02 deja solo miembros del proyecto (más el contratista); G-05 ofrece vigencias 6 h / 24 h / 48 h / 7 días
(24 h por defecto, editable); el GPS va en campos nuevos `gps_lat`/`gps_lon` del nodo sin tocar las coordenadas UTM;
el push de invitación es un aviso al Coordinador cuando se acepta; y la cola de avances se sincroniza con indicador
también para el Coordinador.

## Cómo probar
- Frontend: `cd frontend && npx jest` (81 suites, 801 pruebas). `npx tsc --noEmit`: 10 errores que ya existían (`tree.tsx`, `PlanoMarkerOverlay.tsx`, formato `'map'` y lista de equipo en `projects/[id]/index.tsx`).
- Backend: `cd backend && python -m pytest tests --continue-on-collection-errors` (650 pasan). Las 5 fallas y 53 errores restantes son pruebas de integración que necesitan un servidor vivo en `localhost:8001`.
- Jest usa ahora un mock global de AsyncStorage (`frontend/jest.setup.js`). Las pruebas que rendericen pantallas con `ScreenHeader` deben mockear `expo-router` con `useRouter`.

## IDs corregidos

| ID | Qué se hizo | Dónde |
|---|---|---|
| K-01 | Componente `ScreenHeader` (regreso de 44 pt, ruta de respaldo sin historial, color con contraste) y migración de las pantallas de Coordinador, Especialista, Subcoordinador, autenticación y módulos. Actividades generales, los calendarios y la lista de Mensajes de Especialista y Subcoordinador ganaron regreso. Nuevo proyecto cambió su X de cerrar por el regreso estándar | `ScreenHeader.tsx` y ~55 pantallas |
| K-06 | Hook `useModalUnico` (abrir uno cierra el anterior); pantalla del proyecto, Plano de Avance y Nueva minuta lo usan; los tres selectores de Nueva minuta son hojas dentro del mismo modal | `useModalUnico.ts`, `MinutasView.tsx`, `PlanoAvanceScreen.tsx` |
| A-12 | Capas explícitas (plano 0, overlay 1, controles 2, modal 1000); renombrar oculta el modal del marcador | `capasPlano.ts`, `PlanoAvanceScreen.tsx` |
| P-04 | La pestaña activa se recuerda por proyecto | `usePestanaProyecto.ts` |
| P-05 | `ProyectoActivoProvider`: Mensajes, Minutas, Noticias y Calendario comparten el proyecto activo (recuerda el último por usuario) | `proyecto-activo-context.tsx` |
| G-02 | "Mis reuniones" muestra día y hora, con Hoy/Mañana y las de todo el día primero | `reuniones.ts`, `MyMeetingsPanel.tsx` |
| K-02 | `GET /members?solo_miembros=1` y `create_minuta` rechaza un responsable que no sea miembro ni el contratista | `server.py`, `MinutasView.tsx` |
| G-03 | `contrastRatio` WCAG y título del día del calendario legible; hex fijos del tema del calendario sustituidos por tokens | `theme.ts`, `UniversalCalendar.tsx` |
| G-05 | `vigencia_horas` (6/24/48/168) al crear y editar noticias; el PATCH reinicia el reloj desde la edición; selector y tiempo restante en la UI | `server.py`, `VigenciaSelector.tsx` |
| G-06 | En web Enter envía y Mayús+Enter salta de línea (móvil sin cambios) | `enviarConEnter.ts` |
| G-07 | Tabs con `lazy` y `freezeOnBlur`; polls de Noticias y Mensajes solo con la pantalla enfocada | `usePollingConFoco.ts`, `_layout` de tabs |
| C-10 | Los resultados de búsqueda del catálogo navegan al concepto (abre la partida, resalta y hace scroll, con "Volver a los resultados") | `CatalogoConceptosScreen.tsx` |
| C-11 | Nodo con pestañas Estructura / Conceptos (siempre visibles con su conteo) | `NodoTabs.tsx` |
| C-15 | Margen del botón flotante con el área segura y un solo botón de cerrar (y "Atrás" en pasos intermedios) en los importadores | `ImportarCatalogoModal.tsx` y afines |
| T-05a | "Tomar foto" y galería con compresión (lado mayor 1600 px, JPEG 0.7) en Registrar avance | `comprimirFoto.ts` |
| T-05b | `gps_lat`/`gps_lon` opcionales en el nodo con "Usar mi ubicación" y "Abrir en mapas" | `server.py`, `UbicacionGpsNodo.tsx` |
| T-05c | Push de acuerdos por vencer (hoy y mañana, 08:00-21:00 locales, sin repetir), noticias urgentes e invitación aceptada, con navegación al tocar | `server.py`, `rutaNotificacion.ts`, `NotificacionesNavegacion.tsx` |
| T-05d | La cola sin conexión ahora sincroniza también los avances (antes nunca se enviaban); indicador para el Coordinador; deduplicación por `client_id` acotada a usuario y proyecto, con índice único | `offline-queue-context.tsx`, `server.py` |
| X-07 | El banner de conexión ya existía; se agregaron 7 pruebas | `BannerSinConexion.test.tsx` |

## Verificación a mano (no probado en teléfono)
1. **K-01:** recorre las pantallas migradas en iPhone y Android: el regreso se ve igual en todas, no hay doble margen superior y el color del proyecto mantiene el contraste. En Actividades generales, los calendarios y Mensajes ya hay regreso.
2. **K-06:** en la pantalla del proyecto abre Exportar, ciérralo y abre Catálogos: nunca deben verse dos a la vez. En Nueva minuta, Ubicación, Responsable e Involucrados se abren sobre el formulario sin cerrar el modal padre.
3. **A-12:** en Plano de Avance toca un marcador y Renombrar: el plano no debe tapar el modal (Android, iOS y web).
4. **P-04 / P-05:** cambia de pestaña y de proyecto, cierra y reabre la app: se recuerdan.
5. **G-03 / G-05 / G-06 / G-07:** título del día legible; noticia con 6 h y con 7 días; Enter en web; sin peticiones en segundo plano con la pestaña inactiva y sin pantallas en blanco al volver en un Android de gama baja.
6. **C-10 / C-11 / C-15:** busca un concepto a varios niveles y tócalo; pestañas del nodo; botón flotante con barra de gestos; un solo cierre en el importador.
7. **T-05a:** "Tomar foto" pide permiso con explicación y la foto pesa unos cientos de KB.
8. **T-05b:** "Usar mi ubicación" en un nodo (con GPS apagado y con permiso denegado).
9. **T-05c:** push reales (requieren dispositivo y credenciales): noticia urgente, invitación canjeada y acuerdo con fecha límite mañana; toca la notificación con la app abierta, en segundo plano y cerrada.
10. **T-05d:** en modo avión registra un avance: aparece como pendiente y se envía solo al reconectar; como Coordinador también se ve el indicador.

## Cambios que conviene tener presentes
- **K-02:** `/members` conserva la lista amplia por defecto (otros usos necesitan a los coordinadores: asistentes de eventos y mensajes directos); la lista estricta es el parámetro nuevo. La validación del responsable solo aplica al crear minutas, no a las ya guardadas.
- **T-05d:** los avances encolados en dispositivos que nunca sincronizaron se enviarán por primera vez tras actualizar. La deduplicación por `client_id` evita duplicados de reintentos; el índice único no se probó contra una base real.
- **Jest:** mock global de AsyncStorage y preset de Babel de `expo/node_modules` bajo pruebas (Fase 2).

## Pendientes
- **`ReportPreviewSheet`:** su `EditCaptionsModal` sigue anidado; pasarlo a un solo modal desmonta la vista previa y pierde el scroll, y no se puede comprobar sin teléfono. Decisión pendiente.
- **Push:** los acuerdos con varios vencimientos abren la pantalla general de Minutas, no una minuta concreta. Los envía el bucle de arranque del servidor, así que solo funcionan con el servidor en marcha. La sección i18n `notificaciones` no se usa todavía (los títulos los arma el servidor).
- **Cámara:** `nuevo.tsx` (reporte del Especialista) sigue con su cámara a calidad 0.7 sin `comprimirFoto`.
- **Cola en web:** persiste en `localStorage`; con fotos grandes podría llenar la cuota (ahora pesan menos).
- **`MyMeetingsPanel`:** sin `zona` usa CDMX; solo importa fuera de esa zona.
- **Encabezados:** excepciones que conservan su `chevron-back` con motivo: el paso atrás del modal de Exportar reportes y el asistente de invitación; `(spec)/nuevo.tsx` conserva su "cerrar" porque descarta el reporte y no es un regreso. Vistas embebidas de Minutas y Anuncios no llevan encabezado.
- El resumen de arriba de textos sin acentos en Nueva minuta y otras pantallas se atiende en la Fase 5 (X-01).
