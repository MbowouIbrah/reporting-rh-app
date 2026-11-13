"""Dossier de paie : les fichiers `BrutFinalMMAA.csv` déposés dans IMPORT_DIR sont détectés puis analysés.

L'analyse crée un lot « en vérification » : rien n'est visible tant que l'administrateur n'a pas validé
(flux de validation inchangé). Le dossier n'est jamais modifié (lecture seule). Détection à l'événement
(watchdog) et passage de secours périodique, car un partage réseau ne signale pas toujours les dépôts."""

import hashlib
import logging
import queue
import threading
import time
from datetime import UTC, datetime
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from app.core.config import settings
from app.db.session import SessionLocal
from app.db.session import engine as moteur
from app.imports import paie, service
from app.imports.lecture import MAX_OCTETS
from app.models.imports import LotImport

LOG = logging.getLogger("app.imports.dossier")

DELAI_STABILITE = 1.0  # secondes entre deux lectures de la taille d'un fichier
CLE_VERROU = 727_061  # verrou PostgreSQL : un seul processus surveille le dossier
_PASSAGE = "\0passage"  # tâche « passage complet » dans la file de travail (un nom de fichier n'a pas de \0)

# Taille et date d'un fichier déjà lu -> empreinte (évite de relire un gros fichier à chaque affichage).
_empreintes: dict[str, tuple[int, int, str]] = {}


# ---- chemins ----
def _racine(dossier: str | Path | None = None) -> Path | None:
    """Dossier de paie (IMPORT_DIR par défaut) ; None s'il n'est pas configuré ou introuvable."""
    d = settings.IMPORT_DIR if dossier is None else dossier
    if not d:
        return None
    p = Path(d)
    return p.resolve() if p.is_dir() else None


def lister_possible(dossier: str | Path | None = None) -> bool:
    """Le dossier de paie est configuré et existe."""
    return _racine(dossier) is not None


def _fichier_ok(nom: str) -> bool:
    """Fichier .csv (sans tenir compte de la casse), ni caché ni temporaire (`~$…`, `.…`)."""
    return paie.est_csv(nom) and not nom.startswith((".", "~"))


def _confiner(racine: Path, nom: str) -> Path:
    """Chemin du fichier `nom` du dossier ; 404 si le nom sort du dossier (`..`, chemin absolu, lien
    vers l'extérieur) ou si le fichier n'existe pas."""
    if (not nom or nom in (".", "..") or "/" in nom or "\\" in nom or ":" in nom
            or Path(nom).name != nom):
        raise HTTPException(404, "Fichier introuvable")
    try:
        chemin = (racine / nom).resolve()
        if not chemin.is_relative_to(racine) or chemin.parent != racine or not chemin.is_file():
            raise HTTPException(404, "Fichier introuvable")
    except (OSError, ValueError):
        raise HTTPException(404, "Fichier introuvable") from None
    return chemin


# ---- état d'un fichier ----
def _lots_par_empreinte(db: Session, empreintes: set[str]) -> dict[str, list[tuple[int, str]]]:
    lots: dict[str, list[tuple[int, str]]] = {}
    if empreintes:
        for sha, lot_id, statut in db.execute(
                select(LotImport.sha256, LotImport.id, LotImport.statut)
                .where(LotImport.sha256.in_(empreintes)).order_by(LotImport.id.desc())):
            lots.setdefault(sha, []).append((lot_id, statut))
    return lots


def _etat(lots: list[tuple[int, str]], periode: tuple[int, int] | None) -> tuple[str, int | None]:
    """(état, lot) d'un fichier d'après les lots de même contenu :
    importe (lot validé), en_verification (lot prêt ou rejeté), annule (lot annulé : pas repris tout seul),
    mois_introuvable (nom sans mois lisible), a_traiter."""
    for etat, statuts in (("importe", ("valide",)), ("en_verification", ("pret", "rejete")),
                          ("annule", ("annule",))):
        lot_id = next((i for i, s in lots if s in statuts), None)
        if lot_id is not None:
            return etat, lot_id
    return ("a_traiter" if periode else "mois_introuvable"), None


def _empreinte(chemin: Path, taille: int, modifie_ns: int) -> str:
    vu = _empreintes.get(str(chemin))
    if vu is not None and vu[:2] == (taille, modifie_ns):
        return vu[2]
    sha = hashlib.sha256(chemin.read_bytes()).hexdigest()
    _empreintes[str(chemin)] = (taille, modifie_ns, sha)
    return sha


