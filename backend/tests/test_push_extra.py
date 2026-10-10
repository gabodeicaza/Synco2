"""Push extra (T-05c): acuerdos por vencer, noticia urgente e invitación aceptada.
Base falsa y `send_push_notification` simulado: no se envía nada real."""
import asyncio
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_push_extra")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402


def utc(*a):
    return datetime(*a, tzinfo=timezone.utc)


# --- Base falsa --------------------------------------------------------------
class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    async def to_list(self, length=None):
        return [dict(d) for d in self.docs]


def _coincide(doc, filtro):
    for campo, valor in filtro.items():
        if campo == "deleted_at":
            continue
        if campo == "archived":
            continue
        if campo == "acuerdos":
            continue
        actual = doc.get(campo)
        if isinstance(actual, list):
            if valor not in actual:
                return False
        elif actual != valor:
            return False
    return True


class _Coleccion:
    def __init__(self, docs=None):
        self.docs = docs if docs is not None else []
        self.insertados = []

    def find(self, filtro=None, proyeccion=None):
        return _Cursor([d for d in self.docs if _coincide(d, filtro or {})])

    async def find_one(self, filtro, *a, **k):
        for d in self.docs:
            if _coincide(d, filtro):
                return dict(d)
        return None

    async def insert_one(self, doc):
        self.insertados.append(doc)
        self.docs.append(doc)

    async def update_one(self, filtro, cambio):
        for d in self.docs:
            if d.get("id") != filtro.get("id"):
                continue
            for clave, valor in cambio.get("$set", {}).items():
                if ".$." in clave:
                    lista, campo = clave.split(".$.")
                    for a in d.get(lista, []):
                        if a.get("id") == filtro.get(f"{lista}.id"):
                            a[campo] = valor
                else:
                    d[clave] = valor


class _Db:
    def __init__(self, proyectos=None, minutas=None, usuarios=None, invitaciones=None):
        self.projects = _Coleccion(proyectos)
        self.minutas = _Coleccion(minutas)
        self.users = _Coleccion(usuarios)
        self.invitations = _Coleccion(invitaciones)
        self.announcements = _Coleccion()
        self.areas = _Coleccion()


@pytest.fixture
def envios(monkeypatch):
    """Registra los push enviados en vez de llamar a Expo."""
    registro = []

    async def falso(user_id, title, body, data=None, sound="default", priority="high"):
        registro.append({"user_id": user_id, "title": title, "body": body, "data": data})
        return {"ok": True, "sent": 1}

    monkeypatch.setattr(server, "send_push_notification", falso)
    return registro


def _minuta(mid="m1", titulo="Junta de obra", acuerdos=None):
    return {"id": mid, "project_id": "p1", "titulo": titulo, "acuerdos": acuerdos or []}


def _acuerdo(aid, responsable="r1", limite="2026-09-24", estado=False, **extra):
    return {"id": aid, "responsable_id": responsable, "fecha_limite": limite, "estado": estado, **extra}


# --- Funciones puras ---------------------------------------------------------
def test_destinatarios_excluye_autor_sin_token_y_repetidos():
    usuarios = [
        {"id": "a", "expo_push_tokens": ["ExponentPushToken[1]"]},
        {"id": "b", "expo_push_tokens": []},
        {"id": "c"},
        {"id": "d", "expo_push_tokens": ["ExponentPushToken[4]"]},
        {"id": "d", "expo_push_tokens": ["ExponentPushToken[4]"]},
        {"expo_push_tokens": ["ExponentPushToken[5]"]},
    ]
    assert server.destinatarios_push(usuarios, excluir_id="a") == ["d"]
    assert server.destinatarios_push(usuarios) == ["a", "d"]
    assert server.destinatarios_push([], "x") == []


def test_acuerdos_por_vencer_hoy_y_manana():
    hoy = date(2026, 9, 24)
    minutas = [_minuta(acuerdos=[
        _acuerdo("hoy", limite="2026-09-24"),
        _acuerdo("manana", limite="2026-09-25"),
        _acuerdo("pasado", limite="2026-09-26"),
        _acuerdo("vencido", limite="2026-09-23"),
    ])]
    salida = server.acuerdos_por_vencer(minutas, hoy)
    assert [(s["acuerdo_id"], s["dias"]) for s in salida] == [("hoy", 0), ("manana", 1)]


