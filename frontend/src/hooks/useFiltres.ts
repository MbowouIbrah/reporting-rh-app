import { useQuery } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { useSearchParams } from 'react-router-dom'
import { queryRetry } from '../api/client'
import { usePeut } from '../auth/AuthContext'
import { DIMS_COMPAREES, type FiltresPage, getFiltres, getPeriodes } from '../api/rapports'
import type { Periode } from '../api/types'
import { ecrireCache, lireCache } from '../lib/cacheSession'
import { type Calendrier, DEBUT_FISCAL, exerciceDe } from '../lib/exercice'
import {
  anneeDe, calendrierDe, defautCmp, indice, longueur, lireTexte, migrer, migrerComparaison, moisDe, mois as moisSel, type PeriodeChoisie, texteMois, versTexte,
} from '../lib/periode'
import {
  abonnerPartage,
  CLES_PARTAGEES,
  lirePartage,
  modifierPartage,
  type Partage,
  type Patch,
} from '../lib/filtresPartages'

const STALE = 5 * 60 * 1000

/** Une nouvelle année remet à zéro le mois et les comparaisons ; un nouveau mois, la période comparée.
 *  Un nouveau calendrier remet aussi l'année : « 2026 » n'a pas le même sens en civil et en fiscal.
 *  Une nouvelle période (pages annuelles) remet la comparaison à sa valeur par défaut. */
export function avecCascade(patch: Patch, actuel: Partage): Patch {
  const p = { ...patch }
  const change = (k: 'annee' | 'mois' | 'calendrier' | 'exercice' | 'periode') => k in p && String(p[k] ?? '') !== (actuel[k] ?? '')
  if (change('annee') && !('mois' in p)) p.mois = undefined
  if ((change('annee') || change('mois')) && !('cmp_periode' in p)) p.cmp_periode = undefined
  if (change('periode') && !('comparee' in p)) p.comparee = undefined
  return p
}

/**
 * Filtres partagés entre toutes les pages (lib/filtresPartages), recopiés dans l'URL de la page
 * courante. Un lien qui porte des filtres (?annee=…) les impose à l'ouverture.
 */
export function usePartage() {
  const stocke = useSyncExternalStore(abonnerPartage, lirePartage)
  const [sp, setSp] = useSearchParams()
  // Filtres portés par l'URL à l'ouverture : appliqués dès le premier rendu (pas de requête sur
  // d'autres filtres), versés dans le magasin juste après ; ensuite le magasin fait foi.
  const [venus] = useState(() => CLES_PARTAGEES.filter((k) => sp.get(k)).map((k) => [k, sp.get(k)!] as const))
  const [importe, setImporte] = useState(venus.length === 0)
  const partage: Partage = importe ? stocke : { ...stocke, ...Object.fromEntries(venus) }

  useLayoutEffect(() => {
    if (importe) return
    modifierPartage(Object.fromEntries(venus))
    setImporte(true)
  }, [importe, venus])

  function set(patch: Patch) {
    const complet = avecCascade(patch, lirePartage())
    modifierPartage(complet)
    setSp(
      (prec) => {
        const next = new URLSearchParams(prec)
        for (const [k, v] of Object.entries(complet)) {
          if (v === undefined || v === '') next.delete(k)
          else next.set(k, String(v))
        }
        return next
      },
      { replace: true },
    )
  }

  return { partage, set }
}

/** Filtres liés, dans l'ordre des colonnes de `combinaisons` (/rapports/filtres). Le matricule
 *  (8e colonne) n'est servi qu'avec le droit nominatif. */
const DIMS = ['departement', 'service', 'site', 'type_site', 'activite', 'type_contrat', 'poste', 'matricule'] as const
type Dim = (typeof DIMS)[number]
type Choix = Partial<Record<Dim, string | undefined>>

/** Valeurs d'un filtre : plusieurs, séparées par « | » (R4, sélection multiple). */
export const valeurs = (v: string | undefined) => (v ? v.split('|').filter(Boolean) : [])

