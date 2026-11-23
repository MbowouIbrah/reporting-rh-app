/** Page « Répartition des charges » : formats d'affichage et règles de sélection des cartes (fonctions pures). */
import type { Charges, ChargesPersonne, EffectifContrat, LigneActivite, LigneCharge, LigneChargeBase, Val } from '../api/types'

export const NB = ' '

export type Sens = '' | 'hausse' | 'baisse'
export type Motif = 'poids' | 'hausse' | 'baisse'

export const SEUIL_VAR = 20
export const PART_MIN = 2

/** Valeur serveur en nombre pour l'affichage seulement (jamais pour un calcul de KPI). */
export function num(v: Val | undefined): number | null {
  if (v == null || v === 'n/a') return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}
/** Ratio serveur (0,25) en pourcentage (25). */
export const pcServeur = (v: Val | undefined): number | null => {
  const x = num(v)
  return x == null ? null : x * 100
}

const groupes = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, NB)
const virgule = (s: string) => s.replace('.', ',')

export const ent = (n: number) => groupes(String(Math.abs(Math.round(n))))
export const mt = (n: number) => (Math.round(n) < 0 ? '−' : '') + ent(n)
export const signeEnt = (v: number) => (Math.round(v) > 0 ? '+' : Math.round(v) < 0 ? '−' : '') + ent(v)
export const fp = (v: number | null) =>
  v == null ? '—' : (v >= 0.05 ? '+' : v <= -0.05 ? '−' : '') + virgule(Math.abs(v).toFixed(1)) + NB + '%'
export const part = (v: number) => virgule(v.toFixed(1)) + NB + '%'
export const partR = (v: number) => part(v * 100)
export const pts = (v: number | null) =>
  v == null ? '—' : (v >= 0.05 ? '+' : v <= -0.05 ? '−' : '') + virgule(Math.abs(v).toFixed(1)) + NB + 'pt'

function unite(a: number): [number, string] {
  return a >= 1e9 ? [1e9, 'Md'] : a >= 1e6 ? [1e6, 'M'] : a >= 1e3 ? [1e3, 'K'] : [1, '']
}
/** Montant abrégé : 1,2 M, 340 K, 25 Md. */
export function abr(n: number): string {
  const a = Math.abs(n)
  const [u, s] = unite(a)
  const txt = virgule((a / u).toFixed(s ? 1 : 0))
  return (n < 0 && !/^0(,0)?$/.test(txt) ? '−' : '') + txt + (s ? NB + s : '')
}
/** Comme `abr`, sans décimale dès 100 unités (coût par vente). */
export function abrC(n: number): string {
  const a = Math.abs(n)
  const [u, s] = unite(a)
  return s && a / u >= 100 ? (n < 0 ? '−' : '') + String(Math.round(a / u)) + NB + s : abr(n)
}
export const sa = (v: number) => (Math.round(v) > 0 ? '+' : Math.round(v) < 0 ? '−' : '') + abr(Math.abs(v))

export const sens = (n: number): Sens => (Math.round(n) > 0 ? 'hausse' : Math.round(n) < 0 ? 'baisse' : '')
export const sensPc = (v: number | null): Sens => (v == null || Math.abs(v) < 0.05 ? '' : sens(v))
/** Sens d'une variation : celui du pourcentage serveur, sinon (pourcentage « n/a ») celui de l'écart. */
export const sensVar = (variation: number | null, e: number | null): Sens =>
  variation == null ? '' : e == null ? sens(variation) : sensPc(e)
export const fleche = (s: Sens) => (!s ? '▬' : s === 'hausse' ? '▲' : '▼')

export const bas = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s)
export const sansAccent = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export const SIGLES: Record<string, string> = {
  MAD: 'Mise à disposition',
  CDI: 'Contrat à durée indéterminée',
  CDD: 'Contrat à durée déterminée',
}

/* ---------- Cartes : trois lignes par carte ---------- */

export interface Ligne3 { nom: string; n: number; n1: number | null; e: number | null; part: number | null; pers: number | null }
export interface Rang {
  nom: string
  val: string
  e: number | null
  evTxt?: string
  motif: Motif
  titre: string
}
/** Évolution à droite du grand chiffre : sens, pourcentage, écart. */
export interface Evo { sens: Sens; txt: string; ecart: string; couleur?: boolean }

/** Les 2 plus gros, puis la plus forte évolution parmi les autres. */
export function choisir3<T extends { motif: Motif }>(l: T[], ev: (x: T) => number | null): T[] {
  const r = l
    .slice(2)
    .filter((x) => ev(x) != null)
    .sort((a, b) => Math.abs(ev(b) as number) - Math.abs(ev(a) as number))[0]
  return r ? [...l.slice(0, 2), { ...r, motif: ((ev(r) as number) > 0 ? 'hausse' : 'baisse') as Motif }] : l.slice(0, 3)
}

