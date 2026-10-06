import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, BASE, queryRetry } from './client'

export interface Fiche {
  id: number
  matricule: string
  nom: string
  poste: string | null
  type_contrat: string | null
  activite: string | null
  site: string | null
  service: string | null
  actif: boolean
}
export type FicheIn = Omit<Fiche, 'id'>

export interface ResultatImport {
  simulation: boolean
  crees: number
  modifies: number
  anomalies: { ligne: number; message: string }[]
}

export interface LigneMois {
  matricule: string
  nom: string
  poste: string | null
  type_contrat: string
  activite: string
  site: string
  service: string
  montants: Record<string, string>
  total: string
}
export interface DonneesMois {
  annee: number
  mois: number
  close: boolean
  rubriques: { libelle: string; unite: string }[]
  lignes: LigneMois[]
}
export interface LigneIn {
  annee: number
  mois: number
  matricule: string
  nom?: string
  poste?: string
  type_contrat?: string
  activite?: string
  site?: string
  service?: string
  montants: Record<string, string>
}

export interface Lot {
  id: number
  fichier_nom: string
  statut: 'pret' | 'rejete' | 'valide' | 'annule'
  cree_le: string | null
  nb_lignes: number
  nb_bloquants: number
  nb_avert: number
}
export interface Anomalie {
  ligne: number | null
  colonne: string | null
  gravite: 'bloquant' | 'avertissement'
  message: string
}

const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const fichier = (f: File) => {
  const fd = new FormData()
  fd.append('fichier', f)
  return fd
}

/** Téléchargement d'un fichier généré par l'API (cookies de session inclus). */
export async function telecharger(path: string, nom: string) {
  const r = await fetch(`${BASE}${path}`, { credentials: 'same-origin' })
  if (!r.ok) throw new ApiError(r.status, r.statusText)
  const url = URL.createObjectURL(await r.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = nom
  a.click()
  URL.revokeObjectURL(url)
}

function useEcriture<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => void qc.invalidateQueries() })
}

// ---- employés ----
export const useSalariesAdmin = () =>
  useQuery({ queryKey: ['admin', 'salaries'], queryFn: () => api<Fiche[]>('/salaries'), retry: queryRetry })
export const useCreerSalarie = () => useEcriture((f: FicheIn) => post<Fiche>('/salaries', f))
export const useModifierSalarie = () =>
  useEcriture(({ id, ...f }: Fiche) => api<Fiche>(`/salaries/${id}`, { method: 'PUT', body: JSON.stringify(f) }))
export const useImportSalaries = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ f, simuler }: { f: File; simuler: boolean }) =>
      api<ResultatImport>(`/salaries/import?simuler=${simuler}`, { method: 'POST', body: fichier(f) }),
    onSuccess: (r) => {
      if (!r.simulation) void qc.invalidateQueries()
    },
  })
}
export type Listes = Record<'poste' | 'type_contrat' | 'activite' | 'site' | 'service', string[]>
export const useListes = () =>
  useQuery({ queryKey: ['admin', 'listes'], queryFn: () => api<Listes>('/salaries/listes'), retry: queryRetry })

// ---- données mensuelles ----
export const useDonneesMois = (annee: number, mois: number) =>
  useQuery({
    queryKey: ['admin', 'donnees', annee, mois],
    queryFn: () => api<DonneesMois>(`/donnees?annee=${annee}&mois=${mois}`),
    retry: queryRetry,
  })
export const useSaisirLigne = () => useEcriture((l: LigneIn) => post<{ lot_id: number }>('/donnees/lignes', l))

// ---- lots d'import ----
export const useLots = () =>
  useQuery({ queryKey: ['admin', 'lots'], queryFn: () => api<Lot[]>('/imports'), retry: queryRetry })
export const useCreerLot = () => useEcriture((f: File) => api<Lot>('/imports', { method: 'POST', body: fichier(f) }))
export const useAnomalies = (lotId: number | null) =>
  useQuery({
    queryKey: ['admin', 'anomalies', lotId],
    queryFn: () => api<Anomalie[]>(`/imports/${lotId}/anomalies?limit=200`),
    enabled: lotId !== null,
  })
export const useValiderLot = () => useEcriture((id: number) => post<Lot>(`/imports/${id}/valider`))
export const useAnnulerLot = () => useEcriture((id: number) => post<Lot>(`/imports/${id}/annuler`))

// ---- parcours de fin de mois ----
export type StatutEtape = 'fait' | 'a_faire' | 'a_revoir' | 'reportable' | 'facultatif'
export interface EtapeParcours {
  cle: 'mois' | 'donnees' | 'controles' | 'ca' | 'budgets'
  libelle: string
  statut: StatutEtape
  resume: string
}
export interface Parcours {
  annee: number
  mois: number
  existe: boolean
  periode_id: number | null
  ca: string | null
  effectifs: {
    total: number
    entrees: { matricule: string; nom: string }[]
    sorties: { matricule: string; nom: string }[]
  }
  etapes: EtapeParcours[]
}
export const useParcours = (annee: number, mois: number) =>
  useQuery({
    queryKey: ['admin', 'parcours', annee, mois],
    queryFn: () => api<Parcours>(`/parcours?annee=${annee}&mois=${mois}`),
    retry: queryRetry,
  })
export const useOuvrirMois = () =>
  useEcriture((m: { annee: number; mois: number }) => post<{ id: number }>('/periodes', m))