def test_acuerdos_por_vencer_ignora_cumplidos_sin_responsable_y_ya_avisados():
    hoy = date(2026, 9, 24)
    minutas = [_minuta(acuerdos=[
        _acuerdo("hecho", estado=True),
        _acuerdo("sin_resp", responsable=""),
        _acuerdo("avisado", vencimiento_push_enviado="2026-09-24"),
        _acuerdo("cambio", limite="2026-09-25", vencimiento_push_enviado="2026-09-24"),
    ])]
    assert [s["acuerdo_id"] for s in server.acuerdos_por_vencer(minutas, hoy)] == ["cambio"]


def test_hora_de_aviso_respeta_la_zona_del_proyecto():
    # 14:00 UTC = 08:00 en CDMX (UTC-6): ya es hora; 13:59 UTC = 07:59: todavía no.
    assert server.es_hora_de_aviso(utc(2026, 9, 24, 14, 0), None) is True
    assert server.es_hora_de_aviso(utc(2026, 9, 24, 13, 59), None) is False
    # 21:00 local es el límite (excluido).
    assert server.es_hora_de_aviso(utc(2026, 9, 25, 3, 0), None) is False
    # Tijuana (UTC-7 en septiembre): 14:00 UTC son las 07:00 locales.
    assert server.es_hora_de_aviso(utc(2026, 9, 24, 14, 0), {"zona_horaria": "America/Tijuana"}) is False
    assert server.es_hora_de_aviso(utc(2026, 9, 24, 15, 0), {"zona_horaria": "America/Tijuana"}) is True


def test_recortar_push_normaliza_espacios_y_recorta():
    assert server._recortar_push("  hola \n  mundo ") == "hola mundo"
    largo = server._recortar_push("x" * 200, 20)
    assert len(largo) == 20 and largo.endswith("…")


# --- Acuerdos por vencer (loop) ---------------------------------------------
def _db_acuerdos(monkeypatch, acuerdos, zona=None):
    proyecto = {"id": "p1", "name": "Proyecto", **({"zona_horaria": zona} if zona else {})}
    db = _Db(proyectos=[proyecto], minutas=[_minuta(acuerdos=acuerdos)])
    monkeypatch.setattr(server, "db", db)
    return db


AHORA_DE_DIA = utc(2026, 9, 24, 16, 0)  # 10:00 en CDMX


def test_un_push_por_responsable_agrupa_y_marca(monkeypatch, envios):
    db = _db_acuerdos(monkeypatch, [
        _acuerdo("a1", responsable="r1", limite="2026-09-24"),
        _acuerdo("a2", responsable="r1", limite="2026-09-24"),
        _acuerdo("a3", responsable="r2", limite="2026-09-25"),
    ])
    marcados = asyncio.run(server._avisar_acuerdos_por_vencer(AHORA_DE_DIA))
    assert marcados == 3
    por_usuario = {e["user_id"]: e for e in envios}
    assert set(por_usuario) == {"r1", "r2"}
    assert por_usuario["r1"]["body"] == "Tienes 2 acuerdos que vencen hoy."
    assert por_usuario["r1"]["data"]["type"] == "agreement_due"
    assert por_usuario["r1"]["data"]["count"] == 2
    assert por_usuario["r2"]["body"] == "Tu acuerdo de «Junta de obra» vence mañana."
    assert por_usuario["r2"]["data"]["minuta_id"] == "m1"
    marcas = {a["id"]: a.get("vencimiento_push_enviado") for a in db.minutas.docs[0]["acuerdos"]}
    assert marcas == {"a1": "2026-09-24", "a2": "2026-09-24", "a3": "2026-09-25"}


def test_no_repite_en_la_siguiente_vuelta(monkeypatch, envios):
    _db_acuerdos(monkeypatch, [_acuerdo("a1")])
    asyncio.run(server._avisar_acuerdos_por_vencer(AHORA_DE_DIA))
    asyncio.run(server._avisar_acuerdos_por_vencer(AHORA_DE_DIA))
    assert len(envios) == 1


def test_no_avisa_de_madrugada(monkeypatch, envios):
    _db_acuerdos(monkeypatch, [_acuerdo("a1")])
    # 09:00 UTC = 03:00 en CDMX.
    assert asyncio.run(server._avisar_acuerdos_por_vencer(utc(2026, 9, 24, 9, 0))) == 0
    assert envios == []


