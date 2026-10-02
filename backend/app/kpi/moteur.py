"""Construction des restitutions (mensuel, annuel, individuel) à partir de lignes déjà filtrées.

Aucune dépendance base de données : l'entrée est une liste de `Ligne` par période.
"""

from collections import defaultdict
from dataclasses import dataclass, field
from decimal import Decimal

from app.kpi import formules as f

ABSENCES = "Absences (nb)"
COMMISSION = "Commission"
PRIMES = ("Primes sur ventes", "Primes sur résultats", "Productivité Ateliers")
ZERO = Decimal(0)


@dataclass(frozen=True)
class Ligne:
    salarie_id: int
    service: str
    site: str
    activite: str
    contrat: str
    montants: dict[str, Decimal] = field(default_factory=dict)  # libellé rubrique -> valeur


@dataclass(frozen=True)
class PeriodeData:
    lignes: tuple[Ligne, ...]
    exclues: frozenset[str] = frozenset()  # rubriques hors TOTAL CHARGES à la date de la période
    ca: Decimal | None = None

    def total(self, ligne: Ligne) -> Decimal:
        return sum((v for r, v in ligne.montants.items() if r not in self.exclues), ZERO)

    @property
    def ids(self) -> frozenset[int]:
        return frozenset(L.salarie_id for L in self.lignes)

    @property
    def ms(self) -> Decimal:
        return sum((self.total(L) for L in self.lignes), ZERO)

    def rubrique(self, nom: str) -> Decimal:
        return sum((L.montants.get(nom, ZERO) for L in self.lignes), ZERO)


@dataclass(frozen=True)
class Refs:
    services: tuple[str, ...]
    activites: tuple[str, ...]
    sites: tuple[str, ...]
    contrats: tuple[str, ...]
    rubriques: tuple[str, ...]


@dataclass(frozen=True)
class Params:
    jours_ouvres: Decimal = Decimal(22)
    budget_employe: Decimal | None = Decimal(600000)


def _ok(pd: PeriodeData | None) -> PeriodeData | None:
    return pd if pd is not None and pd.lignes else None


def cell(m: Decimal | None, m1: Decimal | None) -> dict:
    return {"m1": m1, "m": m, "var": f.variation(m, m1), "var_pct": f.variation_pct(m, m1)}


def _par(pd: PeriodeData | None, cle, mesure) -> dict:
    out: dict = defaultdict(lambda: ZERO)
    for L in pd.lignes if pd else ():
        out[cle(L)] += mesure(pd, L)
    return out


def _cells(cur: PeriodeData, prev: PeriodeData | None, noms, cle, mesure) -> list[tuple]:
    a, b = _par(cur, cle, mesure), _par(prev, cle, mesure)
    return [(n, cell(a.get(n, ZERO), b.get(n, ZERO) if prev else None)) for n in noms]


