import { type Calendrier, DEBUT_FISCAL, exerciceDe, ordreMois } from './exercice'
import { MOIS_COURTS } from './format'

/**
 * Période choisie dans le calendrier des pages annuelles (R6) : un mois, une plage de mois (même à
 * cheval sur deux années) ou une année. Les mois sont des indices : année * 12 + (mois - 1).
 */
export type TypeSel = 'mois' | 'plage' | 'annee'
export interface Sel { type: TypeSel; d: number; f: number }

/** Période et comparaison affichées, avec les mois disponibles (indices) : bornes du calendrier. */
export interface PeriodeChoisie { sel: Sel; cmp: Sel; min: number; max: number }

/** Plus longue période acceptée par le serveur (docs/etude-periode-libre.md). */
export const MAX_MOIS = 60

export const indice = (annee: number, mois: number) => annee * 12 + mois - 1
export const anneeDe = (i: number) => Math.floor(i / 12)
/** Numéro du mois (1 à 12). */
export const moisDe = (i: number) => (i % 12) + 1

/** Mois du calendrier, en abréviations de la grille. */
export const MOIS_GRILLE = MOIS_COURTS

const nomMois = (i: number) => MOIS_COURTS[moisDe(i) - 1].toLowerCase()
const cap = (t: string) => t[0].toUpperCase() + t.slice(1)
const nom = (i: number) => `${cap(nomMois(i))} ${anneeDe(i)}`

export const mois = (i: number): Sel => ({ type: 'mois', d: i, f: i })

/** Plage entre deux mois (dans n'importe quel ordre). Janvier → décembre d'une même année, ou
 *  janvier → dernier mois disponible `max` de cette année, vaut « année ». */
export function plage(a: number, b: number, max?: number): Sel {
  const d = Math.min(a, b)
  const f = Math.max(a, b)
  const annee = moisDe(d) === 1 && anneeDe(d) === anneeDe(f) && (moisDe(f) === 12 || f === max)
  return { type: annee ? 'annee' : 'plage', d, f }
}

/** L'année `Y` entière, bornée aux mois disponibles. */
export const anneeEntiere = (Y: number, min: number, max: number) =>
  plage(Math.max(Y * 12, min), Math.min(Y * 12 + 11, max), max)

/** Nombre de mois de la période. */
export const longueur = (s: Sel) => s.f - s.d + 1

/** Libellé abrégé : « Oct. 2026 », « Janv. → déc. 2025 », « Avr. 2025 → mars 2026 ». */
export function libelle(s: Sel) {
  if (s.d === s.f) return nom(s.d)
  if (anneeDe(s.d) === anneeDe(s.f)) return `${cap(nomMois(s.d))} → ${nomMois(s.f)} ${anneeDe(s.f)}`
  return `${nom(s.d)} → ${nomMois(s.f)} ${anneeDe(s.f)}`
}

/** Comparaison par défaut : le mois d'avant, ou les mêmes mois décalés du nombre d'années entières
 *  qui couvre la période (l'année d'avant jusqu'à 12 mois ; sans chevauchement au-delà, comme le serveur). */
export function defautCmp(s: Sel): Sel {
  if (s.type === 'mois') return mois(s.d - 1)
  const decalage = 12 * Math.ceil(longueur(s) / 12)
  return { type: s.type, d: s.d - decalage, f: s.f - decalage }
}

/** Clic sur un mois : le sélectionne, forme une plage avec le mois déjà choisi (MAX_MOIS au plus, sinon
 *  la sélection recommence au mois cliqué), ou le désélectionne (null). */
export function cliqueMois(b: Sel | null, i: number, max?: number): Sel | null {
  if (!b || b.type === 'annee') return mois(i)
  if (b.type === 'mois') {
    if (b.d === i) return null
    return Math.abs(i - b.d) + 1 > MAX_MOIS ? mois(i) : plage(b.d, i, max)
  }
  if (i === b.d) return mois(b.f)
  if (i === b.f) return mois(b.d)
  return mois(i)
}

/** Texte d'URL : « 2026-10 » pour un mois, « 2025-04..2026-03 » sinon. */
export const texteMois = (i: number) => `${anneeDe(i)}-${String(moisDe(i)).padStart(2, '0')}`
export const versTexte = (s: Sel) => (s.d === s.f ? texteMois(s.d) : `${texteMois(s.d)}..${texteMois(s.f)}`)

