import { BarChart3, CalendarDays, CalendarRange, Database, LayoutDashboard, UserRound } from 'lucide-react'
import { useIsFetching } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { prechargerGraphes } from '../lib/pagesDifferees'
import Fond from './Fond'
import { premierePageAdmin } from './AdminNav'
import LienPage from './LienPage'
import MenuProfil from './MenuProfil'

const ONGLETS = [
  { to: '/resume', label: 'Résumé', Icone: LayoutDashboard },
  { to: '/graphes', label: 'Graphes', Icone: BarChart3 },
  { to: '/annuel', label: 'Annuel', Icone: CalendarRange },
  { to: '/mensuel', label: 'Mensuel', Icone: CalendarDays },
  { to: '/individuel', label: 'Individuel', perm: 'nominatif:read', Icone: UserRound },
]

export default function Layout() {
  const { can } = useAuth()
  useEffect(() => prechargerGraphes(), [])
  // Administration : visible dès qu'un de ses onglets est accordé, et ouvre le premier d'entre eux.
  const admin = premierePageAdmin(can)
  const enAdmin = useLocation().pathname.startsWith('/admin')
  const onglets = [
    ...ONGLETS.filter((o) => !o.perm || can(o.perm)),
    ...(admin ? [{ to: admin, label: 'Administration', Icone: Database }] : []),
  ]
  const [ouvert, setOuvert] = useState(false)
  const occupe = useIsFetching() > 0
  return (
    <div className="app layout-ecran">
      <Fond />
      <header className="topbar">
       <div className="topbar-inner">
        <LienPage to="/resume" className="marque" aria-label="Reporting RH, accueil">
          <img className="marque-logo" src={`${import.meta.env.BASE_URL}images/cfao_logo.png`} alt="CFAO" />
          <h1>Reporting RH</h1>
        </LienPage>
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
          {onglets.map((o) => (
            <LienPage key={o.to} to={o.to} className={({ isActive }) => (isActive || (o.to === admin && enAdmin) ? 'active' : undefined)}>
              <o.Icone aria-hidden="true" size={16} strokeWidth={2} />
              {o.label}
            </LienPage>
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
