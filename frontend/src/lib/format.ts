import type { Val } from '../api/types'

const NF = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
const NF1 =new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export const MOIS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

export const MOIS_COURTS = ['Jan', 'Fév', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc']

/** Montant en FCFA. null -> « — », 'n/a' -> « n/a ». Number() sert à l'affichage seulement. */
export function fcfa(v: Val | number | undefined): string {
  if (v === null || v === undefined) return '—'
  if (v === 'n/a') return 'n/a'
  return NF.format(Number(v))
}

/** Valeur saisie telle quelle (jusqu'à 3 décimales), formatée sans flottant ; cellule vide si absente. */
export function valeurBrute(v: string | undefined): string {
  if (v == null) return ''
  const [e, d] = sansZerosFinaux(v).split('.')
  const entier = e.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${e.startsWith('-') ? '-' : ''}${entier}${d ? `,${d}` : ''}`
}

/** Pourcentage : l'API renvoie un ratio (0,05 = 5 %). */
export function pct(v: Val | undefined): string {
  if (v === null || v === undefined) return '—'
  if (v === 'n/a') return 'n/a'
  return `${NF1.format(Number(v) * 100)} %`
}

export const entier = (v: number | null | undefined) => (v == null ? '—' : NF.format(v))

export const isNeg = (v: Val | undefined) => v != null && v !== 'n/a' && Number(v) < 0
export const cls = (v: Val | undefined) => (isNeg(v) ? 'num neg' : 'num')

/** Somme de montants décimaux (3 décimales) en entiers, sans flottant. null si aucune valeur. */
export function somme(valeurs: Val[]): string | null {
  let total = 0n
  let n = 0
  for (const v of valeurs) {
    if (v === null || v === 'n/a') continue
    const [e, d = ''] = v.split('.')
    const neg = e.startsWith('-')
    const milli = BigInt(e.replace('-', '') || '0') * 1000n + BigInt(d.padEnd(3, '0').slice(0, 3))
    total += neg ? -milli : milli
    n += 1
  }
  if (n === 0) return null
  const abs = total < 0n ? -total : total
  return `${total < 0n ? '-' : ''}${abs / 1000n}.${String(abs % 1000n).padStart(3, '0')}`
}

/** Montant saisi : chiffres, virgule ou point, 3 décimales au plus (NUMERIC(18,3)). */
export const montantValide = (v: string) => /^\d+([.,]\d{0,3})?$/.test(v.trim())

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
