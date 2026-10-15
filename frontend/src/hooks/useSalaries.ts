import { useQuery } from '@tanstack/react-query'
import { queryRetry } from '../api/client'
import { getSalaries } from '../api/rapports'
import { useAuth } from '../auth/AuthContext'
import { STALE_TIME } from './useFiltres'

/** Employés proposés au filtre « Employé » ; `undefined` sans le droit de lecture nominative. */
export function useSalaries(annee: number | undefined) {
  const { can } = useAuth()
  const autorise = can('nominatif:read')
  const q = useQuery({
    queryKey: ['salaries', annee],
    queryFn: () => getSalaries(annee!),
    enabled: autorise && annee !== undefined,
    staleTime: STALE_TIME,
    retry: queryRetry,
  })
  return autorise ? (q.data ?? []) : undefined
}
