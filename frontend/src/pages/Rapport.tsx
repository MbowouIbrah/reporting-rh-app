import { useIsFetching } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { type ComponentType, lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { usePartage } from '../hooks/useFiltres'
import { sectionsPermises, type IdSection } from '../lib/sectionsRapport'
import Annuel from './Annuel'
import Individuel from './Individuel'
import Mensuel from './Mensuel'
import Resume from './Resume'

const Graphes = lazy(() => import('./Graphes'))

const PAGES: Record<IdSection, ComponentType> = { resume: Resume, graphes: Graphes, annuel: Annuel, mensuel: Mensuel, individuel: Individuel }

/** Délai après la dernière réponse : laisse les graphiques finir leur animation avant l'impression. */
const DELAI_IMPRESSION = 1200

/**
 * Rapport à enregistrer en PDF : les parties choisies l'une sous l'autre, une par page,
 * sans barre de navigation ni filtres. La boîte d'impression s'ouvre une fois tout chargé.
 */
export default function Rapport() {
  const [sp] = useSearchParams()
  const { can } = useAuth()
  const { partage: p } = usePartage()
  const ids = (sp.get('sections') ?? '').split(',')
  const parties = sectionsPermises(can).filter((s) => ids.includes(s.id))
  const occupe = useIsFetching() > 0
  const [pret, setPret] = useState(false)
  const imprime = useRef(false)

  useEffect(() => {
    if (occupe) return setPret(false)
    const t = setTimeout(() => setPret(true), DELAI_IMPRESSION)
    return () => clearTimeout(t)
  }, [occupe])

  useEffect(() => {
    if (!pret || imprime.current || sp.has('apercu')) return
    imprime.current = true
    window.print()
  }, [pret, sp])

  const perimetre = [p.service, p.type_site, p.site, p.poste, p.matricule && `matricule ${p.matricule}`].filter(Boolean)

  return (
    <div className="rapport-pdf">
      <div className="rapport-outils">
        <span role="status">{pret ? 'Rapport prêt.' : 'Préparation du rapport…'}</span>
        <button type="button" className="bouton bouton-primaire" disabled={!pret} onClick={() => window.print()}>
          <Printer aria-hidden="true" size={16} />
          Enregistrer en PDF
        </button>
      </div>
      <header className="rapport-entete">
        <img src={`${import.meta.env.BASE_URL}images/cfao_academy.png`} alt="" />
        <div>
          <h1>Reporting RH</h1>
          <p>
            {parties.map((s) => s.libelle).join(' · ')} — {perimetre.length ? perimetre.join(', ') : 'tous services et sites'} — édité le{' '}
            {new Date().toLocaleDateString('fr-FR')}
          </p>
        </div>
      </header>
      {parties.map((s) => {
        const Page = PAGES[s.id]
        return (
          <div key={s.id} className="rapport-partie">
            <Suspense fallback={null}>
              <Page />
            </Suspense>
          </div>
        )
      })}
    </div>
  )
}
