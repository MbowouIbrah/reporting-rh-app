import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, queryRetry } from './client'

export interface PeriodeAdmin {
  id: number
  annee: number
  mois: number
  statut: 'ouverte' | 'close'
  close_le: string | null
  ca: string | null
}

const CLE = ['admin', 'periodes']

export const usePeriodesAdmin = () =>
  useQuery({ queryKey: CLE, queryFn: () => api<PeriodeAdmin[]>('/periodes'), retry: queryRetry })

/** Mutation d'écriture : tout ce qui est en cache est rafraîchi. */
function useEcriture<V>(fn: (v: V) => Promise<PeriodeAdmin>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries() // liste admin + tous les rapports (CA, statut)
    },
  })
}

const post = (path: string, body?: unknown) =>
  api<PeriodeAdmin>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined })

export const useSaisirCa = () =>
  useEcriture(({ id, valeur }: { id: number; valeur: string | null }) =>
    api<PeriodeAdmin>(`/periodes/${id}/ca`, { method: 'PUT', body: JSON.stringify({ valeur }) }),
  )
export const useCloturer = () => useEcriture((id: number) => post(`/periodes/${id}/cloturer`))
export const useRouvrir = () =>
  useEcriture(({ id, motif }: { id: number; motif: string }) => post(`/periodes/${id}/rouvrir`, { motif }))

// ---- utilisateurs et périmètres ----
export interface RoleAdmin {
  role: 'rh_admin' | 'lecteur_global' | 'lecteur_perimetre'
  perimetre_id: number | null
  nominatif: boolean
}
export interface UserAdmin {
  id: number
  email: string
  nom: string
  actif: boolean
  roles: RoleAdmin[]
}
export interface Regle {
  dimension: 'service' | 'site'
  valeur: string
}
export interface PerimetreAdmin {
  id: number
  code: string
  libelle: string
  regles: Regle[]
}
export interface Referentiel {
  valeurs: { id: number; libelle: string; actif: boolean }[]
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
})

export const useUsers = () =>
  useQuery({ queryKey: ['admin', 'users'], queryFn: () => api<UserAdmin[]>('/users'), retry: queryRetry })
export const usePerimetresAdmin = () =>
  useQuery({
    queryKey: ['admin', 'perimetres'],
    queryFn: () => api<PerimetreAdmin[]>('/perimetres'),
    retry: queryRetry,
  })
export const useReferentiel = (dim: 'service' | 'site') =>
  useQuery({
    queryKey: ['admin', 'ref', dim],
    queryFn: () => api<Referentiel>(`/referentiels/${dim}`),
    retry: queryRetry,
  })

function useAction<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries() })
}

export type NouvelUser = { email: string; nom: string; password: string; roles: RoleAdmin[] }
export const useCreerUser = () => useAction((b: NouvelUser) => api('/users', json('POST', b)))
export const useModifierUser = () =>
  useAction(({ id, ...b }: { id: number; actif?: boolean; roles?: RoleAdmin[]; password?: string }) =>
    api(`/users/${id}`, json('PUT', b)),
  )
export const useSupprimerUser = () => useAction((id: number) => api(`/users/${id}`, json('DELETE')))

export type NouveauPerimetre = { code: string; libelle: string; regles: Regle[] }
export const useCreerPerimetre = () => useAction((b: NouveauPerimetre) => api('/perimetres', json('POST', b)))
export const useModifierPerimetre = () =>
  useAction(({ id, ...b }: NouveauPerimetre & { id: number }) => api(`/perimetres/${id}`, json('PUT', b)))
export const useSupprimerPerimetre = () => useAction((id: number) => api(`/perimetres/${id}`, json('DELETE')))
