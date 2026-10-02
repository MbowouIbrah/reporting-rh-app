import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

const LIENS = [
  { to: '/admin/periodes', label: 'Périodes et CA', perm: 'saisie:write' },
  { to: '/admin/utilisateurs', label: 'Utilisateurs', perm: 'users:read' },
  { to: '/admin/perimetres', label: 'Périmètres', perm: 'perimetre:write' },
  { to: '/admin/referentiels', label: 'Référentiels', perm: 'referentiel:write' },
  { to: '/admin/budgets', label: 'Budgets', perm: 'saisie:write' },
  { to: '/admin/parametrage', label: 'Paramétrage', perm: 'referentiel:write' },
]

export default function AdminNav() {
  const { can } = useAuth()
  return (
    <nav aria-label="Administration" className="sous-nav">
      {LIENS.filter((l) => can(l.perm)).map((l) => (
        <NavLink key={l.to} to={l.to}>
          {l.label}
        </NavLink>
      ))}
    </nav>
  )
}