export interface GroupeRangs { motif: Motif; fort: boolean; rangs: Rang[] }
/** Regroupe les rangs par motif (poids, hausse, baisse) ; `fort` : un écart d'au moins 20 %. */
export function grouper(rows: Rang[]): GroupeRangs[] {
  return (['poids', 'hausse', 'baisse'] as Motif[])
    .filter((m) => rows.some((x) => x.motif === m))
    .map((m) => {
      const rangs = rows.filter((x) => x.motif === m)
      return { motif: m, rangs, fort: m !== 'poids' && rangs.some((x) => Math.abs(x.e ?? 0) >= SEUIL_VAR) }
    })
}

export interface Top3 {
  tot: string
  mtU: (n: number) => string
  droite: Evo | null
  rows: Rang[]
}
/** Total d'une carte : montant, période comparée, écart et pourcentage donnés par le serveur. */
export interface Total { n: number; n1: number | null; lc: string; v: number | null; e: number | null }

export function top3(lignes: Ligne3[], T: Total): Top3 {
  const c = T.n1 != null
  const tous = lignes
    .filter((x) => x.n > 0)
    .map((x) => ({ ...x, p: x.part ?? 0, e: c ? x.e : null, motif: 'poids' as Motif }))
    .sort((a, b) => b.n - a.n)
  const L = choisir3(tous, (x) => (x.p >= PART_MIN ? x.e : null))
  const mx = Math.max(0, T.n, ...L.map((x) => x.n))
  const U: [number, string] = mx >= 1e6 ? [1e6, 'M'] : mx >= 1e3 ? [1e3, 'K'] : [1, '']
  const mtU = (n: number) => ent(Math.round(n / U[0])) + (U[1] ? NB + U[1] : '')
  const d = c ? (T.v ?? 0) : 0
  const rows: Rang[] = L.map((x) => ({
    nom: x.nom,
    val: mtU(x.n),
    e: x.e,
    motif: x.motif,
    titre: `${x.nom} : ${mtU(x.n)} FCFA, ${part(x.p)} des charges, ${x.pers ?? '—'} personnes${
      x.e == null ? '' : `, ${fp(x.e)} depuis ${bas(T.lc)}`
    }`,
  }))
  return {
    tot: mtU(T.n),
    mtU,
    droite: c
      ? { sens: sensVar(T.v, T.e), txt: fp(T.e), ecart: (d > 0 ? '+' : d < 0 ? '−' : '') + mtU(Math.abs(d)) }
      : null,
    rows,
  }
}

/** Ligne d'axe serveur en entrée des cartes. */
export const ligne3 = (l: LigneChargeBase): Ligne3 => ({
  nom: l.libelle,
  n: num(l.m) ?? 0,
  n1: num(l.m1),
  e: l.m1 == null ? null : pcServeur(l.var_pct),
  part: pcServeur(l.part),
  pers: l.effectif,
})

export const TYPES_SITE: [string, string, string][] = [
  ['principal', 'principal', 'principaux'],
  ['agence', 'agence', 'agences'],
  ['deporte', 'déporté', 'déportés'],
]
export const typeSite = (l: LigneCharge) => {
  const t = sansAccent(l.type_site ?? '')
  return TYPES_SITE.some(([k]) => k === t) ? t : 'principal'
}

/** Effectifs par nature de contrat : lignes de la carte Effectifs. */
export function rangsContrat(contrats: EffectifContrat[], comparee: boolean): Rang[] {
  const grp: (Rang & { a: number })[] = contrats
    .filter((x) => x.n > 0)
    .map((x) => ({
      nom: x.libelle,
      a: x.n,
      val: ent(x.n),
      e: comparee && x.n1 ? pcServeur(x.var_pct) : null,
      motif: 'poids' as Motif,
      titre: `${x.libelle}${SIGLES[x.libelle] ? ` (${SIGLES[x.libelle]})` : ''} : ${x.n} personnes, ${part(pcServeur(x.part) ?? 0)} de l'effectif${
        comparee ? `, ${x.entrees ?? 0} entrées, ${x.sorties ?? 0} sorties` : ''
      }`,
    }))
    .sort((x, y) => y.a - x.a)
  return choisir3(grp, (x) => x.e)
}

const NOMS_ACT: [string, string][] = [
  ['ventes', 'Ventes'],
  ['factures', 'Factures'],
  ['clients', 'Clients'],
  ['productivite', 'Productivité'],
  ['or', 'Ordres de réparation'],
  ['devis', 'Devis'],
]
/** Indicateurs d'activité de la carte : valeur, évolution, objectif. */
export function rangsActivite(lignes: LigneActivite[]): Rang[] {
  const tous: Rang[] = []
  for (const [cle, nom] of NOMS_ACT) {
    const l = lignes.find((x) => x.cle === cle)
    const val = l ? num(l.m) : null
    if (!l || val == null) continue
    const val1 = num(l.m1)
    const pr = cle === 'productivite'
    const fmt = (x: number) => (pr ? part(x * 100) : ent(x))
    const o = num(l.budget)
    const real = pcServeur(l.realisation)
    tous.push({
      nom,
      val: fmt(val),
      e: val1 == null ? null : pcServeur(l.var_pct),
      evTxt: pr && val1 != null ? pts(pcServeur(l.var)) : undefined,
      motif: 'poids',
      titre: `${nom} : ${fmt(val)}${o ? `, objectif ${fmt(o)} (${real == null ? '—' : Math.round(real)}${NB}% atteint)` : ", pas d'objectif"}`,
    })
  }
  return choisir3(tous, (x) => x.e)
}

