from dataclasses import dataclass, field

from fastapi import HTTPException


@dataclass(frozen=True)
class Permission:
    code: str
    libelle: str
    explication: str
    actions: frozenset[str]
    portee_tout: bool = False  # exige l'accès à toutes les données


# Catalogue figé (docs/etude-droits.md §5) : seule son attribution est en base.
LECTURE = "lecture"
CATALOGUE: tuple[Permission, ...] = (
    Permission(LECTURE, "Consulter les rapports",
               "Toujours accordée, limitée aux données visibles du compte.",
               frozenset({"report:read", "perimetre:read"})),
    Permission("nominatif", "Voir les noms et fiches individuelles",
               "Noms des salariés, fiche individuelle (chaque consultation est journalisée).",
               frozenset({"nominatif:read"})),
    Permission("marge", "Voir le CA et la marge",
               "CA et marge saisis (global, site, service ou case) et CA et marge individuels "
               "des employés.",
               frozenset({"marge:read"}), True),
    Permission("import", "Importer la paie",
               "Dépôt des fichiers mensuels et décisions d'import.",
               frozenset({"import:read", "import:write"}), True),
    Permission("saisie", "Corriger les données, saisir budgets et CA",
               "Corrections, budgets, CA et marge, clôture des périodes.",
               frozenset({"saisie:write", "periode:write", "report:write"}), True),
    Permission("referentiel", "Gérer les sites, services, règles et périmètres",
               "Services, sites, rubriques, règles de calcul, périmètres.",
               frozenset({"referentiel:write", "perimetre:write"}), True),
    Permission("comptes", "Gérer les comptes et les droits",
               "Création des comptes, données visibles et permissions.",
               frozenset({"users:read", "users:write"}), True),
    Permission("journal", "Consulter le journal",
               "Historique des connexions et des modifications.",
               frozenset({"audit:read"}), True),
)
PERMISSIONS = {p.code: p for p in CATALOGUE}
ACCORDABLES = tuple(p.code for p in CATALOGUE if p.code != LECTURE)
ACTIONS = frozenset().union(*(p.actions for p in CATALOGUE))
GESTION_COMPTES = "comptes"

# Modèles de départ (reprise des anciens rôles) : fonction, toutes les données, permissions.
MODELES: dict[str, tuple[str, bool, frozenset[str]]] = {
    "admin": ("Administrateur RH", True, frozenset(ACCORDABLES)),
    "global": ("Lecteur global", True, frozenset({"nominatif", "marge"})),
    "perimetre": ("Lecteur de périmètre", False, frozenset()),
}


@dataclass(frozen=True)
class Portee:
    """Données visibles : tout, ou union par dimension (ET entre service et site)."""

    tout: bool = False
    perimetres: frozenset[int] = frozenset()
    services: frozenset[str] = frozenset()
    sites: frozenset[str] = frozenset()

    @property
    def vide(self) -> bool:
        return not (self.tout or self.perimetres or self.services or self.sites)


@dataclass(frozen=True)
class Principal:
    user_id: int
    email: str
    permissions: frozenset[str] = frozenset()  # codes du catalogue, hors lecture
    portee: Portee = field(default_factory=Portee)
    nom: str = ""
    fonction: str = ""

    @property
    def is_global(self) -> bool:
        return self.portee.tout


@dataclass(frozen=True)
class Resource:
    perimetre_id: int | None = None


def is_allowed(principal: Principal, action: str, resource: Resource | None = None) -> bool:
    portee = principal.portee
    if portee.vide:
        return False  # refus par défaut : aucune donnée accordée, aucun droit
    for perm in CATALOGUE:
        if action not in perm.actions:
            continue
        if perm.code != LECTURE and perm.code not in principal.permissions:
            continue
        if perm.portee_tout and not portee.tout:
            continue
        if (
            not portee.tout
            and resource is not None
            and resource.perimetre_id is not None
            and resource.perimetre_id not in portee.perimetres
        ):
            continue
        return True
    return False


def authorize(principal: Principal, action: str, resource: Resource | None = None) -> None:
    if not is_allowed(principal, action, resource):
        raise HTTPException(status_code=403, detail="Accès refusé")
