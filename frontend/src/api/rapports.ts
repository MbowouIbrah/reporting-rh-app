import { api } from './client'
import type { Annuel, Filtres, Individuel, IndividuelTous, Me, Mensuel, Periode, Salarie } from './types'

export interface FiltresPage {
  annee: number
  mois: number
  service?: string
  site?: string
  type_site?: string
  poste?: string
  activite?: string
  /** Employé (réservé à nominatif:read). */
  matricule?: string
  /** Période de comparaison choisie ; absente : N-1 (annuel) ou M-1 (mensuel). */
  ref_annee?: number
  ref_mois?: number
}

export const qs = (o: Record<string, string | number | undefined>) => {
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

export const getIndividuelTous = (p: {
  annee: number
  matricule?: string
  service?: string
  site?: string
  type_site?: string
  poste?: string
}) =>
  api<IndividuelTous>(`/rapports/individuel/tous${qs(p)}`)