const compatible = (c: string[], choix: Choix, sauf?: Dim) =>
  DIMS.every((d, i) => d === sauf || i >= c.length || !choix[d] || valeurs(choix[d]).includes(c[i]))

/** Valeurs choisies de `d` qui gardent au moins une combinaison avec `garde` ; vide : aucune. */
const restantes = (combis: string[][], garde: Choix, d: Dim, v: string | undefined) =>
  valeurs(v).filter((x) => combis.some((c) => compatible(c, { ...garde, [d]: x }))).join('|') || undefined

/** Valeurs proposées par filtre : celles des combinaisons compatibles avec les autres filtres choisis
 *  (aucune option ne mène à un résultat vide) ; la valeur choisie reste toujours proposée. */
export function facettes(combis: string[][], choix: Choix): Record<Dim, string[]> {
  return Object.fromEntries(
    DIMS.map((d, i) => {
      const v = new Set(combis.filter((c) => compatible(c, choix, d)).map((c) => c[i]).filter(Boolean))
      for (const x of valeurs(choix[d])) v.add(x)
      return [d, [...v].sort()]
    }),
  ) as Record<Dim, string[]>
}

/** Choix réellement appliqués : un filtre partagé venu d'une autre page, d'une autre année ou d'un
 *  autre mois qui n'a plus aucune correspondance est écarté (les précédents dans l'ordre priment). */
export function compatibles(combis: string[][], choix: Choix): Choix {
  const garde: Choix = {}
  for (const d of DIMS) {
    if (!choix[d]) continue
    const r = restantes(combis, garde, d, choix[d])
    if (r) garde[d] = r
  }
  return garde
}

/** Après un changement, efface les autres filtres choisis devenus incompatibles (le plus récent l'emporte). */
export function sansIncompatibles(combis: string[][], actuel: Choix, patch: Patch): Patch {
  const garde: Choix = Object.fromEntries(DIMS.filter((d) => d in patch).map((d) => [d, patch[d] ? String(patch[d]) : undefined]))
  const efface: Patch = {}
  for (const d of DIMS) {
    if (d in patch || !actuel[d]) continue
    const r = restantes(combis, garde, d, actuel[d])
    if (r) garde[d] = r
    if (r !== actuel[d]) efface[d] = r
  }
  return { ...patch, ...efface }
}

interface Options {
  /** La page affiche un sélecteur de mois ; sinon le mois partagé est ignoré (dernier mois saisi). */
  avecMois?: boolean
  /** Comparaison choisie : une période (annuel) ou un mois AAAA-MM (mensuel). Défaut : mois ou période d'avant. */
  comparaison?: 'annee' | 'periode'
  /** La page suit le choix « année civile / fiscale » (pages annuelles) ; sinon toujours civile. */
  avecCalendrier?: boolean
  /** R9 : la page sait comparer deux valeurs d'un filtre (mode « Comparer » des listes). */
  selections?: boolean
}

