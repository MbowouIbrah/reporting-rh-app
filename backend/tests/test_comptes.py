from sqlalchemy import select

from app.comptes import main
from app.models.auth import AuditEvent, Utilisateur
from app.security.passwords import verify_password

NOUVEAU = "<mot-de-passe-test-n1>"


def _u(db, email):
    db.expire_all()
    return db.scalar(select(Utilisateur).where(Utilisateur.email == email))


def _dernier_audit(db):
    return db.scalars(select(AuditEvent).order_by(AuditEvent.id.desc())).first()


def test_creer_lecteur_perimetre_trace_au_journal(db, monkeypatch, capsys):
    monkeypatch.setenv("MOT_DE_PASSE", NOUVEAU)
    argv = ["creer", " DPS.Sav@exemple.invalid ", "--nom", "DPS SAV", "--role",
            "lecteur_perimetre", "--perimetre", "dps"]
    assert main(argv, db) == 0
    u = _u(db, "dps.sav@exemple.invalid")
    assert u.actif and verify_password(NOUVEAU, u.password_hash)
    assert [(r.role, r.perimetre_id is not None, r.nominatif) for r in u.roles] == [
        ("lecteur_perimetre", True, False)
    ]
    e = _dernier_audit(db)
    assert (e.action, e.entite, e.entite_id, e.utilisateur_id) == (
        "create", "utilisateur", str(u.id), None
    )
    main(["lister"], db)
    assert "dps.sav@exemple.invalid" in capsys.readouterr().out


def test_creer_refuse_doublon_mot_de_passe_court_et_perimetre_manquant(db, monkeypatch):
    monkeypatch.setenv("MOT_DE_PASSE", NOUVEAU)
    assert main(["creer", "drh@exemple.invalid", "--nom", "X", "--role", "lecteur_global"], db) == 1
    assert main(["creer", "a@exemple.invalid", "--nom", "A", "--role", "lecteur_perimetre"], db) == 1
    assert main(["creer", "b@exemple.invalid", "--nom", "B", "--role", "lecteur_global",
                 "--perimetre", "dps"], db) == 1
    assert main(["creer", "c@exemple.invalid", "--nom", "C", "--role", "lecteur_perimetre",
                 "--perimetre", "inconnu"], db) == 1
    monkeypatch.setenv("MOT_DE_PASSE", "court")
    assert main(["creer", "d@exemple.invalid", "--nom", "D", "--role", "lecteur_global"], db) == 1
    assert db.scalars(select(Utilisateur).where(Utilisateur.email.like("_@exemple.invalid"))).all() \
        == []


def test_desactiver_activer_et_mot_de_passe(db, monkeypatch):
    assert main(["desactiver", "drh@exemple.invalid"], db) == 0
    assert _u(db, "drh@exemple.invalid").actif is False
    assert main(["activer", "drh@exemple.invalid"], db) == 0
    assert _u(db, "drh@exemple.invalid").actif is True
    monkeypatch.setenv("MOT_DE_PASSE", NOUVEAU)
    assert main(["mot-de-passe", "drh@exemple.invalid"], db) == 0
    assert verify_password(NOUVEAU, _u(db, "drh@exemple.invalid").password_hash)
    assert main(["desactiver", "personne@exemple.invalid"], db) == 1


def test_jamais_zero_admin_actif(db):
    assert main(["desactiver", "admin@exemple.invalid"], db) == 1
    assert main(["role", "admin@exemple.invalid", "--role", "lecteur_global"], db) == 1
    assert _u(db, "admin@exemple.invalid").actif is True
    assert main(["role", "drh@exemple.invalid", "--role", "rh_admin"], db) == 0
    assert main(["desactiver", "admin@exemple.invalid"], db) == 0


def test_role_remplace_et_journal(db, capsys):
    assert main(["role", "dop@exemple.invalid", "--role", "lecteur_perimetre",
                 "--perimetre", "commerce_vn", "--nominatif"], db) == 0
    e = _dernier_audit(db)
    assert e.avant["roles"][0]["role"] == "lecteur_global"
    assert e.apres["roles"][0]["role"] == "lecteur_perimetre"
    capsys.readouterr()
    assert main(["journal", "--entite", "utilisateur", "--detail", "--limite", "1"], db) == 0
    sortie = capsys.readouterr().out
    assert "console" in sortie and "update" in sortie and "lecteur_perimetre" in sortie
