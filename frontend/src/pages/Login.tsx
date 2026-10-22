import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { motDePasseOublie } from '../api/rapports'
import { useAuth } from '../auth/AuthContext'
import ChampMotDePasse from '../components/ChampMotDePasse'
import Fond from '../components/Fond'

function IconeMicrosoft() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1" y="1" width="10" height="10" fill="#f25022" />
      <rect x="13" y="1" width="10" height="10" fill="#7fba00" />
      <rect x="1" y="13" width="10" height="10" fill="#00a4ef" />
      <rect x="13" y="13" width="10" height="10" fill="#ffb900" />
    </svg>
  )
}

function IconeGoogle() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12 11.2v2.4h4.2c-.2 1-1.4 2.9-4.2 2.9-2.5 0-4.6-2.1-4.6-4.7s2.1-4.7 4.6-4.7c1.4 0 2.4.6 3 1.1l2-1.9C16.5 5.4 14.4 4.5 12 4.5 7.9 4.5 4.5 7.9 4.5 12s3.4 7.5 7.5 7.5c4.3 0 7.2-3 7.2-7.3 0-.5 0-.9-.1-1.2H12z"
      />
    </svg>
  )
}

const SSO = [
  { id: 'microsoft', libelle: 'Continuer avec Microsoft', Icone: IconeMicrosoft },
  { id: 'google', libelle: 'Continuer avec Google', Icone: IconeGoogle },
]

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [sp] = useSearchParams()
  const [oubli, setOubli] = useState(sp.get('oubli') === '1')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [emailOubli, setEmailOubli] = useState('')
  const [errorOubli, setErrorOubli] = useState<string | null>(null)
  const [envoye, setEnvoye] = useState(false)
  const champConnexion = useRef<HTMLInputElement>(null)
  const champOubli = useRef<HTMLInputElement>(null)
  const premier = useRef(true)

  // Après la bascule, le focus passe au premier champ du panneau affiché.
  useEffect(() => {
    if (premier.current) {
      premier.current = false
      return
    }
    ;(oubli ? champOubli : champConnexion).current?.focus()
  }, [oubli])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email || !password) {
      setError('Renseignez votre adresse e-mail et votre mot de passe.')
      return
    }
    setBusy(true)
    try {
      await login(email, password, remember)
      const next = sp.get('next')
      navigate(next?.startsWith('/') && !next.startsWith('//') ? next : '/resume', { replace: true })
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Identifiants invalides.'
          : 'Connexion impossible pour le moment. Réessayez.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function onSubmitOubli(e: FormEvent) {
    e.preventDefault()
    setErrorOubli(null)
    if (!emailOubli.trim()) {
      setErrorOubli('Renseignez votre adresse e-mail.')
      return
    }
    setBusy(true)
    try {
      await motDePasseOublie(emailOubli.trim())
      setEnvoye(true)
    } catch {
      setErrorOubli('Envoi impossible pour le moment. Réessayez.')
    } finally {
      setBusy(false)
    }
  }

  function basculer(vers: boolean) {
    setOubli(vers)
    setError(null)
    setErrorOubli(null)
    setEnvoye(false)
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
        <div className="login-form-slider">
          <div className={`login-form-track${oubli ? ' is-oubli' : ''}`}>
            <div className="login-form-panel" role="group" aria-label="Connexion" inert={oubli} aria-hidden={oubli}>
              <div className="login-sso">
                {SSO.map(({ id, libelle, Icone }) => (
                  <button key={id} type="button" className="login-sso-btn" disabled title="Connexion SSO : bientôt disponible">
                    <Icone />
                    <span className="login-sso-label">{libelle}</span>
                    <span className="login-sso-badge">Bientôt</span>
                  </button>
                ))}
              </div>
              <div className="login-divider">
                <span>ou</span>
              </div>
              {error && (
                <div role="alert" className="alert">
                  {error}
                </div>
              )}
              <form onSubmit={onSubmit} noValidate>
                <div className="field">
                  <label htmlFor="email">Adresse e-mail</label>
                  <input
                    id="email"
                    ref={champConnexion}
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <ChampMotDePasse id="password" libelle="Mot de passe" valeur={password} onChange={setPassword} autoComplete="current-password" />
                <div className="login-options">
                  <label className="login-remember">
                    <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                    <span>Se souvenir de moi</span>
                  </label>
                  <button type="button" className="login-forgot" onClick={() => basculer(true)}>
                    Mot de passe oublié ?
                  </button>
                </div>
                <button className="btn" type="submit" disabled={busy}>
                  Se connecter
                </button>
              </form>
              <p className="login-contact-note">Pas de compte ou un problème d'accès ? Contactez l'administrateur RH.</p>
            </div>

            <div className="login-form-panel" role="group" aria-label="Mot de passe oublié" inert={!oubli} aria-hidden={!oubli}>
              <p className="login-explication">
                Saisissez l'adresse e-mail de votre compte. Nous vous enverrons un lien pour choisir un nouveau mot de passe.
              </p>
              {errorOubli && (
                <div role="alert" className="alert">
                  {errorOubli}
                </div>
              )}
              {envoye && (
                <div role="status" className="login-succes">
                  Si un compte existe pour cette adresse, un lien de réinitialisation vient d'être envoyé.
                </div>
              )}
              <form onSubmit={onSubmitOubli} noValidate>
                <div className="field">
                  <label htmlFor="email-oubli">Adresse e-mail</label>
                  <input
                    id="email-oubli"
                    ref={champOubli}
                    type="email"
                    autoComplete="email"
                    value={emailOubli}
                    onChange={(e) => setEmailOubli(e.target.value)}
                    disabled={envoye}
                  />
                </div>
                <button className="btn" type="submit" disabled={busy || envoye}>
                  Envoyer le lien
                </button>
              </form>
              <p className="login-retour">
                <button type="button" className="login-forgot" onClick={() => basculer(false)}>
                  ← Retour à la connexion
                </button>
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