def test_hoy_se_calcula_en_la_zona_del_proyecto_no_en_utc(monkeypatch, envios):
    # 25 sep 02:00 UTC = 24 sep 20:00 en CDMX: el "hoy" del proyecto sigue siendo el 24.
    _db_acuerdos(monkeypatch, [_acuerdo("hoy24", limite="2026-09-24"), _acuerdo("dia25", limite="2026-09-25")])
    asyncio.run(server._avisar_acuerdos_por_vencer(utc(2026, 9, 25, 2, 0)))
    cuerpos = sorted(e["body"] for e in envios)
    # Ambos avisos salen agrupados por responsable y día: hoy (24) y mañana (25).
    assert cuerpos == ["Tu acuerdo de «Junta de obra» vence hoy.", "Tu acuerdo de «Junta de obra» vence mañana."]


def test_si_el_envio_falla_no_marca_y_reintenta(monkeypatch):
    db = _db_acuerdos(monkeypatch, [_acuerdo("a1")])

    async def roto(**k):
        raise RuntimeError("Expo caído")

    monkeypatch.setattr(server, "send_push_notification", roto)
    assert asyncio.run(server._avisar_acuerdos_por_vencer(AHORA_DE_DIA)) == 0
    assert "vencimiento_push_enviado" not in db.minutas.docs[0]["acuerdos"][0]


def test_acuerdo_cumplido_no_avisa(monkeypatch, envios):
    _db_acuerdos(monkeypatch, [_acuerdo("a1", estado=True)])
    assert asyncio.run(server._avisar_acuerdos_por_vencer(AHORA_DE_DIA)) == 0
    assert envios == []


# --- Noticia urgente ---------------------------------------------------------
def _usuarios():
    return [
        {"id": "autor", "project_ids": ["p1"], "expo_push_tokens": ["ExponentPushToken[a]"]},
        {"id": "u2", "project_ids": ["p1"], "expo_push_tokens": ["ExponentPushToken[b]"]},
        {"id": "u3", "project_ids": ["p1"], "expo_push_tokens": []},
        {"id": "otro", "project_ids": ["p2"], "expo_push_tokens": ["ExponentPushToken[c]"]},
    ]


def test_noticia_urgente_avisa_a_miembros_con_token_menos_al_autor(monkeypatch, envios):
    monkeypatch.setattr(server, "db", _Db(usuarios=_usuarios()))
    n = asyncio.run(server._notify_urgent_announcement("p1", "an1", "Cierre de vialidad", "autor"))
    assert n == 1
    assert [e["user_id"] for e in envios] == ["u2"]
    assert envios[0]["title"] == "Noticia urgente"
    assert envios[0]["body"] == "Cierre de vialidad"
    assert envios[0]["data"] == {"type": "urgent_announcement", "project_id": "p1", "announcement_id": "an1"}


def test_noticia_urgente_un_fallo_no_impide_los_demas(monkeypatch):
    usuarios = [
        {"id": "u1", "project_ids": ["p1"], "expo_push_tokens": ["ExponentPushToken[1]"]},
        {"id": "u2", "project_ids": ["p1"], "expo_push_tokens": ["ExponentPushToken[2]"]},
    ]
    monkeypatch.setattr(server, "db", _Db(usuarios=usuarios))
    enviados = []

    async def a_medias(user_id, **k):
        if user_id == "u1":
            raise RuntimeError("falla")
        enviados.append(user_id)
        return {"ok": True}

    monkeypatch.setattr(server, "send_push_notification", a_medias)
    assert asyncio.run(server._notify_urgent_announcement("p1", "an1", "t", None)) == 1
    assert enviados == ["u2"]


def _crear_noticia(monkeypatch, jerarquia, notificaciones):
    db = _Db()
    monkeypatch.setattr(server, "db", db)

    async def acceso(user, pid):
        return {"id": pid}

    async def falso(*args, **kwargs):
        notificaciones.append(args)

    monkeypatch.setattr(server, "ensure_project_access", acceso)
    monkeypatch.setattr(server, "_notify_urgent_announcement", falso)
    user = {"id": "autor", "name": "Ana", "role": server.ROLE_COORD}

    async def correr():
        salida = await server.create_announcement(
            "p1", server.AnnouncementIn(title="Aviso", body="Texto", jerarquia=jerarquia), user,
        )
        await asyncio.sleep(0)  # deja correr la tarea en segundo plano
        return salida

    return asyncio.run(correr())


