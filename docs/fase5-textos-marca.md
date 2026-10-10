# Fase 5: Textos, marca y accesibilidad

Rama `worktree-dirac-tiendas`. Decisiones aplicadas (recomendaciones): ortografía en todo el código y textos a i18n en los
archivos con más literales (con guardia); género de niveles automático con override por nivel; `tipo_obra`
(genérica, carretera, edificación, hidráulica, puente) que decide módulos y plantillas por defecto, proyectos anteriores
sin migrar ("legado"); accesibilidad = auditoría estática + lista de verificación en teléfono; marca: limpieza sin renombrar
llaves de almacenamiento internas.

## Cómo probar
- Frontend: `cd frontend && npx jest` (97 suites, 988 pruebas). `npx tsc --noEmit`: 10 errores previos (tree.tsx, PlanoMarkerOverlay.tsx, index.tsx del proyecto).
- Backend: `cd backend && python -m pytest tests --continue-on-collection-errors` (863 pasan; las 5 fallas y 53 errores son pruebas de integración que necesitan servidor en localhost:8001).
- Guardias nuevas: `ortografia.test.ts` (palabras sin acento, ` _ `, placeholders con `_`, marca), `i18nLote*.test.ts` (sin literales visibles en los archivos migrados), auditoría de accesibilidad (`scripts/audit-a11y.js`, ahora también áreas táctiles < 44 pt).

## IDs corregidos
| ID | Qué se hizo |
|---|---|
| X-01 | Se restauraron unas 420 palabras sin acento/ñ que dejó un script anterior (`scripts/ortografia.js` + diccionario, re-ejecutable como guardia); 22 archivos con más literales pasaron a i18n (proyecto, nuevo reporte, Forestal, Presentación, Minutas, Actividades generales, Tabla resumen, árbol, Plano, panel Subcoord, invitaciones, Seguridad, Estudios, EVM, Riesgos, canje, noticias, plantillas, vista previa, menú); backend: meses en minúscula ("16 de junio de 2026"), constante de meses duplicada corregida, mensajes sin acento |
| X-02 / R-04 / R-05 | Separador ` · ` (`unir()`), placeholders con `…`, máscara `••••••••`, `—` en valores vacíos, sin `_` como ícono |
| C-14 | Género y plural correctos ("Nuevo frente", "Nueva estructura", "niveles"), campo `genero_niveles` con override por nivel en Configuración; mensajes del backend con el nombre de nivel |
| G-08 | "Sé el primero…", "Los saltos de línea…", "Contenido" en campo y error, "Cerrar sesión" desde i18n |
| K-11 | La tarjeta de área ya no muestra el hex; la muestra de color tiene etiqueta accesible |
| K-12 | "Albañiles", "Topógrafos"; `.title()` reemplazado por capitalización en español |
| K-13 / T-10 | `tipo_obra` con módulos y plantillas por defecto por tipo; selector en Nuevo proyecto y Configuración; módulos con textos genéricos; etapas de poste como plantilla opcional |
| P-06 | Resumen de Configuración con cliente, objeto, color, tipo de obra y fechas formateadas |
| T-06 | Marca nativa a Dirac (Gradle, logs, config de red), scripts destructivos y `view.xml` eliminados |
| X-06 | Auditoría reforzada: 0 botones solo-ícono sin etiqueta y 0 áreas táctiles < 44 pt sin hitSlop (5 corregidas) |
| Seguridad | `/admin/bootstrap` ya no tiene secreto por defecto: sin `BOOTSTRAP_SECRET` en el entorno queda desactivado |

## Lista para probar en teléfono (TalkBack en Android, VoiceOver en iPhone)
1. Activa el lector y recorre Inicio, Reportes, Registrar avance, Minutas, Calendario, Mensajes y Configuración: cada botón debe anunciar su nombre y rol, en español.
2. Encabezados: cada pantalla anuncia su título como encabezado y el botón "Volver" funciona (gesto de regreso incluido).
3. Formularios: un error en línea se anuncia al aparecer; los campos numéricos abren el teclado numérico.
4. Modales y hojas (Nueva minuta, exportar): el lector solo lee lo que está encima y se puede cerrar.
5. Áreas: la muestra de color se anuncia como "Color del área X".
6. Contraste al 200 % de texto y en modo oscuro del sistema: nada se corta ni se vuelve ilegible.
7. Acentos y ñ se ven bien en todos los textos, PDF y PPTX exportados incluidos.

## Pendientes
- **Vocabulario de un proyecto específico:** las exportaciones PDF/PPTX (subtramo, intertramo, poste, unas 700 líneas), el módulo Control de Obra, el modelo de nodos y textos como "Acceso al Predio · por subtramo" siguen específicos de cimentaciones con postes; quedan para una fase posterior.
- **Literales fuera de los archivos migrados:** unos 800 textos en el resto de archivos siguen en el código (con ortografía correcta); la guardia solo cubre los migrados.
- **Claves i18n generadas por script** (p. ej. `subCoordinador2`) funcionan pero no están curadas; `es-MX.ts` tiene finales de línea mezclados.
- **Categorías guardadas sin acento** en proyectos existentes ("Albaniles") no se corrigen solas.
- **Nombres de mes** de `ForestalArboladoScreen` siguen como constante en código.
- **Mensajes "no existe"** del backend con "partida/concepto" fijos (no se conoce el proyecto).
- **Claves de almacenamiento** `synco_*` / `syncsite_*` se conservan a propósito.
- **Plantilla de reporte** por tipo de obra es solo recomendación; no hay activación por proyecto.