def mensuel(cur: PeriodeData, prev: PeriodeData | None, refs: Refs, params: Params) -> dict:
    prev = _ok(prev)
    ms, ms1 = cur.ms, prev.ms if prev else None
    eff, eff1 = len(cur.ids), len(prev.ids) if prev else None
    recrut = len(cur.ids - prev.ids) if prev else None
    departs = len(prev.ids - cur.ids) if prev else None
    absences = cur.rubrique(ABSENCES)
    bud = f.budget(eff, params.budget_employe)
    ecart, ecart_pct = f.ecart_budget(ms, bud)
    marge_ = f.marge(cur.ca, ms)

    synthese = {
        "ms": {**cell(ms, ms1), "budget": bud, "ecart": ecart, "ecart_pct": ecart_pct},
        "effectif": {
            "debut": eff1, "recrutements": recrut, "departs": departs, "fin": eff,
            "variation": f.variation(Decimal(eff), None if eff1 is None else Decimal(eff1)),
        },
        "taux_rotation": f.taux_rotation(recrut or 0, departs or 0, eff1, eff) if prev else None,
        "absences": cell(absences, prev.rubrique(ABSENCES) if prev else None),
        "taux_absenteisme": f.taux_absenteisme(absences, eff, params.jours_ouvres),
        "ca": cur.ca,
        "marge": marge_,
        "taux_marge": f.taux_marge(cur.ca, ms),
        "commissions": cell(cur.rubrique(COMMISSION), prev.rubrique(COMMISSION) if prev else None),
        "primes_total": cell(sum((cur.rubrique(r) for r in PRIMES), ZERO),
                             sum((prev.rubrique(r) for r in PRIMES), ZERO) if prev else None),
        "primes": [
            {"rubrique": r, **cell(cur.rubrique(r), prev.rubrique(r) if prev else None)}
            for r in PRIMES
        ],
    }

    def mont(rub):
        return lambda pd, L: L.montants.get(rub, ZERO)

    a_type = [
        {"rubrique": r, "exclu": r in cur.exclues,
         **cell(cur.rubrique(r), prev.rubrique(r) if prev else None)}
        for r in refs.rubriques if r != ABSENCES
    ]
    # chemin indépendant de PeriodeData.ms : somme des rubriques comptées dans le total
    ms_a = sum((x["m"] for x in a_type if not x["exclu"]), ZERO)
    ms_a1 = sum((x["m1"] for x in a_type if not x["exclu"]), ZERO) if prev else None

    def total(pd, L):
        return pd.total(L)

    b_service = []
    for s in refs.services:
        sub = PeriodeData(tuple(L for L in cur.lignes if L.service == s), cur.exclues)
        sub1 = PeriodeData(tuple(L for L in prev.lignes if L.service == s), prev.exclues) \
            if prev else None
        b_service.append({
            "service": s,
            "total": cell(sub.ms, sub1.ms if sub1 else None),
            "effectif": cell(Decimal(len(sub.ids)), Decimal(len(sub1.ids)) if sub1 else None),
            "activites": [
                {"activite": n, **c, "effectif": cell(
                    Decimal(len({L.salarie_id for L in sub.lignes if L.activite == n})),
                    Decimal(len({L.salarie_id for L in sub1.lignes if L.activite == n}))
                    if sub1 else None)}
                for n, c in _cells(sub, sub1, refs.activites, lambda L: L.activite, total)],
        })
    ms_services = sum((b["total"]["m"] for b in b_service), ZERO)

    sites_ms = dict(_cells(cur, prev, refs.sites, lambda L: L.site, total))
    sites_eff = {s: (len({L.salarie_id for L in cur.lignes if L.site == s}),
                     len({L.salarie_id for L in prev.lignes if L.site == s}) if prev else None)
                 for s in refs.sites}
    c_site = [{"site": s, "ms": sites_ms[s],
               "effectif": {"m": sites_eff[s][0], "m1": sites_eff[s][1]}} for s in refs.sites]
    ms_sites = sum((c["ms"]["m"] for c in c_site), ZERO)

    ctrl_contrats: list[dict] = []

    def eff_contrat(pd, contrat):
        return len({L.salarie_id for L in pd.lignes if L.contrat == contrat}) if pd else None

    d_eff = [{"contrat": c, **cell(Decimal(eff_contrat(cur, c)),
                                   None if prev is None else Decimal(eff_contrat(prev, c)))}
             for c in refs.contrats]
    total_contrats = sum((d["m"] for d in d_eff), ZERO)
    def ventil(pd, c, a):
        sel = [L for L in pd.lignes if L.contrat == c and L.activite == a] if pd else []
        return (sum((pd.total(L) for L in sel), ZERO), Decimal(len({L.salarie_id for L in sel}))
                ) if pd else (None, None)

    ventilation = []
    for c in refs.contrats:
        for a in refs.activites:
            (ms_c, ef_c), (ms_c1, ef_c1) = ventil(cur, c, a), ventil(prev, c, a)
            ventilation.append({"contrat": c, "activite": a, "ms": cell(ms_c, ms_c1),
                                "effectif": cell(ef_c, ef_c1)})

    def indicateurs(contrat: str | None) -> dict:
        def sel(pd):
            if pd is None:
                return None
            lignes = tuple(L for L in pd.lignes if contrat is None or L.contrat == contrat)
            return PeriodeData(lignes, pd.exclues)
        c, p = sel(cur), sel(prev)
        ids, ids1 = c.ids, (p.ids if p else None)
        rec = len(ids - ids1) if p else None
        dep = len(ids1 - ids) if p else None
        abs_ = c.rubrique(ABSENCES)
        return {
            "contrat": contrat or "TOTAL",
            "debut": len(ids1) if p else None, "recrutements": rec, "departs": dep,
            "fin": len(ids),
            "taux_rotation": (
                f.taux_rotation(rec or 0, dep or 0, len(ids1), len(ids)) if p else None),
            "absences": abs_,
            "taux_absenteisme": f.taux_absenteisme(abs_, len(ids), params.jours_ouvres),
        }

    d_indic = [indicateurs(c) for c in refs.contrats] + [indicateurs(None)]
    for champ in ("debut", "fin"):  # flux non additifs si changement de contrat
        vals = [d[champ] for d in d_indic[:-1]]
        if None not in vals:
            controles_extra = _controle(f"Total contrats = somme ({champ})",
                                        Decimal(sum(vals)), Decimal(d_indic[-1][champ]))
            ctrl_contrats.append(controles_extra)

    controles = [
        _controle("MS type de charge = service = site", ms_a, ms_services, ms_sites, ms),
        _controle("Total contrats = CDI + CDD + MAD", total_contrats, Decimal(eff)),
    ]
    controles.extend(ctrl_contrats)
    if eff1 is not None:
        controles.append(_controle("Effectif fin = début + recrutements − départs",
                                   Decimal(eff1 + recrut - departs), Decimal(eff)))
    return {
        "synthese": synthese,
        "a_type_charge": a_type
        + [{"rubrique": "TOTAL CHARGES", "exclu": False, **cell(ms_a, ms_a1)}],
        "b_service_activite": b_service,
        "c_site": c_site,
        "d_contrat": {"effectifs": d_eff, "indicateurs": d_indic,
                      "total": cell(Decimal(eff), None if eff1 is None else Decimal(eff1)),
                      "ventilation": ventilation},
        "controles": controles,
    }


