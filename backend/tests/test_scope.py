from sqlalchemy import select

from app.models.referentiel import Service, Site
from app.repos.scope import Scope, apply_scope, scope_for
from app.security.policy import Portee, Principal


def _vus(db, scope, **cols):
    q = select(Service.libelle, Site.libelle).join(Site, Site.id > 0)
    return set(db.execute(apply_scope(q, scope, **cols)).all())


def test_et_entre_dimensions_ou_dans_une_dimension(db):
    p = Principal(1, "u@x", portee=Portee(services=frozenset({"SAV PL", "Pneumatique"}),
                                          sites=frozenset({"Douala"})))
    scope = scope_for(db, p)
    vus = _vus(db, scope, service=Service.libelle, site=Site.libelle)
    assert vus == {("SAV PL", "Douala"), ("Pneumatique", "Douala")}


def test_dimension_restreinte_sans_colonne_ne_laisse_rien(db):
    scope = Scope(False, {"service": frozenset({"SAV PL"}), "site": frozenset({"Douala"})})
    assert _vus(db, scope, service=Service.libelle) == set()


def test_portee_vide_ne_voit_rien_et_tout_voit_tout(db):
    vide = scope_for(db, Principal(1, "u@x"))
    assert _vus(db, vide, service=Service.libelle, site=Site.libelle) == set()
    tout = scope_for(db, Principal(1, "u@x", portee=Portee(tout=True)))
    assert tout.unrestricted


def test_perimetre_et_site_se_combinent(db):
    from app.models.auth import Perimetre

    pid = db.scalar(select(Perimetre.id).where(Perimetre.code == "sav_pl"))
    p = Principal(1, "u@x", portee=Portee(perimetres=frozenset({pid}),
                                          sites=frozenset({"Garoua"})))
    vus = _vus(db, scope_for(db, p), service=Service.libelle, site=Site.libelle)
    assert vus == {("SAV PL", "Garoua")}
