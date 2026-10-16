import { BarChart3, CalendarDays, CalendarRange, Database, LayoutDashboard, UserRound } from 'lucide-react'
import { useIsFetching } from '@tanstack/react-query'
import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import Fond from './Fond'
import MenuProfil from './MenuProfil'

const ONGLETS = [
  { to: '/resume', label: 'Résumé', Icone: LayoutDashboard },
  { to: '/graphes', label: 'Graphes', Icone: BarChart3 },
  { to: '/annuel', label: 'Annuel', Icone: CalendarRange },
  { to: '/mensuel', label: 'Mensuel', Icone: CalendarDays },
  { to: '/individuel', label: 'Individuel', perm: 'nominatif:read', Icone: UserRound },
  { to: '/admin', label: 'Administration', perm: 'saisie:write', Icone: Database },
]

export default function Layout() {
  const { can } = useAuth()
  const [ouvert, setOuvert] = useState(false)
  const occupe = useIsFetching() > 0
  return (
    <div className="app layout-ecran">
      <Fond />
      <header className="topbar">
       <div className="topbar-inner">
        <NavLink to="/resume" className="marque" aria-label="Reporting RH, accueil">
          <img className="marque-logo" src={`${import.meta.env.BASE_URL}images/cfao_logo.png`} alt="CFAO" />
          <h1>Reporting RH</h1>
        </NavLink>
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
            <NavLink key={o.to} to={o.to} className={({ isActive }) => (isActive ? 'active' : undefined)}>
              <o.Icone aria-hidden="true" size={16} strokeWidth={2} />
              {o.label}
            </NavLink>
          ))}
        </nav>
        <MenuProfil />
       </div>
      </header>
      {/* Le squelette est visuel (aria-busy, peu restitué) : annonce polie pour les lecteurs d'écran. */}
      <span className="sr-only" role="status" aria-live="polite">{occupe ? 'Chargement…' : ''}</span>
      <main className="page">
        <Outlet />
      </main>
    </div>
  )
}
