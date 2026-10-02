#!/usr/bin/env python
"""RPA (Playwright) de último recurso para "pegar" clima en SynCo.

*** LEE ESTO ANTES DE USARLO ***

Al revisar este mismo repo encontré que SynCo YA expone una API HTTP real
para este caso de uso: `POST /api/auth/login` (JWT) + `PUT
/api/projects/{pid}/weather-logs` (ver `backend/server.py`, sección
"Módulo Estado del Tiempo"). Esa API es infinitamente más robusta que
cualquier automatización de UI: no depende de selectores frágiles, no se
rompe si cambia un texto o un layout, y devuelve errores estructurados
(400/403/404) en vez de un timeout de Playwright imposible de diagnosticar.

Ver `weather_openmeteo_export.py` en esta misma carpeta -- usa esa API
directamente con `--push` y hace exactamente lo que este script intenta
simular por fuerza bruta, sin nada de lo de abajo.

Razones adicionales por las que esta Opción 1 es especialmente frágil en
SynCo, más allá de "siempre es mejor usar la API si existe":

    1. SynCo es una app Expo/React Native (`frontend/app/(auth)/login.tsx`),
       no un sitio web clásico. Los <TextInput> no tienen `id`, `name` ni
       `data-testid` -- ni siquiera en un build web de Expo (React Native
       Web) los selectores son estables entre builds. El build principal
       es para Android (ver `frontend/android/`), donde Playwright/Selenium
       (herramientas de automatización de NAVEGADOR) directamente no
       aplican: no hay DOM que inspeccionar.
    2. El formulario de "reporte de obra diario" (captura de clima) no es
       una pantalla fija con URL propia y navegable por deep link simple:
       vive dentro de la navegación autenticada de la app
       (`app/(spec)/...` etc.), con varios pasos de contexto (elegir
       proyecto, elegir nodo/Estación) antes de llegar al formulario.
    3. Solo se pueden usar credenciales de correo/contraseña de un usuario
       real -- nunca un token de invitación de un solo uso, que además
       expira al canjearse una vez (ver `redeem` en el flujo de auth).

Por eso este archivo se entrega como PLANTILLA + bitácora de pasos, no como
un bot terminado: sin acceso a un build web real de SynCo no existen
selectores verificables que yo pueda poner aquí sin inventarlos. Si de
todas formas necesitas RPA (p. ej. porque el equipo de captura insiste en
pegar el dato a mano en una pantalla que no se puede tocar por API),
usa esta plantilla como punto de partida y complétala inspeccionando el
DOM real con el modo `--headed` + `page.pause()` de Playwright.

REQUISITOS
----------
    pip install playwright
    playwright install chromium

VARIABLES DE ENTORNO (nunca hardcodear credenciales en el código)
------------------------------------------------------------------
    SYNCO_LOGIN_URL   URL de la pantalla de login (solo aplica a un build
                       web de SynCo; ajústala al ambiente real, ej.
                       "https://apm-app.mx/login" o la URL de un Expo web
                       de staging -- NO existe una constante fija correcta
                       aquí, hay que confirmarla con el equipo de frontend)
    SYNCO_EMAIL
    SYNCO_PASSWORD

USO
---
    python scripts/weather_synco_rpa.py --headed   # ver el navegador, para depurar selectores
    python scripts/weather_synco_rpa.py            # headless, una vez que los selectores estén confirmados
"""

from __future__ import annotations

import argparse
import logging
import os
import sys

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("weather_synco_rpa")


class ConfiguracionFaltanteError(RuntimeError):
    """Falta una variable de entorno requerida para correr el bot."""


def _leer_credenciales() -> tuple[str, str, str]:
    login_url = os.environ.get("SYNCO_LOGIN_URL")
    email = os.environ.get("SYNCO_EMAIL")
    password = os.environ.get("SYNCO_PASSWORD")
    faltantes = [k for k, v in (("SYNCO_LOGIN_URL", login_url), ("SYNCO_EMAIL", email), ("SYNCO_PASSWORD", password)) if not v]
    if faltantes:
        raise ConfiguracionFaltanteError(
            f"Faltan variables de entorno: {', '.join(faltantes)}. "
            "Nunca hardcodees estos valores en el script."
        )
    return login_url, email, password  # type: ignore[return-value]


