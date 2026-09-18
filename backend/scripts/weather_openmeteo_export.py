#!/usr/bin/env python
"""Integración Open-Meteo -> "Reporte de Obra Diario" de SynCo.

CONTEXTO
--------
SynCo ya tiene, dentro de este mismo backend, un módulo "Estado del Tiempo"
con endpoints REALES para capturar clima por nodo/día (ver `server.py`,
sección "Módulo Estado del Tiempo", clase `WeatherLogIn` y los endpoints
`GET/PUT /api/projects/{pid}/weather-logs`). Es decir: NO hace falta
scraping ni un webhook hipotético -- ya existe una API HTTP documentada
(JWT via `POST /api/auth/login`) para subir estos datos.

Este script:
    1. Consulta Open-Meteo (clima + calidad del aire) en resolución HORARIA
       (`hourly=...`) para el día de hoy (huso horario CDMX), para una o
       varias estaciones (lat/lon). Viento a 10 m de altura
       (`wind_speed_10m`), la altura estándar de superficie -- no a 180 m,
       que solo aplicaría a viento en grúas/torres muy altas.
    2. Arma, por estación, un `ReporteClimaDiario` con una lista de
       `LecturaHoraria` (una por hora del día) usando los mismos nombres de
       campo que ya usa SynCo internamente (`_fetch_weather_for_export`:
       temperature_c, wind_kmh, precipitation_mm, us_aqi) + metadata de
       trazabilidad.
    3. Exporta a CSV (una fila por hora por estación -- formato largo, el
       más fácil de importar/filtrar) y a JSON (anidado, una entrada por
       estación con su lista de lecturas horarias completa).
    4. Opcionalmente (--push) sube al endpoint real de SynCo la lectura
       horaria más cercana a la hora actual -- el endpoint de SynCo guarda
       UN valor por nodo/día (upsert), no una serie horaria, así que no
       tiene un lugar natural donde meter las 24 lecturas; ver la función
       `_lectura_mas_cercana_a_ahora` si en vez de eso prefieres subir un
       agregado del día (máximo de precipitación, promedio de temperatura,
       etc.) -- es un cambio de una línea en `subir_reporte_clima`.

USO
---
    cd backend
    python scripts/weather_openmeteo_export.py --config estaciones.json --outdir ./salida

    # Además de exportar, subirlo directo a SynCo (requiere credenciales
    # por variable de entorno, ver más abajo):
    python scripts/weather_openmeteo_export.py --config estaciones.json --outdir ./salida --push

CONFIGURACIÓN DE ESTACIONES (--config, JSON)
---------------------------------------------
Lista de estaciones a consultar. `node_id` es el id del LocationNode tipo
"Estación" en SynCo (ver GET /api/projects/{pid}/nodes) -- solo se necesita
si vas a usar --push; para solo exportar CSV/JSON puedes omitirlo.

    [
      {"nombre": "Estación CDMX Centro", "lat": 19.4284, "lon": -99.1276,
       "project_id": "<id-del-proyecto-en-synco>", "node_id": "<id-del-nodo>"}
    ]

VARIABLES DE ENTORNO (solo si usas --push; NUNCA hardcodear credenciales)
--------------------------------------------------------------------------
    SYNCO_BASE_URL   Ej: https://apm-app.mx/api  (usa siempre HTTPS en prod)
    SYNCO_EMAIL      Correo del usuario con acceso al proyecto
    SYNCO_PASSWORD   Contraseña de ese usuario
      -- o, en vez de email/password, un token ya vigente: --
    SYNCO_TOKEN      Un JWT ya emitido (evita loguear en cada corrida)

AJUSTES QUE DEBES REVISAR ANTES DE USAR EN PRODUCCIÓN
-------------------------------------------------------
    - SYNCO_BASE_URL: por default apunta a producción (apm-app.mx); usa un
      ambiente de staging si tu organización tiene uno para probar.
    - `project_id`/`node_id` en el config: son ids reales de tu proyecto en
      SynCo, no inventados -- consíguelos con GET /api/projects y
      GET /api/projects/{pid}/nodes autenticado.
    - El nodo destino debe ser tipo "Estación" (tipo_nodo == "estacion") y
      tener Acceso al Predio habilitado, o el PUT devuelve 400 (ver
      `_node_es_estacion_habilitada` en server.py).
    - El módulo "estado_tiempo" debe estar activo en el proyecto
      (`_ensure_modulo_activo`), o el PUT devuelve 403/404 según el caso.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from zoneinfo import ZoneInfo

import requests

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("weather_openmeteo_export")

OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
CDMX_TZ = ZoneInfo("America/Mexico_City")

HTTP_TIMEOUT_S = 15
HTTP_MAX_RETRIES = 3
HTTP_RETRY_BACKOFF_S = 2


class WeatherFetchError(RuntimeError):
    """No se pudo obtener clima/calidad del aire de Open-Meteo."""


class SyncoApiError(RuntimeError):
    """La API de SynCo respondió con un error (auth, validación, etc.)."""


@dataclass
class LecturaHoraria:
    """Una lectura de una hora específica del día (huso CDMX).

    Nombres de campo idénticos a los que ya usa SynCo internamente
    (`_fetch_weather_for_export` / `WeatherLogIn` en server.py) para no
    tener que traducir nombres de columna al importar.
    """

    hora_local: str  # "YYYY-MM-DDTHH:MM", hora local CDMX que reporta Open-Meteo
    temperature_c: Optional[float] = None
    wind_kmh: Optional[float] = None
    precipitation_mm: Optional[float] = None
    us_aqi: Optional[float] = None
    european_aqi: Optional[float] = None
    pm10: Optional[float] = None
    pm2_5: Optional[float] = None


@dataclass
class ReporteClimaDiario:
    """Reporte de Obra Diario (bloque clima) de una estación: metadata +
    la serie de lecturas horarias del día."""

    estacion_nombre: str
    lat: float
    lon: float
    fecha_cdmx: str  # YYYY-MM-DD, día de obra en huso horario CDMX
    hora_consulta_utc: str  # ISO-8601, cuándo se corrió el script
    project_id: Optional[str] = None
    node_id: Optional[str] = None
    fuente: str = "open-meteo"
    lecturas: list[LecturaHoraria] = field(default_factory=list)


def _get_con_reintentos(url: str, params: dict) -> dict:
    """GET con reintentos y backoff -- Open-Meteo es un servicio externo y
    puede fallar por red/rate-limit; no queremos tumbar todo el reporte
    diario por un timeout transitorio."""
    ultimo_error: Optional[Exception] = None
    for intento in range(1, HTTP_MAX_RETRIES + 1):
        try:
            resp = requests.get(url, params=params, timeout=HTTP_TIMEOUT_S)
            resp.raise_for_status()
            return resp.json()
        except (requests.RequestException, ValueError) as exc:
            ultimo_error = exc
            log.warning("Intento %d/%d falló para %s: %s", intento, HTTP_MAX_RETRIES, url, exc)
            if intento < HTTP_MAX_RETRIES:
                time.sleep(HTTP_RETRY_BACKOFF_S * intento)
    raise WeatherFetchError(f"No se pudo consultar {url} tras {HTTP_MAX_RETRIES} intentos") from ultimo_error


def obtener_clima_horario(lat: float, lon: float) -> list[LecturaHoraria]:
    """Consulta clima + calidad del aire por hora, para el día de hoy en
    huso horario CDMX (`forecast_days=1`, sin `past_days`, con
    `timezone=America/Mexico_City` para que las horas devueltas ya vengan
    alineadas al día local en vez de UTC).

    Viento a 10 m de altura (`wind_speed_10m`), la altura estándar de
    superficie para condiciones de obra a nivel de piso.
    """
    params_clima = {
        "latitude": lat,
        "longitude": lon,
        "hourly": "temperature_2m,precipitation,wind_speed_10m",
        "timezone": "America/Mexico_City",
        "forecast_days": 1,
    }
    params_calidad = {
        "latitude": lat,
        "longitude": lon,
        "hourly": "european_aqi,us_aqi,pm10,pm2_5",
        "timezone": "America/Mexico_City",
        "forecast_days": 1,
    }

    clima = _get_con_reintentos(OPEN_METEO_FORECAST_URL, params_clima).get("hourly", {})
    calidad = _get_con_reintentos(OPEN_METEO_AIR_QUALITY_URL, params_calidad).get("hourly", {})

    horas = clima.get("time") or calidad.get("time")
    if not horas:
        raise WeatherFetchError(f"Open-Meteo no devolvió datos 'hourly' para lat={lat}, lon={lon}")

    # Los dos endpoints comparten la misma malla horaria cuando se pide el
    # mismo timezone/forecast_days, así que alinean por índice sin necesidad
    # de cruzarlas por el valor de "time" -- si algún día dejan de coincidir
    # en longitud, es más seguro fallar aquí que reportar horas cruzadas.
    n = len(horas)
    for nombre_serie, serie in (("clima", clima.get("time")), ("calidad", calidad.get("time"))):
        if serie is not None and len(serie) != n:
            raise WeatherFetchError(
                f"Series horarias desalineadas entre clima y calidad del aire "
                f"({nombre_serie} trae {len(serie)} horas, se esperaban {n})"
            )

    def _en(serie: Optional[list], i: int) -> Optional[float]:
        return serie[i] if serie is not None else None

    return [
        LecturaHoraria(
            hora_local=horas[i],
            temperature_c=_en(clima.get("temperature_2m"), i),
            wind_kmh=_en(clima.get("wind_speed_10m"), i),
            precipitation_mm=_en(clima.get("precipitation"), i),
            us_aqi=_en(calidad.get("us_aqi"), i),
            european_aqi=_en(calidad.get("european_aqi"), i),
            pm10=_en(calidad.get("pm10"), i),
            pm2_5=_en(calidad.get("pm2_5"), i),
        )
        for i in range(n)
    ]


def _lectura_mas_cercana_a_ahora(lecturas: list[LecturaHoraria]) -> LecturaHoraria:
    """Para --push: el endpoint de SynCo guarda un solo valor por nodo/día,
    así que se sube la lectura horaria más cercana al momento actual (en
    vez de las 24 horas completas, que sólo van al CSV/JSON)."""
    ahora = datetime.now(CDMX_TZ).replace(tzinfo=None)
    return min(lecturas, key=lambda l: abs(datetime.fromisoformat(l.hora_local) - ahora))


def construir_reporte(
    nombre: str, lat: float, lon: float,
    project_id: Optional[str] = None, node_id: Optional[str] = None,
) -> ReporteClimaDiario:
    """Arma el registro con la estructura de Reporte de Obra Diario a
    partir de la respuesta cruda de Open-Meteo."""
    lecturas = obtener_clima_horario(lat, lon)
    ahora_utc = datetime.now(timezone.utc)

    return ReporteClimaDiario(
        estacion_nombre=nombre,
        lat=lat,
        lon=lon,
        fecha_cdmx=ahora_utc.astimezone(CDMX_TZ).date().isoformat(),
        hora_consulta_utc=ahora_utc.isoformat(),
        project_id=project_id,
        node_id=node_id,
        lecturas=lecturas,
    )


def exportar_csv(reportes: list[ReporteClimaDiario], ruta: Path) -> None:
    """Una fila por hora por estación (formato largo) -- el más simple de
    abrir en Excel/importar a otra herramienta sin aplanar arreglos."""
    if not reportes:
        log.warning("No hay reportes que exportar a CSV (%s)", ruta)
        return

    campos = [
        "estacion_nombre", "lat", "lon", "project_id", "node_id", "fuente",
        "fecha_cdmx", "hora_consulta_utc", "hora_local",
        "temperature_c", "wind_kmh", "precipitation_mm",
        "us_aqi", "european_aqi", "pm10", "pm2_5",
    ]
    ruta.parent.mkdir(parents=True, exist_ok=True)
    total_filas = 0
    with ruta.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=campos)
        writer.writeheader()
        for r in reportes:
            base = {
                "estacion_nombre": r.estacion_nombre, "lat": r.lat, "lon": r.lon,
                "project_id": r.project_id, "node_id": r.node_id, "fuente": r.fuente,
                "fecha_cdmx": r.fecha_cdmx, "hora_consulta_utc": r.hora_consulta_utc,
            }
            for lectura in r.lecturas:
                writer.writerow({**base, "hora_local": lectura.hora_local, **{
                    k: v for k, v in asdict(lectura).items() if k != "hora_local"
                }})
                total_filas += 1
    log.info("CSV exportado: %s (%d filas, %d estaciones)", ruta, total_filas, len(reportes))


def exportar_json(reportes: list[ReporteClimaDiario], ruta: Path) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "tipo": "reporte_obra_diario_clima",
        "resolucion": "hourly",
        "generado_en_utc": datetime.now(timezone.utc).isoformat(),
        "registros": [asdict(r) for r in reportes],
    }
    with ruta.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    log.info("JSON exportado: %s (%d registros)", ruta, len(reportes))


# --- Integración real con la API de SynCo (bonus: el endpoint SÍ existe) ---

class ClienteSynco:
    """Cliente mínimo para la API real de SynCo.

    Usa las credenciales SOLO desde variables de entorno -- nunca las
    recibe como argumento de línea de comandos ni las hardcodea, para no
    dejarlas en el historial de shell ni en logs de proceso.
    """

    def __init__(self, base_url: str, token: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        if token:
            self.session.headers["Authorization"] = f"Bearer {token}"

    @classmethod
    def desde_entorno(cls) -> "ClienteSynco":
        base_url = os.environ.get("SYNCO_BASE_URL", "https://apm-app.mx/api")
        token = os.environ.get("SYNCO_TOKEN")
        cliente = cls(base_url, token=token)
        if not token:
            email = os.environ.get("SYNCO_EMAIL")
            password = os.environ.get("SYNCO_PASSWORD")
            if not email or not password:
                raise SyncoApiError(
                    "Define SYNCO_TOKEN, o SYNCO_EMAIL + SYNCO_PASSWORD, como "
                    "variables de entorno antes de usar --push."
                )
            cliente.login(email, password)
        return cliente

    def login(self, email: str, password: str) -> None:
        """POST /api/auth/login -- devuelve un JWT (ver `make_token` en
        server.py) que se manda como 'Authorization: Bearer <token>' en
        cada request subsiguiente."""
        try:
            resp = self.session.post(
                f"{self.base_url}/auth/login",
                json={"email": email, "password": password},
                timeout=HTTP_TIMEOUT_S,
            )
            resp.raise_for_status()
        except requests.RequestException as exc:
            raise SyncoApiError(f"Login a SynCo falló: {exc}") from exc

        data = resp.json()
        token = data.get("token")
        if not token:
            raise SyncoApiError("Respuesta de login sin 'token'")
        self.session.headers["Authorization"] = f"Bearer {token}"
        log.info("Login a SynCo OK (usuario: %s)", data.get("user", {}).get("email", email))

    def subir_reporte_clima(self, reporte: ReporteClimaDiario) -> dict:
        """PUT /api/projects/{project_id}/weather-logs

        Requiere que `reporte.project_id` y `reporte.node_id` estén
        definidos (vienen del config de estaciones), y que el nodo sea una
        Estación con Acceso al Predio habilitado y el módulo
        "estado_tiempo" activo en el proyecto -- si no, la API responde
        400/403/404 y por eso NO se debe silenciar el error aquí.

        El endpoint guarda un solo valor por nodo/día (upsert), así que se
        sube la lectura horaria más cercana a la hora actual -- no las 24
        horas completas (esas sólo van al CSV/JSON)."""
        if not reporte.project_id or not reporte.node_id:
            raise SyncoApiError(
                f"'{reporte.estacion_nombre}' no tiene project_id/node_id en el "
                "config -- agrégalos para poder usar --push."
            )
        if not reporte.lecturas:
            raise SyncoApiError(f"'{reporte.estacion_nombre}' no tiene lecturas horarias que subir")

        lectura = _lectura_mas_cercana_a_ahora(reporte.lecturas)
        url = f"{self.base_url}/projects/{reporte.project_id}/weather-logs"
        body = {
            "node_id": reporte.node_id,
            "temperature_c": lectura.temperature_c,
            "wind_kmh": lectura.wind_kmh,
            "precipitation_mm": lectura.precipitation_mm,
            "us_aqi": lectura.us_aqi,
        }
        try:
            resp = self.session.put(url, json=body, timeout=HTTP_TIMEOUT_S)
            resp.raise_for_status()
        except requests.HTTPError as exc:
            detalle = exc.response.text if exc.response is not None else str(exc)
            raise SyncoApiError(
                f"PUT weather-logs falló para nodo {reporte.node_id}: "
                f"HTTP {exc.response.status_code if exc.response is not None else '?'} - {detalle}"
            ) from exc
        except requests.RequestException as exc:
            raise SyncoApiError(f"PUT weather-logs falló para nodo {reporte.node_id}: {exc}") from exc

        return resp.json()


def cargar_estaciones(ruta_config: Path) -> list[dict]:
    with ruta_config.open("r", encoding="utf-8") as f:
        estaciones = json.load(f)
    if not isinstance(estaciones, list) or not estaciones:
        raise ValueError(f"{ruta_config} debe contener una lista JSON no vacía de estaciones")
    for e in estaciones:
        if "lat" not in e or "lon" not in e or "nombre" not in e:
            raise ValueError(f"Estación mal formada (falta nombre/lat/lon): {e}")
    return estaciones


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", required=True, type=Path, help="JSON con la lista de estaciones a consultar")
    parser.add_argument("--outdir", required=True, type=Path, help="Carpeta donde se escriben el CSV y JSON")
    parser.add_argument("--push", action="store_true", help="Además de exportar, sube la lectura más reciente de cada estación a SynCo vía su API real")
    args = parser.parse_args()

    try:
        estaciones = cargar_estaciones(args.config)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        log.error("No se pudo leer el config de estaciones: %s", exc)
        return 1

    reportes: list[ReporteClimaDiario] = []
    errores = 0
    for est in estaciones:
        try:
            reporte = construir_reporte(
                nombre=est["nombre"], lat=est["lat"], lon=est["lon"],
                project_id=est.get("project_id"), node_id=est.get("node_id"),
            )
            reportes.append(reporte)
            actual = _lectura_mas_cercana_a_ahora(reporte.lecturas)
            log.info(
                "Clima obtenido para '%s' (%d horas, lectura actual %s): %.1f°C, %.1f mm, AQI %s",
                reporte.estacion_nombre, len(reporte.lecturas), actual.hora_local,
                actual.temperature_c or 0, actual.precipitation_mm or 0, actual.us_aqi,
            )
        except WeatherFetchError as exc:
            errores += 1
            log.error("Estación '%s' omitida: %s", est.get("nombre", "?"), exc)

    if not reportes:
        log.error("Ninguna estación pudo consultarse; no se genera ningún archivo.")
        return 1

    fecha_tag = datetime.now(CDMX_TZ).strftime("%Y%m%d")
    exportar_csv(reportes, args.outdir / f"reporte_obra_diario_clima_{fecha_tag}.csv")
    exportar_json(reportes, args.outdir / f"reporte_obra_diario_clima_{fecha_tag}.json")

    if args.push:
        try:
            cliente = ClienteSynco.desde_entorno()
        except SyncoApiError as exc:
            log.error("No se pudo preparar el cliente de SynCo: %s", exc)
            return 1

        for reporte in reportes:
            try:
                resultado = cliente.subir_reporte_clima(reporte)
                log.info("Subido a SynCo: %s -> weather_log id=%s", reporte.estacion_nombre, resultado.get("id"))
            except SyncoApiError as exc:
                errores += 1
                log.error("No se pudo subir '%s' a SynCo: %s", reporte.estacion_nombre, exc)

    return 1 if errores else 0


if __name__ == "__main__":
    sys.exit(main())
