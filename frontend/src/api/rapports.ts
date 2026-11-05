import type { Calendrier } from '../lib/exercice'
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
  type_contrat?: string
  /** Employé (réservé à nominatif:read). */
  matricule?: string
  /** Période de comparaison choisie ; absente : N-1 (annuel) ou M-1 (mensuel). */
  ref_annee?: number
  ref_mois?: number
  /** Pages annuelles en année fiscale : `annee` = début de l'exercice ; absent = civil. */
  calendrier?: Calendrier
}

export const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v))
  return `?${p}`
}

export const getMe = () => api<Me>('/auth/me')
export const login = (email: string, password: string, remember = false) =>
  api<Me>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, remember }) })
export const motDePasseOublie = (email: string) =>
  api<{ status: string }>('/auth/mot-de-passe-oublie', { method: 'POST', body: JSON.stringify({ email }) })
export const reinitialiser = (jeton: string, password: string) =>
  api<{ status: string }>('/auth/reinitialiser', { method: 'POST', body: JSON.stringify({ jeton, password }) })
export const changerMotDePasse = (actuel: string, nouveau: string) =>
  api<Me>('/auth/changer-mot-de-passe', { method: 'POST', body: JSON.stringify({ actuel, nouveau }) })
export const logout = () => api<void>('/auth/logout', { method: 'POST' })
export const getPeriodes = () => api<Periode[]>('/rapports/periodes')
export const getFiltres = (annee: number, calendrier?: Calendrier) =>
  api<Filtres>(`/rapports/filtres${qs({ annee, calendrier })}`)
export const getSalaries = (annee: number, calendrier?: Calendrier) =>
  api<Salarie[]>(`/rapports/salaries${qs({ annee, calendrier })}`)
export const getMensuel = (f: FiltresPage) => api<Mensuel>(`/rapports/mensuel${qs({ ...f })}`)
export const getAnnuel = (f: FiltresPage) => api<Annuel>(`/rapports/annuel${qs({ ...f })}`)
export const getIndividuel = (annee: number, matricule: string, calendrier?: Calendrier) =>
  api<Individuel>(`/rapports/individuel${qs({ annee, matricule, calendrier })}`)

export const getIndividuelTous = (p: {
  annee: number
  matricule?: string
  service?: string
  site?: string
  type_site?: string
  poste?: string
  calendrier?: Calendrier
}) =>
  api<IndividuelTous>(`/rapports/individuel/tous${qs(p)}`)

