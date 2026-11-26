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
from app.kpi import charges as charges_kpi
from app.kpi import exercice as ex
from app.kpi import formules, moteur
from app.kpi.exercice import Calendrier
from app.models.donnees import Periode, Salarie
from app.models.referentiel import Departement, Rubrique, Service
from app.repos.scope import restreindre, scope_for
from app.security import audit
from app.security.deps import current_principal
from app.security.policy import Principal, authorize, is_allowed

router = APIRouter(prefix="/rapports", tags=["rapports"])
CLES_MARGE = {"ca", "marge", "taux_marge", "marge_ytd", "nb_mois_marge", "nb_mois_ca", "ca_ytd",
              "taux_marge_ytd", "taux_marge_cmp", "ca_cumul", "ca_par_effectif", "lignes_ca_marge",
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


def _sortie(p: Principal, data: dict | list) -> dict | list:
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
# Plus longue période acceptée (docs/etude-periode-libre.md) : borne le nombre de mois chargés
MAX_MOIS = 60


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


def _calcul_mensuel(db, scope, cur, prev, annee, mois, service, site, type_site, crit) -> dict:
    """Tableaux du mois (contrôles de cohérence compris) pour des données déjà filtrées."""
    return moteur.mensuel(cur, prev, ch.charger_refs(db, type_site, scope),
                          _params(db, crit, annee, mois),
                          ch.charger_budgets(db, scope, annee, mois, service, site, **crit))


def _mensuel(db, p, annee, mois, service, site, ref_annee=None, ref_mois=None,
             type_site=None, poste=None, matricule=None, activite=None, type_contrat=None,
             departement=None) -> dict | list:
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
    return _sortie(p, _calcul_mensuel(db, scope, cur, prev, annee, mois, service, site, type_site,
                                      crit))


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
    (début du cadre, premier mois du cadre, indices de mois du début et de la fin, indice du début
    de la comparaison, nombre de rangs du cadre, années de décalage de la comparaison par défaut).
    Le cadre du moteur fait 12 rangs, à partir de janvier si la période tient dans une année civile,
    sinon du mois `du` ; une période de plus de 12 mois est son propre cadre. Sans comparaison
    choisie : mêmes mois, décalés du nombre d'années entières qui couvre la période (sans
    chevauchement, janvier contre janvier)."""
    if (du is None) != (au is None):
        raise HTTPException(422, "Le début et la fin de la période vont ensemble")
    if (cmp_du is None) != (cmp_au is None):
        raise HTTPException(422, "Le début et la fin de la comparaison vont ensemble")
    a, b = ex.indice(du), ex.indice(au)
    if a > b:
        raise HTTPException(422, "Le début de la période est après sa fin")
    nb = b - a + 1
    if nb > MAX_MOIS:
        raise HTTPException(422, f"La période ne peut pas dépasser {MAX_MOIS} mois")
    ans = -(-nb // 12)
    if cmp_du is None:
        c = a - 12 * ans
    else:
        c = ex.indice(cmp_du)
        if ex.indice(cmp_au) - c != b - a:
            raise HTTPException(
                422, "La comparaison doit couvrir le même nombre de mois que la période")
    depart = 1 if a // 12 == b // 12 else a % 12 + 1
    return a // 12, depart, a, b, c, max(12, nb), ans


def _criteres(db, p, service, site, type_site, poste, matricule, activite, type_contrat,
              departement):
    """Filtres de l'utilisateur (valeurs multiples « A|B ») et périmètre restreint au département :
    (périmètre, service, site, type de site, autres critères de `ch.filtrer`)."""
    service, site, type_site, poste, activite, type_contrat, departement = map(
        _liste, (service, site, type_site, poste, activite, type_contrat, departement))
    scope = restreindre(db, scope_for(db, p), departement)
    crit = {"type_site": type_site, "poste": poste, "salarie_id": _salarie_id(db, p, matricule),
            "activite": activite, "type_contrat": type_contrat}
    return scope, service, site, type_site, crit


def _charger_mois(db, scope, service, site, crit, mois_reels) -> dict[int, moteur.PeriodeData]:
    """Données filtrées des mois donnés, `(rang, (année, mois))` ; les mois absents sont omis."""
    out = {}
    for r, (y, m) in mois_reels:
        pd = ch.filtrer(ch.charger_periode(db, scope, y, m), service, site, **crit)
        if pd is not None:
            out[r] = pd
    return out


def _mois_comptes(db, p, service, site, type_site, poste, matricule, activite, type_contrat,
                  departement, du, au, cmp_du, cmp_au):
    """Mois de la période choisie (`du`, `au`), de sa comparaison et, pour un mois seul comparé au
    mois d'avant, du même mois un an plus tôt (comparaison des primes) : un `PeriodeData` ou None
    par mois, dans l'ordre, puis la période servie. Mêmes règles de période que `/annuel` ; 404
    sans aucune donnée."""
    authorize(p, "report:read")
    _, _, a, b, c, _, _ = _plage(du, au, cmp_du, cmp_au)
    scope, service, site, _, crit = _criteres(
        db, p, service, site, type_site, poste, matricule, activite, type_contrat, departement)
    nb = b - a + 1

    def mois(debut: int) -> list[moteur.PeriodeData | None]:
        pds = _charger_mois(db, scope, service, site, crit,
                            ((i, ((debut + i) // 12, (debut + i) % 12 + 1)) for i in range(nb)))
        return [pds.get(i) for i in range(nb)]

    n, n1 = mois(a), mois(c)
    if not moteur.avec_donnees(dict(enumerate(n))):
        raise HTTPException(404, "Aucune donnée pour cette période")
    # mois seul comparé au mois d'avant : les primes se comparent au même mois un an plus tôt
    primes = a == b and c == a - 1
    n1_primes = mois(a - 12) if primes else None
    return n, n1, {"du": ex.texte(a), "au": ex.texte(b),
                   "cmp_du": ex.texte(c), "cmp_au": ex.texte(c + nb - 1),
                   "cmp_primes_du": ex.texte(a - 12) if primes else None,
                   "cmp_primes_au": ex.texte(a - 12) if primes else None}, n1_primes


def _calcul_annuel(db, p, annee, mois, service, site, ref_annee=None, type_site=None, poste=None,
                   matricule=None, activite=None, type_contrat=None,
                   calendrier: Calendrier = "civil", departement=None, debut=None, cmp="",
                   du=None, au=None, cmp_du=None, cmp_au=None) -> dict:
    """Cumul de la période, montants en `Decimal` (comme `_calcul_mensuel`). `annee` : début de
    l'exercice ; `mois` : vrai mois de fin du cumul (None : fin de l'exercice) ; `debut` : vrai
    mois de début (None : début de l'exercice). `cmp` : vide = même période de `ref_annee`, `prec`
    = les mêmes nombre de mois juste avant, `aucune`. Le moteur
    reçoit des rangs 1 à 12 (kpi/exercice.py). `du` et `au` (« AAAA-MM »), quand ils sont fournis,
    remplacent `annee`, `mois`, `debut`, `calendrier`, `ref_annee` et `cmp` ; `cmp_du` et `cmp_au`
    : période comparée (règle de `_plage` si absents). Une période de plus de 12 mois a autant de
    rangs que de mois."""
    authorize(p, "report:read")
    plage = None
    nb_rangs, ans = 12, 1
    if du is not None or au is not None:
        annee, calendrier, a, b, c, nb_rangs, ans = plage = _plage(du, au, cmp_du, cmp_au)
        mois, debut, ref_annee, cmp = b % 12 + 1, a % 12 + 1, None, ""
    elif annee is None:
        raise HTTPException(422, "L'année ou la période (du, au) est obligatoire")
    scope, service, site, type_site, crit = _criteres(
        db, p, service, site, type_site, poste, matricule, activite, type_contrat, departement)

    def pds(mois_reels) -> dict[int, moteur.PeriodeData]:
        return _charger_mois(db, scope, service, site, crit, mois_reels)

    def annee_pds(a: int) -> dict[int, moteur.PeriodeData]:
        return pds(enumerate(ex.mois_exercice(a, calendrier, nb_rangs), 1))

    reels = ex.mois_exercice(annee, calendrier, nb_rangs)
    if plage is not None:
        # rangs dans le cadre (il peut dépasser 12 mois : `ex.rang` ne s'applique plus)
        cadre = annee * 12 + ex.premier_mois(calendrier) - 1
        d, fin = plage[2] - cadre + 1, plage[3] - cadre + 1
    else:
        fin = 12 if mois is None else ex.rang(mois, calendrier)
        d = 1 if debut is None else ex.rang(debut, calendrier)
    if d > fin:
        raise HTTPException(422, "Le début de la période est après sa fin")
    ref = ref_annee or annee - ans
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
                        comparaison, nb_rangs)
    res = ex.en_mois_reels(res, annee, ref, calendrier, nb_rangs)
    # période et comparaison effectives, au format du calendrier (« AAAA-MM »)
    res |= {"du": ex.texte(debut_reel), "au": ex.texte(debut_reel + fin - d),
            "cmp_du": None if k is None else ex.texte(k),
            "cmp_au": None if k is None else ex.texte(k + fin - d)}
    return res


def _annuel(db, p, *args, **kwargs) -> dict:
    return _sortie(p, _calcul_annuel(db, p, *args, **kwargs))


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


def _contexte_charges(db, p, service, site, type_site, crit, debut: int, departement):
    """Filtres actifs et périmètre du compte (sans le filtre Département, qui est un filtre et non
    un périmètre), de quoi expliquer l'absence de budget (kpi/charges.py)."""
    compte = scope_for(db, p)
    return charges_kpi.Contexte(
        debut=debut, service=bool(service), site=bool(site or type_site),
        activite=bool(crit["activite"]), contrat=bool(crit["type_contrat"]),
        poste=bool(crit["poste"] or crit["salarie_id"]), perimetre=not compte.unrestricted,
        perim_service=bool(compte.rules.get("service")), perim_site=bool(compte.rules.get("site")),
        departement=bool(_liste(departement)))


def _bloc_activite_charges(res: dict, total: dict, masque: bool, debut: int) -> dict:
    """Carte Activité : lignes d'activité du moteur (réel N, N-1, objectif), coût par vente
    (charges / ventes) et nombre d'objectifs atteints. Les objectifs sont masqués avec un filtre
    Service ou Site ou un compte à périmètre (ils sont saisis pour toute l'entreprise)."""
    lignes = res.get("activite")
    if lignes is not None and masque:
        lignes = [{**{k: v for k, v in x.items() if k != "budget_partiel"},
                   **{k: None for k in ("budget", "ecart", "ecart_pct", "realisation")
                      if k in x}} for x in lignes]
    ventes = next((x for x in lignes or [] if x["cle"] == "ventes"), None)

    def par_vente(charges: Decimal | None, nb: Decimal | None) -> Decimal | None:
        return None if charges is None or not nb else charges / nb

    suivis = [x for x in lignes or [] if x["cle"] in moteur.OBJECTIFS_ACTIVITE
              and x.get("budget") is not None]
    atteints = None
    if not masque and debut >= charges_kpi.BUD_DEBUT and suivis:
        atteints = [sum(1 for x in suivis if x["realisation"] is not None
                        and x["realisation"] >= 1), len(suivis)]
    cout = par_vente(total["m"], ventes["m"] if ventes else None)
    cout1 = par_vente(total["m1"], ventes["m1"] if ventes else None)
    return {
        "activite": lignes,
        "lignes_ca_marge": res.get("lignes_ca_marge"),
        "cout_par_vente": {"n": cout, "n1": cout1, "var": formules.variation(cout, cout1),
                           "var_pct": formules.variation_pct(cout, cout1)},
        "objectifs_atteints": atteints,
    }


@router.get("/charges")
def charges(
    du: str = Query(pattern=MOIS_AAAA_MM),
    au: str = Query(pattern=MOIS_AAAA_MM),
    cmp_du: str | None = Query(None, pattern=MOIS_AAAA_MM),
    cmp_au: str | None = Query(None, pattern=MOIS_AAAA_MM),
    service: str | None = Query(None, max_length=MAX_MULTI),
    site: str | None = Query(None, max_length=MAX_MULTI),
    type_site: str | None = Query(None, max_length=200, pattern=TYPES_SITE),
    poste: str | None = Query(None, max_length=MAX_MULTI),
    matricule: str | None = Query(None, max_length=30),
    activite: str | None = Query(None, max_length=MAX_MULTI),
    type_contrat: str | None = Query(None, max_length=MAX_MULTI),
    departement: str | None = Query(None, max_length=MAX_MULTI),
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    """Répartition des charges de la période choisie, comparée à la période de comparaison :
    total, axes (type de charge, site, service, activité, contrat) avec effectifs, entrées,
    sorties, budget et réalisation, carte Activité et effectifs par contrat. Un mois seul comparé
    au mois d'avant compare ses primes au même mois un an plus tôt."""
    n, n1, periode, n1_primes = _mois_comptes(
        db, p, service, site, type_site, poste, matricule, activite, type_contrat, departement,
        du, au, cmp_du, cmp_au)
    scope, svc, st, ts, crit = _criteres(
        db, p, service, site, type_site, poste, matricule, activite, type_contrat, departement)
    debut = ex.indice(du)
    ctx = _contexte_charges(db, p, svc, st, ts, crit, debut, departement)
    # budgets de chaque mois de la période qui a des données (rien avant leur saisie)
    budgets = [ch.charger_budgets(db, scope, (debut + i) // 12, (debut + i) % 12 + 1, svc, st,
                                  **crit)
               if pd is not None and pd.lignes and debut + i >= charges_kpi.BUD_DEBUT else None
               for i, pd in enumerate(n)]
    out = {**periode,
           **charges_kpi.rapport(n, n1, ch.rubriques_paie(db), budgets, ctx, n1_primes)}
    # carte Activité : seuls le périmètre, le service, le site et le type de site s'appliquent
    res = _calcul_annuel(db, p, None, None, service, site, None, type_site, None, None, None, None,
                         "civil", departement, None, "", du, au, cmp_du, cmp_au)
    masque = bool(svc or st or ts or ctx.perimetre or ctx.departement)
    out |= _bloc_activite_charges(res, out["total"], masque, debut)
    if du == au:
        # un seul mois : les mêmes contrôles de cohérence que le rapport mensuel
        res = _calcul_mensuel(db, scope, n[0], n1[0], int(du[:4]), int(du[5:]), svc, st, ts, crit)
        out["controles"] = res["controles"]
    return _sortie(p, out)


@router.get("/charges/personnes")
def charges_personnes(
    axe: Literal["type", "site", "service", "activite", "contrat"],
    valeur: str = Query(min_length=1, max_length=200),
    du: str = Query(pattern=MOIS_AAAA_MM),
    au: str = Query(pattern=MOIS_AAAA_MM),
    ligne_activite: str | None = Query(None, max_length=200),
    cmp_du: str | None = Query(None, pattern=MOIS_AAAA_MM),
    cmp_au: str | None = Query(None, pattern=MOIS_AAAA_MM),
    service: str | None = Query(None, max_length=MAX_MULTI),
    site: str | None = Query(None, max_length=MAX_MULTI),
    type_site: str | None = Query(None, max_length=200, pattern=TYPES_SITE),
    poste: str | None = Query(None, max_length=MAX_MULTI),
    matricule: str | None = Query(None, max_length=30),
    activite: str | None = Query(None, max_length=MAX_MULTI),
    type_contrat: str | None = Query(None, max_length=MAX_MULTI),
    departement: str | None = Query(None, max_length=MAX_MULTI),
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    """Salariés du périmètre ayant un montant compté sur la ligne `valeur` de l'axe (N ou N-1),
    et sur son activité `ligne_activite` si elle est donnée : noms et montants individuels, donc
    droit nominatif et lecture journalisée. `activite` reste le filtre de la barre."""
    authorize(p, "nominatif:read")
    n, n1, periode, n1_primes = _mois_comptes(
        db, p, service, site, type_site, poste, matricule, activite, type_contrat, departement,
        du, au, cmp_du, cmp_au)
    # rubriques de paie du référentiel (actives ou non) et celles que les données portent
    lignes = charges_kpi.personnes(n, n1, ch.rubriques_paie(db), axe, valeur, ligne_activite,
                                   n1_primes)
    if lignes is None:
        raise HTTPException(422, "Rubrique inconnue")
    ids = {x["salarie_id"] for x in lignes}
    identite = {i: (mat, nom) for i, mat, nom in db.execute(
        select(Salarie.id, Salarie.matricule, Salarie.nom).where(Salarie.id.in_(ids)))} \
        if ids else {}
    audit.record(db, p.user_id, "lecture_charges_personnes", axe, valeur, None,
                 {**periode, "ligne_activite": ligne_activite, "service": service, "site": site,
                  "type_site": type_site, "poste": poste, "matricule": matricule,
                  "activite": activite, "type_contrat": type_contrat, "departement": departement})
    db.commit()
    return _sortie(p, [{"matricule": identite[x["salarie_id"]][0],
                        "nom": identite[x["salarie_id"]][1],
                        **{k: v for k, v in x.items() if k != "salarie_id"}} for x in lignes])


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
