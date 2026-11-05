import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { motDePasseOublie } from '../api/rapports'
import { useAuth } from '../auth/AuthContext'
import ChampMotDePasse from '../components/ChampMotDePasse'
import PageConnexion from '../components/PageConnexion'
import { cibleSure } from '../lib/connexion'

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
    // Sans preventScroll, le navigateur fait défiler le cadre rogné en plus de la translation.
    ;(oubli ? champOubli : champConnexion).current?.focus({ preventScroll: true })
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
      navigate(cibleSure(sp.get('next')), { replace: true })
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Identifiants invalides.'
          : err instanceof ApiError && err.status === 429
            ? 'Trop de tentatives. Réessayez dans une minute.'
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
    <PageConnexion>
      <div className="login-form-slider">
        <div className={`login-form-track${oubli ? ' is-oubli' : ''}`}>
          <div className="login-form-panel" role="group" aria-label="Connexion" inert={oubli} aria-hidden={oubli}>
            <p className="login-card-lead">Veuillez saisir votre adresse e-mail et votre mot de passe pour vous connecter</p>
            {error && (
              <div role="alert" className="alert">
                {error}
              </div>
            )}
            <form onSubmit={onSubmit} noValidate>
              <div className="field">
                <label htmlFor="email" className="sr-only">
                  Adresse e-mail
                </label>
                <input
                  id="email"
                  ref={champConnexion}
                  type="email"
                  autoComplete="username"
                  placeholder="Adresse e-mail"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <ChampMotDePasse
                id="password"
                libelle="Mot de passe"
                libelleMasque
                placeholder="Mot de passe"
                valeur={password}
                onChange={setPassword}
                autoComplete="current-password"
              />
              <div className="login-options">
                <label className="login-remember">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  <span>Se souvenir de moi</span>
                </label>
                <button type="button" className="login-forgot" onClick={() => basculer(true)}>
                  Mot de passe oublié ?
                </button>
              </div>
              <button className="btn login-submit" type="submit" disabled={busy}>
                Se connecter
              </button>
            </form>
            <p className="login-contact-note">Pas de compte ou un problème d'accès ? Contactez l'administrateur RH.</p>
          </div>

          <div className="login-form-panel" role="group" aria-label="Mot de passe oublié" inert={!oubli} aria-hidden={!oubli}>
            <p className="login-form-eyebrow">Mot de passe oublié</p>
            <h2 className="login-form-title">Réinitialiser</h2>
            <p className="login-form-sub">
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
                  placeholder="prénom.nom"
                  value={emailOubli}
                  onChange={(e) => setEmailOubli(e.target.value)}
                  disabled={envoye}
                />
              </div>
              <button className="btn login-submit" type="submit" disabled={busy || envoye}>
                Envoyer le lien <span aria-hidden="true">→</span>
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
    </PageConnexion>
  )
}
