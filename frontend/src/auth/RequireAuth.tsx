import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { premierePageAdmin } from '../components/AdminNav'
import { useAuth } from './AuthContext'

export default function RequireAuth({ perm, children }: { perm?: string; children: ReactNode }) {
  const { me, loading, can } = useAuth()
  const loc = useLocation()
  // Session inconnue (premier affichage de l'onglet) : rien plutôt qu'une structure qui ne serait pas
  // celle de la page ; au rechargement, le profil gardé (AuthContext) affiche la page sans attendre.
  if (loading) return null
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  // Page non accordée : on n'en révèle pas l'existence, on mène à une page permise.
  if (perm && !can(perm)) {
    const admin = loc.pathname.startsWith('/admin') ? premierePageAdmin(can) : undefined
    return <Navigate to={admin ?? '/resume'} replace />
  }
  return <>{children}</>
}