/** Filtres des pages de reporting. Défaut : dernière période disponible dans le périmètre de l'utilisateur. */
export function useFiltres({ avecMois = true, comparaison, avecCalendrier = false, selections = false }: Options = {}) {
  const { partage: p, set } = usePartage()
  const nominatif = usePeut('nominatif:read')
  const periodes = useQuery({
    queryKey: ['periodes'],
    queryFn: getPeriodes,
    staleTime: STALE,
    retry: queryRetry,
    // Au rechargement : filtres et structure de la page tout de suite, revalidés ensuite.
    placeholderData: () => lireCache<Periode[]>('periodes'),
  })
  useEffect(() => {
    if (!periodes.isPlaceholderData && periodes.data) ecrireCache('periodes', periodes.data)
  }, [periodes.data, periodes.isPlaceholderData])
  const derniere = periodes.data?.at(-1)
  // Pages annuelles : période et comparaison (R6). Sans choix, les anciens filtres (année, vue, mois…)
  // sont traduits ; sinon le dernier mois disponible, comparé au mois d'avant.
  const premierMois = periodes.data?.[0]
  const min = premierMois && indice(premierMois.annee, premierMois.mois)
  const max = derniere && indice(derniere.annee, derniere.mois)
  const periode: PeriodeChoisie | null = (() => {
    if (comparaison !== 'annee' || !derniere || min === undefined || max === undefined) return null
    const sel = lireTexte(p.periode, max) ?? migrer(p, derniere, max) ?? moisSel(max)
    const cmp = lireTexte(p.comparee, max) ?? (lireTexte(p.periode, max) ? null : migrerComparaison(p, sel))
    return { sel, cmp: cmp && longueur(cmp) === longueur(sel) ? cmp : defautCmp(sel), min, max }
  })()
  const calendrier: Calendrier = periode
    ? calendrierDe(periode.sel)
    : avecCalendrier && p.calendrier === 'fiscal' ? 'fiscal' : 'civil'
  const fiscal = calendrier === 'fiscal' ? calendrier : undefined
  const exDerniere = derniere && exerciceDe(derniere.annee, derniere.mois, calendrier)
  // En fiscal, l'année est celle du début de l'exercice (2026 = avril 2026 → mars 2027), partagée
  // sous sa propre clé : `annee` reste une année civile pour les autres pages (mois choisi).
  const annee = periode ? anneeDe(periode.sel.d) : Number(fiscal ? p.exercice : p.annee) || exDerniere
  const finExercice = fiscal ? DEBUT_FISCAL - 1 : 12
  const moisDefaut = (annee === exDerniere ? derniere?.mois : finExercice) || finExercice
  const mois = (avecMois && Number(p.mois)) || moisDefaut
  // Page mensuelle : les listes ne proposent que ce que le mois affiché contient.
  const moisFiltres = avecMois && !fiscal ? mois : undefined
  const options = useQuery({
    queryKey: ['filtres', annee, fiscal, moisFiltres],
    queryFn: () => getFiltres(annee!, fiscal, moisFiltres),
    enabled: annee !== undefined,
    staleTime: STALE,
    retry: queryRetry,
  })

  // Anciennes clés des pages annuelles (vue, mois de début et de fin, comparaison) : traduites en
  // période une fois, puis retirées.
  const anciennes = ['vue', 'debut', 'fin', 'cmp', 'cmp_annee', 'cmp_periode'] as const
  const aMigrer = !!periode && anciennes.some((k) => p[k])
  const texteSel = periode && versTexte(periode.sel)
  const periodeLue = max !== undefined && !!lireTexte(p.periode, max)
  const texteCmp = periode && versTexte(periode.cmp)
  const cmpMigree = !!p.cmp_periode && !lireTexte(p.comparee, max)
  useEffect(() => {
    if (!aMigrer || !texteSel) return
    set({
      ...Object.fromEntries(anciennes.map((k) => [k, undefined])),
      ...(!periodeLue && { periode: texteSel, comparee: cmpMigree ? texteCmp ?? undefined : p.comparee }),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aMigrer, texteSel, periodeLue])

  const ref = (() => {
    if (periode) return {}
    const m = comparaison === 'periode' ? /^(\d{4})-(\d{1,2})$/.exec(p.cmp_periode ?? '') : null
    return m ? { ref_annee: Number(m[1]), ref_mois: Number(m[2]) } : {}
  })()

  // Filtres partagés sans correspondance dans les données de la page : écartés tout de suite
  // (pas de requête vide), puis retirés du partage.
  const combis = options.data?.combinaisons
  const garde = combis?.length ? compatibles(combis, p) : null
  // Une valeur écartée d'un choix multiple réduit le choix ; le filtre disparaît s'il n'en reste aucune.
  const ecartes = garde ? DIMS.filter((d) => p[d] && garde[d] !== p[d]) : []
  const choix: Choix = garde ?? p
  const cleEcartes = JSON.stringify(Object.fromEntries(ecartes.map((d) => [d, garde?.[d] ?? null])))
  useEffect(() => {
    const e: Record<string, string | null> = JSON.parse(cleEcartes)
    if (Object.keys(e).length) set(Object.fromEntries(Object.entries(e).map(([d, v]) => [d, v ?? undefined])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleEcartes])

  // R9 : une liste en mode « Comparer » (pages annuelles). Avec deux valeurs cochées, la 1re est A
  // (filtre appliqué), la 2e est B (sélection comparée, même période) ; sinon la comparaison de période reste.
  const cmpDim = selections && periode ? DIMS_COMPAREES.find((d) => d === p.cmp_dim) ?? null : null
  const ab = cmpDim ? valeurs(choix[cmpDim]) : []
  const selection = cmpDim && ab.length === 2 ? { dim: cmpDim, a: ab[0], b: ab[1] } : null

  const filtres: FiltresPage | null = annee === undefined ? null : {
    annee,
    mois: periode ? moisDe(periode.sel.f) : mois,
    ...(periode && {
      du: texteMois(periode.sel.d),
      au: texteMois(periode.sel.f),
      cmp_du: texteMois(periode.cmp.d),
      cmp_au: texteMois(periode.cmp.f),
    }),
    departement: choix.departement,
    service: choix.service,
    site: choix.site,
    type_site: choix.type_site,
    poste: choix.poste,
    activite: choix.activite,
    type_contrat: choix.type_contrat,
    // Un matricule partagé (lien, autre page) n'est transmis qu'avec le droit nominatif : sinon 403.
    matricule: nominatif ? choix.matricule : undefined,
    ...(selection && { [selection.dim]: selection.a, cmp_dim: selection.dim, cmp_val: selection.b }),
    ...ref,
    ...(fiscal && { calendrier: fiscal }),
  }

  // Filtres liés : chaque liste ne garde que les valeurs compatibles avec les autres choix, et un
  // nouveau choix efface ceux qui ne le sont plus.
  const f = combis ? facettes(combis, choix) : null
  function setLie(brut: Patch) {
    const { annee: a, ...reste } = brut
    const patch: Patch = fiscal && 'annee' in brut ? { ...reste, exercice: a } : brut
    set(combis && DIMS.some((d) => d in patch) ? sansIncompatibles(combis, choix, patch) : patch)
  }

  return {
    filtres,
    set: setLie,
    partage: p,
    periodes: periodes.data ?? [],
    calendrier,
    /** Pages annuelles : période, comparaison et mois disponibles (bornes du calendrier). */
    periode,
    /** R9 : filtre en mode « Comparer » (null : aucun ; undefined : page sans ce mode), et les deux valeurs une fois cochées. */
    cmpDim: selections ? cmpDim : undefined,
    selection,
    annees: [...new Set(periodes.data?.map((x) => exerciceDe(x.annee, x.mois, calendrier)))],
    // Filtre « Département » proposé seulement quand le périmètre en couvre plusieurs.
    departements: (options.data?.departements?.length ?? 0) > 1
      ? (f?.departement ?? options.data?.departements)
      : undefined,
    services: f?.service ?? options.data?.services ?? [],
    sites: f?.site ?? options.data?.sites ?? [],
    typesSite: f?.type_site ?? options.data?.types_site ?? [],
    postes: f?.poste ?? options.data?.postes ?? [],
    activites: f?.activite ?? options.data?.activites ?? [],
    typesContrat: f?.type_contrat ?? options.data?.types_contrat ?? [],
    /** Employés compatibles avec les autres filtres (combinaisons nominatives), la personne choisie comprise. */
    garderSalaries: <T extends { matricule: string }>(l: T[] | undefined) =>
      l && f && combis?.[0]?.length === DIMS.length ? l.filter((s) => f.matricule.includes(s.matricule)) : l,
    pret: !periodes.isLoading,
    // Une panne n'est pas une absence de période : sans liste connue, la page affiche l'erreur.
    vide: periodes.isSuccess && !derniere,
    erreur: derniere ? null : periodes.error,
    relancer: () => void periodes.refetch(),
  }
}

export const STALE_TIME = STALE
