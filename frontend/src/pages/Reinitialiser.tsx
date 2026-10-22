import { type FormEvent, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { reinitialiser } from '../api/rapports'
import ChampMotDePasse from '../components/ChampMotDePasse'
import Fond from '../components/Fond'

export default function Reinitialiser() {
  const { hash } = useLocation()
  const navigate = useNavigate()
  // Jeton dans le fragment (#), jamais envoyé au serveur ; lu une fois puis retiré de l'adresse.
  const [jeton] = useState(() => new URLSearchParams(hash.slice(1)).get('jeton') ?? '')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [invalide, setInvalide] = useState(!jeton)
  const [fait, setFait] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (hash) navigate({ hash: '' }, { replace: true })
  }, [hash, navigate])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères.')
      return
    }
    if (password !== confirmation) {
      setError('Les deux mots de passe ne sont pas identiques.')
      return
    }
    setBusy(true)
    try {
      await reinitialiser(jeton, password)
      setFait(true)
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setInvalide(true)
      else setError('Réinitialisation impossible pour le moment. Réessayez.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-page">
      <Fond />
      <div className="login-card">
        <div className="login-marque">
          <img className="login-logo" src={`${import.meta.env.BASE_URL}images/cfao_logo.png`} alt="CFAO" />
          <h1>
            Reporting <span className="accent">RH</span>
          </h1>
        </div>
        {fait ? (
          <>
            <div role="status" className="login-succes">
              Votre mot de passe a été modifié.
            </div>
            <p className="login-retour">
              <Link className="btn-link" to="/login">
                Se connecter
              </Link>
            </p>
          </>
        ) : invalide ? (
          <>
            <div role="alert" className="alert">
              Ce lien est invalide ou a expiré.
            </div>
            <p className="login-retour">
              <Link className="btn-link" to="/login?oubli=1">
                Demander un nouveau lien
              </Link>
            </p>
          </>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <p className="login-explication">Choisissez un nouveau mot de passe (8 caractères minimum).</p>
            {error && (
              <div role="alert" className="alert">
                {error}
              </div>
            )}
            <ChampMotDePasse id="nouveau" libelle="Nouveau mot de passe" valeur={password} onChange={setPassword} autoComplete="new-password" />
            <ChampMotDePasse id="confirmation" libelle="Confirmer le mot de passe" valeur={confirmation} onChange={setConfirmation} autoComplete="new-password" />
            <button className="btn" type="submit" disabled={busy}>
              Enregistrer le mot de passe
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
