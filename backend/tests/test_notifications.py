"""Notifications : publication d'un mois, cloche, préférence e-mail, désabonnement par jeton."""

import pytest
from sqlalchemy import select

from app import mail, notifications
from app.core.config import settings
from app.models.auth import AuditEvent, Utilisateur
from app.models.imports import LotImport
from app.models.notifications import Notification
from tests.conftest import mot_de_passe_choisi
from tests.identites import courriel
from tests.test_import_paie import employe, envoyer, poser_poste

API = "/api/v1"
ADMIN, DRH = courriel("admin"), courriel("drh")
SAV, PNEU = courriel("dir.technique"), courriel("dc.pneumatique")


@pytest.fixture()
def lot(db, make_client):
    """Lot prêt (mois d'octobre 2026, service SAV PL), pas encore publié."""
    poser_poste(db)
    for e in (ADMIN, DRH, SAV, PNEU):
        mot_de_passe_choisi(db, e)
    c = make_client(ADMIN)
    r = envoyer(c, [employe()])
    assert r.status_code == 201, r.text
    return r.json()["id"]


def uid(db, email):
    return db.scalar(select(Utilisateur.id).where(Utilisateur.email == email))


def notifs(db, email):
    db.expire_all()
    return list(db.scalars(select(Notification).where(Notification.utilisateur_id == uid(db, email))
                           .order_by(Notification.id)))


def publier(make_client, lot_id):
    r = make_client(ADMIN).post(f"{API}/imports/{lot_id}/valider")
    assert r.status_code == 200, r.text


def test_publication_notifie_admin_et_perimetre(db, make_client, lot):
    publier(make_client, lot)
    admin = notifs(db, ADMIN)
    assert [n.titre for n in admin if n.type == "lot_publie"] == ["Octobre 2026 publié"]
    assert any(n.titre == "Les données d’octobre 2026 sont disponibles" for n in notifs(db, SAV))
    assert any(n.type == "donnees_disponibles" for n in notifs(db, DRH))
    assert notifs(db, PNEU) == []
    for n in (*admin, *notifs(db, SAV)):
        assert "150" not in n.texte and "150" not in n.titre  # jamais de montant


def test_republication_du_meme_mois_sans_doublon(db, make_client, lot):
    publier(make_client, lot)
    c = make_client(ADMIN)
    r = envoyer(c, [employe(Matricule="E002")], nom="BrutFinal1026.CSV")
    assert r.status_code == 201, r.text
    publier(make_client, r.json()["id"])
    dispo = [n for n in notifs(db, SAV) if n.type == "donnees_disponibles"]
    assert len(dispo) == 1


def test_apercu_sans_commit_ne_notifie_rien(db, make_client, lot):
    from app.imports import service

    service.valider_lot(db, uid(db, ADMIN), lot, commit=False)
    db.rollback()
    assert db.scalar(select(Notification.id)) is None


def test_fichier_recu_notifie_les_admins(db, lot):
    n = notifs(db, ADMIN)
    assert n == []  # le dépôt manuel ne notifie pas : seul le dossier le fait
    obj = db.get(LotImport, lot)
    notifications.lot_recu(db, obj)
    db.commit()
    recu = notifs(db, ADMIN)
    assert len(recu) == 1 and recu[0].titre.startswith("Fichier reçu : ")
    assert recu[0].texte == "Prêt pour l’aperçu" and recu[0].lien == notifications.LIEN_IMPORT


def test_fichier_recu_mail_aux_admins_abonnes(db, make_client, lot, monkeypatch):
    envoyes = []
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.exemple.invalid")
    monkeypatch.setattr(mail, "envoyer",
                        lambda dest, sujet, texte, html=None: envoyes.append((dest, sujet)) or True)
    make_client(ADMIN).put(f"{API}/notifications/preferences", json={"notif_mail": True})
    notifications.lot_recu(db, db.get(LotImport, lot))
    assert [d for d, _ in envoyes] == [ADMIN]  # DRH admin non abonné : rien
    assert "fichier reçu" in envoyes[0][1]


def test_mail_bloque_hors_liste_autorisee(monkeypatch):
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.exemple.invalid")
    monkeypatch.setattr(settings, "MAIL_DESTINATAIRES_AUTORISES", " Seul@Exemple.com ")

    def interdit(*a, **k):
        raise AssertionError("aucune connexion SMTP attendue")

    monkeypatch.setattr(mail.smtplib, "SMTP", interdit)
    assert mail.envoyer("autre@exemple.com", "s", "t") is False


