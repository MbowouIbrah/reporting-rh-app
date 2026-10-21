import { useQuery } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { useSearchParams } from 'react-router-dom'
import { queryRetry } from '../api/client'
import { usePeut } from '../auth/AuthContext'
import { type FiltresPage, getFiltres, getPeriodes } from '../api/rapports'
import type { Periode } from '../api/types'
import { ecrireCache, lireCache } from '../lib/cacheSession'
import {
  abonnerPartage,
  CLES_PARTAGEES,
  lirePartage,
  modifierPartage,
  type Partage,
  type Patch,
} from '../lib/filtresPartages'

const STALE = 5 * 60 * 1000

/** Une nouvelle année remet à zéro le mois et les comparaisons ; un nouveau mois, la période comparée. */
function avecCascade(patch: Patch, actuel: Partage): Patch {
  const p = { ...patch }
  const change = (k: 'annee' | 'mois') => k in p && String(p[k] ?? '') !== (actuel[k] ?? '')
  if (change('annee')) {
    if (!('mois' in p)) p.mois = undefined
    if (!('cmp_annee' in p)) p.cmp_annee = undefined
  }
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

interface Options {
  /** La page affiche un sélecteur de mois ; sinon le mois partagé est ignoré (dernier mois saisi). */
  avecMois?: boolean
  /** Comparaison choisie : une année (annuel) ou une période AAAA-MM (mensuel). Défaut : N-1 ou M-1. */
  comparaison?: 'annee' | 'periode'
}

/** Filtres des pages de reporting. Défaut : dernière période disponible dans le périmètre de l'utilisateur. */
export function useFiltres({ avecMois = true, comparaison }: Options = {}) {
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
  const annee = Number(p.annee) || derniere?.annee
  const moisDefaut = (annee === derniere?.annee ? derniere?.mois : 12) || 12
  const mois = (avecMois && Number(p.mois)) || moisDefaut
  const options = useQuery({
    queryKey: ['filtres', annee],
    queryFn: () => getFiltres(annee!),
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
  }

  // Site et type de site sont liés : la liste Site ne garde que les sites du type choisi, et un
  // nouveau type efface un site qui n'en fait pas partie.
  const typeParSite = options.data?.type_par_site ?? {}
  const sites = (options.data?.sites ?? []).filter((s) => !p.type_site || typeParSite[s] === p.type_site)
  function setLie(patch: Patch) {
    const t = patch.type_site
    if (t && !('site' in patch) && p.site && typeParSite[p.site] !== t) set({ ...patch, site: undefined })
    else set(patch)
  }

  return {
    filtres,
    set: setLie,
    partage: p,
    periodes: periodes.data ?? [],
    annees: [...new Set(periodes.data?.map((x) => x.annee))],
    services: options.data?.services ?? [],
    sites,
    typesSite: options.data?.types_site ?? [],
    postes: options.data?.postes ?? [],
    activites: options.data?.activites ?? [],
    typesContrat: options.data?.types_contrat ?? [],
    pret: !periodes.isLoading,
    vide: !periodes.isLoading && !derniere,
    erreur: periodes.error,
  }
}

export const STALE_TIME = STALE
