import bcrypt
from fastapi import HTTPException


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode()[:72], bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode()[:72], hashed.encode())
    except ValueError:
        return False


def check_password(pw: str) -> None:
    if len(pw) < 8:
        raise HTTPException(422, "Mot de passe : 8 caractères minimum")
    if not pw.strip():
        raise HTTPException(422, "Mot de passe : ne peut pas être fait seulement d'espaces")
    if len(pw.encode()) > 72:
        raise HTTPException(422, "Mot de passe : 72 octets maximum")
