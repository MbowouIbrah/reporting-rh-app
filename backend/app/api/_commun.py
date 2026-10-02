from decimal import Decimal, InvalidOperation

from fastapi import HTTPException


def parse_montant(s: str) -> Decimal:
    """Montant saisi (virgule ou point) -> Decimal(18,3) ; 422 si invalide ou négatif."""
    try:
        v = Decimal(s.strip().replace(",", "."))
    except InvalidOperation:
        raise HTTPException(422, "Montant invalide") from None
    if not v.is_finite() or v < 0 or abs(v) >= Decimal("1e15"):
        raise HTTPException(422, "Montant invalide")
    return v.quantize(Decimal("0.001"))
