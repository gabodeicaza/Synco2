"""Informe diario por ingeniero (corte 19:00 + resumen IA): helpers puros, corte por
zona horaria y el límite de ritmo / reintentos hacia Gemini. Sin red ni Mongo."""
import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_informe_diario")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
import server  # noqa: E402


def utc(*a):
    return datetime(*a, tzinfo=timezone.utc)


def _rep(**kw):
    base = {
        "id": "r1", "created_at": utc(2026, 10, 22, 17, 1), "node_path_names": ["L4", "Estación 4", "Campo Xóchitl"],
        "area_name": "Obra civil", "gravedad": "verde",
        "actividades_items": [{"texto": "  Retiro   de escombro ", "gravedad": "verde"}, {"texto": ""}],
        "personnel": ["1 cabo", "6 oficiales"], "equipment": ["Excavadora :: CAT :: 320 :: EX-321", "Herramienta menor"],
        "observaciones": "Se supervisó la seguridad", "incidencias": "", "images": ["a", "b"], "photo_captions": ["Foto uno"],
    }
    base.update(kw)
    return base


def test_bloque_sigue_la_plantilla():
    b = server._informe_bloque_de_reporte(_rep(), {"zona_horaria": "America/Mexico_City"})
    assert b["hora"] == "11:01"  # 17:01 UTC = 11:01 CDMX
    assert b["ubicacion"] == "L4 › Estación 4 › Campo Xóchitl"
    assert b["estatus"] == "En proceso de ejecución"
    assert b["actividades"] == ["Retiro de escombro"]
    assert b["fuerza_trabajo"] == "1 cabo, 6 oficiales"
    assert b["equipo"] == "Excavadora CAT 320 (EX-321), Herramienta menor"
    assert b["fotos"] == [{"idx": 0, "caption": "Foto uno"}, {"idx": 1, "caption": ""}]


def test_bloque_estatus_por_gravedad_y_sin_ubicacion():
    b = server._informe_bloque_de_reporte(_rep(gravedad="rojo", node_path_names=[], actividades_items=[], actividades="a\nb"))
    assert b["estatus"] == "Requiere atención"
    assert b["ubicacion"] == "Sin ubicación"
    assert b["actividades"] == ["a", "b"]


def test_entrada_ia_solo_texto_y_acotada():
    bloques = [server._informe_bloque_de_reporte(_rep()) for _ in range(server.INFORME_MAX_BLOQUES_IA + 5)]
    txt = server._informe_entrada_ia(bloques, "Ing. Arturo", "2026-10-22")
    assert txt.count('clave="b') == server.INFORME_MAX_BLOQUES_IA
    assert "base64" not in txt and "Retiro de escombro" in txt


def test_parsear_ia_tolera_cercas_y_claves_raras():
    raw = '```json\n{"resumen_general": " Día  productivo. ", "bloques": {"b1": "Uno", "2": "Dos", "b9": "fuera", "x": "no"}}\n```'
    general, por = server._informe_parsear_ia(raw, 3)
    assert general == "Día productivo."
    assert por == {0: "Uno", 1: "Dos"}


@pytest.mark.parametrize("raw", ["", "sin json", "[]", '{"bloques": {}}'])
def test_parsear_ia_rechaza_vacio(raw):
    with pytest.raises((ValueError, Exception)):
        server._informe_parsear_ia(raw, 2)


def test_respaldo_sin_ia():
    assert server._informe_resumen_respaldo([]) == "Sin actividades registradas."
    b = server._informe_bloque_de_reporte(_rep())
    assert "1 reporte(s) con 1 actividad(es)" in server._informe_resumen_respaldo([b])


def test_corte_usa_la_zona_del_proyecto():
    proj = {"zona_horaria": "America/Mexico_City"}
    # 00:30 UTC del 23 = 18:30 del 22 en CDMX (UTC-6): todavía no es el corte
    assert server._informe_toca_corte(proj, utc(2026, 10, 23, 0, 30)) is None
    # 01:05 UTC del 23 = 19:05 del 22 en CDMX: toca, y es el informe DEL 22
    assert server._informe_toca_corte(proj, utc(2026, 10, 23, 1, 5)).isoformat() == "2026-10-22"


class _Resp:
    def __init__(self, status, texto="{}"):
        self.status_code = status
        self.text = texto

    def json(self):
        return {"candidates": [{"content": {"parts": [{"text": self.text}]}}]}


def _parchar_http(monkeypatch, respuestas, tiempos):
    llamadas = {"n": 0}

    class _Client:
        def __init__(self, *a, **k): ...
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, *a, **k):
            llamadas["n"] += 1
            tiempos.append(asyncio.get_event_loop().time())
            return respuestas.pop(0)

    monkeypatch.setattr(server.httpx, "AsyncClient", _Client)
    monkeypatch.setattr(server, "GEMINI_API_KEY", "k")
    return llamadas


