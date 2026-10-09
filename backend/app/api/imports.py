import io
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.imports import service
from app.imports.lecture import MAX_OCTETS
from app.models.imports import ImportAnomalie, LotImport
from app.security.deps import current_principal
from app.security.policy import Principal, authorize

router = APIRouter(prefix="/imports", tags=["imports"])


@router.post("", status_code=201)
async def creer_lot(
    fichier: UploadFile, p: Principal = Depends(current_principal), db: Session = Depends(get_db)
):
    authorize(p, "import:write")
    contenu = await fichier.read(MAX_OCTETS + 1)
    lot = service.analyser(db, p.user_id, fichier.filename or "import.xlsx", contenu)
    return service.lot_dict(lot)


@router.get("")
def liste(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    authorize(p, "import:read")
    q = select(LotImport).order_by(LotImport.id.desc())
    return [service.lot_dict(x) for x in db.scalars(q)]


def _lot(db: Session, lot_id: int) -> LotImport:
    lot = db.get(LotImport, lot_id)
    if lot is None:
        raise HTTPException(404, "Lot introuvable")
    return lot


@router.get("/{lot_id}")
def detail(lot_id: int, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    authorize(p, "import:read")
    return service.lot_dict(_lot(db, lot_id))


@router.get("/{lot_id}/anomalies")
def anomalies(
    lot_id: int,
    gravite: str | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    authorize(p, "import:read")
    _lot(db, lot_id)
    q = select(ImportAnomalie).where(ImportAnomalie.lot_id == lot_id)
    if gravite:
        q = q.where(ImportAnomalie.gravite == gravite)
    q = q.order_by(ImportAnomalie.gravite, ImportAnomalie.num_ligne, ImportAnomalie.id)
    return [
        {"ligne": a.num_ligne, "colonne": a.colonne, "code": a.code, "gravite": a.gravite,
         "valeur": a.valeur, "message": a.message}
        for a in db.scalars(q.offset(offset).limit(limit))
    ]


@router.get("/{lot_id}/rapport.xlsx")
def rapport(lot_id: int, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    authorize(p, "import:read")
    lot = _lot(db, lot_id)
    anos = list(db.scalars(select(ImportAnomalie).where(ImportAnomalie.lot_id == lot_id)
                           .order_by(ImportAnomalie.gravite, ImportAnomalie.num_ligne)))
    wb = Workbook()
    ws = wb.active
    ws.title = "ANOMALIES"
    ws.append(["Ligne", "Colonne", "Code", "Gravité", "Valeur", "Message"])
    for a in anos:
        ws.append([a.num_ligne, a.colonne, a.code, a.gravite, a.valeur, a.message])
    ws.auto_filter.ref = f"A1:F{max(2, ws.max_row)}"
    ws.freeze_panes = "A2"
    ws2 = wb.create_sheet("SYNTHESE")
    for k, v in (lot.stats or {}).items():
        ws2.append([k, str(v)])
    ws2.append(["bloquantes", lot.nb_bloquants])
    ws2.append(["avertissements", lot.nb_avert])
    for code, c in Counter(a.code for a in anos).most_common():
        ws2.append([f"  {code}", c])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="rapport_lot_{lot_id}.xlsx"'},
    )


@router.get("/{lot_id}/apercu")
def apercu(lot_id: int, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    """Effet de la validation : lignes nouvelles, modifiées (avant -> après), identiques."""
    authorize(p, "import:read")
    return service.apercu(db, lot_id)


class Cle(BaseModel):
    annee: int
    mois: int
    matricule: str


class ValidationIn(BaseModel):
    garder: list[Cle] = []  # lignes déjà en base à conserver telles quelles


@router.post("/{lot_id}/valider")
def valider(lot_id: int, corps: ValidationIn | None = None,
            p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    authorize(p, "import:write")
    garder = {(c.annee, c.mois, c.matricule.strip()) for c in corps.garder} if corps else None
    return service.lot_dict(service.valider_lot(db, p.user_id, lot_id, garder))


@router.post("/{lot_id}/annuler")
def annuler(lot_id: int, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    authorize(p, "import:write")
    return service.lot_dict(service.annuler_lot(db, p.user_id, lot_id))
