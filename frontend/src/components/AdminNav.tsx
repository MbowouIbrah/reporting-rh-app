import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

interface Lien {
  to: string
  label: string
  perm: string
}

const LIENS: Lien[] = [
  { to: '/admin/periodes', label: 'Périodes et CA', perm: 'saisie:write' },
  { to: '/admin/employes', label: 'Employés', perm: 'saisie:write' },
  { to: '/admin/donnees', label: 'Données mensuelles', perm: 'saisie:write' },
  { to: '/admin/acces', label: 'Accès', perm: 'users:read' },
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
