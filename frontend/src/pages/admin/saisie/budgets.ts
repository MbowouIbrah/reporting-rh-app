import { AXES, TITRES, type Axe, type CibleBudget, type Pilotage } from '../../../api/pilotage'
import { enMilli, fcfa, MOIS, sansEspaces, somme } from '../../../lib/format'

export type Valeurs = Record<string, string>
export const cle = (axe: Axe, id: number) => `${axe}:${id}`
/** Saisie normalisée pour le serveur ("1 200,5" -> "1200.5"), null si vide. */
export const normal = (v: string) => (v.trim() ? sansEspaces(v).replace(',', '.') : null)

/** Hauteur d'un tableau en lignes : en-tête, total, et la mention « hors total » qui double une ligne. */
export const hauteur = (cibles: CibleBudget[]) => cibles.length + cibles.filter((c) => c.exclue).length + 2

/**
 * Répartit des tableaux en colonnes de hauteurs voisines, dans leur ordre : chacun dans sa colonne,
 * ou deux colonnes dont l'une empile les autres. Retient l'écart relatif le plus faible ; à égalité,
 * le plus de colonnes. `ecart` : hauteur, en lignes, de l'espace entre deux tableaux empilés.
 */
export function repartirColonnes<T>(items: { id: T; h: number }[], ecart = 1): T[][] {
  if (items.length < 2) return [items.map((i) => i.id)]
  const options: T[][][] = [items.map((i) => [i.id])]
  // Deux colonnes : le premier tableau à gauche, chaque autre à gauche ou à droite (masque de bits).
  for (let m = 1; m < 2 ** (items.length - 1); m++) {
    const g = [items[0]], d: typeof items = []
    items.slice(1).forEach((it, i) => ((m >> i) & 1 ? d : g).push(it))
    options.push([g.map((i) => i.id), d.map((i) => i.id)])
  }
  const h = new Map(items.map((i) => [i.id, i.h]))
  const score = (cols: T[][]) => {
    const hs = cols.map((c) => c.reduce((s, id) => s + h.get(id)!, 0) + ecart * (c.length - 1))
    return (Math.max(...hs) - Math.min(...hs)) / Math.max(...hs)
  }
  return options.reduce((best, o) => (score(o) < score(best) - 1e-9 ? o : best))
}

export interface Changement { axe: Axe; cible_id: number; libelle: string; avant: string | null; apres: string | null }
export interface Point { code: string; titre: string; aide: string; lignes: string[] }
export interface Verification {
  /** Tous les changements, dans l'ordre des tableaux. */
  changements: Changement[]
  ajouts: Changement[]
  modifs: Changement[]
  effaces: Changement[]
  totaux: Record<Axe, { avant: string | null; apres: string | null }>
  points: Point[]
}

const egal = (a: string | null, b: string | null) => (a == null || b == null ? a === b : enMilli(a) === enMilli(b))
const ou = (c: Changement) => `${c.libelle} (${TITRES[c.axe].toLowerCase()})`

/** Ce que l'enregistrement va changer, et les points à relire avant de le faire. */
export function verifier(vue: Pilotage, valeurs: Valeurs): Verification {
  const tous: Changement[] = []
  const totaux = {} as Verification['totaux']
  const ecarts: string[] = [], zeros: string[] = [], inactifs: string[] = [], manquants: string[] = []
  for (const axe of AXES) {
    const cibles = vue.budgets[axe]
    const apres = (x: CibleBudget) => normal(valeurs[cle(axe, x.cible_id)] ?? '')
    const comptees = cibles.filter((x) => !x.exclue)
    totaux[axe] = { avant: somme(comptees.map((x) => x.valeur)), apres: somme(comptees.map(apres)) }
    const vides = comptees.filter((x) => x.actif && apres(x) == null)
    if (vides.length && cibles.some((x) => apres(x) != null)) manquants.push(`${TITRES[axe]} : ${vides.map((x) => x.libelle).join(', ')}`)
    for (const x of cibles) {
      const c: Changement = { axe, cible_id: x.cible_id, libelle: x.libelle, avant: x.valeur, apres: apres(x) }
      if (!egal(c.avant, c.apres)) tous.push(c)
      if (c.apres == null) continue
      if (enMilli(c.apres) === 0n) zeros.push(ou(c))
      if (!x.actif) inactifs.push(ou(c))
      // Référence : le montant enregistré, sinon celui du mois proposé en reprise.
      const ref = c.avant ?? vue.reprise?.valeurs[axe][String(x.cible_id)] ?? null
      if (ref != null && enMilli(ref) > 0n) {
        const d = enMilli(c.apres) - enMilli(ref)
        if ((d < 0n ? -d : d) * 2n > enMilli(ref)) ecarts.push(`${ou(c)} : ${fcfa(ref)} → ${fcfa(c.apres)}`)
      }
    }
  }
  const effaces = tous.filter((c) => c.apres == null)
  const points: Point[] = []
  const add = (code: string, titre: string, aide: string, lignes: string[]) => lignes.length && points.push({ code, titre, aide, lignes })
  add('EFFACE', 'Budgets effacés', 'Le montant enregistré sera supprimé : voulu ?', effaces.map((c) => `${ou(c)} : ${fcfa(c.avant)}`))
  const remplis = AXES.filter((a) => totaux[a].apres != null)
  if (remplis.length > 1 && new Set(remplis.map((a) => enMilli(totaux[a].apres!))).size > 1) {
    add('TOTAUX', 'Totaux différents selon la répartition',
      'Types de charge, services et sites ne donnent pas le même total : oubli ou répartition à revoir ?',
      remplis.map((a) => `${TITRES[a]} : ${fcfa(totaux[a].apres)}`))
  }
  add('MANQUANT', 'Budgets manquants', 'Lignes laissées vides alors que le reste du tableau est rempli.', manquants)
  const r = vue.reprise
  add('ECART', 'Écarts de plus de 50 %',
    `Comparé au montant enregistré${r ? `, ou à celui de ${MOIS[r.mois - 1]} ${r.annee}` : ''} : un zéro en trop ou en moins ?`, ecarts)
  add('ZERO', 'Budgets à zéro', 'Un zéro est un budget nul ; laisser vide s’il n’y a pas de budget.', zeros)
  add('INACTIF', 'Budgets sur des lignes inactives', 'Service, site ou type de charge désactivé.', inactifs)
  return {
    changements: tous,
    ajouts: tous.filter((c) => c.avant == null),
    modifs: tous.filter((c) => c.avant != null && c.apres != null),
    effaces,
    totaux,
    points,
  }
}
