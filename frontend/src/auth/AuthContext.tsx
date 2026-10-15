import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo } from 'react'
import { ApiError, setUnauthorizedHandler } from '../api/client'
import { getMe, login as apiLogin, logout as apiLogout } from '../api/rapports'
import type { Me } from '../api/types'
import { viderCache } from '../lib/cacheSession'
import { viderPartage } from '../lib/filtresPartages'

interface Auth {
  me: Me | null
  loading: boolean
  can: (perm: string) => boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const Ctx = createContext<Auth | null>(null)

const sansSession = (e: unknown) =>
  e instanceof ApiError && e.status === 401 ? null : Promise.reject(e)

// Profil de la session (nom, rôle, droits ; aucun jeton) gardé le temps de l'onglet : au rechargement,
// la page et sa structure s'affichent tout de suite pendant que /auth/me revalide la session.
// Les droits ne servent qu'à l'affichage : le serveur contrôle chaque requête.
const PROFIL = 'reporting-rh:profil'
function lireProfil(): Me | undefined {
  try {
    return JSON.parse(sessionStorage.getItem(PROFIL) ?? 'null') ?? undefined
  } catch {
    return undefined
  }
}
function ecrireProfil(me: Me | null) {
  try {
    if (me) sessionStorage.setItem(PROFIL, JSON.stringify(me))
    else sessionStorage.removeItem(PROFIL)
  } catch {
    /* stockage indisponible : le rechargement attend /auth/me */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['me'],
    queryFn: () => getMe().catch(sansSession),
    staleTime: Infinity,
    retry: false,
    placeholderData: lireProfil,
  })
  const me = q.data ?? null

  useEffect(() => {
    if (!q.isPlaceholderData && q.status === 'success') ecrireProfil(q.data)
  }, [q.data, q.isPlaceholderData, q.status])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      viderCache()
      // qc.clear() retirerait aussi ['me'] : son observateur ne verrait plus le null et la page resterait vide.
      qc.setQueryData(['me'], null)
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' })
    })
  }, [qc])

  const login = useCallback(
    async (email: string, password: string) => {
      const me = await apiLogin(email, password)
      viderCache()
      qc.setQueryData(['me'], me)
    },
    [qc],
  )
  const logout = useCallback(async () => {
    await apiLogout().catch(() => {})
    // Le prochain utilisateur de l'onglet ne doit pas hériter du service ou de l'employé choisis.
    viderPartage()
    ecrireProfil(null)
    viderCache()
    qc.clear()
    qc.setQueryData(['me'], null)
  }, [qc])

  const value = useMemo<Auth>(
    () => ({ me, loading: q.isLoading, can: (p) => !!me?.permissions.includes(p), login, logout }),
    [me, q.isLoading, login, logout],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Droit de l'utilisateur connecté ; faux hors AuthProvider (hooks partagés, tests). */
export function usePeut(perm: string): boolean {
  return useContext(Ctx)?.can(perm) ?? false
}

export function useAuth(): Auth {
  const v = useContext(Ctx)
  if (!v) throw new Error('AuthProvider manquant')
  return v
}
