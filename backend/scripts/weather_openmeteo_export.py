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

MODO POR DEFECTO: AUTO-DESCUBRIMIENTO
--------------------------------------
Sin `--config`, el script se auto-descubre contra la propia API de SynCo:
    1. Lista TODOS tus proyectos (`GET /api/projects`) -- incluidos los que
       crees después de hoy, no hay ids hardcodeados en ningún lado.
    2. Para cada proyecto con el módulo "estado_tiempo" activo, lista sus
       nodos y filtra los que son "Estación" habilitada (misma regla que
       `_node_es_estacion_habilitada`/`_acceso_predio_efectivo` en
       server.py: tipo_nodo == "estacion" y acceso_predio_habilitado
       True, o profundidad 1 si nadie lo tocó explícitamente).
    3. Para cada estación, resuelve su coordenada: primero
       `target_lat`/`target_lon` del nodo; si no están, la toma de la
       ÚLTIMA lectura de campo capturada ahí (`GET
       /nodes/{id}/history`, `measurement_value.lat/lon`) -- si nunca se
       ha capturado nada en ese nodo, se omite (no se inventa coordenada).
    4. *** IMPORTANTE: esas coordenadas están en UTM (Este/Norte), NO en
       grados WGS84 *** -- confirmado en el código (`validate_measurement_value`
       en server.py y el formulario de nodos en el frontend, `tree.tsx`:
       "Coordenada X (Este)"/"Y (Norte)", sin restricción -90/90). Se
       convierten a lat/lon con `pyproj` usando la zona UTM de
       `--utm-zone`/`SYNCO_UTM_ZONE` (default 14, hemisferio norte --
       correcto para Ciudad de México; AJUSTAR si algún proyecto futuro
       cae en otra zona -- ver advertencia en `convertir_utm_a_latlon`).

Con `--config <archivo.json>` se usa la lista de estaciones ahí definida en
vez de auto-descubrir -- útil para pruebas locales con lat/lon ya conocidas.

Una vez con la lista de estaciones (auto o de config), el script:
    1. Consulta Open-Meteo (clima + calidad del aire) en resolución HORARIA
       (`hourly=...`) para el día de hoy (huso horario CDMX). Viento a 10 m
       de altura (`wind_speed_10m`), la altura estándar de superficie.
    2. Arma, por estación, un `ReporteClimaDiario` con una lista de
       `LecturaHoraria` (una por hora) usando los mismos nombres de campo
       que ya usa SynCo internamente (`_fetch_weather_for_export`:
       temperature_c, wind_kmh, precipitation_mm, us_aqi).
    3. Exporta a CSV (una fila por hora por estación) y JSON (anidado) --
       bitácora de auditoría de cada corrida, además de lo que se sube.
    4. Con `--push`, sube a SynCo la lectura horaria más cercana a la hora
       actual -- el endpoint guarda un solo valor por nodo/día (upsert).

USO
---
    cd backend

    # Simulación (no escribe nada en SynCo, solo exporta CSV/JSON):
    python scripts/weather_openmeteo_export.py

    # Auto-descubrimiento + push real a TODOS los proyectos elegibles:
    python scripts/weather_openmeteo_export.py --push

    # Modo manual con estaciones explícitas (sin tocar la API de proyectos):
    python scripts/weather_openmeteo_export.py --config estaciones.json --push

PROGRAMARLO A DIARIO (cron, en el servidor de producción)
--------------------------------------------------------------
    1. Copia weather_synco.env.example a ".env" en esta misma carpeta y
       rellena SYNCO_EMAIL/SYNCO_PASSWORD ahí (NUNCA en el crontab ni en
       el repo -- el script lo carga solo si existe, vía `python-dotenv`).
    2. Agrega al crontab del usuario que corre el backend (`crontab -e`):

        0 7 * * * cd /ruta/a/backend && /ruta/a/tu/venv/bin/python scripts/weather_openmeteo_export.py --push >> scripts/salida_clima/cron.log 2>&1

       Corre una vez al día a las 7am hora del servidor -- ajusta la hora
       si tu servidor no está en huso CDMX. Sube UNA lectura representativa
       por estación (la más cercana a las 7am), consistente con que el
       módulo "Estado del Tiempo" es una captura por día, no continua.

VARIABLES DE ENTORNO (NUNCA hardcodear credenciales; ver .env.example)
--------------------------------------------------------------------------
    SYNCO_BASE_URL   Ej: https://apm-app.mx/api  (default; usa HTTPS)
    SYNCO_EMAIL      Correo del usuario con acceso a los proyectos
    SYNCO_PASSWORD   Contraseña de ese usuario
      -- o, en vez de email/password, un token ya vigente: --
    SYNCO_TOKEN      Un JWT ya emitido
    SYNCO_UTM_ZONE   Zona UTM (número, ej. "14") de tus proyectos -- default 14

