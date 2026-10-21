import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { plafonner } from '../lib/plafond'
import { Panneau } from './BlocsRapport'

export interface PanneauSnap {
  titre: string
  contenu: ReactNode
}

/** Un écran : un ou plusieurs tableaux qui vont ensemble, côte à côte (colonnes en fr). */
export interface SectionSnap {
  id: string
  titre: string
  colonnes?: string
  /** Un tableau seul, ou une liste de tableaux empilés dans une même colonne. */
  panneaux: (PanneauSnap | PanneauSnap[])[]
}

/**
 * Sections plein écran avec accrochage (scroll-snap) et rail de navigation à droite,
 * sur le modèle du portail Academy Assist. Sous 1100 px : simple empilement.
 */
export default function SnapSections({ sections }: { sections: SectionSnap[] }) {
  const zone = useRef<HTMLDivElement>(null)
  const [actif, setActif] = useState(sections[0]?.id)

  useEffect(() => {
    const racine = zone.current
    if (!racine || typeof IntersectionObserver === 'undefined') return
    const obs = new IntersectionObserver(
      (entrees) => {
        const visible = entrees.find((e) => e.isIntersecting)
        if (visible) setActif(visible.target.id)
      },
      { root: racine, threshold: 0.55 },
    )
    racine.querySelectorAll('.snap-section').forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [sections.length])

  // Molette : un geste = une section (l'accrochage seul ramène au départ sur un petit cran),
  // sauf si le tableau survolé peut encore défiler dans ce sens
  useEffect(() => {
    const racine = zone.current
    if (!racine) return
    let verrou = 0
    const surMolette = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < 4 || racine.scrollHeight <= racine.clientHeight) return
      const bas = e.deltaY > 0
      const corps = (e.target as HTMLElement).closest('.panneau-corps')
      if (corps && (bas ? corps.scrollTop + corps.clientHeight < corps.scrollHeight - 1 : corps.scrollTop > 0)) return
      e.preventDefault()
      if (Date.now() < verrou) return
      const liste = [...racine.querySelectorAll<HTMLElement>('.snap-section')]
      const courant = liste.reduce((m, s, i) => (Math.abs(s.offsetTop - racine.scrollTop) < Math.abs(liste[m].offsetTop - racine.scrollTop) ? i : m), 0)
      const cible = liste[courant + (bas ? 1 : -1)]
      if (!cible) return
      verrou = Date.now() + 700
      aller(cible.id)
    }
    racine.addEventListener('wheel', surMolette, { passive: false })
    return () => racine.removeEventListener('wheel', surMolette)
  }, [])

  // Tableaux empilés : chacun grandit au prorata de ses lignes, pour une hauteur de ligne commune,
  // sans dépasser la hauteur de ligne plafonnée
  useLayoutEffect(() => {
    const poser = () =>
      zone.current?.querySelectorAll<HTMLElement>('.snap-section .panneau').forEach((p) => {
        p.style.flexGrow = String(p.querySelectorAll('tbody tr').length || 1)
        plafonner(p)
      })
    poser()
    window.addEventListener('resize', poser)

    const racine = zone.current
    let mo: MutationObserver | null = null
    if (racine && typeof MutationObserver !== 'undefined') {
      mo = new MutationObserver(() => {
        poser()
      })
      mo.observe(racine, { childList: true, subtree: true })
    }

    return () => {
      window.removeEventListener('resize', poser)
      mo?.disconnect()
    }
  })

  function aller(id: string) {
    const reduit = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    document.getElementById(id)?.scrollIntoView({ behavior: reduit ? 'auto' : 'smooth', block: 'start' })
  }

  return (
    <div className="snap-zone">
      <div className="snap-scroll" ref={zone} tabIndex={0} role="region" aria-label="Tableaux du rapport">
        {sections.map((s, i) => (
          <div key={s.id} id={s.id} className="snap-section" style={{ gridTemplateColumns: s.colonnes }}>
            {s.panneaux.map((pn) =>
              Array.isArray(pn) ? (
                <div key={pn[0].titre} className="snap-colonne">
                  {pn.map((x) => (
                    <Panneau key={x.titre} titre={x.titre}>
                      {x.contenu}
                    </Panneau>
                  ))}
                </div>
              ) : (
                <Panneau key={pn.titre} titre={pn.titre}>
                  {pn.contenu}
                </Panneau>
              ),
            )}
            {sections[i + 1] ? (
              <button type="button" className="snap-suite" onClick={() => aller(sections[i + 1].id)}>
                {sections[i + 1].titre}
                <ArrowDown aria-hidden="true" />
              </button>
            ) : (
              i > 0 && (
                <button type="button" className="snap-suite haut" onClick={() => aller(sections[0].id)}>
                  Retour en haut
                  <ArrowUp aria-hidden="true" />
                </button>
              )
            )}
          </div>
        ))}
      </div>
      <nav className="rail" aria-label="Sections du rapport">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            className={s.id === actif ? 'rail-point actif' : 'rail-point'}
            aria-label={s.titre}
            aria-current={s.id === actif ? 'true' : undefined}
            onClick={() => aller(s.id)}
          >
            <span className="rail-bulle">{s.titre}</span>
            <span className="rail-puce" aria-hidden="true" />
          </button>
        ))}
      </nav>
    </div>
  )
}
