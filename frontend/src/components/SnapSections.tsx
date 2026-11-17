import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { plafonnerTout } from '../lib/plafond'
import { Panneau } from './BlocsRapport'

export interface PanneauSnap {
  titre: string
  contenu: ReactNode
  /** Le contenu porte lui-même le titre (bandeau intégré au tableau). */
  sansTitre?: boolean
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
 * Un bouton animé sous le rail mène à la section suivante (son titre s'affiche au survol) ;
 * sur la dernière, il remonte à la première. Toujours présent : les points du rail ne bougent pas.
 */
export default function SnapSections({ sections, libelle = 'Tableaux du rapport', onActif }: {
  sections: SectionSnap[]
  libelle?: string
  /** Appelé quand la section visible change (ex. titre affiché hors des sections). */
  onActif?: (id: string) => void
}) {
  const zone = useRef<HTMLDivElement>(null)
  const cles = sections.map((x) => x.id).join('|')

  // Molette. Règles :
  // - dans une section plus haute que l'écran, défilement libre (sans accrochage) ;
  // - au bout de la section, le geste s'arrête : il faut relâcher (pause) puis relancer pour changer de section ;
  // - un geste sur une section au bout (ou sans défilement) mène à la section voisine, en une fois ;
  // - la fin de ce geste (inertie du pavé tactile) est ignorée : elle ne fait pas défiler la section d'arrivée.
  useEffect(() => {
    const racine = zone.current
    if (!racine) return
    const PAUSE = 200 // ms sans cran = geste relâché
    let dernier = -1e9
    let verrou: 'fin' | 'saut' | null = null
    let depart = -1e9
    let enMouvement = false
    let secours = 0
    const liberer = () => {
      enMouvement = false
      window.clearTimeout(secours)
    }
    const surMolette = (e: WheelEvent) => {
      if (e.deltaY === 0 || racine.scrollHeight <= racine.clientHeight) return
      const t = performance.now()
      const nouveauGeste = t - dernier > PAUSE
      dernier = t
      // Une molette qui tourne sans pause ne reste pas bloquée indéfiniment après un changement de section
      if (nouveauGeste || (verrou === 'saut' && t - depart > 1200)) verrou = null
      if (verrou) {
        e.preventDefault()
        return
      }
      const bas = e.deltaY > 0
      const section = (e.target as HTMLElement).closest<HTMLElement>('.snap-section')
      if (section && (bas ? section.scrollTop + section.clientHeight < section.scrollHeight - 1 : section.scrollTop > 0)) return
      // Crans suivants bloqués : laissés au navigateur, ils interrompaient le défilement doux (à-coup).
      e.preventDefault()
      if (Math.abs(e.deltaY) < 4) {
        if (nouveauGeste) dernier = -1e9 // un cran minuscule ne compte pas comme début de geste
        return
      }
      // Section défilée jusqu'au bout pendant ce geste : on attend le relâchement
      if (!nouveauGeste && section && section.scrollHeight > section.clientHeight + 1) {
        verrou = 'fin'
        return
      }
      if (enMouvement) return
      const liste = [...racine.querySelectorAll<HTMLElement>('.snap-section')]
      const courant = liste.reduce((m, s, i) => (Math.abs(s.offsetTop - racine.scrollTop) < Math.abs(liste[m].offsetTop - racine.scrollTop) ? i : m), 0)
      const cible = liste[courant + (bas ? 1 : -1)]
      if (!cible) return
      verrou = 'saut'
      depart = t
      enMouvement = true
      secours = window.setTimeout(liberer, 900) // navigateur sans scrollend
      aller(cible.id, !bas)
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
    const poser = () => {
      const panneaux = [...(zone.current?.querySelectorAll<HTMLElement>('.snap-section .panneau') ?? [])]
      panneaux.forEach((p) => (p.style.flexGrow = String(p.querySelectorAll('tbody tr').length || 1)))
      plafonnerTout(panneaux)
    }
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
      // Seuls l'ajout ou le retrait d'éléments (arrivée des données, lignes) changent la hauteur des tableaux ;
      // pas les changements de texte seuls, ni les dessins des graphiques (svg)
      const element = (n: Node) => n.nodeType === Node.ELEMENT_NODE
      mo = new MutationObserver((l) => {
        if (l.some((m) => !(m.target as Element).closest?.('svg') && ([...m.addedNodes].some(element) || [...m.removedNodes].some(element)))) planifier()
      })
      mo.observe(racine, { childList: true, subtree: true })
    }

    return () => {
      cancelAnimationFrame(image)
      window.removeEventListener('resize', planifier)
      mo?.disconnect()
    }
  }, [cles])

  /** En remontant, on arrive en bas de la section précédente ; sinon en haut. */
  function aller(id: string, parLeBas = false) {
    const reduit = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const cible = document.getElementById(id)
    if (!cible) return
    cible.scrollTop = parLeBas ? cible.scrollHeight : 0
    cible.scrollIntoView({ behavior: reduit ? 'auto' : 'smooth', block: 'start' })
  }

  return (
    <div className="snap-zone">
      <div className="snap-scroll" ref={zone} tabIndex={0} role="region" aria-label={libelle}>
        {sections.map((s) => (
          <div key={s.id} id={s.id} data-titre={s.titre} className="snap-section" style={{ gridTemplateColumns: s.colonnes }}>
            {s.contenu ?? s.panneaux?.map((pn) =>
              Array.isArray(pn) ? (
                <div key={pn[0].titre} className="snap-colonne">
                  {pn.map((x) => (
                    <Panneau key={x.titre} titre={x.titre} sansTitre={x.sansTitre}>
                      {x.contenu}
                    </Panneau>
                  ))}
                </div>
              ) : (
                <Panneau key={pn.titre} titre={pn.titre} sansTitre={pn.sansTitre}>
                  {pn.contenu}
                </Panneau>
              ),
            )}
          </div>
        ))}
      </div>
      <Rail sections={sections} zone={zone} cles={cles} aller={aller} onActif={onActif} />
    </div>
  )
}

/** Rail à part : le changement de section active ne redessine que lui, pas les tableaux. */
function Rail({ sections, zone, cles, aller, onActif }: {
  sections: SectionSnap[]
  zone: RefObject<HTMLDivElement | null>
  cles: string
  aller: (id: string) => void
  onActif?: (id: string) => void
}) {
  const [actif, setActif] = useState(sections[0]?.id)
  useEffect(() => {
    const racine = zone.current
    if (!racine || typeof IntersectionObserver === 'undefined') return
    const obs = new IntersectionObserver(
      (entrees) => {
        const visible = entrees.find((e) => e.isIntersecting)
        if (visible) {
          setActif(visible.target.id)
          onActif?.(visible.target.id)
        }
      },
      { root: racine, threshold: 0.55 },
    )
    racine.querySelectorAll('.snap-section').forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [cles, zone, onActif])

  const suivante = sections[sections.findIndex((x) => x.id === actif) + 1]
  const cible = suivante ?? sections[0]
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
      {sections.length > 1 && (
        <button type="button" className={suivante ? 'rail-suite' : 'rail-suite haut'} aria-label={cible.titre} onClick={() => aller(cible.id)}>
          <span className="rail-bulle">{suivante ? cible.titre : `Retour en haut : ${cible.titre}`}</span>
          {suivante ? <ArrowDown aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
        </button>
      )}
    </nav>
  )
}
