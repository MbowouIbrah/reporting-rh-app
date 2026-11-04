import { flushSync } from 'react-dom'

export function mouvementReduit(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

type DocTransition = Document & { startViewTransition?: (maj: () => void) => unknown }

/** Navigue avec la transition de page (sortie en fondu de la page quittée) quand le navigateur la permet. */
export function transitionPage(naviguer: () => void, doc: DocTransition = document) {
  if (!doc.startViewTransition || mouvementReduit()) {
    naviguer()
    return
  }
  doc.startViewTransition(() => flushSync(naviguer))
}
