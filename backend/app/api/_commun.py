from decimal import Decimal, InvalidOperation

from fastapi import HTTPException


def parse_montant(s: str, negatif: bool = False) -> Decimal:
    """Montant saisi (virgule ou point) -> Decimal(18,3) ; 422 si invalide ou négatif
    (sauf `negatif`, pour une marge)."""
    try:
        v = Decimal(s.strip().replace(",", "."))
    except InvalidOperation:
        raise HTTPException(422, "Montant invalide") from None
    if not v.is_finite() or (v < 0 and not negatif) or abs(v) >= Decimal("1e15"):
        raise HTTPException(422, "Montant invalide")
    return (v if v else Decimal(0)).quantize(Decimal("0.001"))  # « -0 » enregistré 0
