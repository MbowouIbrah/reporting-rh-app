import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  panneaux?: (PanneauSnap | PanneauSnap[])[]
  /** Contenu libre, rendu à la place des panneaux (ex. une grille de graphiques). */
  contenu?: ReactNode
}

/**
 * Sections plein écran avec accrochage (scroll-snap) et rail de navigation à droite,
 * sur le modèle du portail Academy Assist. Sous 1100 px : simple empilement.
 */
export default function SnapSections({ sections, libelle = 'Tableaux du rapport' }: { sections: SectionSnap[]; libelle?: string }) {
  const zone = useRef<HTMLDivElement>(null)
  const cles = sections.map((x) => x.id).join('|')

  // Molette : un geste = une section (l'accrochage seul ramène au départ sur un petit cran),
  // sauf si le tableau survolé peut encore défiler dans ce sens
  useEffect(() => {
    const racine = zone.current
    if (!racine) return
    // Verrou levé à l'arrivée (scrollend) et non après un délai fixe ; les crans d'un même geste
    // (inertie du pavé tactile) restent ignorés tant qu'ils se suivent de près.
    let enMouvement = false
    let dernier = 0
    let depart = -1e9
    let secours = 0
    let dernierTableau = -1e9
    const liberer = () => {
      enMouvement = false
      window.clearTimeout(secours)
    }
    const surMolette = (e: WheelEvent) => {
      if (e.deltaY === 0 || racine.scrollHeight <= racine.clientHeight) return
      const bas = e.deltaY > 0
      const t = performance.now()
      const corps = (e.target as HTMLElement).closest('.panneau-corps')
      if (corps && (bas ? corps.scrollTop + corps.clientHeight < corps.scrollHeight - 1 : corps.scrollTop > 0)) {
        dernierTableau = t
        return
      }
      // Tableau arrivé au bout : le geste en cours s'arrête là, il faut relâcher puis relancer pour changer de section
      if (corps && corps.scrollHeight > corps.clientHeight + 1 && t - dernierTableau < 300) {
        e.preventDefault()
        dernierTableau = t
        return
      }
      // Tous les crans sont bloqués, même les petits de fin d'inertie : laissés au navigateur, ils
      // interrompaient le défilement doux et l'accrochage recalait la section après coup (à-coup).
      e.preventDefault()
      // Crans rapprochés = même geste, mais seulement dans la seconde qui suit un changement de section :
      // une molette qui envoie des crans sans pause ne doit jamais rester bloquée.
      const memeGeste = t - dernier < 160 && t - depart < 1000
      dernier = t
      if (enMouvement || memeGeste || Math.abs(e.deltaY) < 4) return
      const liste = [...racine.querySelectorAll<HTMLElement>('.snap-section')]
      const courant = liste.reduce((m, s, i) => (Math.abs(s.offsetTop - racine.scrollTop) < Math.abs(liste[m].offsetTop - racine.scrollTop) ? i : m), 0)
      const cible = liste[courant + (bas ? 1 : -1)]
      if (!cible) return
      enMouvement = true
      depart = t
      secours = window.setTimeout(liberer, 900) // navigateur sans scrollend
      aller(cible.id)
    }
    racine.addEventListener('wheel', surMolette, { passive: false })
    racine.addEventListener('scrollend', liberer)
    return () => {
      racine.removeEventListener('wheel', surMolette)
      racine.removeEventListener('scrollend', liberer)
      window.clearTimeout(secours)
    }
  }, [])

  // Tableaux empilés : chacun grandit au prorata de ses lignes, pour une hauteur de ligne commune,
  // sans dépasser la hauteur de ligne plafonnée
  useLayoutEffect(() => {
    const poser = () =>
      zone.current?.querySelectorAll<HTMLElement>('.snap-section .panneau').forEach((p) => {
        p.style.flexGrow = String(p.querySelectorAll('tbody tr').length || 1)
        plafonner(p)
      })
    // Recalage regroupé en une fois par image, jamais pendant le rendu d'un changement de section
    let image = 0
    const planifier = () => {
      if (!image) image = requestAnimationFrame(() => {
        image = 0
        poser()
      })
    }
    poser()
    window.addEventListener('resize', planifier)

    const racine = zone.current
    let mo: MutationObserver | null = null
    if (racine && typeof MutationObserver !== 'undefined') {
      // les dessins des graphiques (svg) ne changent pas la hauteur des tableaux
      mo = new MutationObserver((l) => {
        if (l.some((m) => !(m.target as Element).closest?.('svg'))) planifier()
      })
      mo.observe(racine, { childList: true, subtree: true })
    }

    return () => {
      cancelAnimationFrame(image)
      window.removeEventListener('resize', planifier)
      mo?.disconnect()
    }
  }, [cles])

  function aller(id: string) {
    const reduit = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    document.getElementById(id)?.scrollIntoView({ behavior: reduit ? 'auto' : 'smooth', block: 'start' })
  }

  return (
    <div className="snap-zone">
      <div className="snap-scroll" ref={zone} tabIndex={0} role="region" aria-label={libelle}>
        {sections.map((s, i) => (
          <div key={s.id} id={s.id} className="snap-section" style={{ gridTemplateColumns: s.colonnes }}>
            {s.contenu ?? s.panneaux?.map((pn) =>
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
      <Rail sections={sections} zone={zone} cles={cles} aller={aller} />
    </div>
  )
}

/** Rail à part : le changement de section active ne redessine que lui, pas les tableaux. */
function Rail({ sections, zone, cles, aller }: {
  sections: SectionSnap[]
  zone: RefObject<HTMLDivElement | null>
  cles: string
  aller: (id: string) => void
}) {
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
  }, [cles, zone])
  return (
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
  )
}
