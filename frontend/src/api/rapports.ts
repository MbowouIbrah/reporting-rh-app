import { api } from './client'
import type { Annuel, Filtres, Individuel, IndividuelTous, Me, Mensuel, Periode, Salarie } from './types'

export interface FiltresPage {
  annee: number
  mois: number
  service?: string
  site?: string
}

const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v))
  return `?${p}`
}

export const getMe = () => api<Me>('/auth/me')
export const login = (email: string, password: string) =>
  api<Me>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
export const logout = () => api<void>('/auth/logout', { method: 'POST' })
export const getPeriodes = () => api<Periode[]>('/rapports/periodes')
export const getFiltres = (annee: number) => api<Filtres>(`/rapports/filtres${qs({ annee })}`)
export const getSalaries = (annee: number) => api<Salarie[]>(`/rapports/salaries${qs({ annee })}`)
export const getMensuel = (f: FiltresPage) => api<Mensuel>(`/rapports/mensuel${qs({ ...f })}`)
export const getAnnuel = (f: FiltresPage) => api<Annuel>(`/rapports/annuel${qs({ ...f })}`)
export const getIndividuel = (annee: number, matricule: string) =>
  api<Individuel>(`/rapports/individuel${qs({ annee, matricule })}`)

export const getIndividuelTous = (p: { annee: number; matricule?: string; service?: string; site?: string }) =>
  api<IndividuelTous>(`/rapports/individuel/tous${qs(p)}`)

/** Lien de téléchargement xlsx : mêmes filtres que l'écran, authentifié par le cookie. */
export const urlExport = (rapport: 'mensuel' | 'annuel', f: FiltresPage) =>
  `${import.meta.env.BASE_URL}api/v1/rapports/${rapport}/export${qs({ ...f })}`
