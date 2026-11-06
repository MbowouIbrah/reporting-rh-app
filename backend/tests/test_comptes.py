from sqlalchemy import select

from app.comptes import main
from app.models.auth import AuditEvent, Utilisateur
from app.security.passwords import verify_password
from tests.identites import DOMAINE, courriel, mot_de_passe

NOUVEAU = mot_de_passe()


def _u(db, email):
    db.expire_all()
    return db.scalar(select(Utilisateur).where(Utilisateur.email == email))


def _dernier_audit(db):
    return db.scalars(select(AuditEvent).order_by(AuditEvent.id.desc())).first()


def test_creer_lecteur_perimetre_trace_au_journal(db, monkeypatch, capsys):
    monkeypatch.setenv("MOT_DE_PASSE", NOUVEAU)
    argv = ["creer", f" DPS.Sav@{DOMAINE.upper()} ", "--nom", "DPS SAV", "--modele",
            "perimetre", "--perimetre", "dps"]
    assert main(argv, db) == 0
    u = _u(db, courriel("dps.sav"))
    assert u.actif and verify_password(NOUVEAU, u.password_hash)
    assert u.doit_changer_mdp is True
    assert u.fonction == "Lecteur de périmètre" and u.permissions == []
    assert [(x.type, x.perimetre_id is not None) for x in u.portees] == [("perimetre", True)]
    e = _dernier_audit(db)
    assert (e.action, e.entite, e.entite_id, e.utilisateur_id) == (
        "create", "utilisateur", str(u.id), None
    )
    main(["lister"], db)
    assert courriel("dps.sav") in capsys.readouterr().out


def test_creer_refuse_doublon_mot_de_passe_court_et_perimetre_manquant(db, monkeypatch):
    monkeypatch.setenv("MOT_DE_PASSE", NOUVEAU)
    assert main(["creer", courriel("drh"), "--nom", "X", "--modele", "global"], db) == 1
    assert main(["creer", courriel("a"), "--nom", "A", "--modele", "perimetre"], db) == 1
    assert main(["creer", courriel("b"), "--nom", "B", "--modele", "global",
                 "--perimetre", "dps"], db) == 1
    assert main(["creer", courriel("c"), "--nom", "C", "--modele", "perimetre",
                 "--perimetre", "inconnu"], db) == 1
    monkeypatch.setenv("MOT_DE_PASSE", "court")
    assert main(["creer", courriel("d"), "--nom", "D", "--modele", "global"], db) == 1
    assert db.scalars(select(Utilisateur).where(Utilisateur.email.like(courriel("_")))).all() \
        == []


def test_desactiver_activer_et_mot_de_passe(db, monkeypatch):
    assert main(["desactiver", courriel("drh")], db) == 0
    assert _u(db, courriel("drh")).actif is False
    assert main(["activer", courriel("drh")], db) == 0
    assert _u(db, courriel("drh")).actif is True
    monkeypatch.setenv("MOT_DE_PASSE", NOUVEAU)
    assert main(["mot-de-passe", courriel("drh")], db) == 0
    assert verify_password(NOUVEAU, _u(db, courriel("drh")).password_hash)
    assert _u(db, courriel("drh")).doit_changer_mdp is True
    assert main(["desactiver", courriel("personne")], db) == 1


def test_jamais_zero_admin_actif(db):
    assert main(["desactiver", courriel("admin")], db) == 1
    assert main(["droits", courriel("admin"), "--modele", "global"], db) == 1
    assert _u(db, courriel("admin")).actif is True
    assert main(["droits", courriel("drh"), "--modele", "admin"], db) == 0
    assert main(["desactiver", courriel("admin")], db) == 0


def test_droits_remplaces_et_journal(db, capsys):
    assert main(["droits", courriel("dop"), "--modele", "perimetre",
                 "--perimetre", "commerce_vn", "--nominatif", "--fonction", "DOP VN"], db) == 0
    e = _dernier_audit(db)
    assert e.avant["portee"]["tout"] and e.avant["permissions"] == ["marge", "nominatif"]
    assert not e.apres["portee"]["tout"] and len(e.apres["portee"]["perimetres"]) == 1
    assert e.apres["permissions"] == ["nominatif"] and e.apres["fonction"] == "DOP VN"
    capsys.readouterr()
    assert main(["journal", "--entite", "utilisateur", "--detail", "--limite", "1"], db) == 0
    sortie = capsys.readouterr().out
    assert "console" in sortie and "update" in sortie and "DOP VN" in sortie


def test_exiger_changement_et_affichage(db, capsys):
    u = _u(db, courriel("drh"))
    u.doit_changer_mdp = False
    db.commit()
    assert main(["exiger-changement", courriel("drh")], db) == 0
    assert _u(db, courriel("drh")).doit_changer_mdp is True
    assert main(["exiger-changement", courriel("personne")], db) == 1
    capsys.readouterr()
    assert main(["lister"], db) == 0
    ligne = next(x for x in capsys.readouterr().out.splitlines() if x.startswith(courriel("drh")))
    assert "provisoire" in ligne