def lister(db: Session, dossier: str | Path | None = None) -> list[dict]:
    """Fichiers .csv du dossier (pas de sous-dossiers), le plus récent d'abord : nom, taille, date de
    modification, mois lu dans le nom et état. Dossier non configuré : liste vide."""
    racine = _racine(dossier)
    if racine is None:
        return []
    trouves = []
    for p in racine.iterdir():
        if not _fichier_ok(p.name):
            continue
        try:
            chemin = _confiner(racine, p.name)
            st = chemin.stat()
        except (HTTPException, OSError):
            continue
        sha = None if st.st_size > MAX_OCTETS else _empreinte(chemin, st.st_size, st.st_mtime_ns)
        trouves.append((p.name, chemin, st, sha))
    for cle in [c for c in _empreintes if c.startswith(str(racine)) and c not in {str(t[1]) for t in trouves}]:
        del _empreintes[cle]
    lots = _lots_par_empreinte(db, {t[3] for t in trouves if t[3]})
    sortie = []
    for nom, _chemin, st, sha in trouves:
        periode = paie.mois_du_nom(nom)
        etat, lot_id = ("trop_volumineux", None) if sha is None else _etat(lots.get(sha, []), periode)
        sortie.append({
            "nom": nom, "taille": st.st_size,
            "modifie_le": datetime.fromtimestamp(st.st_mtime, UTC).isoformat(),
            "annee": periode[0] if periode else None, "mois": periode[1] if periode else None,
            "etat": etat, "lot_id": lot_id})
    return sorted(sortie, key=lambda f: (f["modifie_le"], f["nom"]), reverse=True)


# ---- analyse ----
def _stable(chemin: Path) -> bool:
    """Taille identique à deux lectures espacées : le dépôt du fichier est terminé."""
    avant = chemin.stat().st_size
    time.sleep(DELAI_STABILITE)
    return chemin.stat().st_size == avant


def traiter(db: Session, nom: str, annee: int | None = None, mois: int | None = None, auto: bool = True,
            user_id: int | None = None, dossier: str | Path | None = None):
    """Analyse un fichier du dossier (lot « en vérification », rien n'est validé). None si le fichier est
    encore en cours d'écriture (repris au prochain avis) ou, en mode auto, s'il n'y a rien à faire : déjà
    importé ou en vérification, lot annulé, mois introuvable, trop volumineux, erreur (journalisée).
    Mode manuel (`auto=False`) : mois choisi possible et erreurs remontées comme l'envoi d'un fichier."""
    racine = _racine(dossier)
    if racine is None:
        raise HTTPException(404, "Dossier de paie non configuré")
    chemin = _confiner(racine, nom)
    if not _fichier_ok(nom):
        raise HTTPException(404, "Fichier introuvable")
    try:
        if not _stable(chemin):
            LOG.info("Fichier %s en cours d'écriture : repris plus tard", nom)
            return None
        with chemin.open("rb") as f:
            contenu = f.read(MAX_OCTETS + 1)
    except OSError:
        if auto:
            LOG.warning("Fichier %s illisible", nom)
            return None
        raise HTTPException(404, "Fichier introuvable") from None
    if auto:
        if len(contenu) > MAX_OCTETS:
            LOG.warning("Fichier %s ignoré : plus de 20 Mo", nom)
            return None
        sha = hashlib.sha256(contenu).hexdigest()
        etat, _ = _etat(_lots_par_empreinte(db, {sha}).get(sha, []), paie.mois_du_nom(nom))
        if etat != "a_traiter":
            return None
    try:
        lot = service.analyser(db, user_id, nom, contenu, None, annee, mois, origine="dossier", chemin=nom)
    except IntegrityError:  # même contenu analysé au même instant par un autre processus
        db.rollback()
        if auto:
            return None
        raise HTTPException(409, "Fichier déjà en vérification ou importé") from None
    except HTTPException as e:
        db.rollback()
        if not auto:
            raise
        LOG.info("Fichier %s non analysé : %s", nom, e.detail)
        return None
    except Exception:
        db.rollback()
        if not auto:
            raise
        LOG.exception("Analyse du fichier %s en échec", nom)
        return None
    LOG.info("Fichier %s analysé : lot %s (%s)", nom, lot.id, lot.statut)
    return lot


def passage(db_factory=SessionLocal, dossier: str | Path | None = None) -> int:
    """Analyse tous les fichiers à traiter du dossier ; renvoie le nombre de lots créés."""
    with db_factory() as db:
        a_traiter = [f["nom"] for f in lister(db, dossier) if f["etat"] == "a_traiter"]
    nb = 0
    for nom in a_traiter:
        with db_factory() as db:
            if traiter(db, nom, dossier=dossier) is not None:
                nb += 1
    return nb


# ---- surveillance ----
class _Avis(FileSystemEventHandler):
    """Transmet les fichiers .csv créés, modifiés, fermés ou déplacés ; le travail se fait ailleurs."""

    def __init__(self, demander):
        self._demander = demander

    def _vu(self, chemin) -> None:
        nom = Path(str(chemin)).name
        if _fichier_ok(nom):
            self._demander(nom)

    def on_created(self, event):
        if not event.is_directory:
            self._vu(event.src_path)

    on_modified = on_closed = on_created

    def on_moved(self, event):
        if not event.is_directory:
            self._vu(event.dest_path)


