import { type ReactNode, useEffect, useRef, useState } from 'react'
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

  function aller(id: string) {
    const reduit = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    document.getElementById(id)?.scrollIntoView({ behavior: reduit ? 'auto' : 'smooth', block: 'start' })
  }

  return (
    <div className="snap-zone">
      <div className="snap-scroll" ref={zone}>
        {sections.map((s) => (
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
