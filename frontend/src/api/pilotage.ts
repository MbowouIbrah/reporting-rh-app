import { keepPreviousData, useQuery, type QueryClient } from '@tanstack/react-query'
import { api, queryRetry } from './client'
import { qs } from './rapports'
import type { Calendrier } from '../lib/exercice'
import type { Dec, Val } from './types'

export const AXES = ['rubrique', 'service', 'site'] as const
export type Axe = (typeof AXES)[number]
export const TITRES: Record<Axe, string> = { rubrique: 'Types de charge', service: 'Services', site: 'Sites' }

export interface CibleBudget {
  cible_id: number
  libelle: string
  actif: boolean
  /** Rubrique exclue du TOTAL CHARGES à la date du mois : hors total. */
  exclue: boolean
  valeur: Dec | null
}

export interface Pilotage {
  annee: number
  mois: number
  /** null : le mois n'est pas encore ouvert (rien n'a été saisi). */
  periode_id: number | null
  ca: Dec | null
  marge: Dec | null
  taux_marge: Val
  budgets: Record<Axe, CibleBudget[]>
  totaux: Record<Axe, Dec | null>
  /** Budgets du dernier mois qui en a, proposés quand ce mois n'en a aucun. */
  reprise: { annee: number; mois: number; valeurs: Record<Axe, Record<string, Dec>> } | null
}

export interface LigneBudget {
  axe: Axe
  cible_id: number
  valeur: string | null
}

const put = (body: unknown): RequestInit => ({ method: 'PUT', body: JSON.stringify(body) })

export const usePilotage = (annee: number, mois: number, actif: boolean) =>
  useQuery({
    queryKey: ['pilotage', annee, mois],
    queryFn: () => api<Pilotage>(`/pilotage${qs({ annee, mois })}`),
    enabled: actif,
    retry: queryRetry,
  })

export type Groupe = 'ca_marge' | 'activite' | 'obj_ca_marge' | 'obj_activite'
/** Groupes d'objectifs : jamais calculés depuis les employés. */
export const estObjectif = (g: Groupe) => g === 'obj_ca_marge' || g === 'obj_activite'
export type Niveau = 'global' | 'site' | 'service' | 'cellule'

export interface ValeurSaisie {
  /** Chiffre tapé dans cette case, null si la case est vide. */
  saisi: Dec | null
  /** Somme des chiffres des employés rattachés à la case. */
  employes: Dec | null
  /** Valeur retenue : le chiffre saisi s'il existe, sinon la somme des employés. */
  valeur: Dec | null
  origine: 'saisi' | 'calcule' | null
  /** « Non réparti » : part du chiffre saisi que les cases du dessous n'expliquent pas. */
  ecart: Dec | null
  /** Somme des valeurs de l'ancien niveau, quand on affiche un niveau plus fin que celui en base. */
  propose: Dec | null
}

export interface CaseSaisie {
  site_id: number | null
  service_id: number | null
  valeurs: Record<string, ValeurSaisie>
  /** Groupe CA et marge seulement : taux de la case, calculé par le serveur. */
  taux_marge?: Val
}

export interface TotalSaisie {
  valeur: Dec | null
  partiel: boolean
  renseignes: number
  attendus: number
}

export interface VueSaisies {
  annee: number
  mois: number
  groupe: Groupe
  periode_id: number | null
  indicateurs: string[]
  /** Niveau affiché (celui demandé, sinon celui en base, sinon celui du dernier mois saisi). */
  niveau: Niveau
  /** Niveau en base pour ce mois, null si rien n'est enregistré. */
  niveau_enregistre: Niveau | null
  /** Vrai si le niveau n'a jamais été choisi pour ce mois : il vient de la règle par défaut. */
  niveau_par_defaut: boolean
  sites: { id: number; libelle: string }[]
  services: { id: number; libelle: string; productif: boolean }[]
  cases: CaseSaisie[]
  totaux: Record<string, TotalSaisie>
  /** Totaux de l'ancien niveau que la grille affichée ne permet pas de ranger dans une case. */
  a_repartir: Record<string, Dec>
  /** Groupe CA et marge seulement. */
  taux_marge?: Val
}

