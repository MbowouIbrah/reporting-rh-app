import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

interface Lien {
  to: string
  label: string
  perm: string
}
interface Groupe extends Lien {
  /** Pages du groupe : un second rang de liens s'affiche quand on y est. */
  pages?: Lien[]
}

const GROUPES: Groupe[] = [
  { to: '/admin/periodes', label: 'Périodes et CA', perm: 'saisie:write' },
  { to: '/admin/employes', label: 'Employés', perm: 'saisie:write' },
  { to: '/admin/donnees', label: 'Données mensuelles', perm: 'saisie:write' },
  {
    to: '/admin/acces',
    label: 'Accès',
    perm: 'users:read',
    pages: [
      { to: '/admin/acces', label: 'Vue d’ensemble', perm: 'users:read' },
      { to: '/admin/utilisateurs', label: 'Comptes', perm: 'users:read' },
      { to: '/admin/perimetres', label: 'Périmètres', perm: 'perimetre:write' },
    ],
  },
  {
    to: '/admin/budgets',
    label: 'Réglages',
    perm: 'saisie:write',
    pages: [
      { to: '/admin/budgets', label: 'Budgets', perm: 'saisie:write' },
      { to: '/admin/referentiels', label: 'Référentiels', perm: 'referentiel:write' },
      { to: '/admin/parametrage', label: 'Rubriques et règles', perm: 'referentiel:write' },
      { to: '/admin/journal', label: 'Journal', perm: 'audit:read' },
    ],
  },
]

export default function AdminNav() {
  const { can } = useAuth()
  const { pathname } = useLocation()
  const actif = GROUPES.find((g) => g.pages?.some((p) => pathname.startsWith(p.to)))
  return (
    <>
      <nav aria-label="Administration" className="sous-nav">
        {GROUPES.filter((g) => can(g.perm)).map((g) => (
          <NavLink key={g.to} to={g.to} className={g === actif ? 'active' : undefined}>
            {g.label}
          </NavLink>
        ))}
      </nav>
      {actif?.pages && (
        <nav aria-label={actif.label} className="sous-nav sous-nav-2">
          {actif.pages
            .filter((p) => can(p.perm))
            .map((p) => (
              <NavLink key={p.to} to={p.to}>
                {p.label}
              </NavLink>
            ))}
        </nav>
      )}
    </>
  )
}
