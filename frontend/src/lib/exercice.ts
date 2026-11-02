import { MOIS } from './format'

/** Année civile (janvier → décembre) ou fiscale (avril → mars) : docs/etude-annee-fiscale.md. */
export type Calendrier = 'civil' | 'fiscal'
export const DEBUT_FISCAL = 4

/** Exercice (année de début) qui contient le mois donné. */
export const exerciceDe = (annee: number, mois: number, cal: Calendrier) =>
  cal === 'fiscal' && mois < DEBUT_FISCAL ? annee - 1 : annee

/** Numéros des 12 mois dans l'ordre de l'exercice (1 à 12, ou 4 à 12 puis 1 à 3). */
export const ordreMois = (cal: Calendrier = 'civil') =>
  Array.from({ length: 12 }, (_, i) => ((i + (cal === 'fiscal' ? DEBUT_FISCAL - 1 : 0)) % 12) + 1)

/** « 2026 » en civil, « 2026-27 » en fiscal. */
export const libelleExercice = (annee: number, cal: Calendrier = 'civil') =>
  cal === 'fiscal' ? `${annee}-${String((annee + 1) % 100).padStart(2, '0')}` : `${annee}`

/** « Cumul de janvier à mars 2026 » ou « Cumul d'avril 2026 à février 2027 ». */
export function libelleCumul(annee: number, moisFin: number, cal: Calendrier = 'civil') {
  const nom = (m: number) => MOIS[m - 1].toLowerCase()
  const fin = `${nom(moisFin)} ${cal === 'fiscal' && moisFin < DEBUT_FISCAL ? annee + 1 : annee}`
  return cal === 'fiscal' ? `Cumul d'${nom(DEBUT_FISCAL)} ${annee} à ${fin}` : `Cumul de janvier à ${fin}`
}
