import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

// Onglets au-dessus de l'en-tête qu'ils pilotent : titre et rôle de la section active.
const ONGLETS = [
  { to: '/admin', label: 'Données', perm: 'saisie:write', titre: 'ADMINISTRATION DES DONNÉES', aide: 'Importer, saisir et corriger les chiffres de chaque mois.' },
  { to: '/admin/employes', label: 'Employés', perm: 'saisie:write', titre: 'ADMINISTRATION DES EMPLOYÉS', aide: 'Fiches des salariés : création, rattachement au service et au site.' },
  { to: '/admin/referentiels', label: 'Sites et services', perm: 'referentiel:write', titre: 'ADMINISTRATION DES SITES ET SERVICES', aide: 'Listes des sites et des services utilisées dans les rapports et les droits.' },
  { to: '/admin/utilisateurs', label: 'Utilisateurs', perm: 'users:write', titre: 'ADMINISTRATION DES UTILISATEURS', aide: 'Comptes de connexion : qui accède à l’application et ce que chacun voit.' },
]

/** Premier onglet d'administration accordé ; aucun : l'administration n'existe pas pour ce compte. */
export const premierePageAdmin = (can: (perm: string) => boolean) => ONGLETS.find((o) => can(o.perm))?.to

export default function AdminNav() {
  const { can } = useAuth()
  const { pathname } = useLocation()
  const actif = ONGLETS.find((o) => o.to === pathname.replace(/\/$/, '')) ?? ONGLETS[0]
  return (
    <>
      <nav aria-label="Administration" className="admin-onglets">
        {ONGLETS.filter((o) => can(o.perm)).map((o) => (
          <NavLink key={o.to} to={o.to} end>{o.label}</NavLink>
        ))}
      </nav>
      <header className="admin-entete">
        <h2 className="bandeau-titre">{actif.titre}</h2>
        <p>{actif.aide}</p>
      </header>
    </>
  )
}