class Surveillance:
    """Un observateur du dossier, un thread de travail (une analyse à la fois) et un thread de secours."""

    def __init__(self, racine: Path, db_factory=SessionLocal, minutes: int = 30, moteur_bd=moteur):
        self._racine, self._db_factory, self._minutes = racine, db_factory, max(1, minutes)
        self._bd = moteur_bd
        self._stop = threading.Event()
        self._file: queue.Queue = queue.Queue()
        self._en_file: set[str] = set()
        self._verrou_file = threading.Lock()
        self._observer = None
        self._connexion = None  # connexion qui garde le verrou PostgreSQL
        self._threads = [threading.Thread(target=self._travail, name="import-travail", daemon=True),
                         threading.Thread(target=self._secours, name="import-secours", daemon=True)]

    def demarrer(self) -> None:
        for t in self._threads:
            t.start()

    def arreter(self) -> None:
        self._stop.set()
        self._file.put(None)
        for t in self._threads:
            t.join(timeout=5)
        self._arreter_observer()
        self._liberer()

    def _demander(self, tache: str) -> None:
        with self._verrou_file:
            if tache in self._en_file:
                return
            self._en_file.add(tache)
        self._file.put(tache)

    def _travail(self) -> None:
        while True:
            tache = self._file.get()
            if tache is None or self._stop.is_set():
                return
            with self._verrou_file:
                self._en_file.discard(tache)
            try:
                if tache == _PASSAGE:
                    passage(self._db_factory, self._racine)
                else:
                    with self._db_factory() as db:
                        traiter(db, tache, dossier=self._racine)
            except Exception:
                LOG.exception("Surveillance du dossier de paie : traitement de %r en échec", tache)

    def _secours(self) -> None:
        """Passage complet au démarrage puis à intervalle régulier. Seul le processus qui tient le verrou
        surveille ; les autres retentent à chaque passage (reprise si le premier s'arrête)."""
        while not self._stop.is_set():
            if self._tenir_verrou():
                self._lancer_observer()
                self._demander(_PASSAGE)
            else:
                self._arreter_observer()
            if self._stop.wait(self._minutes * 60):
                return

    def _tenir_verrou(self) -> bool:
        if self._bd.dialect.name != "postgresql":  # SQLite (tests, recette) : pas de verrou
            return True
        if self._connexion is not None:
            try:
                self._connexion.execute(text("SELECT 1"))
                self._connexion.commit()
                return True
            except Exception:
                LOG.warning("Connexion du verrou de surveillance perdue")
                self._liberer()
        try:
            connexion = self._bd.connect()
            pris = connexion.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": CLE_VERROU}).scalar()
            connexion.commit()
        except Exception:
            LOG.exception("Verrou de surveillance du dossier de paie indisponible")
            return False
        if not pris:
            connexion.close()
            return False
        self._connexion = connexion
        return True

    def _liberer(self) -> None:
        connexion, self._connexion = self._connexion, None
        if connexion is not None:
            try:
                connexion.close()  # le verrou de session disparaît avec la connexion
            except Exception:
                LOG.debug("Fermeture de la connexion du verrou en échec", exc_info=True)

    def _lancer_observer(self) -> None:
        if self._observer is not None:
            return
        try:
            observer = Observer()
            observer.schedule(_Avis(self._demander), str(self._racine), recursive=False)
            observer.daemon = True
            observer.start()
        except Exception:
            LOG.exception("Détection par événements impossible : seul le passage de secours est actif")
            return
        self._observer = observer

    def _arreter_observer(self) -> None:
        observer, self._observer = self._observer, None
        if observer is not None:
            observer.stop()
            observer.join(timeout=5)


_surveillance: Surveillance | None = None


def demarrer(db_factory=SessionLocal, dossier: str | Path | None = None) -> bool:
    """Lance la surveillance du dossier de paie ; False (avertissement) si IMPORT_DIR est vide ou absent."""
    global _surveillance
    if _surveillance is not None:
        return True
    racine = _racine(dossier)
    if racine is None:
        LOG.warning("Surveillance du dossier de paie coupée : IMPORT_DIR vide ou introuvable")
        return False
    _surveillance = Surveillance(racine, db_factory, settings.IMPORT_SCAN_MINUTES)
    _surveillance.demarrer()
    LOG.info("Surveillance du dossier de paie démarrée")
    return True


def arreter() -> None:
    global _surveillance
    s, _surveillance = _surveillance, None
    if s is not None:
        s.arreter()
