"""Comptes et journal en console serveur : python -m app.comptes <commande>.

L'administration n'a plus d'écran Utilisateurs ni Journal (08a) : cet outil les remplace en
production via `docker compose exec api python -m app.comptes ...`. Mêmes règles que l'API
(droits, 8 caractères, au moins un compte actif qui gère les comptes) ; chaque écriture est
tracée au journal d'audit avec un utilisateur vide (console).

Mot de passe : saisi au clavier (jamais en argument, pour ne pas finir dans l'historique),
ou lu dans la variable MOT_DE_PASSE pour un usage non interactif.
"""

import argparse
import getpass
import json
import os
import sys

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.admin import (
    PorteeIn,
    _check_droits,
    _commit,
    _est_admin_actif,
    _exiger_autre_admin,
    _flush,
    _poser_droits,
    _user_dict,
)
from app.db.session import SessionLocal
from app.models.auth import AuditEvent, Perimetre, Utilisateur
from app.security import audit
from app.security.deps import portee_de
from app.security.passwords import check_password, hash_password
from app.security.policy import MODELES


class Erreur(Exception):
    pass


def _mot_de_passe() -> str:
    pw = os.environ.get("MOT_DE_PASSE")
    if pw is None:
        pw = getpass.getpass("Mot de passe : ")
        if getpass.getpass("Confirmer : ") != pw:
            raise Erreur("Les deux saisies diffèrent")
    check_password(pw)
    return pw


def _utilisateur(db: Session, email: str) -> Utilisateur:
    u = db.scalar(select(Utilisateur).where(Utilisateur.email == email.strip().lower()))
    if u is None:
        raise Erreur(f"Aucun compte {email}")
    return u


def _droits(db: Session, args: argparse.Namespace) -> tuple[str, list[str], PorteeIn]:
    """Fonction, permissions et données d'un modèle ; --perimetre restreint les données."""
    fonction, tout, perms = MODELES[args.modele]
    perms = sorted(perms | ({"nominatif"} if args.nominatif else set()))
    if tout:
        if args.perimetre:
            raise Erreur("--perimetre ne s'applique qu'au modèle perimetre")
        portee = PorteeIn(tout=True)
    else:
        if not args.perimetre:
            raise Erreur("--perimetre est obligatoire pour ce modèle (voir la commande perimetres)")
        p = db.scalar(select(Perimetre).where(Perimetre.code == args.perimetre))
        if p is None:
            raise Erreur(f"Périmètre inconnu : {args.perimetre} (voir la commande perimetres)")
        portee = PorteeIn(perimetres=[p.id])
    _check_droits(db, perms, portee)
    return args.fonction or fonction, perms, portee


def _modifier(db: Session, u: Utilisateur, *, actif=None, pw=None, droits=None) -> None:
    avant = _user_dict(u)
    etait_admin = _est_admin_actif(u)
    if actif is not None:
        u.actif = actif
    if pw is not None:
        u.password_hash = hash_password(pw)
    if droits is not None:
        u.fonction, perms, portee = droits
        _poser_droits(u, perms, portee)
    if etait_admin and not _est_admin_actif(u):
        _exiger_autre_admin(db, u)
    _flush(db)
    audit.record(db, None, "update", "utilisateur", u.id, avant, _user_dict(u))
    _commit(db)


def lister(db: Session, args: argparse.Namespace) -> None:
    codes = {p.id: p.code for p in db.scalars(select(Perimetre))}
    for u in db.scalars(select(Utilisateur).order_by(Utilisateur.email)):
        pt = portee_de(u)
        donnees = "tout" if pt.tout else ", ".join(
            [codes.get(i, str(i)) for i in sorted(pt.perimetres)] + sorted(pt.services | pt.sites)
        ) or "aucune donnée"
        perms = ", ".join(sorted(x.permission for x in u.permissions)) or "lecture"
        etat = "actif" if u.actif else "INACTIF"
        print(f"{u.email:40} {etat:8} [{donnees}] {perms}  ({u.nom}, {u.fonction or '-'})")


def perimetres(db: Session, args: argparse.Namespace) -> None:
    for p in db.scalars(select(Perimetre).order_by(Perimetre.code)):
        regles = ", ".join(f"{r.dimension}={r.valeur}" for r in p.regles)
        print(f"{p.code:20} {p.libelle:25} {regles}")


