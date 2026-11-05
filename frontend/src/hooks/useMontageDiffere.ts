import { useEffect, useRef, useState } from 'react'

// Un seul montage par tranche : le navigateur peint entre deux, la page répond pendant le tracé.
const file: Array<() => void> = []
let enCours = false

function suivant() {
  const tache = file.shift()
  if (!tache) {
    enCours = false
    return
  }
  tache()
  requestAnimationFrame(() => setTimeout(suivant, 0))
}

function planifier(tache: () => void) {
  file.push(tache)
  if (!enCours) {
    enCours = true
    suivant()
  }
  return () => {
    const i = file.indexOf(tache)
    if (i >= 0) file.splice(i, 1)
  }
}

/**
 * Retarde le montage d'un contenu coûteux jusqu'à ce qu'il approche de l'écran, puis le monte à son tour.
 * Immédiat si `immediat` (impression du rapport) ou si le navigateur n'a pas d'IntersectionObserver.
 */
export function useMontageDiffere<T extends HTMLElement>(immediat = false) {
  const zone = useRef<T>(null)
  const [monte, setMonte] = useState(immediat || typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    const el = zone.current
    if (monte || !el) return
    let annuler: (() => void) | undefined
    // Sur grand écran les groupes défilent dans leur propre zone ; ailleurs, c'est la page qui défile.
    const conteneur = el.closest<HTMLElement>('.snap-scroll')
    const root = conteneur && getComputedStyle(conteneur).overflowY !== 'visible' ? conteneur : null
    const observateur = new IntersectionObserver(
      (entrees) => {
        if (!entrees.some((e) => e.isIntersecting)) return
        observateur.disconnect()
        annuler = planifier(() => setMonte(true))
      },
      // Un écran d'avance : le graphe est prêt avant d'arriver à l'écran
      { root, rootMargin: '100% 0px' },
    )
    observateur.observe(el)
    return () => {
      observateur.disconnect()
      annuler?.()
    }
  }, [monte])

  return { zone, monte }
}
