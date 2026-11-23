import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

const CELLULES = (r: HTMLTableRowElement) => Array.from(r.cells)

function nettoyer(r: HTMLTableRowElement) {
  r.classList.remove('fige', 'collee')
  delete r.dataset.top
  CELLULES(r).forEach((c) => {
    c.style.position = ''
    c.style.top = ''
    c.style.zIndex = ''
  })
}

/** Une ligne figée est « collée » quand ses cellules ont quitté leur place naturelle (la ligne, elle, défile). */
function marquerCollees(racine: HTMLElement | null) {
  racine?.querySelectorAll<HTMLTableRowElement>('tr.fige').forEach((r) => {
    const c = r.cells[0]
    if (c) r.classList.toggle('collee', c.getBoundingClientRect().top - r.getBoundingClientRect().top > 0.5)
  })
}

/** Les trois premières lignes ouvertes restent collées sous l'en-tête du tableau, l'une sous l'autre. */
function figer(racine: HTMLElement | null) {
  const t = racine?.querySelector<HTMLTableElement>('table.arbre:not(.liste-pers)')
  if (!t || !t.tHead || !t.tBodies[0]) return
  const lignes = Array.from(t.tBodies[0].rows)
  const choisies = lignes.filter((r) => r.classList.contains('ouverte')).slice(0, 3)
  lignes.filter((r) => !choisies.includes(r)).forEach(nettoyer)
  const dpr = window.devicePixelRatio || 1
  let top = t.tHead.getBoundingClientRect().height
  choisies.forEach((r) => {
    r.classList.add('fige')
    CELLULES(r).forEach((c) => {
      c.style.position = 'sticky'
      c.style.top = Math.floor(top * dpr) / dpr + 'px'
      c.style.zIndex = '3'
    })
    r.dataset.top = String(top)
    top += r.getBoundingClientRect().height - 1 /* hauteurs décimales : aucun jour entre deux lignes figées */
  })
  marquerCollees(racine)
}

/**
 * Fige les lignes ouvertes d'un tableau en arbre ; à appeler dans le composant qui porte le tableau.
 * `ouvertes` identifie les lignes ouvertes : le calcul est refait quand elles changent, quand le tableau
 * change de taille, quand la fenêtre est redimensionnée ou quand les polices sont chargées.
 */
export function useLignesFigees(racine: RefObject<HTMLElement | null>, ouvertes = '') {
  useLayoutEffect(() => {
    figer(racine.current)
  }, [racine, ouvertes])
  const attente = useRef(0)
  useEffect(() => {
    let actif = true
    const refaire = () => {
      cancelAnimationFrame(attente.current)
      attente.current = requestAnimationFrame(() => figer(racine.current))
    }
    const defiler = () => {
      cancelAnimationFrame(attente.current)
      attente.current = requestAnimationFrame(() => marquerCollees(racine.current))
    }
    window.addEventListener('resize', refaire)
    document.addEventListener('scroll', defiler, { capture: true, passive: true })
    const table = racine.current?.querySelector<HTMLTableElement>('table.arbre:not(.liste-pers)')
    const observeur = table && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(refaire) : null
    if (table) observeur?.observe(table)
    document.fonts?.ready.then(() => {
      if (actif) refaire()
    })
    return () => {
      actif = false
      observeur?.disconnect()
      cancelAnimationFrame(attente.current)
      window.removeEventListener('resize', refaire)
      document.removeEventListener('scroll', defiler, { capture: true })
    }
  }, [racine])
}