def test_crear_noticia_urgente_dispara_el_aviso(monkeypatch):
    notificaciones = []
    _crear_noticia(monkeypatch, "urgente", notificaciones)
    assert len(notificaciones) == 1
    assert notificaciones[0][0] == "p1" and notificaciones[0][2] == "Aviso" and notificaciones[0][3] == "autor"


@pytest.mark.parametrize("jerarquia", ["importante", "informativo", None])
def test_crear_noticia_no_urgente_no_avisa(monkeypatch, jerarquia):
    notificaciones = []
    _crear_noticia(monkeypatch, jerarquia, notificaciones)
    assert notificaciones == []


# --- Invitación aceptada -----------------------------------------------------
def _invitacion(**extra):
    return {"id": "i1", "project_id": "p1", "project_name": "Proyecto", **extra}


def test_invitacion_aceptada_avisa_a_quien_la_creo(monkeypatch, envios):
    usuarios = [
        {"id": "coord1", "role": server.ROLE_COORD, "project_ids": ["p1"], "expo_push_tokens": ["ExponentPushToken[1]"]},
        {"id": "coord2", "role": server.ROLE_COORD, "project_ids": ["p1"], "expo_push_tokens": ["ExponentPushToken[2]"]},
    ]
    monkeypatch.setattr(server, "db", _Db(usuarios=usuarios))
    n = asyncio.run(server._notify_invitation_accepted(_invitacion(creado_por="coord1"), "Luis Pérez"))
    assert n == 1
    assert [e["user_id"] for e in envios] == ["coord1"]
    assert envios[0]["title"] == "Invitación aceptada"
    assert envios[0]["body"] == "Luis Pérez aceptó la invitación a Proyecto."
    assert envios[0]["data"] == {"type": "invitation_accepted", "project_id": "p1", "invitation_id": "i1"}


def test_invitacion_vieja_sin_creador_avisa_a_los_coordinadores_del_proyecto(monkeypatch, envios):
    usuarios = [
        {"id": "coord1", "role": server.ROLE_COORD, "project_ids": ["p1"], "expo_push_tokens": ["ExponentPushToken[1]"]},
        {"id": "esp", "role": server.ROLE_ESPECIALISTA, "project_ids": ["p1"], "expo_push_tokens": ["ExponentPushToken[2]"]},
        {"id": "coord_otro", "role": server.ROLE_COORD, "project_ids": ["p9"], "expo_push_tokens": ["ExponentPushToken[3]"]},
    ]
    monkeypatch.setattr(server, "db", _Db(usuarios=usuarios))
    asyncio.run(server._notify_invitation_accepted(_invitacion(), "Luis"))
    assert [e["user_id"] for e in envios] == ["coord1"]


def test_invitacion_aceptada_sin_token_no_envia(monkeypatch, envios):
    usuarios = [{"id": "coord1", "role": server.ROLE_COORD, "project_ids": ["p1"], "expo_push_tokens": []}]
    monkeypatch.setattr(server, "db", _Db(usuarios=usuarios))
    assert asyncio.run(server._notify_invitation_accepted(_invitacion(creado_por="coord1"), "Luis")) == 0
    assert envios == []


def test_accept_invite_avisa_al_coordinador_y_un_fallo_no_rompe_el_canje(monkeypatch):
    invitacion = {
        "id": "i1", "token": "tok", "status": "pending", "project_id": "p1", "project_name": "Proyecto",
        "email": "nuevo@example.com", "name": "Luis", "role": "especialista", "creado_por": "coord1",
        "expires_at": utc(2099, 1, 1),
    }
    db = _Db(invitaciones=[invitacion])
    monkeypatch.setattr(server, "db", db)
    avisos = []

    async def falso(inv, nombre):
        avisos.append((inv["id"], nombre))
        raise RuntimeError("no debe romper el canje")

    monkeypatch.setattr(server, "_notify_invitation_accepted", falso)

    async def correr():
        salida = await server.accept_invite(server.AcceptInviteIn(token="tok", password="secreto123"))
        await asyncio.sleep(0)
        return salida

    salida = asyncio.run(correr())
    assert salida["user"]["email"] == "nuevo@example.com"
    assert avisos == [("i1", "Luis")]
    assert db.invitations.docs[0]["status"] == "accepted"
