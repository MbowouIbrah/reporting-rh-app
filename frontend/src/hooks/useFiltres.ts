import { useQuery } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { useSearchParams } from 'react-router-dom'
import { queryRetry } from '../api/client'
import { usePeut } from '../auth/AuthContext'
import { type FiltresPage, getFiltres, getPeriodes } from '../api/rapports'
import type { Periode } from '../api/types'
import { ecrireCache, lireCache } from '../lib/cacheSession'
import { type Calendrier, DEBUT_FISCAL, exerciceDe } from '../lib/exercice'
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
 *  Un nouveau calendrier remet aussi l'année : « 2026 » n'a pas le même sens en civil et en fiscal. */
export function avecCascade(patch: Patch, actuel: Partage): Patch {
  const p = { ...patch }
  const change = (k: 'annee' | 'mois' | 'calendrier' | 'exercice') => k in p && String(p[k] ?? '') !== (actuel[k] ?? '')
  if (change('annee') && !('mois' in p)) p.mois = undefined
  // La comparaison annuelle est une année civile ou un exercice, selon le calendrier.
  if ((change('annee') || change('calendrier') || change('exercice')) && !('cmp_annee' in p)) p.cmp_annee = undefined
  if ((change('annee') || change('mois')) && !('cmp_periode' in p)) p.cmp_periode = undefined
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

/** Filtres liés, dans l'ordre des colonnes de `combinaisons` (/rapports/filtres). */
const DIMS = ['service', 'site', 'type_site', 'activite', 'type_contrat', 'poste'] as const
type Dim = (typeof DIMS)[number]
type Choix = Partial<Record<Dim, string | undefined>>

const compatible = (c: string[], choix: Choix, sauf?: Dim) =>
  DIMS.every((d, i) => d === sauf || !choix[d] || c[i] === choix[d])

/** Valeurs proposées par filtre : celles des combinaisons compatibles avec les autres filtres choisis
 *  (aucune option ne mène à un résultat vide) ; la valeur choisie reste toujours proposée. */
export function facettes(combis: string[][], choix: Choix): Record<Dim, string[]> {
  return Object.fromEntries(
    DIMS.map((d, i) => {
      const v = new Set(combis.filter((c) => compatible(c, choix, d)).map((c) => c[i]).filter(Boolean))
      if (choix[d]) v.add(choix[d])
      return [d, [...v].sort()]
    }),
  ) as Record<Dim, string[]>
}

/** Après un changement, efface les autres filtres choisis devenus incompatibles (le plus récent l'emporte). */
export function sansIncompatibles(combis: string[][], actuel: Choix, patch: Patch): Patch {
  const garde: Choix = Object.fromEntries(DIMS.filter((d) => d in patch).map((d) => [d, patch[d] ? String(patch[d]) : undefined]))
  const efface: Patch = {}
  for (const d of DIMS) {
    if (d in patch || !actuel[d]) continue
    const essai = { ...garde, [d]: actuel[d] }
    if (combis.some((c) => compatible(c, essai))) garde[d] = actuel[d]
    else efface[d] = undefined
  }
  return { ...patch, ...efface }
}

interface Options {
  /** La page affiche un sélecteur de mois ; sinon le mois partagé est ignoré (dernier mois saisi). */
  avecMois?: boolean
  /** Comparaison choisie : une année (annuel) ou une période AAAA-MM (mensuel). Défaut : N-1 ou M-1. */
  comparaison?: 'annee' | 'periode'
  /** La page suit le choix « année civile / fiscale » (pages annuelles) ; sinon toujours civile. */
  avecCalendrier?: boolean
}

/** Filtres des pages de reporting. Défaut : dernière période disponible dans le périmètre de l'utilisateur. */
export function useFiltres({ avecMois = true, comparaison, avecCalendrier = false }: Options = {}) {
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
  const calendrier: Calendrier = avecCalendrier && p.calendrier === 'fiscal' ? 'fiscal' : 'civil'
  const fiscal = calendrier === 'fiscal' ? calendrier : undefined
  const exDerniere = derniere && exerciceDe(derniere.annee, derniere.mois, calendrier)
  // En fiscal, l'année est celle du début de l'exercice (2026 = avril 2026 → mars 2027), partagée
  // sous sa propre clé : `annee` reste une année civile pour les autres pages (Mensuel).
  const annee = Number(fiscal ? p.exercice : p.annee) || exDerniere
  const finExercice = fiscal ? DEBUT_FISCAL - 1 : 12
  const moisDefaut = (annee === exDerniere ? derniere?.mois : finExercice) || finExercice
  const mois = (avecMois && Number(p.mois)) || moisDefaut
  const options = useQuery({
    queryKey: ['filtres', annee, fiscal],
    queryFn: () => getFiltres(annee!, fiscal),
    enabled: annee !== undefined,
    staleTime: STALE,
    retry: queryRetry,
  })

  const ref = (() => {
    if (comparaison === 'annee' && p.cmp_annee) return { ref_annee: Number(p.cmp_annee) }
    const m = comparaison === 'periode' ? /^(\d{4})-(\d{1,2})$/.exec(p.cmp_periode ?? '') : null
    return m ? { ref_annee: Number(m[1]), ref_mois: Number(m[2]) } : {}
  })()

  const filtres: FiltresPage | null = annee === undefined ? null : {
    annee,
    mois,
    service: p.service,
    site: p.site,
    type_site: p.type_site,
    poste: p.poste,
    activite: p.activite,
    type_contrat: p.type_contrat,
    // Un matricule partagé (lien, autre page) n'est transmis qu'avec le droit nominatif : sinon 403.
    matricule: nominatif ? p.matricule : undefined,
    ...ref,
    ...(fiscal && { calendrier: fiscal }),
  }

  // Filtres liés : chaque liste ne garde que les valeurs compatibles avec les autres choix, et un
  // nouveau choix efface ceux qui ne le sont plus.
  const combis = options.data?.combinaisons
  const f = combis ? facettes(combis, p) : null
  function setLie(brut: Patch) {
    const { annee: a, ...reste } = brut
    const patch: Patch = fiscal && 'annee' in brut ? { ...reste, exercice: a } : brut
    set(combis && DIMS.some((d) => d in patch) ? sansIncompatibles(combis, p, patch) : patch)
  }

  return {
    filtres,
    set: setLie,
    partage: p,
    periodes: periodes.data ?? [],
    calendrier,
    annees: [...new Set(periodes.data?.map((x) => exerciceDe(x.annee, x.mois, calendrier)))],
    services: f?.service ?? options.data?.services ?? [],
    sites: f?.site ?? options.data?.sites ?? [],
    typesSite: f?.type_site ?? options.data?.types_site ?? [],
    postes: f?.poste ?? options.data?.postes ?? [],
    activites: f?.activite ?? options.data?.activites ?? [],
    typesContrat: f?.type_contrat ?? options.data?.types_contrat ?? [],
    pret: !periodes.isLoading,
    vide: !periodes.isLoading && !derniere,
    erreur: periodes.error,
  }
}

export const STALE_TIME = STALE
