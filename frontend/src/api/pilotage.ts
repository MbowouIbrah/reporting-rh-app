import { useQuery, type QueryClient } from '@tanstack/react-query'
import { api, queryRetry } from './client'
import { qs } from './rapports'
import type { Dec, Val } from './types'

export const AXES = ['rubrique', 'service', 'site'] as const
export type Axe = (typeof AXES)[number]
export const TITRES: Record<Axe, string> = { rubrique: 'Types de charge', service: 'Services', site: 'Sites' }

export interface CibleBudget {
  cible_id: number
  libelle: string
  actif: boolean
  /** Rubrique exclue du TOTAL CHARGES à la date du mois : hors total. */
  exclue: boolean
  valeur: Dec | null
}

export interface Pilotage {
  annee: number
  mois: number
  /** null : le mois n'est pas encore ouvert (rien n'a été saisi). */
  periode_id: number | null
  ca: Dec | null
  marge: Dec | null
  taux_marge: Val
  budgets: Record<Axe, CibleBudget[]>
  totaux: Record<Axe, Dec | null>
  /** Budgets du dernier mois qui en a, proposés quand ce mois n'en a aucun. */
  reprise: { annee: number; mois: number; valeurs: Record<Axe, Record<string, Dec>> } | null
}

export interface LigneBudget {
  axe: Axe
  cible_id: number
  valeur: string | null
}

const put = (body: unknown): RequestInit => ({ method: 'PUT', body: JSON.stringify(body) })

export const usePilotage = (annee: number, mois: number, actif: boolean) =>
  useQuery({
    queryKey: ['pilotage', annee, mois],
    queryFn: () => api<Pilotage>(`/pilotage${qs({ annee, mois })}`),
    enabled: actif,
    retry: queryRetry,
  })

export const enregistrerCaMarge = (annee: number, mois: number, ca: string | null, marge: string | null) =>
  api<Pilotage>('/pilotage/ca-marge', put({ annee, mois, ca, marge }))

export const enregistrerBudgets = (annee: number, mois: number, lignes: LigneBudget[]) =>
  api<Pilotage>('/pilotage/budgets', put({ annee, mois, lignes }))

/** Après une écriture : la vue du mois est remplacée, les rapports qui en dépendent sont rechargés. */
export function apresEcriture(qc: QueryClient, vue: Pilotage) {
  qc.setQueryData(['pilotage', vue.annee, vue.mois], vue)
  for (const k of ['annuel', 'mensuel', 'periodes', 'filtres']) qc.invalidateQueries({ queryKey: [k] })
}