def test_lire_marquer_lue_et_tout_lu(db, make_client, lot):
    publier(make_client, lot)
    c = make_client(SAV)
    r = c.get(f"{API}/notifications").json()
    assert r["non_lues"] == 1 and r["notifications"][0]["lue"] is False
    nid = r["notifications"][0]["id"]
    assert make_client(DRH).post(f"{API}/notifications/{nid}/lue").status_code == 404
    assert c.post(f"{API}/notifications/{nid}/lue").status_code == 200
    assert c.get(f"{API}/notifications").json()["non_lues"] == 0
    cadm = make_client(ADMIN)
    assert cadm.get(f"{API}/notifications").json()["non_lues"] == 2
    assert cadm.post(f"{API}/notifications/tout-lu").status_code == 200
    assert cadm.get(f"{API}/notifications").json()["non_lues"] == 0
    assert c.get(f"{API}/notifications").json()["non_lues"] == 0


def test_notifications_reservees_aux_connectes(make_client):
    assert make_client().get(f"{API}/notifications").status_code == 401


def test_preferences_mail(db, make_client, lot):
    c = make_client(SAV)
    assert c.get(f"{API}/notifications/preferences").json() == {"notif_mail": False}
    r = c.put(f"{API}/notifications/preferences", json={"notif_mail": True})
    assert r.status_code == 200 and r.json() == {"notif_mail": True}
    db.expire_all()
    u = db.get(Utilisateur, uid(db, SAV))
    assert u.notif_mail is True and u.notif_mail_depuis is not None
    assert c.get(f"{API}/notifications/preferences").json() == {"notif_mail": True}
    assert db.scalar(select(AuditEvent.id).where(AuditEvent.action == "notif_mail_preference"))


def test_desabonnement_par_jeton(db, make_client, lot):
    c = make_client(SAV)
    c.put(f"{API}/notifications/preferences", json={"notif_mail": True})
    jeton = notifications.jeton_desabonnement(uid(db, SAV))
    sans_session = make_client()
    assert sans_session.post(f"{API}/notifications/desabonner", json={"jeton": "n.importe"}
                             ).status_code == 400
    faux = jeton.rsplit(".", 1)[0] + ".00"
    assert sans_session.post(f"{API}/notifications/desabonner", json={"jeton": faux}
                             ).status_code == 400
    assert sans_session.post(f"{API}/notifications/desabonner", json={"jeton": jeton}
                             ).status_code == 200
    db.expire_all()
    assert db.get(Utilisateur, uid(db, SAV)).notif_mail is False
    assert db.scalar(select(AuditEvent.id).where(AuditEvent.action == "notif_mail_desabonnement"))


def test_jeton_lie_a_l_utilisateur_et_url_en_fragment():
    j = notifications.jeton_desabonnement(7)
    assert notifications.lire_jeton(j) == 7
    assert notifications.lire_jeton("8." + j.split(".", 1)[1]) is None
    assert "/desabonnement#jeton=" in notifications.url_desabonnement(7)


def test_mail_envoye_une_seule_fois(db, make_client, lot, monkeypatch):
    envoyes = []
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.exemple.invalid")
    monkeypatch.setattr(mail, "envoyer",
                        lambda dest, sujet, texte, html=None: envoyes.append((dest, texte)) or True)
    make_client(SAV).put(f"{API}/notifications/preferences", json={"notif_mail": True})
    publier(make_client, lot)
    r = envoyer(make_client(ADMIN), [employe(Matricule="E002")])
    publier(make_client, r.json()["id"])
    assert [d for d, _ in envoyes] == [SAV]
    assert "/desabonnement#jeton=" in envoyes[0][1]
    assert "150" not in envoyes[0][1]


def test_erreur_d_envoi_ne_bloque_pas_la_publication(db, make_client, lot, monkeypatch):
    def casse(*a):
        raise OSError("SMTP indisponible")

    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.exemple.invalid")
    monkeypatch.setattr(mail, "envoyer", casse)
    make_client(SAV).put(f"{API}/notifications/preferences", json={"notif_mail": True})
    publier(make_client, lot)
    db.expire_all()
    assert db.get(LotImport, lot).statut == "valide"
    assert any(n.type == "donnees_disponibles" for n in notifs(db, SAV))


def test_sans_smtp_aucun_envoi(db, make_client, lot, monkeypatch):
    appels = []
    monkeypatch.setattr(settings, "SMTP_HOST", "")
    monkeypatch.setattr(mail, "envoyer", lambda *a: appels.append(a) or True)
    make_client(SAV).put(f"{API}/notifications/preferences", json={"notif_mail": True})
    publier(make_client, lot)
    assert appels == []


def test_me_expose_le_mode_d_import(make_client, monkeypatch, db):
    c = make_client(ADMIN)
    assert c.get(f"{API}/auth/me").json()["import_mode"] == "depot"
    monkeypatch.setattr(settings, "IMPORT_MODE", "dossier")
    assert c.get(f"{API}/auth/me").json()["import_mode"] == "dossier"