def creer(db: Session, args: argparse.Namespace) -> None:
    email = args.email.strip().lower()
    if db.scalar(select(Utilisateur).where(Utilisateur.email == email)):
        raise Erreur(f"Le compte {email} existe déjà")
    fonction, perms, portee = _droits(db, args)
    u = Utilisateur(
        email=email,
        nom=args.nom,
        fonction=fonction,
        password_hash=hash_password(_mot_de_passe()),
    )
    _poser_droits(u, perms, portee)
    db.add(u)
    _flush(db)
    audit.record(db, None, "create", "utilisateur", u.id, None, _user_dict(u))
    _commit(db)
    print(f"Compte créé : {email}")


def droits(db: Session, args: argparse.Namespace) -> None:
    _modifier(db, _utilisateur(db, args.email), droits=_droits(db, args))
    print(f"Droits mis à jour : {args.email}")


def activer(db: Session, args: argparse.Namespace) -> None:
    _modifier(db, _utilisateur(db, args.email), actif=True)
    print(f"Compte activé : {args.email}")


def desactiver(db: Session, args: argparse.Namespace) -> None:
    _modifier(db, _utilisateur(db, args.email), actif=False)
    print(f"Compte désactivé : {args.email}")


def mot_de_passe(db: Session, args: argparse.Namespace) -> None:
    u = _utilisateur(db, args.email)
    _modifier(db, u, pw=_mot_de_passe())
    print(f"Mot de passe changé : {args.email}")


def journal(db: Session, args: argparse.Namespace) -> None:
    emails = {u.id: u.email for u in db.scalars(select(Utilisateur))}
    q = select(AuditEvent).order_by(AuditEvent.id.desc()).limit(args.limite)
    if args.entite:
        q = q.where(AuditEvent.entite == args.entite)
    for e in db.scalars(q):
        qui = emails.get(e.utilisateur_id, "console") if e.utilisateur_id else "console"
        print(f"{e.ts:%Y-%m-%d %H:%M:%S}  {qui:30} {e.action:10} {e.entite} {e.entite_id or ''}")
        if args.detail:
            for cle, val in (("avant", e.avant), ("après", e.apres)):
                if val is not None:
                    print(f"    {cle} : {json.dumps(val, ensure_ascii=False, default=str)}")


def _parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="python -m app.comptes", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="commande", required=True)
    sub.add_parser("lister", help="comptes, état, données et permissions").set_defaults(fn=lister)
    sub.add_parser("perimetres", help="codes de périmètre").set_defaults(fn=perimetres)

    def avec_droits(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("--modele", required=True, choices=tuple(MODELES))
        sp.add_argument("--perimetre", help="code, obligatoire pour le modèle perimetre")
        sp.add_argument("--nominatif", action="store_true", help="accès aux données nominatives")
        sp.add_argument("--fonction", help="intitulé affiché, sans effet sur les droits")

    sp = sub.add_parser("creer", help="nouveau compte (mot de passe demandé)")
    sp.add_argument("email")
    sp.add_argument("--nom", required=True)
    avec_droits(sp)
    sp.set_defaults(fn=creer)

    sp = sub.add_parser("droits", help="remplace la fonction, les données et les permissions")
    sp.add_argument("email")
    avec_droits(sp)
    sp.set_defaults(fn=droits)

    for nom, fn, aide in (
        ("activer", activer, "réactive un compte"),
        ("desactiver", desactiver, "désactive un compte (départ : ne pas supprimer)"),
        ("mot-de-passe", mot_de_passe, "change le mot de passe (demandé)"),
    ):
        sp = sub.add_parser(nom, help=aide)
        sp.add_argument("email")
        sp.set_defaults(fn=fn)

    sp = sub.add_parser("journal", help="dernières entrées du journal d'audit")
    sp.add_argument("--limite", type=int, default=50)
    sp.add_argument("--entite", help="ex. utilisateur, periode, budget")
    sp.add_argument("--detail", action="store_true", help="affiche avant / après")
    sp.set_defaults(fn=journal)
    return ap


def main(argv: list[str] | None = None, db: Session | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if db is not None:
            args.fn(db, args)
        else:
            with SessionLocal() as session:
                args.fn(session, args)
    except (Erreur, HTTPException) as e:
        if db is not None:
            db.rollback()  # refus : rien ne reste modifié dans la session appelante
        print(f"Erreur : {getattr(e, 'detail', e)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
