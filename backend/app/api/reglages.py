"""Réglages communs à tous les utilisateurs (ex. noms des groupes de graphiques).

Lecture ouverte à qui consulte les rapports ; écriture réservée à l'administration, tracée."""

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.auth import ReglageGlobal
from app.security import audit
from app.security.deps import current_principal
from app.security.policy import Principal, authorize

router = APIRouter(tags=["reglages"])

CLE_NOMS = "noms_groupes"
_ID = re.compile(r"^[a-z_]{1,30}$")


class NomsGroupes(BaseModel):
    valeur: dict[str, str]

    @field_validator("valeur")
    @classmethod
    def _noms(cls, v: dict[str, str]) -> dict[str, str]:
        if len(v) > 20:
            raise ValueError("20 noms au plus")
        res: dict[str, str] = {}
        for cle, nom in v.items():
            if not _ID.match(cle):
                raise ValueError("identifiant de groupe invalide")
            nom = nom.strip()
            if not 1 <= len(nom) <= 60:
                raise ValueError("le nom doit faire de 1 à 60 caractères")
            res[cle] = nom
        return res


def _verifier_cle(cle: str) -> None:
    if cle != CLE_NOMS:
        raise HTTPException(404, "Réglage inconnu")


def _ligne(db: Session, cle: str) -> ReglageGlobal | None:
    return db.scalar(select(ReglageGlobal).where(ReglageGlobal.cle == cle))


@router.get("/reglages/{cle}")
def lire_reglage(cle: str, p: Principal = Depends(current_principal),
                 db: Session = Depends(get_db)):
    authorize(p, "report:read")
    _verifier_cle(cle)
    ligne = _ligne(db, cle)
    return {"valeur": ligne.valeur if ligne else {}}


@router.put("/reglages/{cle}")
def ecrire_reglage(cle: str, body: NomsGroupes, p: Principal = Depends(current_principal),
                   db: Session = Depends(get_db)):
    authorize(p, "referentiel:write")
    _verifier_cle(cle)
    ligne = _ligne(db, cle)
    avant = {"valeur": ligne.valeur} if ligne else None
    if ligne:
        ligne.valeur = body.valeur
    else:
        ligne = ReglageGlobal(cle=cle, valeur=body.valeur)
        db.add(ligne)
    db.flush()
    audit.record(db, p.user_id, "update", "reglage", cle, avant, {"valeur": body.valeur})
    db.commit()
    return {"valeur": body.valeur}
