import io
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from fastapi.responses import Response
from openpyxl import load_workbook
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.imports import modeles
from app.imports.lecture import MAX_OCTETS, norm
from app.models.donnees import Salarie
from app.models.referentiel import Activite, Poste, RefAlias, Service, Site, TypeContrat
from app.security import audit
from app.security.deps import current_principal
from app.security.policy import Principal, authorize

router = APIRouter(prefix="/salaries", tags=["salaries"])
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

# champ de la fiche -> (colonne Salarie, dimension, modèle, libellé Excel)
DIMS = {
    "poste": ("poste_id", "poste", Poste, "Poste"),
    "type_contrat": ("type_contrat_id", "type_contrat", TypeContrat, "Type Contrat"),
    "activite": ("activite_id", "activite", Activite, "Activité"),
    "site": ("site_id", "site", Site, "Site"),
    "service": ("service_id", "service", Service, "Service"),
}


class FicheIn(BaseModel):
    matricule: str
    nom: str
    poste: str | None = None
    type_contrat: str | None = None
    activite: str | None = None
    site: str | None = None
    service: str | None = None
    actif: bool = True


class Index:
    """Résolution d'un libellé (ou alias) d'une liste vers son id, sans accents ni casse."""

    def __init__(self, db: Session):
        self.par_dim, self.libelles = {}, {}
        for champ, (_, dim, model, _) in DIMS.items():
            base = {r.id: r.libelle for r in db.scalars(select(model))}
            idx = {norm(v): i for i, v in base.items()}
            for a in db.scalars(select(RefAlias).where(RefAlias.dimension == dim)):
                if a.cible_id in base:
                    idx[a.alias_norm] = a.cible_id
            self.par_dim[champ], self.libelles[champ] = idx, base

    def id(self, champ: str, texte: str | None) -> int | None | Literal[False]:
        if texte is None or not str(texte).strip():
            return None
        return self.par_dim[champ].get(norm(texte), False)


def _dict(s: Salarie, idx: Index) -> dict:
    d = {"id": s.id, "matricule": s.matricule, "nom": s.nom, "actif": s.actif}
    for champ, (col, *_rest) in DIMS.items():
        d[champ] = idx.libelles[champ].get(getattr(s, col))
    return d


def _appliquer(s: Salarie, f: FicheIn, idx: Index) -> list[str]:
    erreurs = []
    for champ, (col, _d, _m, lib) in DIMS.items():
        v = idx.id(champ, getattr(f, champ))
        if v is False:
            erreurs.append(f"{lib} « {getattr(f, champ)} » inconnu")
        else:
            setattr(s, col, v)
    s.nom, s.actif = f.nom.strip(), f.actif
    return erreurs


