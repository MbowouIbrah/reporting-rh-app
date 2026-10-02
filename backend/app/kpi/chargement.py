"""Lecture des données (toujours filtrées par périmètre) vers les structures du moteur."""

from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.kpi.moteur import Ligne, Params, PeriodeData, Refs
from app.models.donnees import Montant, Periode, SituationMensuelle
from app.models.pilotage import CaPeriode, Parametre
from app.models.referentiel import Activite, Rubrique, RubriqueRegle, Service, Site, TypeContrat
from app.repos.scope import Scope, apply_scope


def charger_refs(db: Session) -> Refs:
    def libs(model):
        return tuple(db.scalars(select(model.libelle).where(model.actif).order_by(model.id)))

    rub = tuple(db.scalars(select(Rubrique.libelle).where(Rubrique.actif).order_by(Rubrique.ordre)))
    return Refs(libs(Service), libs(Activite), libs(Site), libs(TypeContrat), rub)


def charger_params(db: Session, annee: int, mois: int) -> Params:
    d = date(annee, mois, 1)
    valeurs: dict[str, Decimal] = {}
    q = select(Parametre).where(Parametre.date_debut <= d).order_by(Parametre.date_debut)
    for p in db.scalars(q):
        valeurs[p.cle] = Decimal(p.valeur)
    defaut = Params()
    return Params(valeurs.get("jours_ouvres", defaut.jours_ouvres),
                  valeurs.get("budget_employe", defaut.budget_employe))


def exclues_a_date(db: Session, annee: int, mois: int) -> frozenset[str]:
    d = date(annee, mois, 1)
    q = (select(Rubrique.libelle)
         .join(RubriqueRegle, RubriqueRegle.rubrique_id == Rubrique.id)
         .where(RubriqueRegle.regle == "exclu_total_ligne", RubriqueRegle.date_debut <= d,
                (RubriqueRegle.date_fin.is_(None)) | (RubriqueRegle.date_fin >= d)))
    return frozenset(db.scalars(q))


def charger_periode(db: Session, scope: Scope, annee: int, mois: int) -> PeriodeData | None:
    periode = db.scalar(select(Periode).where(Periode.annee == annee, Periode.mois == mois))
    if periode is None:
        return None
    q = apply_scope(
        select(SituationMensuelle.id, SituationMensuelle.salarie_id, Service.libelle,
               Site.libelle, Activite.libelle, TypeContrat.libelle)
        .join(Service, Service.id == SituationMensuelle.service_id)
        .join(Site, Site.id == SituationMensuelle.site_id)
        .join(Activite, Activite.id == SituationMensuelle.activite_id)
        .join(TypeContrat, TypeContrat.id == SituationMensuelle.type_contrat_id)
        .where(SituationMensuelle.periode_id == periode.id),
        scope, service=Service.libelle, site=Site.libelle)
    rows = db.execute(q).all()
    montants: dict[int, dict[str, Decimal]] = defaultdict(dict)
    if rows:
        mq = (select(Montant.situation_id, Rubrique.libelle, Montant.valeur)
              .join(Rubrique, Rubrique.id == Montant.rubrique_id)
              .where(Montant.situation_id.in_([r[0] for r in rows])))
        for sid, rub, val in db.execute(mq):
            montants[sid][rub] = Decimal(str(val))
    ca = db.scalar(select(CaPeriode.valeur).where(CaPeriode.periode_id == periode.id))
    lignes = tuple(Ligne(sal, srv, site, act, ctr, montants.get(sid, {}))
                   for sid, sal, srv, site, act, ctr in rows)
    return PeriodeData(lignes, exclues_a_date(db, annee, mois),
                       None if ca is None else Decimal(str(ca)))


def filtrer(pd: PeriodeData | None, service: str | None, site: str | None) -> PeriodeData | None:
    """Filtre d'affichage choisi par l'utilisateur, appliqué après le périmètre (jamais en deçà)."""
    if pd is None:
        return None
    lignes = tuple(L for L in pd.lignes
                   if (not service or L.service == service) and (not site or L.site == site))
    return PeriodeData(lignes, pd.exclues, pd.ca)


def precedente(annee: int, mois: int) -> tuple[int, int]:
    return (annee - 1, 12) if mois == 1 else (annee, mois - 1)
