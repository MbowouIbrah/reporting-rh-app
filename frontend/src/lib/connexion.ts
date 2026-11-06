import { ApiError, ErreurReseau } from '../api/client'
/** Longueur minimale d'un mot de passe : même règle que le serveur, qui reste l'autorité. */
export const MDP_MIN = 8

const PAGES_CONNEXION = ['/login', '/changer-mot-de-passe', '/reinitialiser']

/**
 * Page d'arrivée demandée, seulement si elle reste dans l'application et n'est pas une page de connexion.
 * Lue comme le navigateur la lit : il retire tabulations et retours à la ligne, et « \\ » vaut « / ».
 */
export function cibleSure(next: string | null) {
  if (!next || !next.startsWith('/')) return '/resume'
  try {
    const base = window.location.origin
    const u = new URL(next, base)
    if (u.origin !== base) return '/resume'
    if (PAGES_CONNEXION.includes(u.pathname.replace(/\/+$/, ''))) return '/resume'
    return u.pathname + u.search + u.hash
  } catch {
    return '/resume'
  }
}

/** Message d'échec d'une page de connexion : dit si le serveur est injoignable ou en panne,
 *  plutôt qu'un « Réessayez » générique. `autre` sert pour toute autre erreur. */
export function messagePanne(err: unknown, autre: string): string {
  if (err instanceof ErreurReseau) return 'Le serveur est injoignable : réseau coupé ou serveur arrêté. Vérifiez votre connexion, puis réessayez dans quelques minutes.'
  if (err instanceof ApiError && err.status >= 500) {
    return `Le serveur a rencontré une erreur (${err.status}). Réessayez dans quelques minutes ; si cela dure, prévenez l’administrateur.`
  }
  return autre
}
