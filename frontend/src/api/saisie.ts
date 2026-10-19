import { useQuery } from '@tanstack/react-query'
import { api, BASE, queryRetry, telecharger } from './client'
import { qs } from './rapports'

export const ATTRIBUTS = ['poste', 'type_contrat', 'activite', 'site', 'service'] as const
export type Attribut = (typeof ATTRIBUTS)[number]

export interface SalariePrepa {
  matricule: string
  nom: string
  /** Une ligne existe déjà pour ce mois : ses montants sont repris dans la grille. */
  saisi: boolean
  present_precedent: boolean
  attributs: Record<Attribut, string | null>
  montants: Record<string, string>
}

export interface Preparation {
  annee: number
  mois: number
  rubriques: { libelle: string; unite: string }[]
  exclues: string[]
  referentiels: Record<Attribut, string[]>
  salaries: SalariePrepa[]
}

export interface LigneSaisie {
  matricule: string
  nom: string | null
  poste: string | null
  type_contrat: string | null
  activite: string | null
  site: string | null
  service: string | null
  montants: Record<string, string | null>
}

export interface AnomalieSaisie {
  /** Index de la ligne envoyée (0 = première). */
  ligne: number
  colonne: string | null
  code: string
  gravite: 'bloquant' | 'avertissement'
  message: string
}

export interface Verification {
  anomalies: AnomalieSaisie[]
  totaux: ({ total: string; exclusions: string } | null)[]
}

export interface Lot {
  id: number
  fichier_nom: string
  statut: 'pret' | 'rejete' | 'valide' | 'annule'
  nb_lignes: number
  nb_bloquants: number
  nb_avert: number
  stats: Record<string, unknown> | null
}

export interface Changement {
  colonne: string
  avant: string | null
  apres: string | null
}

export interface LigneApercu {
  annee: number
  mois: number
  matricule: string
  nom: string | null
  nouveau_salarie: boolean
  statut: 'nouvelle' | 'modifiee' | 'identique'
  total_avant: string | null
  total_apres: string
  changements: Changement[]
}

export interface Apercu {
  lot: Lot
  nouvelle: number
  modifiee: number
  identique: number
  effaces: number
  nouveaux_salaries: string[]
  employes: { total: number; nouveaux: number; existants: number }
  total_lot: string
  /** Présents le mois précédent, absents du lot (100 premiers). */
  absents: { annee: number; mois: number; matricule: string; nom: string }[]
  nb_absents: number
  lignes: LigneApercu[]
}

export interface AnomalieLot {
  ligne: number | null
  colonne: string | null
  code: string
  gravite: 'bloquant' | 'avertissement'
  valeur: string | null
  message: string
  /** Employé de la ligne : nom du fichier, sinon celui déjà enregistré ; absents pour une ligne d'en-tête. */
  matricule?: string | null
  nom?: string | null
}

/** Ligne du fichier telle que lue : une valeur refusée est absente. */
export interface LigneLot {
  ligne: number
  annee: number | null
  mois: number | null
  matricule: string | null
  nom: string | null
  poste: string | null
  type_contrat: string | null
  activite: string | null
  site: string | null
  service: string | null
  montants: Record<string, string>
  /** Valeurs telles qu'écrites dans le fichier, par colonne : absent pour un lot analysé avant les corrections sur place. */
  brut: Record<string, string | null> | null
  /** Valeurs proposées par colonne (on peut en taper une autre). */
  choix: Record<string, string[]> | null
}

export type Cle = { annee: number; mois: number; matricule: string }

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

export const useDernierePeriode = () =>
  useQuery({
    queryKey: ['saisie', 'derniere-periode'],
    queryFn: () => api<{ annee: number; mois: number; lignes: number } | null>('/donnees/derniere-periode'),
    retry: queryRetry,
  })

export const usePreparation = (annee: number, mois: number, actif: boolean) =>
  useQuery({
    queryKey: ['saisie', 'preparation', annee, mois],
    queryFn: () => api<Preparation>(`/donnees/preparation${qs({ annee, mois })}`),
    enabled: actif,
    retry: queryRetry,
  })

export const verifier = (annee: number, mois: number, lignes: LigneSaisie[], signal?: AbortSignal) =>
  api<Verification>('/donnees/verifier', { ...json({ annee, mois, lignes }), signal })

export const creerLotSaisie = (brouillon_id: string, annee: number, mois: number, lignes: LigneSaisie[]) =>
  api<Lot>('/donnees/lots', json({ brouillon_id, annee, mois, lignes }))

export function envoyerFichier(f: File) {
  const fd = new FormData()
  fd.append('fichier', f)
  return api<Lot>('/imports', { method: 'POST', body: fd })
}

export const lireApercu = (id: number) => api<Apercu>(`/imports/${id}/apercu`)
export const lireAnomalies = (id: number, gravite?: string) =>
  api<AnomalieLot[]>(`/imports/${id}/anomalies${qs({ gravite, limit: 1000 })}`)
export const lireLigne = (id: number, num: number) => api<LigneLot>(`/imports/${id}/lignes/${num}`)
export const corrigerLigne = (id: number, num: number, valeurs: Record<string, string | null>) =>
  api<Lot>(`/imports/${id}/lignes/${num}`, { method: 'PUT', body: JSON.stringify({ valeurs }) })
export const validerLot = (id: number, garder: Cle[]) => api<Lot>(`/imports/${id}/valider`, json({ garder }))
export const annulerLot = (id: number) => api<Lot>(`/imports/${id}/annuler`, { method: 'POST' })

export const urlRapport = (id: number) => `${BASE}/imports/${id}/rapport.xlsx`

/** Modèle xlsx vide d'un mois ; sans année ni mois : modèle de plusieurs mois (mois indiqué sur chaque ligne). */
export const urlModele = (annee?: number, mois?: number) => `${BASE}/donnees/modele.xlsx${qs({ annee, mois })}`

/** Modèle xlsx du mois avec exactement ces lignes, valeurs comprises ; aucune ligne : modèle vide. */
export const telechargerModele = (annee: number, mois: number, lignes: LigneSaisie[]) =>
  telecharger('/donnees/modele.xlsx', json({ annee, mois, lignes }), `donnees_${annee}_${String(mois).padStart(2, '0')}.xlsx`)
