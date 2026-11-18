import type { Calendrier } from '../lib/exercice'
import { api, telecharger } from './client'
import type { Annuel, Filtres, Individuel, IndividuelTous, Me, Mensuel, Periode, Salarie } from './types'

export interface FiltresPage {
  annee: number
  mois: number
  /** Département : le rapport ne garde que ses services. */
  departement?: string
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
  /** Pages annuelles (R6) : période « AAAA-MM » du premier au dernier mois, et période comparée. */
  du?: string
  au?: string
  cmp_du?: string
  cmp_au?: string
  /** Pages annuelles : `fiscal` quand la période est un exercice d'avril à mars ; absent = civil. */
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
export const connexionParLien = (jeton: string) =>
  api<Me>('/auth/lien', { method: 'POST', body: JSON.stringify({ jeton }) })
export const motDePasseOublie = (email: string) =>
  api<{ status: string }>('/auth/mot-de-passe-oublie', { method: 'POST', body: JSON.stringify({ email }) })
export const reinitialiser = (jeton: string, password: string) =>
  api<{ status: string }>('/auth/reinitialiser', { method: 'POST', body: JSON.stringify({ jeton, password }) })
export const changerMotDePasse = (actuel: string, nouveau: string) =>
  api<Me>('/auth/changer-mot-de-passe', { method: 'POST', body: JSON.stringify({ actuel, nouveau }) })
export const logout = () => api<void>('/auth/logout', { method: 'POST' })
export const getPeriodes = () => api<Periode[]>('/rapports/periodes')
export const getFiltres = (annee: number, calendrier?: Calendrier, mois?: number) =>
  api<Filtres>(`/rapports/filtres${qs({ annee, calendrier, mois })}`)
export const getSalaries = (annee: number, calendrier?: Calendrier) =>
  api<Salarie[]>(`/rapports/salaries${qs({ annee, calendrier })}`)
export const getMensuel = (f: FiltresPage) => api<Mensuel>(`/rapports/mensuel${qs({ ...f })}`)
/** Avec une période (`du`, `au`), le serveur n'a besoin ni de l'année, ni du mois, ni du calendrier. */
const paramsAnnuel = (f: FiltresPage) => {
  if (!f.du) return f
  const { annee: _annee, mois: _mois, calendrier: _calendrier, ref_annee: _ra, ref_mois: _rm, ...reste } = f
  return reste
}
export const getAnnuel = (f: FiltresPage) => api<Annuel>(`/rapports/annuel${qs(paramsAnnuel(f))}`)
/** Graphes d'évolution en classeur Excel : vrais graphiques liés à leurs données (retours N2, point 2). */
export const exporterGraphes = (f: FiltresPage, ids: string[]) =>
  telecharger(
    `/rapports/annuel/export${qs({ ...paramsAnnuel(f), graphiques: 'true', graphes: ids.join(',') })}`,
    {},
    f.du && f.au ? `graphes-${f.du}_${f.au}.xlsx` : `graphes-${f.annee}.xlsx`,
  )
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

