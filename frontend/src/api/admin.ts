import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, queryRetry } from './client'

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) })

/** Écriture : tout ce qui est en cache est rafraîchi (listes d'administration, filtres et rapports), sauf la session. */
function useEcriture<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' }),
  })
}

// ---- référentiels (sites et services) ----
export type DimensionRef = 'site' | 'service'
export interface ValeurRef {
  id: number
  libelle: string
  actif: boolean
  type_site?: string
}
export interface ModifRef {
  dim: DimensionRef
  id: number
  libelle?: string
  actif?: boolean
  type_site?: string
}
export const TYPES_SITE = ['principal', 'agence', 'deporte'] as const

export const useReferentiel = (dim: DimensionRef) =>
  useQuery({
    queryKey: ['admin', 'ref', dim],
    queryFn: () => api<{ valeurs: ValeurRef[] }>(`/referentiels/${dim}`),
    retry: queryRetry,
  })
export const apercuRenommage = (dim: DimensionRef, id: number, libelle: string) =>
  api<{ perimetres_maj: number }>(`/referentiels/${dim}/${id}?apercu=true`, json('PUT', { libelle }))
export const useModifierRef = () =>
  useEcriture(({ dim, id, ...b }: ModifRef) => api<ValeurRef>(`/referentiels/${dim}/${id}`, json('PUT', b)))
export const useCreerRef = () =>
  useEcriture(({ dim, ...b }: { dim: DimensionRef; libelle: string; type_site?: string }) =>
    api<ValeurRef>(`/referentiels/${dim}`, json('POST', b)),
  )

// ---- employés ----
export const CHAMPS_FICHE = ['poste', 'type_contrat', 'activite', 'site', 'service'] as const
export type ChampFiche = (typeof CHAMPS_FICHE)[number]
export interface FicheIn extends Record<ChampFiche, string | null> {
  matricule: string
  nom: string
  actif: boolean
}
export interface Fiche extends FicheIn {
  id: number
}
export type Listes = Record<ChampFiche, string[]>

export const useSalaries = () =>
  useQuery({ queryKey: ['admin', 'salaries'], queryFn: () => api<Fiche[]>('/salaries'), retry: queryRetry })
export const useListes = () =>
  useQuery({ queryKey: ['admin', 'salaries', 'listes'], queryFn: () => api<Listes>('/salaries/listes'), retry: queryRetry })
export const useCreerSalarie = () => useEcriture((b: FicheIn) => api<Fiche>('/salaries', json('POST', b)))
export const useModifierSalarie = () =>
  useEcriture(({ id, ...b }: Fiche) => api<Fiche>(`/salaries/${id}`, json('PUT', b)))
