/**
 * État de la connexion au serveur. Seule une sonde déclare la connexion perdue : une requête isolée
 * qui échoue ne suffit pas. Toute réponse du serveur la rétablit. Voir docs/etude-reseau.md.
 */
const DELAI_SONDE = 5_000

let perdue = false
let sonde: Promise<boolean> | null = null
const abonnes = new Set<() => void>()

function poser(valeur: boolean) {
  if (perdue === valeur) return
  perdue = valeur
  abonnes.forEach((f) => f())
}

export const connexionPerdue = () => perdue
export const connexionRetablie = () => poser(false)

export function abonnerConnexion(f: () => void) {
  abonnes.add(f)
  return () => {
    abonnes.delete(f)
  }
}

/** Interroge le serveur et met l'état à jour. Sans session, le 401 prouve aussi que le serveur répond. */
export function verifierConnexion(): Promise<boolean> {
  sonde ??= fetch(`${import.meta.env.BASE_URL}api/v1/auth/me`, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(DELAI_SONDE),
  })
    .then((r) => r.status < 500)
    .catch(() => false)
    .then((ok) => {
      poser(!ok)
      return ok
    })
    .finally(() => {
      sonde = null
    })
  return sonde
}
