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
    argv = ["creer", " DPS.Sav@exemple.invalid ", "--nom", "DPS SAV", "--modele",
            "perimetre", "--perimetre", "dps"]
    assert main(argv, db) == 0
    u = _u(db, "dps.sav@exemple.invalid")
    assert u.actif and verify_password(NOUVEAU, u.password_hash)
    assert u.doit_changer_mdp is True
    assert u.fonction == "Lecteur de périmètre" and u.permissions == []
    assert [(x.type, x.perimetre_id is not None) for x in u.portees] == [("perimetre", True)]
    e = _dernier_audit(db)
    assert (e.action, e.entite, e.entite_id, e.utilisateur_id) == (
        "create", "utilisateur", str(u.id), None
    )
    main(["lister"], db)
    assert "dps.sav@exemple.invalid" in capsys.readouterr().out


def test_creer_refuse_doublon_mot_de_passe_court_et_perimetre_manquant(db, monkeypatch):
    monkeypatch.setenv("MOT_DE_PASSE", NOUVEAU)
    assert main(["creer", "drh@exemple.invalid", "--nom", "X", "--modele", "global"], db) == 1
    assert main(["creer", "a@exemple.invalid", "--nom", "A", "--modele", "perimetre"], db) == 1
    assert main(["creer", "b@exemple.invalid", "--nom", "B", "--modele", "global",
                 "--perimetre", "dps"], db) == 1
    assert main(["creer", "c@exemple.invalid", "--nom", "C", "--modele", "perimetre",
                 "--perimetre", "inconnu"], db) == 1
    monkeypatch.setenv("MOT_DE_PASSE", "court")
    assert main(["creer", "d@exemple.invalid", "--nom", "D", "--modele", "global"], db) == 1
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
    assert _u(db, "drh@exemple.invalid").doit_changer_mdp is True
    assert main(["desactiver", "personne@exemple.invalid"], db) == 1


def test_jamais_zero_admin_actif(db):
    assert main(["desactiver", "admin@exemple.invalid"], db) == 1
    assert main(["droits", "admin@exemple.invalid", "--modele", "global"], db) == 1
    assert _u(db, "admin@exemple.invalid").actif is True
    assert main(["droits", "drh@exemple.invalid", "--modele", "admin"], db) == 0
    assert main(["desactiver", "admin@exemple.invalid"], db) == 0


def test_droits_remplaces_et_journal(db, capsys):
    assert main(["droits", "dop@exemple.invalid", "--modele", "perimetre",
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
    u = _u(db, "drh@exemple.invalid")
    u.doit_changer_mdp = False
    db.commit()
    assert main(["exiger-changement", "drh@exemple.invalid"], db) == 0
    assert _u(db, "drh@exemple.invalid").doit_changer_mdp is True
    assert main(["exiger-changement", "personne@exemple.invalid"], db) == 1
    capsys.readouterr()
    assert main(["lister"], db) == 0
    ligne = next(x for x in capsys.readouterr().out.splitlines() if x.startswith("drh@exemple.invalid"))
    assert "provisoire" in ligne
