import { keepPreviousData, useQuery } from '@tanstack/react-query'
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

export interface Tableau {
  /** Rubriques dans l'ordre des colonnes de la feuille. */
  colonnes: string[]
  filtres: { annees: number[]; services: string[]; sites: string[] }
  lignes: LigneTableau[]
}

export interface FiltresTableau {
  annee?: string
  mois?: string
  service?: string
  site?: string
  q?: string
}

export const useTableau = (f: FiltresTableau) =>
  useQuery({
    queryKey: ['donnees', 'tableau', f],
    queryFn: () => api<Tableau>(`/donnees/tableau${qs({ ...f })}`),
    placeholderData: keepPreviousData,
    retry: queryRetry,
  })
