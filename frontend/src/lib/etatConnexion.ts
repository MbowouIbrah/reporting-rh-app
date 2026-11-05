/**
 * État de la connexion au serveur. Seule une sonde déclare la connexion perdue : une requête isolée
 * qui échoue ne suffit pas. Toute réponse du serveur la rétablit. Voir docs/etude-reseau.md.
 */
const DELAI_SONDE = 5_000

/** Réponses d'une passerelle sans serveur derrière : seules ces réponses valent panne. */
export const PANNE_PASSERELLE = [502, 503, 504]

let perdue = false
let sonde: Promise<boolean> | null = null
// Compte les réponses reçues : une sonde partie avant une réponse réussie ne peut plus déclarer la panne.
let reponses = 0
const abonnes = new Set<() => void>()

function poser(valeur: boolean) {
  if (perdue === valeur) return
  perdue = valeur
  abonnes.forEach((f) => f())
}

export const connexionPerdue = () => perdue
export const connexionRetablie = () => {
  reponses++
  poser(false)
}

export function abonnerConnexion(f: () => void) {
  abonnes.add(f)
  return () => {
    abonnes.delete(f)
  }
}

/** Interroge le serveur et met l'état à jour. Sans session, le 401 prouve aussi que le serveur répond. */
export function verifierConnexion(): Promise<boolean> {
  if (sonde) return sonde
  const depart = reponses
  // Minuteur manuel : AbortSignal.timeout manque sur Safari < 16.
  const ctrl = new AbortController()
  const minuteur = setTimeout(() => ctrl.abort(), DELAI_SONDE)
  sonde = fetch(`${import.meta.env.BASE_URL}api/v1/auth/me`, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal: ctrl.signal,
  })
    .then((r) => !PANNE_PASSERELLE.includes(r.status))
    .catch(() => false)
    .then((ok) => {
      if (ok || reponses === depart) poser(!ok)
      return ok || reponses !== depart
    })
    .finally(() => {
      clearTimeout(minuteur)
      sonde = null
    })
  return sonde
}
