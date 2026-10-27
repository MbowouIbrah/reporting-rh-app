import { useEffect, useState } from 'react'
import { useMonId } from '../auth/AuthContext'

// Forme de la dernière réponse d'un rapport, gardée par compte : au premier chargement, la page s'affiche à sa
// structure exacte (libellés, lignes, colonnes) et seules les valeurs passent en squelette. Aucun chiffre stocké.
const PREFIXE = 'reporting-rh:gabarit:'
const CHIFFRE = /^-?\d+(\.\d+)?$/

/** Copie sans chiffres : montants, effectifs et taux (chaînes décimales) deviennent null, le reste est gardé. */
export function gabarit<T>(d: T): T {
  if (typeof d === 'string') return (CHIFFRE.test(d) ? null : d) as T
  if (Array.isArray(d)) return d.map(gabarit) as T
  if (d && typeof d === 'object') return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, gabarit(v)])) as T
  return d
}

/** Gabarit lu à l'ouverture de la page, mis à jour à chaque réponse fraîche (`frais`). */
export function useGabarit<T>(cle: string, data: T | undefined, frais: boolean): T | undefined {
  const id = useMonId()
  const k = id == null ? null : `${PREFIXE}${id}:${cle}`
  const [lu] = useState<T | undefined>(() => {
    try {
      return k ? (JSON.parse(localStorage.getItem(k) ?? 'null') ?? undefined) : undefined
    } catch {
      return undefined
    }
  })
  useEffect(() => {
    if (!k || !data || !frais) return
    try {
      localStorage.setItem(k, JSON.stringify(gabarit(data)))
    } catch {
      /* stockage indisponible : le premier chargement garde le squelette générique */
    }
  }, [k, data, frais])
  return lu
}