def test_gemini_reintenta_en_429_y_devuelve_texto(monkeypatch):
    esperas = []

    async def _sleep(s):
        esperas.append(s)

    monkeypatch.setattr(server.asyncio, "sleep", _sleep)
    monkeypatch.setattr(server, "_informe_ia_ultima", 0.0)
    tiempos = []
    ll = _parchar_http(monkeypatch, [_Resp(429), _Resp(503), _Resp(200, '{"ok":1}')], tiempos)
    out = asyncio.run(server._informe_gemini_json("s", "u"))
    assert out == '{"ok":1}' and ll["n"] == 3
    assert any(e >= 5 for e in esperas)  # hubo espera creciente entre reintentos


def test_gemini_agota_reintentos_y_lanza(monkeypatch):
    async def _sleep(s): ...

    monkeypatch.setattr(server.asyncio, "sleep", _sleep)
    ll = _parchar_http(monkeypatch, [_Resp(429)] * 3, [])
    with pytest.raises(RuntimeError, match="429"):
        asyncio.run(server._informe_gemini_json("s", "u"))
    assert ll["n"] == server.INFORME_IA_REINTENTOS_HTTP


def test_gemini_error_no_reintentable_corta_de_inmediato(monkeypatch):
    async def _sleep(s): ...

    monkeypatch.setattr(server.asyncio, "sleep", _sleep)
    ll = _parchar_http(monkeypatch, [_Resp(400, "mala petición")], [])
    with pytest.raises(RuntimeError, match="400"):
        asyncio.run(server._informe_gemini_json("s", "u"))
    assert ll["n"] == 1


def test_gemini_sin_api_key(monkeypatch):
    monkeypatch.setattr(server, "GEMINI_API_KEY", "")
    with pytest.raises(RuntimeError, match="GEMINI_API_KEY"):
        asyncio.run(server._informe_gemini_json("s", "u"))


# --- PDF imprimible ------------------------------------------------------------
def _png_b64():
    import base64
    import io
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), (200, 30, 30)).save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _informe(nombre="Ing. Arturo Alcántara", fecha="2026-10-22", confirmado=True):
    b = server._informe_bloque_de_reporte(_rep())
    b["resumen_ia"] = "Se retiró escombro y se atendió el frente."
    return {
        "id": "i1", "user_name": nombre, "user_role": "especialista", "fecha": fecha, "ia": True,
        "resumen_general": "Jornada productiva en Campo Xóchitl.", "bloques": [b],
        "confirmado_en": utc(2026, 10, 23, 1, 30) if confirmado else None,
        "comentario_ingeniero": "Sin comentarios & todo <ok>",
    }


def test_pdf_individual_con_foto_y_firmas():
    proj = {"name": "Cablebús L4", "contract_number": "DGOT-LP-F-4-017-2025", "constructora": "ALFA & Leitner"}
    pdf = server._informe_pdf_bytes([_informe()], proj, {"r1": [_png_b64()]})
    assert pdf[:5] == b"%PDF-" and len(pdf) > 3000
    import io
    from pypdf import PdfReader
    assert sum(len(p.images) for p in PdfReader(io.BytesIO(pdf)).pages) == 1  # la foto sí se dibujó


def test_pdf_semanal_con_hoja_de_firmas_y_foto_corrupta():
    import io
    from pypdf import PdfReader
    proj = {"name": "Cablebús L4"}
    infs = [_informe("Ing. A", "2026-10-19"), _informe("Ing. A", "2026-10-20", confirmado=False), _informe("Ing. B", "2026-10-20")]
    hoja = [{"nombre": "Ing. A", "rol": "Ingeniero especialista", "dias": 2, "confirmados": 1, "sin_actividad": "21/10"},
            {"nombre": "Ing. B", "rol": "Sub-coordinador", "dias": 1, "confirmados": 1, "sin_actividad": ""}]
    pdf = server._informe_pdf_bytes(infs, proj, {"r1": ["no-es-imagen"]}, hoja, "Semana del 18/10/2026 al 24/10/2026")
    r = PdfReader(io.BytesIO(pdf))
    assert len(r.pages) >= 4  # 3 informes + hoja de firmas
    assert "HOJA DE FIRMAS SEMANAL" in r.pages[-1].extract_text()


def test_pdf_sin_informes_no_truena():
    assert server._informe_pdf_bytes([], {"name": "X"}, {})[:5] == b"%PDF-"
