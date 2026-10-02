import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import Etat from '../components/Etat'
import { useAuth } from './AuthContext'

export default function RequireAuth({ perm, children }: { perm?: string; children: ReactNode }) {
  const { me, loading, can } = useAuth()
  const loc = useLocation()
  if (loading) return <Etat type="chargement" />
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  if (perm && !can(perm)) return <Etat type="403" />
  return <>{children}</>
}
