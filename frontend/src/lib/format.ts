import type { Val } from '../api/types'

const NF = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
const NF1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })
const NF2 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 })

/** Séparateur de milliers : espace insécable pleine largeur (l'espace fine de fr-FR colle les groupes à l'écran). */
export const SEP = '\u00a0'
const espacer = (s: string) => s.replace(/[\u202f\u00a0]/g, SEP)

export const MOIS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

/** Employé sans matricule : le serveur lui attribue un identifiant technique (SM-…), jamais montré. */
export const matriculeAffiche = (m: string | null | undefined) => (m && !m.startsWith('SM-') ? m : '')

export const MOIS_COURTS = ['Jan', 'Fév', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc']

/** Montant en FCFA. null (absent) et 'n/a' (non calculable) -> « — ». Number() sert à l'affichage seulement. */
export function fcfa(v: Val | number | undefined): string {
  if (v === null || v === undefined) return '—'
  if (v === 'n/a') return '—'
  return espacer(NF.format(Number(v)))
}

/** Montant écrit au chiffre près, là où un écart de quelques francs compte : le texte du serveur
 *  est découpé, sans Number() ni arrondi ; seuls les zéros de fin sont retirés. */
export function montantExact(v: Val | undefined): string {
  if (v === null || v === undefined || v === 'n/a') return '—'
  const negatif = v.startsWith('-')
  const [entier, decimales = ''] = (negatif ? v.slice(1) : v).split('.')
  const fin = decimales.replace(/0+$/, '')
  return `${negatif ? '-' : ''}${entier.replace(/\B(?=(\d{3})+$)/g, SEP)}${fin ? `,${fin}` : ''}`
}

/** Indice ou ratio d'activité (productivité, OR par productif) : deux décimales au plus. Number() sert à l'affichage seulement. */
export function decimal2(v: Val | undefined): string {
  if (v === null || v === undefined || v === 'n/a') return '—'
  return espacer(NF2.format(Number(v)))
}

/** Montant abrégé pour les indicateurs et les graphes : « 125,4 M », « 830 K » (une décimale) ; les tableaux gardent fcfa. */
export function compact(v: Val | number | undefined): string {
  if (v === null || v === undefined || v === 'n/a') return '—'
  const n = Number(v)
  const a = Math.abs(n)
  if (a < 1000) return espacer(NF.format(n))
  // 999 960 donnerait « 1 000 K » : passe en M dès que l'arrondi en K atteint 1 000
  const [div, unite] = Math.round(a / 100) >= 10000 ? [1e6, 'M'] : [1e3, 'K']
  return `${espacer(NF1.format(n / div))}${SEP}${unite}`
}

/** Valeur saisie telle quelle (toutes ses décimales), formatée sans flottant ; cellule vide si absente. */
export function valeurBrute(v: string | undefined): string {
  if (v == null) return ''
  const [e, d] = sansZerosFinaux(v).split('.')
  const entier = e.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, SEP)
  return `${e.startsWith('-') ? '-' : ''}${entier}${d ? `,${d}` : ''}`
}

/** Pourcentage : l'API renvoie un ratio (0,05 = 5 %). */
export function pct(v: Val | undefined): string {
  if (v === null || v === undefined) return '—'
  if (v === 'n/a') return '—'
  return `${espacer(NF1.format(Number(v) * 100))}${SEP}%`
}

export const entier = (v: number | null | undefined) => (v == null ? '—' : espacer(NF.format(v)))

export const isNeg = (v: Val | undefined) => v != null && v !== 'n/a' && Number(v) < 0
export const cls = (v: Val | undefined) => (isNeg(v) ? 'num neg' : 'num')
/** Écart à l'objectif d'un résultat (CA, marge, ventes, clients, factures, productivité) : le dépasser est bon (vert), rester en dessous est mauvais (rouge). */
export const clsResultat = (v: Val | undefined) => (isNeg(v) ? 'num neg' : v != null && v !== 'n/a' && Number(v) > 0 ? 'num bon' : 'num')
/** Écart d'une charge : au-dessus du budget (positif) en rouge, en dessous en vert. */
export const clsCharge = (v: Val | undefined) => (isNeg(v) ? 'num bon' : v != null && v !== 'n/a' && Number(v) > 0 ? 'num neg' : 'num')

/**
 * Décimaux exacts, sans flottant et sans arrondi : chaque valeur est ramenée à un entier (BigInt)
 * à l'échelle de la valeur qui a le plus de décimales, ce qui permet de comparer et d'additionner.
 */
