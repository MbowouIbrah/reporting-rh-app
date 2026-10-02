import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { queryRetry } from '../api/client'
import { type FiltresPage, getFiltres, getPeriodes } from '../api/rapports'

const STALE = 5 * 60 * 1000

/**
 * Filtres propres à une page, portés par l'URL (?annee&mois&service&site).
 * Valeur par défaut : dernière période disponible dans le périmètre de l'utilisateur.
 */
export function useFiltres() {
  const [sp, setSp] = useSearchParams()
  const periodes = useQuery({
    queryKey: ['periodes'],
    queryFn: getPeriodes,
    staleTime: STALE,
    retry: queryRetry,
  })
  const derniere = periodes.data?.at(-1)
  const annee = Number(sp.get('annee')) || derniere?.annee
  const mois = Number(sp.get('mois')) || (annee === derniere?.annee ? derniere?.mois : 12) || 12
  const options = useQuery({
    queryKey: ['filtres', annee],
    queryFn: () => getFiltres(annee!),
    enabled: annee !== undefined,
    staleTime: STALE,
    retry: queryRetry,
  })

  const filtres: FiltresPage | null = annee === undefined ? null : {
    annee,
    mois,
    service: sp.get('service') || undefined,
    site: sp.get('site') || undefined,
  }

  function set(patch: Record<string, string | number | undefined>) {
    const next = new URLSearchParams(sp)
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') next.delete(k)
      else next.set(k, String(v))
    }
    setSp(next, { replace: true })
  }

  return {
    filtres,
    set,
    annees: [...new Set(periodes.data?.map((p) => p.annee))],
    services: options.data?.services ?? [],
    sites: options.data?.sites ?? [],
    pret: !periodes.isLoading,
    vide: !periodes.isLoading && !derniere,
    erreur: periodes.error,
  }
}

export const STALE_TIME = STALE