CONFIGURACIÓN DE ESTACIONES (--config, JSON, modo manual)
-------------------------------------------------------------
    [
      {"nombre": "Estación CDMX Centro", "lat": 19.4284, "lon": -99.1276,
       "project_id": "<id-del-proyecto-en-synco>", "node_id": "<id-del-nodo>"}
    ]
    (aquí lat/lon SÍ son grados WGS84 -- a diferencia del modo auto, que
    convierte desde UTM, en modo manual tú ya das la coordenada final.)

LIMITACIONES A REVISAR
-------------------------
    - Si tu organización tiene proyectos en más de una zona UTM, este
      script asume UNA sola zona global (`--utm-zone`) para todos --
      no hay mapeo por proyecto. Con un solo valor global incorrecto para
      alguno de tus proyectos, sus estaciones quedarían con coordenadas (y
      por tanto clima) erróneas -- REVISA la salida antes de confiar en
      --push para un proyecto en una región distinta a la ya validada.
    - Una estación sin ninguna coordenada capturada nunca (ni
      target_lat/lon ni un reporte de campo con lat/lon) se omite --  no
      hay forma de inventarle una ubicación.
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
from dotenv import load_dotenv

# Carga scripts/.env si existe (credenciales del cron diario -- ese archivo
# NUNCA se commitea, ver .gitignore raíz: ".env", ".env.*", "*.env"). Si ya
# hay variables de entorno puestas por otro medio, esas tienen prioridad
# (override=False, el default de load_dotenv).
load_dotenv(Path(__file__).parent / ".env")

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

DEFAULT_OUTDIR = Path(__file__).parent / "salida_clima"


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


def _separar_este_norte(a: float, b: float) -> tuple[float, float]:
    """Determina cuál de los dos números es Este (Easting) y cuál Norte
    (Northing) POR MAGNITUD, no por nombre de campo -- en México el Este
    UTM siempre es < 1,000,000 (rango típico 200,000-800,000, falso este
    de 500,000) y el Norte siempre > 1,000,000 (rango típico
    1,900,000-3,700,000 para las latitudes del país). Esto evita
    depender de qué tan consistentemente se nombraron los campos
    `lat`/`lon` en cada formulario de captura de SynCo -- confirmamos que
    NO es consistente entre `target_lat`/`target_lon` (nodo) y
    `measurement_value.lat/lon` (reporte de campo): en uno el campo `lat`
    resultó ser el Este y en el otro el Norte."""
    umbral = 1_000_000
    a_es_este, b_es_este = a < umbral, b < umbral
    if a_es_este and not b_es_este:
        return a, b
    if b_es_este and not a_es_este:
        return b, a
    raise ValueError(f"No se pudo distinguir Este/Norte por magnitud: valores {a}, {b}")


