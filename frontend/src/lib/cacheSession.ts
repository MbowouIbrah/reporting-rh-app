// Données de référence (périodes disponibles…) gardées le temps de l'onglet : au rechargement, les
// pages affichent tout de suite leurs filtres et la structure de leurs tableaux pendant la
// revalidation. Vidé à chaque changement de session (connexion, déconnexion, expiration).
const PREFIXE = 'reporting-rh:cache:'

export function lireCache<T>(cle: string): T | undefined {
  try {
    return JSON.parse(sessionStorage.getItem(PREFIXE + cle) ?? 'null') ?? undefined
  } catch {
    return undefined
  }
}

export function ecrireCache(cle: string, valeur: unknown) {
  try {
    sessionStorage.setItem(PREFIXE + cle, JSON.stringify(valeur))
  } catch {
    /* stockage indisponible : le rechargement attend le serveur */
  }
}

export function viderCache() {
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(PREFIXE)) sessionStorage.removeItem(k)
  } catch {
    /* rien à vider */
  }
}
