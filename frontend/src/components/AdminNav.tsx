import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

const ONGLETS = [
  { to: '/admin', label: 'Données', perm: 'saisie:write' },
  { to: '/admin/employes', label: 'Employés', perm: 'saisie:write' },
  { to: '/admin/referentiels', label: 'Référentiels', perm: 'referentiel:write' },
  { to: '/admin/utilisateurs', label: 'Utilisateurs', perm: 'users:write' },
]

/** Sous-onglets de l'administration, sous le titre de page ; un onglet n'apparaît qu'avec le droit qu'exige son API. */
export default function AdminNav() {
  const { can } = useAuth()
  return (
    <nav aria-label="Administration" className="admin-onglets">
      {ONGLETS.filter((o) => can(o.perm)).map((o) => (
        <NavLink key={o.to} to={o.to} end>
          {o.label}
        </NavLink>
      ))}
    </nav>
  )
}
