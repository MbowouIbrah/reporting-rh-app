"""Recette sur PostgreSQL (NUMERIC exact) : DATABASE_URL=postgresql+psycopg://... pytest."""

from collections import defaultdict
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.core.config import settings
from app.imports.lecture import lire
from app.imports.regles import valider
from app.imports.service import charger_refs
from app.models.donnees import Montant, SituationMensuelle
from app.models.referentiel import Rubrique
from tests.test_import_regles import V4

pytestmark = pytest.mark.skipif(
    not settings.db_url.startswith("postgresql") or not V4.exists(),
    reason="PostgreSQL et fichier V4 requis",
)
API = "/api/v1"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def test_v4_import_complet_sommes_exactes(make_client, db):
    contenu = V4.read_bytes()
    attendu: dict[str, Decimal] = defaultdict(Decimal)
    lignes, _, _ = valider(lire(contenu), charger_refs(db))
    for L in lignes:
        for rub, v in L.montants.items():
            attendu[rub] += v

    c = make_client("admin@exemple.invalid")
    r = c.post(f"{API}/imports", files={"fichier": ("v4.xlsx", contenu, XLSX)})
    assert r.status_code == 201, r.text
    lot = r.json()
    assert lot["statut"] == "pret" and lot["nb_lignes"] == 1398 and lot["nb_bloquants"] == 0
    assert c.post(f"{API}/imports/{lot['id']}/valider").json()["statut"] == "valide"

    db.expire_all()
    assert db.scalar(select(func.count()).select_from(SituationMensuelle)) == 1398
    en_base = dict(db.execute(
        select(Rubrique.libelle, func.sum(Montant.valeur)).join(
            Montant, Montant.rubrique_id == Rubrique.id).group_by(Rubrique.libelle)).all())
    assert {k: v for k, v in en_base.items()} == dict(attendu)  # égalité exacte, sans tolérance

    assert c.post(f"{API}/imports", files={"fichier": ("v4.xlsx", contenu, XLSX)}).status_code == 409
    assert c.post(f"{API}/imports/{lot['id']}/annuler").status_code == 200
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(SituationMensuelle)) == 0
