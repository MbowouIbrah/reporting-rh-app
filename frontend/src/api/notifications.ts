import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, queryRetry } from './client'

export interface Notification {
  id: number
  type: string
  titre: string
  texte: string
  lien: string | null
  cree_le: string
  lue: boolean
}

export interface Notifications {
  notifications: Notification[]
  non_lues: number
}

/** Cloche de l'en-tête : relue toutes les 60 s. */
export const useNotifications = () =>
  useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<Notifications>('/notifications'),
    refetchInterval: 60_000,
    retry: queryRetry,
  })

export function useMarquerLue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api<{ status: string }>(`/notifications/${id}/lue`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

export function useToutLu() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<{ status: string }>('/notifications/tout-lu', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

export const usePreferencesMail = (actif: boolean) =>
  useQuery({
    queryKey: ['notifications-preferences'],
    queryFn: () => api<{ notif_mail: boolean }>('/notifications/preferences'),
    enabled: actif,
    retry: queryRetry,
  })

export function useChangerPreferenceMail() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (notif_mail: boolean) =>
      api<{ notif_mail: boolean }>('/notifications/preferences', { method: 'PUT', body: JSON.stringify({ notif_mail }) }),
    onSuccess: (r) => qc.setQueryData(['notifications-preferences'], r),
  })
}

export const desabonner = (jeton: string) =>
  api<{ status: string }>('/notifications/desabonner', { method: 'POST', body: JSON.stringify({ jeton }) })