export interface CaseEnvoyee {
  site_id: number | null
  service_id: number | null
  valeurs: Record<string, string | null>
}

/** `niveau` facultatif : sans lui, le serveur choisit (celui en base, sinon celui du dernier mois saisi). */
export const useSaisies = (groupe: Groupe, annee: number, mois: number, actif: boolean, niveau?: Niveau) =>
  useQuery({
    queryKey: ['saisies', groupe, annee, mois, niveau ?? null],
    queryFn: () => api<VueSaisies>(`/pilotage/saisies${qs({ groupe, annee, mois, niveau })}`),
    enabled: actif,
    retry: queryRetry,
    // Changer de niveau garde la grille à l'écran le temps de la requête.
    placeholderData: keepPreviousData,
  })

export const enregistrerSaisies = (groupe: Groupe, annee: number, mois: number, niveau: Niveau, cases: CaseEnvoyee[]) =>
  api<VueSaisies>('/pilotage/saisies', put({ annee, mois, groupe, niveau, cases }))

export interface TotalAnnuel {
  site_id: number | null
  service_id: number | null
  indicateur: string
  total: string
}

export interface ReponseAnnee {
  annee: number
  groupe: Groupe
  niveau: Niveau
  calendrier: Calendrier
  mois: { annee: number; mois: number; cases: CaseEnvoyee[] }[]
  /** Mois (numéros, uniques dans l'exercice) dont un objectif déjà saisi a été remplacé. */
  ecrases: number[]
}

/** Objectifs annuels répartis par le serveur sur les 12 mois de l'année civile ou de l'exercice fiscal
 *  (avril `annee` → mars `annee + 1`) ; le reste de la division va sur le dernier mois. */
export const repartirAnnee = (groupe: Groupe, annee: number, niveau: Niveau, cases: TotalAnnuel[], calendrier: Calendrier = 'civil') =>
  api<ReponseAnnee>('/pilotage/saisies/annee', put({ annee, groupe, niveau, cases, calendrier }))

/** Après une répartition annuelle : tous les mois du groupe et les rapports sont rechargés. */
export function apresAnnee(qc: QueryClient, groupe: Groupe, annee: number, calendrier: Calendrier = 'civil') {
  qc.invalidateQueries({ queryKey: ['saisies', groupe, annee] })
  if (calendrier === 'fiscal') qc.invalidateQueries({ queryKey: ['saisies', groupe, annee + 1] })
  qc.invalidateQueries({ queryKey: ['saisie', 'derniere-periode'] })
  qc.invalidateQueries({ queryKey: ['pilotage'] })
  rechargerRapports(qc)
}

export const enregistrerBudgets = (annee: number, mois: number, lignes: LigneBudget[]) =>
  api<Pilotage>('/pilotage/budgets', put({ annee, mois, lignes }))

/** Après une écriture : la vue du mois est remplacée, les rapports qui en dépendent sont rechargés. */
export function apresEcriture(qc: QueryClient, vue: Pilotage) {
  qc.setQueryData(['pilotage', vue.annee, vue.mois], vue)
  rechargerRapports(qc)
}

/** Après une écriture de saisies : la vue du groupe est remplacée, la vue du mois et les rapports sont rechargés. */
export function apresSaisies(qc: QueryClient, vue: VueSaisies) {
  // Le niveau enregistré devient le niveau affiché : les autres niveaux déjà chargés ne valent plus.
  qc.setQueryData(['saisies', vue.groupe, vue.annee, vue.mois, null], vue)
  qc.setQueryData(['saisies', vue.groupe, vue.annee, vue.mois, vue.niveau], vue)
  qc.invalidateQueries({
    queryKey: ['saisies', vue.groupe, vue.annee, vue.mois],
    predicate: (q) => q.queryKey[4] !== null && q.queryKey[4] !== vue.niveau,
  })
  qc.invalidateQueries({ queryKey: ['saisie', 'derniere-periode'] })
  qc.invalidateQueries({ queryKey: ['pilotage'] })
  rechargerRapports(qc)
}

function rechargerRapports(qc: QueryClient) {
  for (const k of ['annuel', 'mensuel', 'periodes', 'filtres', 'individuel', 'individuel-tous']) qc.invalidateQueries({ queryKey: [k] })
}