def _controle(libelle: str, *valeurs: Decimal) -> dict:
    ecart = f.ecart_bloquant(*valeurs)
    return {"controle": libelle, "ecart": ecart, "bloquant": ecart > f.TOLERANCE}


def avec_donnees(pds: dict[int, PeriodeData], jusqu_au: int = 12) -> list[int]:
    return [m for m in sorted(pds) if m <= jusqu_au and _ok(pds[m])]


def annuel(
    n: dict[int, PeriodeData], n1: dict[int, PeriodeData], mois: int, refs: Refs, params: Params
) -> dict:
    """n, n1 : mois -> données de l'année N et N-1. `mois` : dernier mois du cumul."""
    def serie(pds):
        return [{"mois": m,
                 "ms": pds[m].ms if _ok(pds.get(m)) else None,
                 "effectif": len(pds[m].ids) if _ok(pds.get(m)) else None,
                 "absences": pds[m].rubrique(ABSENCES) if _ok(pds.get(m)) else None,
                 "ca": pds[m].ca if _ok(pds.get(m)) else None,
                 "commissions": pds[m].rubrique(COMMISSION) if _ok(pds.get(m)) else None,
                 "primes": sum((pds[m].rubrique(r) for r in PRIMES), ZERO)
                 if _ok(pds.get(m)) else None,
                 "marge": f.marge(pds[m].ca, pds[m].ms) if _ok(pds.get(m)) else None,
                 "taux_marge": f.taux_marge(pds[m].ca, pds[m].ms) if _ok(pds.get(m)) else None}
                for m in range(1, 13)]

    def cumul(pds):
        mois_ok = avec_donnees(pds, mois)
        c = sum((pds[m].ms for m in mois_ok), ZERO)
        return c, len(mois_ok), f.moyenne(c, len(mois_ok)), mois_ok

    c, nb, moy, ok = cumul(n)
    c1, nb1, moy1, _ = cumul(n1)
    avec_ca = [m for m in ok if n[m].ca is not None]
    marge_ytd = sum((n[m].ca - n[m].ms for m in avec_ca), ZERO) if avec_ca else None

    def ms_service(pds, mois_ok):
        out = defaultdict(lambda: ZERO)
        for m in mois_ok:
            for L in pds[m].lignes:
                out[L.service] += pds[m].total(L)
        return out

    ok1 = avec_donnees(n1, mois)
    s_n = ms_service(n, ok)
    s_n1 = ms_service(n1, ok1)
    complet1 = sum((n1[m].ms for m in avec_donnees(n1)), ZERO)
    return {
        "serie_n": serie(n),
        "serie_n1": serie(n1),
        "cumul_ytd": {**cell(c if nb else None, c1 if nb1 else None), "nb_mois": nb,
                      "nb_mois_n1": nb1},
        "moyenne_mensuelle": cell(moy, moy1),
        "marge_ytd": marge_ytd,
        "nb_mois_marge": len(avec_ca),
        "cumul_annee_n1": complet1 if avec_donnees(n1) else None,
        "par_service": [
            {"service": s, **cell(s_n.get(s, ZERO) if nb else None,
                                  s_n1.get(s, ZERO) if nb1 else None),
             "nb_mois": nb, "nb_mois_n1": nb1,
             "moy_m": f.moyenne(s_n.get(s, ZERO), nb),
             "moy_m1": f.moyenne(s_n1.get(s, ZERO), nb1),
             "ecart_moy_pct": f.variation_pct(f.moyenne(s_n.get(s, ZERO), nb),
                                              f.moyenne(s_n1.get(s, ZERO), nb1))}
            for s in refs.services],
    }


def individuel(pds: dict[int, PeriodeData], salarie_id: int, refs: Refs) -> dict:
    """Un matricule sur 12 mois. Mois sans ligne : None."""
    mois = []
    for m in range(1, 13):
        pd = _ok(pds.get(m))
        ligne = next((L for L in pd.lignes if L.salarie_id == salarie_id), None) if pd else None
        mois.append({
            "mois": m,
            "present": ligne is not None,
            "service": ligne.service if ligne else None,
            "site": ligne.site if ligne else None,
            "contrat": ligne.contrat if ligne else None,
            "rubriques": {r: ligne.montants.get(r) for r in refs.rubriques} if ligne else None,
            "total": pd.total(ligne) if ligne and pd else None,
        })
    presents = [x["total"] for x in mois if x["present"]]
    cumul = sum(presents, ZERO)
    return {"mois": mois, "cumul": cumul, "nb_mois": len(presents),
            "moyenne": f.moyenne(cumul, len(presents))}
