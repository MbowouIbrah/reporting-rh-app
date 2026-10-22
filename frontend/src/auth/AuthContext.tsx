import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import { ApiError, setUnauthorizedHandler } from '../api/client'
import { getMe, login as apiLogin, logout as apiLogout } from '../api/rapports'
import type { Me } from '../api/types'
import { viderCache } from '../lib/cacheSession'
import { viderPartage } from '../lib/filtresPartages'

interface Auth {
  me: Me | null
  loading: boolean
  can: (perm: string) => boolean
  login: (email: string, password: string, remember?: boolean) => Promise<void>
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

// Le cookie de session est commun aux onglets, le profil non : une connexion ou une déconnexion
// dans un onglet est annoncée aux autres, qui revérifient /auth/me (sinon ils gardent menus et
// droits du compte précédent jusqu'au rafraîchissement).
const CANAL = 'reporting-rh:session'

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const canal = useRef<BroadcastChannel | null>(null)
  const q = useQuery({
    queryKey: ['me'],
    queryFn: () => getMe().catch(sansSession),
    staleTime: Infinity,
    retry: false,
    placeholderData: lireProfil,
  })
  const me = q.data ?? null

  /** Oublie tout ce qui appartient au compte précédent (filtres, caches), sauf le profil lui-même. */
  const oublier = useCallback(() => {
    viderPartage()
    viderCache()
    qc.removeQueries({ predicate: (x) => x.queryKey[0] !== 'me' })
  }, [qc])

  useEffect(() => {
    if (q.isPlaceholderData || q.status !== 'success') return
    // Profil gardé d'un autre compte (connexion changée dans un autre onglet, onglet fermé) : on repart de zéro.
    const garde = lireProfil()
    if (garde && garde.id !== q.data?.id) oublier()
    ecrireProfil(q.data)
  }, [q.data, q.isPlaceholderData, q.status, oublier])

  // Revérifie la session : sur annonce d'un autre onglet, ou quand l'onglet redevient visible.
  useEffect(() => {
    let enCours = false
    const verifier = () => {
      if (enCours) return
      enCours = true
      getMe()
        .catch(sansSession)
        .then(
          (m: Me | null) => {
            const avant = qc.getQueryData<Me | null>(['me'])
            if ((m?.id ?? null) !== (avant?.id ?? null)) {
              ecrireProfil(null)
              oublier()
            }
            qc.setQueryData(['me'], m)
          },
          () => {},
        )
        .finally(() => {
          enCours = false
        })
    }
    const visible = () => {
      if (document.visibilityState === 'visible') verifier()
    }
    if (typeof BroadcastChannel !== 'undefined') {
      canal.current = new BroadcastChannel(CANAL)
      canal.current.onmessage = verifier
    }
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('focus', visible)
    return () => {
      canal.current?.close()
      canal.current = null
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('focus', visible)
    }
  }, [qc, oublier])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      viderCache()
      // qc.clear() retirerait aussi ['me'] : son observateur ne verrait plus le null et la page resterait vide.
      qc.setQueryData(['me'], null)
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' })
    })
  }, [qc])

  const login = useCallback(
    async (email: string, password: string, remember = false) => {
      const me = await apiLogin(email, password, remember)
      oublier()
      qc.setQueryData(['me'], me)
      canal.current?.postMessage('connexion')
    },
    [qc, oublier],
  )
  const logout = useCallback(async () => {
    await apiLogout().catch(() => {})
    // Le prochain utilisateur de l'onglet ne doit pas hériter du service ou de l'employé choisis.
    // Pas de qc.clear() : il retirerait ['me'] et l'écran resterait sur le profil précédent.
    ecrireProfil(null)
    oublier()
    qc.setQueryData(['me'], null)
    canal.current?.postMessage('deconnexion')
  }, [qc, oublier])

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