/** Coût par vente (charges ÷ ventes) : valeur, période comparée, écart et évolution donnés par le serveur. */
export function coutParVente(d: Charges) {
  const { n, n1, var: ecart, var_pct } = d.cout_par_vente
  return { v: num(n), v1: num(n1), var: num(ecart), e: pcServeur(var_pct) }
}

/* ---------- Tableau d'un axe ---------- */

export type AxeVue = 'type' | 'site' | 'service' | 'eff' | 'act'
export const AXES_VUE: AxeVue[] = ['type', 'site', 'service', 'eff', 'act']
export const NOM_AXE: Record<AxeVue | 'marque', string> = {
  type: 'Types de charge',
  site: 'Sites',
  service: 'Services',
  marque: 'Marques',
  act: 'Activité',
  eff: 'Effectifs',
}
export const PREMIER_LIBELLE: Record<'type' | 'site' | 'service' | 'eff', string> = {
  type: 'Type de charge',
  site: 'Site',
  service: 'Service',
  eff: 'Service',
}

export interface Noeud {
  nom: string
  n: number
  n1: number | null
  variation: number | null
  e: number | null
  part: number | null
  eff: number
  eff1: number | null
  /** Écart d'effectif (serveur). */
  effVar: number | null
  entrees: number | null
  sorties: number | null
  bu: number | null
  /** Écart au budget et part du budget consommée en % (serveur). */
  ecartBu: number | null
  real: number | null
  /** Rubrique de primes comparée au même mois un an plus tôt. */
  primes: boolean
  enfants?: Noeud[]
}

export function noeud(l: LigneChargeBase | LigneCharge): Noeud {
  const enfants = (l as LigneCharge).enfants
  return {
    nom: l.libelle,
    n: num(l.m) ?? 0,
    n1: num(l.m1),
    variation: num(l.var),
    e: pcServeur(l.var_pct),
    part: num(l.part),
    eff: l.effectif,
    eff1: l.effectif1,
    effVar: l.effectif_var,
    entrees: l.entrees,
    sorties: l.sorties,
    bu: num(l.budget),
    ecartBu: num(l.ecart_budget),
    real: pcServeur(l.realisation),
    primes: l.cmp_primes === true,
    enfants: enfants?.map(noeud),
  }
}

/** Chemin d'ouverture effectif, sans modifier l'état : ouverture automatique d'un enfant unique. */
export function chemin(items: Noeud[], ouv: string[], fermeAuto: boolean): string[] {
  const out: string[] = []
  let cur: Noeud[] | null = items
  let d = 0
  while (cur) {
    let k: string | undefined = ouv[d]
    if (k === undefined && cur.length === 1 && !fermeAuto) k = cur[0].nom
    if (k === undefined) break
    const x: Noeud | undefined = cur.find((i) => i.nom === k)
    if (!x) break
    out.push(k)
    cur = x.enfants && x.enfants.length > 1 ? x.enfants : null
    d++
  }
  return out
}

/** Statut d'une personne dans l'axe Effectifs : entrée ou sortie sur la période. */
export const statut = (p: ChargesPersonne) => (p.entree ? 'entree' : p.sortie ? 'sortie' : '')

/** Libellé de contexte d'une personne (info-bulle). */
export const contextePersonne = (p: ChargesPersonne) =>
  [p.nom, `matricule ${p.matricule}`, p.service, p.site, p.activite, p.contrat].filter(Boolean).join(' · ')

/* ---------- Export de la liste (CSV lisible par Excel) ---------- */

/** Un texte qui commence par = + - @ serait lu comme une formule : une apostrophe le neutralise (les nombres restent tels quels). */
const cellule = (v: string | number | null) => {
  let s = v == null ? '' : String(v)
  if (/^[=+@-]/.test(s) && !/^[+-]?\d+(,\d+)?$/.test(s)) s = `'${s}`
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const decVirgule = (v: Val) => (v == null || v === 'n/a' ? '' : v.replace('.', ','))

export function csvPersonnes(lignes: ChargesPersonne[]): string {
  const tete = ['Matricule', 'Nom', 'Service', 'Site', 'Activité', 'Contrat', 'Poste', 'Période comparée', 'Période', 'Variation', 'Statut']
  const corps = lignes.map((p) =>
    [
      p.matricule, p.nom, p.service, p.site, p.activite, p.contrat, p.poste,
      decVirgule(p.m1), decVirgule(p.m), decVirgule(p.var), p.entree ? 'Entrée' : p.sortie ? 'Sortie' : '',
    ].map(cellule).join(';'),
  )
  return '﻿' + [tete.map(cellule).join(';'), ...corps].join('\r\n') + '\r\n'
}
