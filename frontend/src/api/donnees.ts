import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { ecrireCache, lireCache } from '../lib/cacheSession'
import { api, queryRetry } from './client'
import { qs } from './rapports'

/** Une ligne de la feuille DONNEES : un employé pour un mois. Montants en chaînes décimales. */
export interface LigneTableau {
  annee: number
  mois: number
  matricule: string
  nom: string
  poste: string | null
  type_contrat: string
  activite: string
  site: string
  service: string
  /** Libellé de rubrique -> valeur ; une rubrique non saisie est absente. */
  montants: Record<string, string>
  total: string
  exclusions: string
}

export interface Structure {
  /** Rubriques dans l'ordre des colonnes de la feuille. */
  colonnes: string[]
  /** Rubriques exclues du TOTAL, dans l'ordre des colonnes. */
  exclues: string[]
  /** Valeurs des filtres, limitées au périmètre ; employés triés par nom. */
  filtres: { annees: number[]; services: string[]; sites: string[]; salaries: { matricule: string; nom: string }[] }
}

export interface Tableau extends Structure {
  lignes: LigneTableau[]
}

/** En-tête et filtres seuls : arrivent avant les lignes, la structure du tableau est posée d'emblée. */
export function useStructure() {
  const q = useQuery({
    queryKey: ['donnees', 'structure'],
    queryFn: () => api<Structure>('/donnees/structure'),
    staleTime: 60_000,
    retry: queryRetry,
    // Au rechargement : toutes les colonnes du tableau tout de suite, revalidées ensuite.
    placeholderData: () => lireCache<Structure>('donnees-structure'),
  })
  useEffect(() => {
    if (!q.isPlaceholderData && q.data) ecrireCache('donnees-structure', q.data)
  }, [q.data, q.isPlaceholderData])
  return q
}

export interface FiltresTableau {
  annee?: string
  mois?: string
  service?: string
  site?: string
  matricule?: string
}

export const useTableau = (f: FiltresTableau) =>
  useQuery({
    queryKey: ['donnees', 'tableau', f],
    queryFn: () => api<Tableau>(`/donnees/tableau${qs({ ...f })}`),
    placeholderData: keepPreviousData,
    retry: queryRetry,
  })
