# Fase 0 · Requisitos de tienda (Google Play y App Store)

Rama: `worktree-dirac-tiendas` (worktree `.claude/worktrees/dirac-tiendas`).

## 1. Datos que recolecta la app (Data safety de Play / etiquetas de privacidad de Apple)

| Dato | Para qué | ¿Se comparte? | Opcional | Cifrado en tránsito | Se puede borrar |
|---|---|---|---|---|---|
| Correo electrónico | Cuenta e inicio de sesión | No | No | Sí (HTTPS) | Sí (eliminar cuenta) |
| Nombre y puesto | Identificar autor de reportes | No | No | Sí | Sí |
| Contraseña (hash bcrypt) | Autenticación | No | No | Sí | Sí |
| Fotos | Evidencia de obra | No | Sí | Sí | El contenido de obra se conserva sin autor (ver §3) |
| Ubicación precisa (GPS) | Georreferenciar evidencia y puntos de obra | No | Sí (solo si se autoriza) | Sí | Igual que fotos |
| Datos de obra (reportes, avances, gastos, minutas, mensajes, planos) | Función principal | No | No | Sí | Se conservan como registro del proyecto |
| Identificador de notificaciones (Expo push token) | Enviar avisos | Sí, con Expo (EAS) como procesador técnico | Sí | Sí | Sí |
| Identificadores de dispositivo / publicidad | No se recolectan | — | — | — | — |
| Analítica, rastreo, anuncios | No hay | — | — | — | — |

Notas para los formularios:
- **Play → Data safety:** "Recopila datos: Sí" · "Comparte datos: Sí (token de notificaciones con Expo)" · "Cifrado en tránsito: Sí" ·
  "Usuarios pueden pedir borrado: Sí" (URL: `https://apm-app.mx/api/eliminar-cuenta`).
- **Apple → Privacy nutrition labels:** Contact Info (correo, nombre) · User Content (fotos, datos de obra) ·
  Location (precisa) · Identifiers (User ID / Device ID por el push token) — todo "vinculado al usuario", **sin rastreo**.
- Permisos Android declarados: cámara, ubicación (fina/aproximada), notificaciones, estado de red y vibración. Ya no se
  declaran permisos de almacenamiento ni micrófono (la galería usa el selector del sistema).

## 2. URLs públicas (las sirve el backend)

| Página | URL |
|---|---|
| Política de privacidad | `https://apm-app.mx/api/privacidad` |
| Términos de uso | `https://apm-app.mx/api/terminos` |
| Eliminar cuenta (Play lo exige) | `https://apm-app.mx/api/eliminar-cuenta` |
| Restablecer contraseña (enlace del correo) | `https://apm-app.mx/api/restablecer?token=…` |

(También responden sin `/api` si Apache reenvía la raíz al backend.) Los Términos son un **borrador**: deben revisarse
con un abogado antes de publicar.

## 3. Eliminación de cuenta

- En la app: Perfil → Eliminar mi cuenta (pide contraseña). `POST /api/auth/delete_account`.
- En web: formulario de `/eliminar-cuenta` → `deletion_requests` → el Coordinador General la atiende con
  `GET /api/admin/deletion_requests` y `POST /api/admin/deletion_requests/{id}/execute {"confirm": true}`.
  **Aún no hay pantalla para esto en la app** (queda para la Fase 4).
- Se anonimiza, no se borra la fila: correo, nombre, teléfono, puesto, contraseña, tokens push y solicitudes de
  contraseña se eliminan; reportes, avances y minutas se conservan con autor "Usuario eliminado".
- No se puede eliminar al único Coordinador General.
- Límite conocido: si un nombre aparece escrito a mano dentro de un texto libre (p. ej. en la descripción de una minuta),
  no se puede reconocer automáticamente.

## 4. Variables de entorno nuevas del backend (`/opt/synco-backend/.env`)

| Variable | Para qué | Por defecto |
|---|---|---|
| `SMTP_HOST` | Servidor de correo. **Si falta, "Olvidé mi contraseña" usa el respaldo administrativo anterior** | vacío |
| `SMTP_PORT` | Puerto (465 = SSL directo) | 587 |
| `SMTP_USER` / `SMTP_PASSWORD` | Credenciales SMTP | vacío |
| `SMTP_FROM` | Remitente | `SMTP_USER` |
| `SMTP_STARTTLS` | `0` para desactivar STARTTLS | activo |
| `PUBLIC_BASE_URL` | Base del enlace del correo | `https://apm-app.mx` |
| `SUPPORT_EMAIL` | Contacto en páginas legales y "Acerca de" | `gabodeicaza@gmail.com` |

## 5. Pedido al equipo de servidor (T-12)

Ocultar la versión de Apache: en la configuración global, `ServerTokens Prod` y `ServerSignature Off`, y recargar Apache.
Además, revisar por qué `HEAD /` devolvía 503 de forma intermitente: la app ya no lo usa (usa `GET /api/health`), pero un
monitor externo podría seguir haciéndolo.

## 6. Cuenta demo para revisores

```bash
export SEED_ADMIN_EMAIL=...   SEED_ADMIN_PASSWORD=...   # un Coordinador General
export SEED_DEMO_PASSWORD=... # opcional; si falta se genera y se imprime
python backend/scripts/seed_demo.py --base-url https://apm-app.mx/api --dry-run
python backend/scripts/seed_demo.py --base-url https://apm-app.mx/api --confirmar
```

Crea "Proyecto Demo (PRUEBA)" y un Sub-coordinador que solo ve ese proyecto. Es idempotente y no borra nada.
El correo por defecto (`revisor.demo@example.com`) se puede cambiar con `--demo-email`.

## 7. Cambios de configuración nativa que requieren recompilar

- `targetSdkVersion`/`compileSdkVersion` 36, `bundleIdentifier` iOS `mx.apmapp.dirac`, permisos Android reducidos,
  esquema de enlace `dirac`, `usesCleartextTraffic=false`.
- `frontend/android/` está versionado y se editó a mano para quedar igual que `app.json`. Si se corre
  `expo prebuild --clean`, conserva las llaves de firma (`keystore.properties`) revisando el diff antes de aceptar.
- Push (Fase 4 / T-05): `app.json` no tiene `extra.eas.projectId` ni `google-services.json`; sin eso no llegarán
  notificaciones en Android.
