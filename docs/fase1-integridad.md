# Fase 1 · Integridad de datos

Rama: `worktree-dirac-tiendas`.

## Reglas de negocio implementadas

**A-01 · Qué se rechaza:** cantidad ≤ 0, texto, y fecha futura (en la zona del proyecto), en el servidor y en la app,
al crear, editar e importar avances. Una corrección es un **ajuste** (`tipo: "ajuste"`) con signo y **motivo
obligatorio** (mínimo 5 caracteres), registrado en la bitácora (`catalogo_bitacora`). Los ajustes no aplican en proyectos
que capturan porcentaje. Un ajuste no puede dejar el acumulado del concepto en negativo.

**A-02 · Qué se permite y se hace visible (nunca se bloquea):**
- Volumen excedente = ejecutado − contratado. Se calcula al leer, reproduciendo los avances en orden (fecha, captura).
- Estatus por concepto: `pendiente_autorizacion` (defecto) · `autorizado` · `rechazado`. **Solo el Coordinador General**
  cambia el estatus; para autorizar exige el convenio modificatorio u orden de cambio.
- Valor ganado: **contractual** (topado a lo contratado) y **total** (con excedentes). En modo porcentaje no se separa.
- `SPI = EV contractual ÷ PV` · `CPI = EV total ÷ AC` · `EAC = BAC ÷ CPI` · `ETC = EAC − AC` · `VAC = BAC − EAC`.
  EAC/ETC/VAC salen «—» mientras no haya gasto real. Un gasto mayor al presupuesto se permite.
- Concepto extraordinario: `extraordinario: true`, P.U. `pendiente_autorizacion`; se autoriza con
  `PATCH /conceptos/{id}/pu_estatus` (Coordinador General).
- Lista por excepción: `excedente_volumen` y `sobrecosto`, alertas informativas con cantidad e importe.
- Servicio único `calcular_analisis_evm`: lo usan el tablero y la Presentación (misma cifra, mismo periodo).
- Sin tope de 100% en modo porcentaje.

## Endpoints nuevos

| Método y ruta | Quién |
|---|---|
| `GET /projects/{pid}/excedentes` | cualquiera con acceso |
| `PATCH /projects/{pid}/excedentes/{concepto_id}` | Coordinador General |
| `PATCH /conceptos/{id}/pu_estatus` | Coordinador General |
| `GET /admin/migraciones/catalogo-jerarquia` (lista) | Coordinador General |
| `GET …/{pid}/vista-previa` · `POST …/{pid}/aplicar` · `POST …/{pid}/revertir` | Coordinador General |

## Migración C-01 (reubicar conceptos por prefijo de clave)

Desde la app: **Perfil → Reorganizar catálogos importados**. Un proyecto a la vez: «Ver cambios» → «Aplicar» (pide
confirmación) → «Deshacer» si hace falta.

- Crea las partidas que faltan (1, 1.1, 1.1.1…) con **la clave como nombre**, marcadas «nombre pendiente»
  (se renombran con el lápiz del Catálogo; el nombre original no se puede recuperar).
- Mueve cada concepto a la partida de su prefijo. Solo toca claves con puntos.
- **Cablebús Línea 4 está excluido** (por nombre: «cablebús» o «línea 4»): el servidor responde 403.
- Idempotente. Reversible: guarda el `partida_id` original de cada concepto (`migraciones_catalogo`); al deshacer no
  pisa lo que alguien movió después y **no borra nada** (da de baja con `activo=false` las partidas que creó).
- Si falla a la mitad, se revierte sola.

## Importadores (catálogo y Maestro)

- Filas sin cantidad ni P.U. (o sin meta, importe ni fechas en el Maestro) = **partidas**; se crean anidadas por
  prefijo de clave con el nombre de la fila. Cada concepto cuelga de la partida más cercana.
- **Partida destino opcional** (solo cuelga el catálogo bajo un nodo existente). Sin destino, un concepto sin partida
  padre es error de validación.
- Duplicados se buscan en todo el proyecto; reimportar es idempotente.
- **C-03:** cantidad ≤ 0 se rechaza salvo la columna opcional **Deductiva** (SI, X, 1).
- Los nombres de nivel salen de `nombres_niveles_partida` del proyecto, no del código.

## Fechas (X-04 / A-08 / K-05)

- El proyecto tiene `zona_horaria` (defecto `America/Mexico_City`, editable en Configuración) y expone `hoy` y
  `tz_offset_min`. La app calcula con ese desfase y **no usa `Intl`** (el truco de `tz.ts` sigue igual).
- Semana de lunes a domingo (o el `dia_inicio_semana` del proyecto).
- Minutas e inicio/fin de concepto ya no se guardan a 00:00 UTC (salían a las 18:00 del día anterior): son eventos
  `all_day`. La lista «próximos» ya no corta el día a medianoche UTC.
- Formato único: `23 sep 2026` / `23 sep 2026, 08:47`.

## Otros

- **P-02:** el color se valida `#RRGGBB` al **guardar** (proyecto y áreas); un valor inválido responde 400 con mensaje
  y **no se sustituye**. Selector con vista previa (`ColorInput`).
- **K-03:** la fecha límite de un acuerdo no puede ser anterior a la fecha de la reunión (servidor y app).
- Se corrigió un bug previo: un validador propio de Pydantic (p. ej. cantidad «abc») terminaba en **500** en lugar de
  422 porque la respuesta no era serializable.
- Editar la cantidad de un avance ya recalcula su importe congelado (antes quedaba el importe anterior).

## Para desplegar

Backend con el flujo habitual (`scp` de `server.py`, `ssh`, `update.sh`). No hay variables de entorno nuevas. La app
requiere compilación nueva. **Avisar a quien tenga la app vieja con capturas en cola**: un avance en cero o negativo
sincronizado después recibirá 400 y quedará «fallido».
