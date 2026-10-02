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