/** Indice d'un mois « AAAA-MM », ou null. */
export function lireMois(t: string | undefined): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(t ?? '')
  const n = m ? Number(m[2]) : 0
  return m && n >= 1 && n <= 12 ? indice(Number(m[1]), n) : null
}

/** Relit un texte d'URL ; null s'il est absent, illisible, à l'envers ou de plus de MAX_MOIS mois. */
export function lireTexte(t: string | undefined, max?: number): Sel | null {
  const [a, b = a, reste] = (t ?? '').split('..')
  if (!t || reste !== undefined) return null
  const d = lireMois(a)
  const f = lireMois(b)
  if (d === null || f === null || f < d || f - d + 1 > MAX_MOIS) return null
  return d === f ? mois(d) : plage(d, f, max)
}

/** Libellé abrégé d'une période servie par le serveur (début et fin « AAAA-MM »), vide si illisible. */
export function libelleTexte(du?: string | null, au?: string | null) {
  const s = du && au ? lireTexte(`${du}..${au}`) : null
  return s ? libelle(s) : ''
}

/** Exercice de base de la période (comme le serveur) : janvier si elle tient dans une année civile,
 *  sinon 12 mois à partir de son premier mois. */
export function exerciceBase(s: Sel) {
  return { annee: anneeDe(s.d), depart: anneeDe(s.d) === anneeDe(s.f) ? 1 : moisDe(s.d) }
}

/** « 2026 » pour un exercice qui commence en janvier, « 2025-26 » sinon ; `decalage` en années. */
export function libelleExercicePeriode(s: Sel, decalage = 0) {
  const { annee, depart } = exerciceBase(s)
  const a = annee + decalage
  return depart === 1 ? `${a}` : `${a}-${String((a + 1) % 100).padStart(2, '0')}`
}

/** Calendrier des listes liées à la période : fiscal pour un exercice qui commence en avril. */
export const calendrierDe = (s: Sel): Calendrier =>
  moisDe(s.d) === DEBUT_FISCAL && anneeDe(s.d) !== anneeDe(s.f) ? 'fiscal' : 'civil'

/** Anciennes clés d'URL des pages annuelles, relues une fois pour fabriquer la période. */
export interface AnciensFiltres {
  annee?: string
  mois?: string
  exercice?: string
  calendrier?: string
  vue?: string
  debut?: string
  fin?: string
  cmp_periode?: string
}

/** Période équivalente aux anciens filtres (cumul de l'exercice par défaut, mois, trimestre, année, plage). */
export function migrer(p: AnciensFiltres, derniere: { annee: number; mois: number }, max: number): Sel | null {
  if (!(p.annee || p.exercice || p.vue || p.debut || p.fin)) return null
  const cal: Calendrier = p.calendrier === 'fiscal' ? 'fiscal' : 'civil'
  const exDerniere = exerciceDe(derniere.annee, derniere.mois, cal)
  const ex = Number(cal === 'fiscal' ? p.exercice : p.annee) || exDerniere
  const ordre = ordreMois(cal)
  const depart = indice(ex, ordre[0])
  const rangDe = (v: string | undefined) => {
    const m = Number(v)
    return Number.isInteger(m) && m >= 1 && m <= 12 ? ordre.indexOf(m) + 1 : undefined
  }
  const rangDerniere = ex === exDerniere ? ordre.indexOf(derniere.mois) + 1 : 12
  const fin = Math.min(Math.max(rangDe(p.fin) ?? rangDerniere, 1), 12)
  let debut = 1
  let dernier = fin
  switch (p.vue) {
    case 'mois':
      debut = fin
      break
    case 'trimestre':
      debut = 3 * Math.ceil(fin / 3) - 2
      dernier = debut + 2
      break
    case 'annee':
      dernier = 12
      break
    case 'plage':
      debut = Math.min(Math.max(rangDe(p.debut) ?? 1, 1), fin)
      break
  }
  return debut === dernier ? mois(depart + debut - 1) : plage(depart + debut - 1, depart + dernier - 1, max)
}

/** Comparaison équivalente à l'ancienne clé `cmp_periode` de la page Mensuel : le mois comparé, « AAAA-M »
 *  ou « AAAA-MM ». Null si elle est illisible ou si la période `sel` n'est pas un mois. */
export function migrerComparaison(p: AnciensFiltres, sel: Sel): Sel | null {
  const m = /^(\d{4})-(\d{1,2})$/.exec(p.cmp_periode ?? '')
  const n = Number(m?.[2])
  return m && sel.d === sel.f && n >= 1 && n <= 12 ? mois(indice(Number(m[1]), n)) : null
}
