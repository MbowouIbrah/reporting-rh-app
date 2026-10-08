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

export const useSaisirCa = () =>
  useEcriture(({ id, valeur }: { id: number; valeur: string | null }) =>
    api<PeriodeAdmin>(`/periodes/${id}/ca`, { method: 'PUT', body: JSON.stringify({ valeur }) }),
  )

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

// ---- référentiels ----
export type Dimension = 'service' | 'site' | 'activite' | 'type_contrat'
export interface RefModif {
  dim: Dimension
  id: number
  libelle?: string
  actif?: boolean
}
export interface RefResultat {
  perimetres_maj: number
}
export const useReferentielDim = (dim: Dimension) =>
  useQuery({
    queryKey: ['admin', 'ref', dim],
    queryFn: () => api<Referentiel>(`/referentiels/${dim}`),
    retry: queryRetry,
  })
export const apercuRenommage = ({ dim, id, ...b }: RefModif) =>
  api<RefResultat>(`/referentiels/${dim}/${id}?apercu=true`, json('PUT', b))
export const useModifierRef = () =>
  useAction(({ dim, id, ...b }: RefModif) => api<RefResultat>(`/referentiels/${dim}/${id}`, json('PUT', b)))

// ---- paramétrage daté ----
export interface RubriqueP {
  id: number
  libelle: string
  unite: 'FCFA' | 'jours'
  ordre: number
  actif: boolean
  moteur: boolean
}
export interface RegleP {
  id: number
  rubrique_id: number
  regle: 'exclu_total_ligne' | 'exclu_total_general'
  date_debut: string
  date_fin: string | null
}
export interface ParametreP {
  id: number
  cle: 'jours_ouvres' | 'budget_employe'
  valeur: string
  date_debut: string
}
export interface Parametrage {
  rubriques: RubriqueP[]
  regles: RegleP[]
  parametres: ParametreP[]
}
export const useParametrage = () =>
  useQuery({ queryKey: ['admin', 'parametrage'], queryFn: () => api<Parametrage>('/parametrage'), retry: queryRetry })
export const useCreerParametre = () =>
  useAction((b: { cle: string; valeur: string; date_debut: string }) =>
    api('/parametrage/parametres', json('POST', b)),
  )
export const useCreerRegle = () =>
  useAction((b: { rubrique_id: number; regle: string; date_debut: string }) =>
    api('/parametrage/regles', json('POST', b)),
  )
export const useTerminerRegle = () =>
  useAction(({ id, date_fin }: { id: number; date_fin: string }) =>
    api(`/parametrage/regles/${id}/fin`, json('POST', { date_fin })),
  )
export const useCreerRubrique = () =>
  useAction((b: { libelle: string; unite: string }) => api('/parametrage/rubriques', json('POST', b)))
export const useModifierRubrique = () =>
  useAction(({ id, ...b }: { id: number; actif?: boolean; ordre?: number }) =>
    api(`/parametrage/rubriques/${id}`, json('PUT', b)),
  )

// ---- budgets ----
export type AxeBudget = 'rubrique' | 'service' | 'site'
export interface LigneBudget {
  cible_id: number
  libelle: string
  actif: boolean
  valeur: string | null
}
export interface BudgetsVue {
  periode_id: number
  annee: number
  mois: number
  statut: string
  lignes: Record<AxeBudget, LigneBudget[]>
}
export const useBudgets = (periodeId: number | null) =>
  useQuery({
    queryKey: ['admin', 'budgets', periodeId],
    queryFn: () => api<BudgetsVue>(`/budgets?periode_id=${periodeId}`),
    enabled: periodeId !== null,
    retry: queryRetry,
  })
export const useSaisirBudgets = () =>
  useAction(({ id, lignes }: { id: number; lignes: { axe: AxeBudget; cible_id: number; valeur: string | null }[] }) =>
    api(`/budgets/${id}`, json('PUT', { lignes })),
  )
export const useCopierBudgets = () =>
  useAction(({ id, depuis }: { id: number; depuis: number }) => api(`/budgets/${id}/copie`, json('POST', { depuis })))

// ---- journal d'audit ----
export interface EvenementAudit {
  id: number
  ts: string
  utilisateur_id: number | null
  action: string
  entite: string
  entite_id: string | null
  avant: Record<string, unknown> | null
  apres: Record<string, unknown> | null
}
export const useAudit = (f: { entite: string; entite_id: string; limit: number }) => {
  const qs = new URLSearchParams({ limit: String(f.limit) })
  if (f.entite) qs.set('entite', f.entite)
  if (f.entite_id) qs.set('entite_id', f.entite_id)
  return useQuery({
    queryKey: ['admin', 'audit', f],
    queryFn: () => api<EvenementAudit[]>(`/audit?${qs}`),
    retry: queryRetry,
  })
}