def convertir_utm_a_latlon(este: float, norte: float, zona: int) -> tuple[float, float]:
    """SynCo guarda las coordenadas de obra en UTM (Este/Norte), no en
    grados WGS84 -- ver el docstring del módulo. Convierte con `pyproj`
    asumiendo hemisferio norte (correcto para México; si algún proyecto
    futuro cayera en el hemisferio sur habría que parametrizar también
    eso, no solo la zona)."""
    from pyproj import Transformer

    epsg_utm = 32600 + zona  # EPSG:326xx = WGS84 / UTM zone xxN
    transformer = Transformer.from_crs(f"EPSG:{epsg_utm}", "EPSG:4326", always_xy=True)
    lon, lat = transformer.transform(este, norte)
    return lat, lon


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

    def listar_proyectos(self) -> list[dict]:
        resp = self.session.get(f"{self.base_url}/projects", timeout=HTTP_TIMEOUT_S)
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list):
            return data
        return data.get("projects") or data.get("items") or []

    def listar_nodos(self, project_id: str) -> list[dict]:
        resp = self.session.get(f"{self.base_url}/projects/{project_id}/nodes", timeout=HTTP_TIMEOUT_S)
        resp.raise_for_status()
        data = resp.json()
        return data.get("items") if isinstance(data, dict) else (data or [])

    def historial_nodo(self, project_id: str, node_id: str) -> Optional[dict]:
        """GET /projects/{pid}/nodes/{nid}/history -- última lectura de
        campo capturada en ese nodo (para nodos sin target_lat/lon fijo)."""
        resp = self.session.get(
            f"{self.base_url}/projects/{project_id}/nodes/{node_id}/history", timeout=HTTP_TIMEOUT_S,
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        return data.get("last_report") if data.get("has_previous") else None

    def subir_reporte_clima(self, reporte: ReporteClimaDiario) -> dict:
        """PUT /api/projects/{project_id}/weather-logs

        Requiere que `reporte.project_id` y `reporte.node_id` estén
        definidos, y que el nodo sea una Estación con Acceso al Predio
        habilitado y el módulo "estado_tiempo" activo en el proyecto -- si
        no, la API responde 400/403/404 y por eso NO se debe silenciar el
        error aquí.

        El endpoint guarda un solo valor por nodo/día (upsert), así que se
        sube la lectura horaria más cercana a la hora actual -- no las 24
        horas completas (esas sólo van al CSV/JSON)."""
        if not reporte.project_id or not reporte.node_id:
            raise SyncoApiError(
                f"'{reporte.estacion_nombre}' no tiene project_id/node_id -- "
                "agrégalos (o usa el modo auto-descubrimiento) para poder usar --push."
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


def _acceso_predio_efectivo(node: dict) -> bool:
    """Réplica exacta de `_acceso_predio_efectivo` en server.py -- default
    "habilitado" solo a profundidad 1 (Subtramo) si nadie lo tocó."""
    habilitado = node.get("acceso_predio_habilitado")
    return habilitado if habilitado is not None else (node.get("depth") == 1)


def _es_estacion_habilitada(node: dict) -> bool:
    """Réplica exacta de `_node_es_estacion_habilitada` en server.py."""
    return _acceso_predio_efectivo(node) and (node.get("tipo_nodo") or "estacion") == "estacion"


def _modulo_estado_tiempo_activo(project: dict) -> bool:
    modulos = project.get("modulos") or {}
    return any((modulos.get(categoria) or {}).get("estado_tiempo") for categoria in modulos)


def descubrir_estaciones(cliente: ClienteSynco, utm_zone: int) -> list[dict]:
    """Recorre TODOS los proyectos accesibles con este usuario y arma la
    lista de estaciones con coordenada resuelta -- sin ids hardcodeados,
    así que un proyecto creado mañana se incluye solo con volver a correr
    el script."""
    estaciones: list[dict] = []
    proyectos = cliente.listar_proyectos()
    log.info("Proyectos encontrados: %d", len(proyectos))

    for proyecto in proyectos:
        pid = proyecto.get("id")
        nombre_proyecto = proyecto.get("name") or proyecto.get("nombre") or pid
        if not _modulo_estado_tiempo_activo(proyecto):
            log.info("Proyecto '%s': módulo 'estado_tiempo' no activo, se omite.", nombre_proyecto)
            continue

        nodos = cliente.listar_nodos(pid)
        elegibles = [n for n in nodos if _es_estacion_habilitada(n)]
        log.info("Proyecto '%s': %d estaciones elegibles de %d nodos.", nombre_proyecto, len(elegibles), len(nodos))

        for nodo in elegibles:
            valor_a, valor_b, fuente = nodo.get("target_lat"), nodo.get("target_lon"), "target_lat/lon del nodo"
            if valor_a is None or valor_b is None:
                ultimo = cliente.historial_nodo(pid, nodo["id"])
                mv = (ultimo or {}).get("measurement_value") or {}
                valor_a, valor_b = mv.get("lat"), mv.get("lon")
                fuente = "última lectura de campo"
            if valor_a is None or valor_b is None:
                log.warning(
                    "  '%s' (%s): sin coordenada capturada nunca -- se omite (no se inventa ubicación).",
                    nodo.get("name"), nodo["id"],
                )
                continue
            try:
                este, norte = _separar_este_norte(valor_a, valor_b)
                lat, lon = convertir_utm_a_latlon(este, norte, utm_zone)
            except Exception as exc:  # noqa: BLE001 -- error de conversión, se reporta y se omite esta estación
                log.error("  '%s' (%s): no se pudo convertir UTM->WGS84 (%s): %s", nodo.get("name"), nodo["id"], fuente, exc)
                continue
            log.info("  '%s': UTM(E=%.2f, N=%.2f) -> lat=%.5f, lon=%.5f [%s]", nodo.get("name"), este, norte, lat, lon, fuente)
            estaciones.append({
                "nombre": f"{nombre_proyecto} / {nodo.get('name')}",
                "lat": lat, "lon": lon,
                "project_id": pid, "node_id": nodo["id"],
            })

    return estaciones


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
    parser.add_argument("--config", type=Path, default=None, help="JSON con estaciones explícitas (omite el auto-descubrimiento)")
    parser.add_argument("--outdir", type=Path, default=DEFAULT_OUTDIR, help=f"Carpeta de salida CSV/JSON (default: {DEFAULT_OUTDIR})")
    parser.add_argument("--push", action="store_true", help="Además de exportar, sube la lectura más reciente de cada estación a SynCo vía su API real")
    parser.add_argument("--utm-zone", type=int, default=int(os.environ.get("SYNCO_UTM_ZONE", "14")), help="Zona UTM (norte) para convertir coordenadas en modo auto-descubrimiento (default 14, CDMX)")
    args = parser.parse_args()

    cliente: Optional[ClienteSynco] = None

    if args.config:
        try:
            estaciones = cargar_estaciones(args.config)
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            log.error("No se pudo leer el config de estaciones: %s", exc)
            return 1
    else:
        try:
            cliente = ClienteSynco.desde_entorno()
        except SyncoApiError as exc:
            log.error("No se pudo autenticar contra SynCo para auto-descubrir estaciones: %s", exc)
            return 1
        estaciones = descubrir_estaciones(cliente, args.utm_zone)
        if not estaciones:
            log.warning("No se encontró ninguna estación con coordenada resoluble en ningún proyecto.")
            return 0

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
        if cliente is None:
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
