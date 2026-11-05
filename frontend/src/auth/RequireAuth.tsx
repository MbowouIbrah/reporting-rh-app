import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { premierePageAdmin } from '../components/AdminNav'
import BandeauConnexion from '../components/BandeauConnexion'
import Etat, { etatErreur } from '../components/Etat'
import { useAuth } from './AuthContext'

export default function RequireAuth({ perm, children }: { perm?: string; children: ReactNode }) {
  const { me, loading, panne, reessayer, can } = useAuth()
  const loc = useLocation()
  // Session inconnue (premier affichage de l'onglet) : rien plutôt qu'une structure qui ne serait pas
  // celle de la page ; au rechargement, le profil gardé (AuthContext) affiche la page sans attendre.
  if (loading) return null
  // Serveur injoignable sans profil connu : ce n'est pas une fin de session, on n'envoie pas vers /login.
  // Le bandeau sonde le serveur et relance /auth/me à son retour.
  if (panne)
    return (
      <main className="page">
        <Etat type={etatErreur(panne)} titre="Connexion impossible" onRetry={reessayer} />
        <BandeauConnexion />
      </main>
    )
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  if (me.doit_changer_mdp) return <Navigate to={`/changer-mot-de-passe?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  // Page non accordée : on n'en révèle pas l'existence, on mène à une page permise.
  if (perm && !can(perm)) {
    const admin = loc.pathname.startsWith('/admin') ? premierePageAdmin(can) : undefined
    return <Navigate to={admin ?? '/resume'} replace />
  }
  return <>{children}</>
}