@router.get("")
def liste(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    authorize(p, "saisie:write")
    idx = Index(db)
    return [_dict(s, idx) for s in db.scalars(select(Salarie).order_by(Salarie.matricule))]


@router.get("/listes")
def listes(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    authorize(p, "saisie:write")
    idx = Index(db)
    return {c: sorted(idx.libelles[c].values()) for c in DIMS}


@router.post("", status_code=201)
def creer(f: FicheIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    authorize(p, "saisie:write")
    mat = f.matricule.strip()
    if not mat or not f.nom.strip():
        raise HTTPException(422, "Matricule et nom obligatoires")
    if db.scalar(select(Salarie.id).where(Salarie.matricule_norm == mat.casefold())):
        raise HTTPException(409, "Matricule déjà existant")
    idx = Index(db)
    s = Salarie(matricule=mat, matricule_norm=mat.casefold(), nom=f.nom.strip())
    erreurs = _appliquer(s, f, idx)
    if erreurs:
        raise HTTPException(422, "; ".join(erreurs))
    db.add(s)
    db.flush()
    audit.record(db, p.user_id, "creation_salarie", "salarie", s.id, None, _dict(s, idx))
    db.commit()
    return _dict(s, idx)


@router.put("/{sid}")
def modifier(sid: int, f: FicheIn, p: Principal = Depends(current_principal),
             db: Session = Depends(get_db)):
    authorize(p, "saisie:write")
    s = db.get(Salarie, sid)
    if s is None:
        raise HTTPException(404, "Employé introuvable")
    idx = Index(db)
    avant = _dict(s, idx)
    erreurs = _appliquer(s, f, idx)
    if erreurs:
        raise HTTPException(422, "; ".join(erreurs))
    audit.record(db, p.user_id, "modification_salarie", "salarie", s.id, avant, _dict(s, idx))
    db.commit()
    return _dict(s, idx)


@router.get("/modele.xlsx")
def modele(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    authorize(p, "saisie:write")
    idx = Index(db)
    refs = {lib: sorted(idx.libelles[c].values()) for c, (_, _, _, lib) in DIMS.items()}
    exemple = [["MAT001", "Nom Prénom", None, None, None, None, None, "Oui"]]
    return Response(modeles.modele_employes(refs, exemple), media_type=XLSX,
                    headers={"Content-Disposition": 'attachment; filename="modele_employes.xlsx"'})


def _lire(contenu: bytes) -> list[tuple[int, dict]]:
    try:
        wb = load_workbook(io.BytesIO(contenu), read_only=True, data_only=True)
    except Exception as e:
        raise HTTPException(422, "Fichier Excel illisible") from e
    ws = wb["EMPLOYES"] if "EMPLOYES" in wb.sheetnames else wb.worksheets[0]
    cles = {norm(t): t for t in modeles.EMPLOYES_ENTETES}
    entete, lignes = None, []
    for num, row in enumerate(ws.iter_rows(values_only=True), start=1):
        if entete is None:
            noms = [norm(v) if v is not None else "" for v in row]
            if "matricule" in noms and "noms" in noms:
                entete = [cles.get(n) for n in noms]
            elif num > 10:
                break
            continue
        if all(v is None or str(v).strip() == "" for v in row):
            continue
        lignes.append((num, {h: v for h, v in zip(entete, row, strict=False) if h}))
    if entete is None:
        raise HTTPException(422, "En-tête introuvable (Matricule, Noms)")
    return lignes


@router.post("/import")
async def importer(fichier: UploadFile, simuler: bool = Query(True),
                   p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    authorize(p, "saisie:write")
    contenu = await fichier.read(MAX_OCTETS + 1)
    if len(contenu) > MAX_OCTETS:
        raise HTTPException(413, "Fichier trop volumineux")
    idx = Index(db)
    existants = {s.matricule_norm: s for s in db.scalars(select(Salarie))}
    crees, modifies, anomalies, vus = [], [], [], set()
    for num, r in _lire(contenu):
        mat = str(r.get("Matricule") or "").strip()
        nom = str(r.get("Noms") or "").strip()
        if not mat or not nom:
            anomalies.append({"ligne": num, "message": "Matricule et Noms obligatoires"})
            continue
        if mat.casefold() in vus:
            anomalies.append(
                {"ligne": num, "message": f"Matricule « {mat} » en double dans le fichier"}
            )
            continue
        vus.add(mat.casefold())
        actif = norm(r.get("Actif") or "oui") not in ("non", "false", "0")
        f = FicheIn(matricule=mat, nom=nom, actif=actif,
                    **{c: (str(r.get(lib)).strip() if r.get(lib) else None)
                       for c, (_, _, _, lib) in DIMS.items()})
        s = existants.get(mat.casefold())
        nouveau = s is None
        if nouveau:
            s = Salarie(matricule=mat, matricule_norm=mat.casefold(), nom=nom)
        erreurs = _appliquer(s, f, idx)
        for e in erreurs:
            anomalies.append({"ligne": num, "message": e})
        if not erreurs:
            (crees if nouveau else modifies).append(s)
    if simuler or anomalies:
        db.rollback()
        if anomalies and not simuler:
            raise HTTPException(422, {"message": "Import refusé", "anomalies": anomalies})
    else:
        for s in crees:
            db.add(s)
        db.flush()
        audit.record(db, p.user_id, "import_salaries", "salarie", None, None,
                     {"crees": len(crees), "modifies": len(modifies)})
        db.commit()
    return {"simulation": simuler, "crees": len(crees), "modifies": len(modifies),
            "anomalies": anomalies}
