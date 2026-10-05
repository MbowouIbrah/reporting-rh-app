import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

const ONGLETS = [
  { to: '/resume', label: 'Résumé' },
  { to: '/mensuel', label: 'Mensuel' },
  { to: '/annuel', label: 'Annuel' },
  { to: '/graphes', label: 'Graphes' },
  { to: '/individuel', label: 'Individuel', perm: 'nominatif:read' },
  { to: '/admin/periodes', label: 'Administration', perm: 'saisie:write' },
]

export default function Layout() {
  const { me, can, logout } = useAuth()
  const navigate = useNavigate()
  const admin = useLocation().pathname.startsWith('/admin')
  const [ouvert, setOuvert] = useState(false)
  const role = me?.roles[0]?.role
  return (
    <div className={`app layout-ecran${admin ? ' ecran-admin' : ''}`}>
      <header className="topbar">
       <div className="topbar-inner">
        <div className="marque">
          <span className="micro">CFAO · Ressources humaines</span>
          <h1>
            Reporting <span className="accent">RH</span>
          </h1>
        </div>
        <button
          type="button"
          className="menu-toggle"
          aria-expanded={ouvert}
          aria-controls="nav-rapports"
          onClick={() => setOuvert((o) => !o)}
        >
          Menu
        </button>
        <nav id="nav-rapports" aria-label="Rapports" className={ouvert ? 'ouvert' : undefined} onClick={() => setOuvert(false)}>
          {ONGLETS.filter((o) => !o.perm || can(o.perm)).map((o) => (
            <NavLink key={o.to} to={o.to}>
              {o.label}
            </NavLink>
          ))}
        </nav>
        <div className="user">
          <span className="user-id">
            <span className="user-email">{me?.email}</span>
            {role && <span className="badge badge-neutre">{role.replace(/_/g, ' ')}</span>}
          </span>
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
       </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  )
}