export function aligner(valeurs: string[]): { n: bigint[]; echelle: number } {
  const lues = valeurs.map((v) => {
    const t = v.trim()
    const [e, d = ''] = t.replace('-', '').split('.')
    return { neg: t.startsWith('-'), e: e || '0', d }
  })
  const echelle = Math.max(0, ...lues.map((x) => x.d.length))
  const n = lues.map((x) => {
    const abs = BigInt(x.e) * 10n ** BigInt(echelle) + BigInt(x.d.padEnd(echelle, '0') || '0')
    return x.neg ? -abs : abs
  })
  return { n, echelle }
}

/** Entier à une échelle donnée en décimal texte ("-120050" à l'échelle 2 -> "-1200.50"). */
export function depuisEntier(total: bigint, echelle: number): string {
  const abs = total < 0n ? -total : total
  const signe = total < 0n ? '-' : ''
  if (echelle === 0) return `${signe}${abs}`
  const texte = String(abs).padStart(echelle + 1, '0')
  return `${signe}${texte.slice(0, -echelle)}.${texte.slice(-echelle)}`
}

/** Compare deux décimaux : -1, 0 ou 1. */
export function comparer(a: string, b: string): number {
  const { n: [x, y] } = aligner([a, b])
  return x < y ? -1 : x > y ? 1 : 0
}

/** Signe d'un décimal : -1, 0 ou 1. */
export const signe = (v: string) => comparer(v, '0')

/** Somme exacte de décimaux à échelle variable, sans arrondi. null si aucune valeur. */
export function somme(valeurs: (Val | undefined)[]): string | null {
  const presentes = valeurs.filter((v): v is string => v != null && v !== 'n/a')
  if (presentes.length === 0) return null
  const { n, echelle } = aligner(presentes)
  return depuisEntier(n.reduce((s, x) => s + x, 0n), echelle)
}

/** Moyenne exacte, comme le serveur : null si elle ne tient pas en 12 décimales (division sans fin). */
export function moyenne(valeurs: string[]): string | null {
  if (valeurs.length === 0) return null
  const { n, echelle } = aligner(valeurs)
  const total = n.reduce((s, x) => s + x, 0n)
  const nb = BigInt(valeurs.length)
  for (let e = echelle; e <= 12; e++) {
    const t = total * 10n ** BigInt(e - echelle)
    if (t % nb === 0n) return depuisEntier(t / nb, e)
  }
  return null
}

/** Écart absolu exact entre deux décimaux. */
export function ecartAbsolu(a: string, b: string): string {
  const { n: [x, y], echelle } = aligner([a, b])
  return depuisEntier(x > y ? x - y : y - x, echelle)
}

// Règle du serveur pour CA, marge, ventes, clients, productivité : 15 chiffres, 12 décimales au plus.
const ACTIVITE = /^\d{1,15}([.,]\d{1,12})?$/
const ACTIVITE_SIGNE = /^-?\d{1,15}([.,]\d{1,12})?$/

/** Valeur d'activité saisie (milliers tolérés) : mêmes limites que le serveur. */
export const montantValide = (v: string) => ACTIVITE.test(sansEspaces(v))

/** Valeur pouvant être négative (une marge), séparateurs de milliers tolérés. */
export const montantSigneValide = (v: string) => ACTIVITE_SIGNE.test(sansEspaces(v))

/** Budget saisi : chiffres, virgule ou point, 3 décimales au plus (le serveur arrondit à 3). */
export const budgetValide = (v: string) => /^\d+([.,]\d{0,3})?$/.test(sansEspaces(v))

/** Montant tapé ou collé sans ses séparateurs de milliers (espaces, espaces insécables). */
export const sansEspaces = (v: string) => v.replace(/[\s  ]/g, '')

/** Décimal du serveur sans zéros de fin, sans passer par un flottant ("1200.500" -> "1200.5"). */
export const sansZerosFinaux = (v: string) => (v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v)

/** Largeur d'un en-tête : deux lignes au plus, juste la place du plus long des deux segments, plus une légère marge. */
export const largeurEntete = (t: string) => {
  const mots = t.split(' ')
  let meilleur = t.length
  for (let i = 1; i < mots.length; i++) {
    meilleur = Math.min(meilleur, Math.max(mots.slice(0, i).join(' ').length, mots.slice(i).join(' ').length))
  }
  return Math.round(meilleur * 9.6 + 14)
}
