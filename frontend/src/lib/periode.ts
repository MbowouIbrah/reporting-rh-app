import { type Calendrier, DEBUT_FISCAL, libelleExercice, ordreMois } from './exercice'
import { MOIS, MOIS_COURTS } from './format'

/** Raccourcis du menu « Période » des pages annuelles (R6, variante A). Une période reste dans un exercice. */
export type Vue = 'mois' | 'trimestre' | 'cumul' | 'annee' | 'plage'
export const VUES: { vue: Vue; libelle: string }[] = [
  { vue: 'mois', libelle: 'Mois' },
  { vue: 'trimestre', libelle: 'Trimestre' },
  { vue: 'cumul', libelle: "Cumul de l'exercice" },
  { vue: 'annee', libelle: 'Année' },
  { vue: 'plage', libelle: 'De… à…' },
]
export const lireVue = (v: string | undefined): Vue => VUES.find((x) => x.vue === v)?.vue ?? 'cumul'

/** Comparaison : vide = même période d'un autre exercice (N-1 par défaut), période précédente, aucune. */
export type Cmp = '' | 'prec' | 'aucune'
export const lireCmp = (v: string | undefined): Cmp => (v === 'prec' || v === 'aucune' ? v : '')

/** Rang (1 à 12) d'un vrai mois dans l'exercice, et l'inverse. */
export const rang = (mois: number, cal: Calendrier) => ordreMois(cal).indexOf(mois) + 1
export const moisDeRang = (r: number, cal: Calendrier) => ordreMois(cal)[r - 1]
/** Vraie année d'un mois de l'exercice `annee` (en fiscal, janvier à mars tombent l'année d'après). */
export const anneeReelle = (annee: number, mois: number, cal: Calendrier) =>
  cal === 'fiscal' && mois < DEBUT_FISCAL ? annee + 1 : annee

/** Bornes d'une période, en rangs de l'exercice. */
export interface Bornes { debut: number; fin: number }

/** Bornes du raccourci choisi. `derniere` : rang du dernier mois saisi (12 pour un exercice fini) ;
 *  `fin`, `debut` : rangs choisis dans le menu (absents : valeurs par défaut). */
export function bornes(vue: Vue, derniere: number, fin?: number, debut?: number): Bornes {
  const f = Math.min(Math.max(fin ?? derniere, 1), 12)
  switch (vue) {
    case 'mois':
      return { debut: f, fin: f }
    case 'trimestre': {
      const q = Math.ceil(f / 3)
      return { debut: 3 * q - 2, fin: 3 * q }
    }
    case 'annee':
      return { debut: 1, fin: 12 }
    case 'plage':
      return { debut: Math.min(Math.max(debut ?? 1, 1), f), fin: f }
    default:
      return { debut: 1, fin: f }
  }
}

const court = (m: number) => MOIS_COURTS[m - 1]

/** « Mars 2026 », « Avr → juin 2026 », « Nov 2026 → fév 2027 », « Exercice 2026-27 ». */
export function libelleBornes(annee: number, b: Bornes, cal: Calendrier) {
  const md = moisDeRang(b.debut, cal)
  const mf = moisDeRang(b.fin, cal)
  const ad = anneeReelle(annee, md, cal)
  const af = anneeReelle(annee, mf, cal)
  if (b.debut === b.fin) return `${MOIS[mf - 1]} ${af}`
  if (b.debut === 1 && b.fin === 12) return cal === 'fiscal' ? `Exercice ${libelleExercice(annee, cal)}` : `Année ${annee}`
  const fin = `${court(mf).toLowerCase()} ${af}`
  return ad === af ? `${court(md)} → ${fin}` : `${court(md)} ${ad} → ${fin}`
}

/** En-tête court d'une colonne : l'exercice pour un cumul ou une année (comme avant), la période sinon. */
export const libelleColonne = (annee: number, vue: Vue, b: Bornes, cal: Calendrier) =>
  vue === 'cumul' || vue === 'annee' ? libelleExercice(annee, cal) : libelleBornes(annee, b, cal)

/** Vrais mois (année, mois) de la période précédente : les mêmes nombre de mois juste avant le début. */
export function periodePrecedente(annee: number, b: Bornes, cal: Calendrier) {
  const md = moisDeRang(b.debut, cal)
  const k = anneeReelle(annee, md, cal) * 12 + md - 1 - (b.fin - b.debut + 1)
  const n = b.fin - b.debut
  const mois = (i: number) => ({ annee: Math.floor((k + i) / 12), mois: ((k + i) % 12) + 1 })
  return { debut: mois(0), fin: mois(n) }
}

/** Libellé de la période comparée (colonnes, évolutions). */
export function libelleComparee(annee: number, vue: Vue, b: Bornes, cal: Calendrier, cmp: Cmp, refAnnee?: number) {
  if (cmp === 'aucune') return 'Sans comparaison'
  if (cmp === 'prec') {
    const { debut: d, fin: f } = periodePrecedente(annee, b, cal)
    if (d.annee === f.annee && d.mois === f.mois) return `${MOIS[f.mois - 1]} ${f.annee}`
    const fin = `${court(f.mois).toLowerCase()} ${f.annee}`
    return d.annee === f.annee ? `${court(d.mois)} → ${fin}` : `${court(d.mois)} ${d.annee} → ${fin}`
  }
  return libelleColonne(refAnnee ?? annee - 1, vue, b, cal)
}
