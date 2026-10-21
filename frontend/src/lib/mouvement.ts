import { flushSync } from 'react-dom'

/** Effets d'animation disponibles ; chacun correspond à un préréglage [data-mouvement] de styles/mouvement.css. */
export const EFFETS = ['monte', 'fondu', 'glisse', 'zoom', 'aucun'] as const
export type Effet = (typeof EFFETS)[number]

/** Effet appliqué à tous : le changer ici suffit pour toute l'application. */
export const EFFET_PAR_DEFAUT: Effet = 'monte'

const CLE = 'reporting-rh.mouvement'

function estEffet(v: string | null): v is Effet {
  return v !== null && (EFFETS as readonly string[]).includes(v)
}

function lireChoix(): Effet | null {
  try {
    const v = localStorage.getItem(CLE)
    return estEffet(v) ? v : null
  } catch {
    return null
  }
}

function ecrireChoix(effet: Effet | null) {
  try {
    if (effet) localStorage.setItem(CLE, effet)
    else localStorage.removeItem(CLE)
  } catch {
    /* stockage indisponible : le choix vaut pour la page en cours seulement */
  }
}

/**
 * Pose l'effet actif sur <html data-mouvement>. Pour essayer un effet : ?mouvement=zoom (mémorisé
 * dans ce navigateur), ?mouvement=defaut pour revenir à EFFET_PAR_DEFAUT.
 */
export function installerMouvement(doc: Document = document, url: string = location.href): Effet {
  const demande = new URL(url).searchParams.get('mouvement')
  if (demande === 'defaut') ecrireChoix(null)
  else if (estEffet(demande)) ecrireChoix(demande)
  const effet = (estEffet(demande) ? demande : lireChoix()) ?? EFFET_PAR_DEFAUT
  doc.documentElement.dataset.mouvement = effet
  return effet
}

export function mouvementReduit(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

type DocTransition = Document & { startViewTransition?: (maj: () => void) => unknown }

/** Navigue avec la transition de page (sortie en fondu de la page quittée) quand le navigateur la permet. */
export function transitionPage(naviguer: () => void, doc: DocTransition = document) {
  if (!doc.startViewTransition || mouvementReduit() || doc.documentElement.dataset.mouvement === 'aucun') {
    naviguer()
    return
  }
  doc.startViewTransition(() => flushSync(naviguer))
}