def iniciar_sesion(headed: bool, lectura) -> None:
    """Login real con Playwright + comentarios de dónde iría cada paso
    siguiente para pegar el clima, marcados como AJUSTAR AQUÍ donde hace
    falta un selector real que no puedo adivinar desde el código fuente."""
    from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright

    login_url, email, password = _leer_credenciales()

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not headed)
        page = browser.new_page()
        try:
            log.info("Navegando a %s", login_url)
            page.goto(login_url, wait_until="networkidle")

            # AJUSTAR AQUÍ: en el código fuente (login.tsx) el campo de
            # correo es un <TextInput placeholder="nombre@empresa.com" />
            # sin id/testID. En un build web de React Native Web esto se
            # renderiza como <input placeholder="nombre@empresa.com">, así
            # que el ancla MENOS frágil disponible hoy es el placeholder
            # -- pero confírmalo inspeccionando el DOM real (F12) antes de
            # confiar en este selector en producción.
            page.get_by_placeholder("nombre@empresa.com").fill(email)
            page.get_by_placeholder("________").fill(password)  # AJUSTAR AQUÍ si el placeholder real difiere

            # El botón dice "Entrar" (ver <Button label="Entrar" .../> en
            # login.tsx) -- si `Button` no renderiza el texto como
            # accesible (revisar su implementación en components/Button),
            # este selector por rol+nombre puede no encontrar nada y
            # habría que usar un selector de posición/clase en su lugar.
            page.get_by_role("button", name="Entrar").click()

            page.wait_for_load_state("networkidle", timeout=15_000)
            log.info("Login enviado. Verifica manualmente que llegaste al home autenticado.")

            # --- A partir de aquí NO hay selectores confiables que yo
            # pueda escribir sin ver la app corriendo -- son los "pasos
            # exactos" pedidos, como bitácora de lo que el bot tendría que
            # hacer, cada uno marcado con el punto exacto que falta
            # confirmar:
            log.info("PASO SIGUIENTE (AJUSTAR): navegar al proyecto de obra correspondiente.")
            log.info("  -> Buscar el selector real de la tarjeta/fila de proyecto en la pantalla de lista de proyectos.")
            log.info("PASO SIGUIENTE (AJUSTAR): entrar al nodo tipo 'Estación' donde se captura clima.")
            log.info("  -> Ver árbol de nodos; el nodo debe tener tipo_nodo == 'estacion' y Acceso al Predio habilitado.")
            log.info("PASO SIGUIENTE (AJUSTAR): abrir el formulario del módulo 'Estado del Tiempo'.")
            log.info("PASO SIGUIENTE (AJUSTAR): llenar los campos con la lectura horaria más cercana a ahora (%s):", lectura.hora_local)
            log.info("    Temperatura (°C)      -> %.1f", lectura.temperature_c or 0)
            log.info("    Viento (km/h, a 10 m) -> %.1f", lectura.wind_kmh or 0)
            log.info("    Precipitación (mm)    -> %.1f", lectura.precipitation_mm or 0)
            log.info("    Calidad del aire (AQI)-> %s", lectura.us_aqi)
            log.info("PASO SIGUIENTE (AJUSTAR): confirmar/guardar el formulario y verificar el toast/mensaje de éxito.")
            log.info(
                "NOTA: cada uno de estos pasos corresponde exactamente a lo que ya hace "
                "PUT /api/projects/{pid}/weather-logs en una sola llamada HTTP -- "
                "ver weather_openmeteo_export.py con --push."
            )

        except PlaywrightTimeoutError as exc:
            log.error("Timeout esperando un elemento de la página: %s", exc)
            page.screenshot(path="synco_rpa_error.png")
            log.error("Screenshot guardado en synco_rpa_error.png para depurar el selector que falló.")
            raise
        finally:
            browser.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--headed", action="store_true", help="Corre con navegador visible (para depurar selectores)")
    args = parser.parse_args()

    # Reutiliza la misma consulta a Open-Meteo que weather_openmeteo_export.py
    # (hourly, viento a 10 m) y toma la lectura más cercana a ahora, igual
    # que hace `--push` en ese script.
    from weather_openmeteo_export import _lectura_mas_cercana_a_ahora, obtener_clima_horario

    try:
        lecturas = obtener_clima_horario(19.4284, -99.1276)  # AJUSTAR AQUÍ: lat/lon de la estación real
        lectura = _lectura_mas_cercana_a_ahora(lecturas)
    except Exception as exc:  # noqa: BLE001 -- se reporta y se aborta, no tiene sentido seguir sin datos
        log.error("No se pudo obtener clima de Open-Meteo: %s", exc)
        return 1

    try:
        iniciar_sesion(headed=args.headed, lectura=lectura)
    except ConfiguracionFaltanteError as exc:
        log.error(str(exc))
        return 1
    except ImportError:
        log.error("Playwright no está instalado. Corre: pip install playwright && playwright install chromium")
        return 1
    except Exception as exc:  # noqa: BLE001 -- error de RPA ya logueado con detalle arriba
        log.error("El bot no pudo completar el flujo: %s", exc)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
