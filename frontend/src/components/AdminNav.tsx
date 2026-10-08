import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

interface Lien {
  to: string
  label: string
  perm: string
}

const LIENS: Lien[] = [
  { to: '/admin/cloture', label: 'Fin de mois', perm: 'saisie:write' },
  { to: '/admin/employes', label: 'Employés', perm: 'saisie:write' },
  { to: '/admin/acces', label: 'Accès', perm: 'users:read' },
]

// Réglages ponctuels : accessibles sans encombrer les trois onglets du quotidien.
const REGLAGES: Lien[] = [
  { to: '/admin/utilisateurs', label: 'Comptes', perm: 'users:read' },
  { to: '/admin/perimetres', label: 'Périmètres', perm: 'perimetre:write' },
  { to: '/admin/referentiels', label: 'Référentiels', perm: 'referentiel:write' },
  { to: '/admin/parametrage', label: 'Paramétrage', perm: 'referentiel:write' },
  { to: '/admin/journal', label: 'Journal', perm: 'audit:read' },
]

export default function AdminNav() {
  const { can } = useAuth()
  const reglages = REGLAGES.filter((l) => can(l.perm))
  return (
    <div className="admin-navs">
      <nav aria-label="Administration" className="sous-nav">
        {LIENS.filter((l) => can(l.perm)).map((l) => (
          <NavLink key={l.to} to={l.to}>
            {l.label}
          </NavLink>
        ))}
      </nav>
      {reglages.length > 0 && (
        <nav aria-label="Réglages" className="nav-reglages">
          <span className="micro">Réglages</span>
          {reglages.map((l) => (
            <NavLink key={l.to} to={l.to}>
              {l.label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  )
}
