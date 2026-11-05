import { type FormEvent, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import ChampMotDePasse from '../components/ChampMotDePasse'
import PageConnexion from '../components/PageConnexion'
import { MDP_MIN, cibleSure } from '../lib/connexion'

/** Changement de mot de passe : imposé si le mot de passe est provisoire (le serveur bloque le reste), sinon volontaire. */
export default function ChangerMotDePasse() {
  const { me, loading, changerMotDePasse, logout } = useAuth()
  const navigate = useNavigate()
  const [sp] = useSearchParams()
  const [actuel, setActuel] = useState('')
  const [nouveau, setNouveau] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [fait, setFait] = useState(false)

  if (loading) return null
  if (!me) return <Navigate to="/login" replace />
  const impose = me.doit_changer_mdp
  const cible = cibleSure(sp.get('next'))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (nouveau.length < MDP_MIN) {
      setError(`Le mot de passe doit contenir au moins ${MDP_MIN} caractères.`)
      return
    }
    if (nouveau !== confirmation) {
      setError('Les deux mots de passe ne sont pas identiques.')
      return
    }
    setBusy(true)
    try {
      await changerMotDePasse(actuel, nouveau)
      if (impose) navigate(cible, { replace: true })
      else setFait(true)
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? 'Trop d’essais. Réessayez dans une minute.'
          : err instanceof ApiError && (err.status === 400 || err.status === 422)
            ? err.message
            : 'Changement impossible pour le moment. Réessayez.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (fait) {
    return (
      <PageConnexion>
        <p className="login-form-eyebrow">Mon compte</p>
        <h2 className="login-form-title">Changer mon mot de passe</h2>
        <div role="status" className="login-succes">
          Mot de passe modifié.
        </div>
        <p className="login-retour">
          <Link className="btn-link" to={cible}>
            Continuer
          </Link>
        </p>
      </PageConnexion>
    )
  }

  return (
    <PageConnexion>
      <p className="login-form-eyebrow">{impose ? 'Mot de passe provisoire' : 'Mon compte'}</p>
      <h2 className="login-form-title">{impose ? 'Changez votre mot de passe' : 'Changer mon mot de passe'}</h2>
      <form onSubmit={onSubmit} noValidate>
        <p className="login-form-sub">
          {impose
            ? `Votre mot de passe est provisoire. Choisissez-en un nouveau pour continuer (${MDP_MIN} caractères minimum).`
            : `Choisissez un nouveau mot de passe (${MDP_MIN} caractères minimum).`}
        </p>
        {error && (
          <div role="alert" className="alert">
            {error}
          </div>
        )}
        <ChampMotDePasse id="actuel" libelle="Mot de passe actuel" valeur={actuel} onChange={setActuel} autoComplete="current-password" />
        <ChampMotDePasse id="nouveau" libelle="Nouveau mot de passe" valeur={nouveau} onChange={setNouveau} autoComplete="new-password" />
        <ChampMotDePasse id="confirmation" libelle="Confirmer le mot de passe" valeur={confirmation} onChange={setConfirmation} autoComplete="new-password" />
        <button className="btn login-submit" type="submit" disabled={busy}>
          Enregistrer le mot de passe
        </button>
      </form>
      <p className="login-retour">
        {impose ? (
          <button type="button" className="btn-link" onClick={() => void logout()}>
            Se déconnecter
          </button>
        ) : (
          <Link className="btn-link" to={cible}>
            Annuler
          </Link>
        )}
      </p>
    </PageConnexion>
  )
}
