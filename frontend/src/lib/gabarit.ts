import { useEffect, useState } from 'react'
import { ecrireCache, lireCache } from './cacheSession'

// Dernière réponse d'un rapport, gardée le temps de l'onglet (cacheSession, vidé à chaque changement de session) :
// au rechargement, la page s'affiche à sa structure exacte (libellés, lignes, largeur des colonnes) et seules
// les valeurs passent en squelette. Les vraies valeurs sont gardées : un masque des chiffres change la largeur
// affichée (chiffres de largeur inégale dans la police, taux et K/M recalculés côté client).

/** Gabarit lu à l'ouverture de la page, mis à jour à chaque réponse fraîche (`frais`). */
export function useGabarit<T>(cle: string, data: T | undefined, frais: boolean): T | undefined {
  const k = `gabarit:${cle}`
  const [lu] = useState<T | undefined>(() => lireCache<T>(k))
  useEffect(() => {
    if (data && frais) ecrireCache(k, data)
  }, [k, data, frais])
  return lu
}
