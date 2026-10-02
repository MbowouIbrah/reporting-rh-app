import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

const ONGLETS = [
  { to: '/resume', label: 'Résumé' },
  { to: '/mensuel', label: 'Mensuel' },
  { to: '/annuel', label: 'Annuel' },
  { to: '/graphes', label: 'Graphes' },
  { to: '/individuel', label: 'Individuel', perm: 'nominatif:read' },
]

export default function Layout() {
  const { me, can, logout } = useAuth()
  const navigate = useNavigate()
  return (
    <div className="app">
      <header className="topbar">
        <span className="micro">CFAO · Ressources humaines</span>
        <h1>
          Reporting <span className="accent">RH</span>
        </h1>
        <nav aria-label="Rapports">
          {ONGLETS.filter((o) => !o.perm || can(o.perm)).map((o) => (
            <NavLink key={o.to} to={o.to}>
              {o.label}
            </NavLink>
          ))}
        </nav>
        <div className="user">
          <span>{me?.email}</span>
          <button
            className="btn-link"
            onClick={async () => {
              await logout()
              navigate('/login')
            }}
          >
            Déconnexion
          </button>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  )
}
