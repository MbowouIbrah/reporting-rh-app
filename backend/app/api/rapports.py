from dataclasses import replace
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.exports import graphiques as graphes_xlsx
from app.exports import xlsx
from app.imports.regles import norm
from app.kpi import chargement as ch
from app.kpi import exercice as ex
from app.kpi import moteur
from app.kpi.exercice import Calendrier
from app.models.donnees import Periode, Salarie
from app.models.referentiel import Departement, Rubrique, Service
from app.repos.scope import restreindre, scope_for
from app.security import audit
from app.security.deps import current_principal
from app.security.policy import Principal, authorize, is_allowed

router = APIRouter(prefix="/rapports", tags=["rapports"])
CLES_MARGE = {"ca", "marge", "taux_marge", "marge_ytd", "nb_mois_marge", "nb_mois_ca", "ca_ytd",
              "taux_marge_ytd", "ca_cumul", "ca_par_effectif", "lignes_ca_marge",
              "ca_individuel", "marge_individuelle", "ca_avec_marge", "ca_par_front",
              "marge_par_front"}

# Colonnes du reporting individuel (RETOURS_PRESENTATION §4, docs/QUESTIONS_CLIENT.md A3, B1,
# B2) et les rubriques de DONNEES qu'elles reprennent, une par colonne : « Autres primes » = primes
# sur ventes et sur résultats, chacune dans sa colonne. « Primes exceptionnelles » = hors salaire.
COLONNES_INDIVIDUEL: dict[str, tuple[str, ...]] = {
    "Salaire brut garanti": ("Salaire brut garantie",),
    "Commission": ("Commission",),
    "Primes de productivité": ("Productivité Ateliers",),
    "Brut réel": ("Brut Réel",),
    "Bonus": ("Bonus",),
    "Primes sur ventes": ("Primes sur ventes",),
    "Primes sur résultats": ("Primes sur résultats",),
    "Marge MAD + TVA": ("TVA & Marge MAD",),
    "Crédit téléphonique": ("Crédit téléphonique",),
    "Frais de mission": ("Frais de mission",),
    "Primes exceptionnelles": ("Primes exceptionnelles",),
    "Logement site déporté": ("Logement site déporté",),
    "Carburant véhicule service": ("Carburant véhicule service",),
}


XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _xlsx(contenu: bytes, nom: str) -> Response:
    return Response(contenu, media_type=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="{nom}"'})


def jsonable(x):
    """Decimal -> chaîne exacte : aucun passage par float."""
    if isinstance(x, Decimal):
        return str(x)
    if isinstance(x, dict):
        return {k: jsonable(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [jsonable(v) for v in x]
    return x


def _sans_marge(x):
    if isinstance(x, dict):
        return {k: _sans_marge(v) for k, v in x.items() if k not in CLES_MARGE}
    if isinstance(x, list):
        return [_sans_marge(v) for v in x]
    return x


def _sortie(p: Principal, data: dict) -> dict:
    return jsonable(data if is_allowed(p, "marge:read") else _sans_marge(data))


def _activite_tous(lignes) -> dict:
    """Indicateurs d'activité d'un groupe de salariés : sommes, indice de productivité en moyenne
    des renseignés ; None si personne n'est renseigné."""
    def valeurs(nom):
        return [L.indicateurs[nom] for L in lignes if nom in L.indicateurs]

    def somme(nom):
        v = valeurs(nom)
        return sum(v, Decimal(0)) if v else None

    prod = valeurs(moteur.PRODUCTIVITE)
    return {"ventes": somme(moteur.VENTES), "clients": somme(moteur.CLIENTS),
            "productivite": sum(prod, Decimal(0)) / len(prod) if prod else None,
            "ca_individuel": somme(moteur.CA_INDIVIDUEL),
            "marge_individuelle": somme(moteur.MARGE_INDIVIDUELLE)}


@router.get("/periodes")
def periodes(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    authorize(p, "report:read")
    scope = scope_for(db, p)
    out = []
    for per in db.scalars(select(Periode).order_by(Periode.annee, Periode.mois)):
        pd = ch.charger_periode(db, scope, per.annee, per.mois)
        if pd is not None and pd.lignes:
            out.append({"annee": per.annee, "mois": per.mois})
    return out


def _lignes_annee(db: Session, p: Principal, annee: int, calendrier: Calendrier = "civil"):
    scope = scope_for(db, p)
    for a, m in ex.mois_exercice(annee, calendrier):
        pd = ch.charger_periode(db, scope, a, m)
        if pd is not None:
            yield from pd.lignes


@router.get("/filtres")
def filtres(
    annee: int = Query(ge=2000, le=2100),
    calendrier: Calendrier = "civil",
    mois: int | None = Query(None, ge=1, le=12),
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    authorize(p, "report:read")
    # Mensuel : combinaisons du seul mois affiché (une valeur de l'année peut manquer ce mois-là).
    if mois is not None:
        pd = ch.charger_periode(db, scope_for(db, p), annee, mois)
        lignes = list(pd.lignes) if pd is not None else []
    else:
        lignes = list(_lignes_annee(db, p, annee, calendrier))
    dep = dict(db.execute(select(Service.libelle, Departement.libelle)
                          .join(Departement, Departement.id == Service.departement_id)).all())
    # Combinaisons présentes : le front n'offre, pour chaque filtre, que les valeurs compatibles
    # avec les autres filtres choisis (jamais d'option qui mène à un résultat vide).
    # Avec le droit nominatif, le matricule ferme chaque combinaison : la liste « Employé » suit
    # aussi les autres filtres.
    mat: dict = {}
    if is_allowed(p, "nominatif:read"):
        ids = {L.salarie_id for L in lignes}
        mat = dict(db.execute(select(Salarie.id, Salarie.matricule).where(Salarie.id.in_(ids)))
                   .all()) if ids else {}
    combinaisons = sorted(
        {(dep.get(L.service, ""), L.service, L.site, L.type_site, L.activite or "", L.contrat,
          L.poste or "") + ((mat.get(L.salarie_id, ""),) if mat else ())
         for L in lignes}
    )
    return {"combinaisons": [list(c) for c in combinaisons],
            "departements": sorted({dep[L.service] for L in lignes if L.service in dep}),
            "services": sorted({L.service for L in lignes}),
            "sites": sorted({L.site for L in lignes}),
            "types_site": sorted({L.type_site for L in lignes}),
            "type_par_site": {L.site: L.type_site for L in lignes},
            "postes": sorted({L.poste for L in lignes if L.poste}),
            "activites": sorted({L.activite for L in lignes if L.activite}),
            "types_contrat": sorted({L.contrat for L in lignes})}


@router.get("/salaries")
def salaries(
    annee: int = Query(ge=2000, le=2100),
    calendrier: Calendrier = "civil",
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    authorize(p, "nominatif:read")
    ids = {L.salarie_id for L in _lignes_annee(db, p, annee, calendrier)}
    rows = db.scalars(select(Salarie).where(Salarie.id.in_(ids))) if ids else []
    return sorted(({"matricule": r.matricule, "nom": r.nom} for r in rows),
                  key=lambda x: x["matricule"])


# R4 : un filtre peut porter plusieurs valeurs, séparées par « | » dans le même paramètre.
MAX_MULTI = 4000
TYPES_SITE = r"^(principal|agence|deporte)(\|(principal|agence|deporte))*$"
# Comparaison du rapport annuel : vide = même période d'un autre exercice (ref_annee)
Comparaison = Literal["", "prec", "aucune"]
# Période choisie au calendrier : mois « AAAA-MM » de début et de fin, et de la comparaison
MOIS_AAAA_MM = r"^\d{4}-(0[1-9]|1[0-2])$"


def _liste(v: str | None) -> frozenset[str] | None:
    """Valeurs d'un filtre multiple (« A|B ») ; vide : aucun filtre."""
    vals = frozenset(x.strip() for x in (v or "").split("|") if x.strip())
    return vals or None


def _reference(annee, mois, ref_annee, ref_mois) -> tuple[int, int]:
    """Période de comparaison du mensuel : celle choisie, sinon le mois précédent."""
    if ref_annee is None or ref_mois is None:
        return ch.precedente(annee, mois)
    return ref_annee, ref_mois


def _salarie_id(db: Session, p: Principal, matricule: str | None) -> int | None:
    """Filtre « employé » des rapports : nominatif, donc soumis au droit de lecture nominative."""
    if not matricule:
        return None
    authorize(p, "nominatif:read")
    sal = db.scalar(select(Salarie).where(Salarie.matricule_norm == norm(matricule)))
    if sal is None:
        raise HTTPException(404, "Matricule introuvable")
    return sal.id


def _params(db, crit: dict, annee: int, mois: int):
    """Paramètres du mois ; pas de budget employé pour un poste, un type de contrat ou une
    personne (seulement pour un effectif d'ensemble), en mensuel comme en annuel."""
    params = ch.charger_params(db, annee, mois)
    if crit["poste"] or crit["type_contrat"] or crit["salarie_id"] is not None:
        params = replace(params, budget_employe=None)
    return params


def _mensuel(db, p, annee, mois, service, site, ref_annee=None, ref_mois=None,
             type_site=None, poste=None, matricule=None, activite=None, type_contrat=None,
             departement=None) -> dict:
    authorize(p, "report:read")
    service, site, type_site, poste, activite, type_contrat, departement = map(
        _liste, (service, site, type_site, poste, activite, type_contrat, departement))
    scope = restreindre(db, scope_for(db, p), departement)
    crit = {"type_site": type_site, "poste": poste, "salarie_id": _salarie_id(db, p, matricule),
            "activite": activite, "type_contrat": type_contrat}
    cur = ch.filtrer(ch.charger_periode(db, scope, annee, mois), service, site, **crit)
    if cur is None or not cur.lignes:
        raise HTTPException(404, "Aucune donnée pour cette période")
    ref = _reference(annee, mois, ref_annee, ref_mois)
    prev = ch.filtrer(ch.charger_periode(db, scope, *ref), service, site, **crit)
    params = _params(db, crit, annee, mois)
    res = moteur.mensuel(cur, prev, ch.charger_refs(db, type_site, scope), params,
                         ch.charger_budgets(db, scope, annee, mois, service, site, **crit))
    return _sortie(p, res)


@router.get("/mensuel")
def mensuel(
    annee: int = Query(ge=2000, le=2100),
    mois: int = Query(ge=1, le=12),
    service: str | None = Query(None, max_length=MAX_MULTI),
    site: str | None = Query(None, max_length=MAX_MULTI),
    ref_annee: int | None = Query(None, ge=2000, le=2100),
    ref_mois: int | None = Query(None, ge=1, le=12),
    type_site: str | None = Query(None, max_length=200, pattern=TYPES_SITE),
    poste: str | None = Query(None, max_length=MAX_MULTI),
    matricule: str | None = Query(None, max_length=30),
    activite: str | None = Query(None, max_length=MAX_MULTI),
    type_contrat: str | None = Query(None, max_length=MAX_MULTI),
    departement: str | None = Query(None, max_length=MAX_MULTI),
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    return _mensuel(db, p, annee, mois, service, site, ref_annee, ref_mois, type_site, poste,
                    matricule, activite, type_contrat,
                    departement=departement)


@router.get("/mensuel/export")
def mensuel_export(
    annee: int = Query(ge=2000, le=2100),
    mois: int = Query(ge=1, le=12),
    service: str | None = Query(None, max_length=MAX_MULTI),
    site: str | None = Query(None, max_length=MAX_MULTI),
    ref_annee: int | None = Query(None, ge=2000, le=2100),
    ref_mois: int | None = Query(None, ge=1, le=12),
    type_site: str | None = Query(None, max_length=200, pattern=TYPES_SITE),
    poste: str | None = Query(None, max_length=MAX_MULTI),
    matricule: str | None = Query(None, max_length=30),
    activite: str | None = Query(None, max_length=MAX_MULTI),
    type_contrat: str | None = Query(None, max_length=MAX_MULTI),
    departement: str | None = Query(None, max_length=MAX_MULTI),
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    res = _mensuel(db, p, annee, mois, service, site, ref_annee, ref_mois, type_site, poste,
                   matricule, activite, type_contrat,
                    departement=departement)
    audit.record(db, p.user_id, "export", "rapport_mensuel", f"{annee}-{mois:02d}", None,
                 {"service": service, "site": site, "type_site": type_site, "poste": poste,
                  "matricule": matricule, "activite": activite,
                  "type_contrat": type_contrat, "departement": departement})
    db.commit()
    if ref_annee is None or ref_mois is None:
        ref_annee, ref_mois = (annee - 1, 12) if mois == 1 else (annee, mois - 1)
    prec = f"{xlsx.MOIS[ref_mois - 1]} {ref_annee}"
    return _xlsx(xlsx.mensuel(res, annee, mois, prec),
                 f"reporting-mensuel-{annee}-{mois:02d}.xlsx")


def _plage(du, au, cmp_du, cmp_au):
    """Période choisie au calendrier (`du`, `au`, `cmp_du`, `cmp_au` : « AAAA-MM ») ->
    (début d'exercice, premier mois de l'exercice, indices de mois du début et de la fin, indice du
    début de la comparaison). Les 12 rangs du moteur démarrent en janvier si la période tient dans
    une année civile, sinon au mois `du`. Sans comparaison choisie : mêmes mois 12 mois plus tôt."""
    if (du is None) != (au is None):
        raise HTTPException(422, "Le début et la fin de la période vont ensemble")
    if (cmp_du is None) != (cmp_au is None):
        raise HTTPException(422, "Le début et la fin de la comparaison vont ensemble")
    a, b = ex.indice(du), ex.indice(au)
    if a > b:
        raise HTTPException(422, "Le début de la période est après sa fin")
    if b - a + 1 > 12:
        raise HTTPException(422, "La période ne peut pas dépasser 12 mois")
    if cmp_du is None:
        c = a - 12
    else:
        c = ex.indice(cmp_du)
        if ex.indice(cmp_au) - c != b - a:
            raise HTTPException(
                422, "La comparaison doit couvrir le même nombre de mois que la période")
    depart = 1 if a // 12 == b // 12 else a % 12 + 1
    return a // 12, depart, a, b, c


def _annuel(db, p, annee, mois, service, site, ref_annee=None, type_site=None, poste=None,
            matricule=None, activite=None, type_contrat=None,
            calendrier: Calendrier = "civil", departement=None, debut=None, cmp="",
            du=None, au=None, cmp_du=None, cmp_au=None) -> dict:
    """`annee` : début de l'exercice ; `mois` : vrai mois de fin du cumul (None : fin de
    l'exercice) ; `debut` : vrai mois de début (None : début de l'exercice). `cmp` : vide = même
    période de `ref_annee`, `prec` = les mêmes nombre de mois juste avant, `aucune`. Le moteur
    reçoit des rangs 1 à 12 (kpi/exercice.py). `du` et `au` (« AAAA-MM »), quand ils sont fournis,
    remplacent `annee`, `mois`, `debut`, `calendrier`, `ref_annee` et `cmp` ; `cmp_du` et `cmp_au`
    : période comparée (mêmes mois 12 mois plus tôt si absents)."""
    authorize(p, "report:read")
    plage = None
    if du is not None or au is not None:
        annee, calendrier, a, b, c = plage = _plage(du, au, cmp_du, cmp_au)
        mois, debut, ref_annee, cmp = b % 12 + 1, a % 12 + 1, None, ""
    elif annee is None:
        raise HTTPException(422, "L'année ou la période (du, au) est obligatoire")
    service, site, type_site, poste, activite, type_contrat, departement = map(
        _liste, (service, site, type_site, poste, activite, type_contrat, departement))
    scope = restreindre(db, scope_for(db, p), departement)
    crit = {"type_site": type_site, "poste": poste, "salarie_id": _salarie_id(db, p, matricule),
            "activite": activite, "type_contrat": type_contrat}

    def pds(mois_reels) -> dict[int, moteur.PeriodeData]:
        out = {}
        for r, (y, m) in mois_reels:
            pd = ch.filtrer(ch.charger_periode(db, scope, y, m), service, site, **crit)
            if pd is not None:
                out[r] = pd
        return out

    def annee_pds(a: int) -> dict[int, moteur.PeriodeData]:
        return pds(enumerate(ex.mois_exercice(a, calendrier), 1))

    reels = ex.mois_exercice(annee, calendrier)
    fin = 12 if mois is None else ex.rang(mois, calendrier)
    d = 1 if debut is None else ex.rang(debut, calendrier)
    if d > fin:
        raise HTTPException(422, "Le début de la période est après sa fin")
    ref = ref_annee or annee - 1
    n = annee_pds(annee)
    if not moteur.avec_donnees(n):
        raise HTTPException(404, "Aucune donnée pour cette année")
    # budgets et paramètres des 12 mois : la série des objectifs couvre toute l'année ; les blocs
    # du cumul ne retiennent que les mois qui ont des données
    budgets = {r: ch.charger_budgets(db, scope, *reels[r - 1], service, site, **crit) for r in n}
    params_mois = {r: _params(db, crit, *reels[r - 1]) for r in n}
    params_fin = params_mois.get(fin) or _params(db, crit, *reels[fin - 1])
    refs = ch.charger_refs(db, type_site, scope)
    comparaison = None
    debut_reel = reels[d - 1][0] * 12 + reels[d - 1][1] - 1
    k = None  # indice de mois du début de la période comparée ; None : aucune comparaison
    if cmp == "aucune":
        comparaison = {}
    elif plage is not None or cmp == "prec":
        # les mois comparés, rangés dans l'ordre sur les mois de la période : la période choisie
        # (calendrier), ou les fin - d + 1 mois juste avant le début
        k = plage[4] if plage is not None else debut_reel - (fin - d + 1)
        comparaison = pds((d + i, ((k + i) // 12, (k + i) % 12 + 1)) for i in range(fin - d + 1))
    else:
        y, m = ex.mois_exercice(ref, calendrier)[d - 1]
        k = y * 12 + m - 1
    res = moteur.annuel(n, annee_pds(ref), fin, refs, params_fin, budgets, params_mois, d,
                        comparaison)
    res = ex.en_mois_reels(res, annee, ref, calendrier)
    # période et comparaison effectives, au format du calendrier (« AAAA-MM »)
    res |= {"du": ex.texte(debut_reel), "au": ex.texte(debut_reel + fin - d),
            "cmp_du": None if k is None else ex.texte(k),
            "cmp_au": None if k is None else ex.texte(k + fin - d)}
    return _sortie(p, res)


@router.get("/annuel")
def annuel(
    annee: int | None = Query(None, ge=2000, le=2100),
    mois: int | None = Query(None, ge=1, le=12),
    service: str | None = Query(None, max_length=MAX_MULTI),
    site: str | None = Query(None, max_length=MAX_MULTI),
    ref_annee: int | None = Query(None, ge=2000, le=2100),
    type_site: str | None = Query(None, max_length=200, pattern=TYPES_SITE),
    poste: str | None = Query(None, max_length=MAX_MULTI),
    matricule: str | None = Query(None, max_length=30),
    activite: str | None = Query(None, max_length=MAX_MULTI),
    type_contrat: str | None = Query(None, max_length=MAX_MULTI),
    departement: str | None = Query(None, max_length=MAX_MULTI),
    calendrier: Calendrier = "civil",
    debut: int | None = Query(None, ge=1, le=12),
    cmp: Comparaison = "",
    du: str | None = Query(None, pattern=MOIS_AAAA_MM),
    au: str | None = Query(None, pattern=MOIS_AAAA_MM),
    cmp_du: str | None = Query(None, pattern=MOIS_AAAA_MM),
    cmp_au: str | None = Query(None, pattern=MOIS_AAAA_MM),
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    return _annuel(db, p, annee, mois, service, site, ref_annee, type_site, poste, matricule,
                   activite, type_contrat, calendrier, departement, debut, cmp,
                   du, au, cmp_du, cmp_au)


@router.get("/annuel/export")
def annuel_export(
    annee: int | None = Query(None, ge=2000, le=2100),
    mois: int | None = Query(None, ge=1, le=12),
    service: str | None = Query(None, max_length=MAX_MULTI),
    site: str | None = Query(None, max_length=MAX_MULTI),
    ref_annee: int | None = Query(None, ge=2000, le=2100),
    type_site: str | None = Query(None, max_length=200, pattern=TYPES_SITE),
    poste: str | None = Query(None, max_length=MAX_MULTI),
    matricule: str | None = Query(None, max_length=30),
    activite: str | None = Query(None, max_length=MAX_MULTI),
    type_contrat: str | None = Query(None, max_length=MAX_MULTI),
    departement: str | None = Query(None, max_length=MAX_MULTI),
    calendrier: Calendrier = "civil",
    debut: int | None = Query(None, ge=1, le=12),
    cmp: Comparaison = "",
    du: str | None = Query(None, pattern=MOIS_AAAA_MM),
    au: str | None = Query(None, pattern=MOIS_AAAA_MM),
    cmp_du: str | None = Query(None, pattern=MOIS_AAAA_MM),
    cmp_au: str | None = Query(None, pattern=MOIS_AAAA_MM),
    graphiques: bool = False,
    graphes: str | None = Query(None, max_length=400, pattern="^[a-z_,]*$"),
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    """Classeur du rapport annuel ; `graphiques` : graphes d'évolution en graphiques Excel
    (`graphes` : identifiants, séparés par des virgules, des graphes cochés ; absent = tous)."""
    res = _annuel(db, p, annee, mois, service, site, ref_annee, type_site, poste, matricule,
                  activite, type_contrat, calendrier, departement, debut, cmp,
                  du, au, cmp_du, cmp_au)
    choisie = du is not None
    an_fin, mois_fin = (int(res["au"][:4]), int(res["au"][5:])) if choisie else ex.fin_cumul(
        annee, mois, calendrier)
    entite = "graphes_annuels" if graphiques else "rapport_annuel"
    audit.record(db, p.user_id, "export", entite, f"{an_fin}-{mois_fin:02d}", None,
                 {"service": service, "site": site, "type_site": type_site, "poste": poste,
                  "matricule": matricule, "activite": activite,
                  "type_contrat": type_contrat, "calendrier": calendrier,
                  "departement": departement, "debut": debut, "cmp": cmp,
                  "du": du, "au": au, "cmp_du": cmp_du, "cmp_au": cmp_au})
    db.commit()
    if choisie:
        # libellés des deux périodes, nom de fichier à l'image de la période choisie
        nom_n = xlsx.libelle_periode(res["du"], res["au"])
        nom_ref = xlsx.libelle_periode(res["cmp_du"], res["cmp_au"])
        fichier = f"{res['du']}_{res['au']}"
        if graphiques:
            ids = graphes.split(",") if graphes else None
            return _xlsx(graphes_xlsx.graphiques(res, nom_n, nom_ref, ids),
                         f"graphes-{fichier}.xlsx")
        return _xlsx(xlsx.annuel_periode(res, nom_n, nom_ref), f"reporting-annuel-{fichier}.xlsx")
    suffixe = "-fiscal" if calendrier == "fiscal" else ""
    if graphiques:
        ref = ref_annee or annee - 1
        def nom(a: int) -> str:
            return f"{a}-{(a + 1) % 100:02d}" if calendrier == "fiscal" else str(a)
        ids = graphes.split(",") if graphes else None
        return _xlsx(graphes_xlsx.graphiques(res, nom(annee), nom(ref), ids),
                     f"graphes-{annee}{suffixe}.xlsx")
    # libellé du cumul : dernier mois réellement cumulé, comme à l'écran
    return _xlsx(xlsx.annuel(res, annee, res.get("mois_fin") or mois_fin, ref_annee, calendrier,
                            debut, cmp),
                 f"reporting-annuel-{annee}{suffixe}.xlsx")


@router.get("/individuel/tous")
def individuel_tous(
    annee: int = Query(ge=2000, le=2100),
    matricule: str | None = Query(None, max_length=30),
    service: str | None = Query(None, max_length=MAX_MULTI),
    site: str | None = Query(None, max_length=MAX_MULTI),
    type_site: str | None = Query(None, max_length=200, pattern=TYPES_SITE),
    poste: str | None = Query(None, max_length=MAX_MULTI),
    calendrier: Calendrier = "civil",
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    """Onglet REPORTING_RH_INDIVIDUEL : par mois, somme des montants de chaque rubrique sur les
    salariés retenus (tous par défaut), effectif concerné par colonne et total.
    Comme dans DONNEES, une colonne dont les rubriques sont exclues du total de ligne est signalée
    (`exclues`) et le TOTAL MENSUEL ne somme que les colonnes comptées à la date du mois.
    `deporte` indique si un site déporté figure dans le mois (logement sinon sans objet)."""
    authorize(p, "nominatif:read")
    service, site, type_site, poste = map(_liste, (service, site, type_site, poste))
    scope = scope_for(db, p)
    sal = None
    if matricule:
        sal = db.scalar(select(Salarie).where(Salarie.matricule_norm == norm(matricule)))
        if sal is None:
            raise HTTPException(404, "Matricule introuvable")
    # Ordre global des colonnes (paramétrage, partagé avec DONNEES).
    rang = {lib: o for lib, o in db.execute(select(Rubrique.libelle, Rubrique.ordre))}
    rubriques = sorted(COLONNES_INDIVIDUEL,
                       key=lambda c: min(rang.get(r, 10**6) for r in COLONNES_INDIVIDUEL[c]))
    exclues = ch.rubriques_exclues(db)
    zero = Decimal(0)

    def montant(L, col: str) -> Decimal:
        return sum((L.montants.get(r, zero) for r in COLONNES_INDIVIDUEL[col]), zero)

    def comptee(pd, col: str) -> bool:
        return not all(r in pd.exclues for r in COLONNES_INDIVIDUEL[col])
    mois = []
    for a, m in ex.mois_exercice(annee, calendrier):
        pd = ch.charger_periode(db, scope, a, m)
        lignes = [] if pd is None else [
            L for L in pd.lignes
            if (sal is None or L.salarie_id == sal.id)
            and (not service or L.service in service) and (not site or L.site in site)
            and (not type_site or L.type_site in type_site) and (not poste or L.poste in poste)]
        if pd is None or not lignes:
            mois.append({"annee": a, "mois": m, "present": False})
            continue
        mois.append({
            "annee": a, "mois": m, "present": True, "effectif": len(lignes),
            "montants": {c: sum((montant(L, c) for L in lignes), zero) for c in rubriques},
            "staff": {c: sum(1 for L in lignes if montant(L, c) != 0) for c in rubriques},
            "total": sum((montant(L, c) for L in lignes for c in rubriques if comptee(pd, c)),
                         zero),
            "deporte": any(L.type_site == "deporte" for L in lignes),
            "activite": _activite_tous(lignes),
        })
    if sal is not None and not any(x["present"] for x in mois):
        raise HTTPException(404, "Matricule introuvable")  # hors périmètre : rien ne fuit
    audit.record(db, p.user_id, "lecture_fiche", "salarie", sal.id if sal else None, None,
                 {"annee": annee, "tous": sal is None, "calendrier": calendrier})
    db.commit()
    return _sortie(p, {"annee": annee, "calendrier": calendrier,
                       "matricule": sal.matricule if sal else None,
                       "nom": sal.nom if sal else None, "rubriques": rubriques,
                       "exclues": [c for c in rubriques
                                   if all(r in exclues for r in COLONNES_INDIVIDUEL[c])],
                       "sources": {c: list(COLONNES_INDIVIDUEL[c]) for c in rubriques},
                       "mois": mois,
                       "activite_total": moteur.activite_total(
                           [x.get("activite") for x in mois])})


@router.get("/individuel")
def individuel(
    annee: int = Query(ge=2000, le=2100),
    matricule: str = Query(min_length=1, max_length=30),
    calendrier: Calendrier = "civil",
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    authorize(p, "nominatif:read")
    sal = db.scalar(select(Salarie).where(Salarie.matricule_norm == norm(matricule)))
    scope = scope_for(db, p)
    reels = ex.mois_exercice(annee, calendrier)
    pds = {r: pd for r, (a, m) in enumerate(reels, 1)
           if (pd := ch.charger_periode(db, scope, a, m)) is not None}
    if sal is None or not any(L.salarie_id == sal.id for pd in pds.values() for L in pd.lignes):
        raise HTTPException(404, "Matricule introuvable")
    audit.record(db, p.user_id, "lecture_fiche", "salarie", sal.id, None,
                 {"annee": annee, "calendrier": calendrier})
    db.commit()
    res = moteur.individuel(pds, sal.id, ch.charger_refs(db))
    res["mois"] = ex.serie_reelle(res["mois"], annee, calendrier)
    return _sortie(p, {"matricule": sal.matricule, "nom": sal.nom, "annee": annee,
                       "calendrier": calendrier, **res})
