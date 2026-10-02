import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo } from 'react'
import { ApiError, setUnauthorizedHandler } from '../api/client'
import { getMe, login as apiLogin, logout as apiLogout } from '../api/rapports'
import type { Me } from '../api/types'

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['me'],
    queryFn: () => getMe().catch(sansSession),
    staleTime: Infinity,
    retry: false,
  })
  const me = q.data ?? null

  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.clear()
      qc.setQueryData(['me'], null)
    })
  }, [qc])

  const login = useCallback(
    async (email: string, password: string) => {
      qc.setQueryData(['me'], await apiLogin(email, password))
    },
    [qc],
  )
  const logout = useCallback(async () => {
    await apiLogout().catch(() => {})
    qc.clear()
    qc.setQueryData(['me'], null)
  }, [qc])

  const value = useMemo<Auth>(
    () => ({ me, loading: q.isLoading, can: (p) => !!me?.permissions.includes(p), login, logout }),
    [me, q.isLoading, login, logout],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): Auth {
  const v = useContext(Ctx)
  if (!v) throw new Error('AuthProvider manquant')
  return v
}
