import { type FormEvent, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import Fond from '../components/Fond'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [sp] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email || !password) {
      setError('Renseignez votre adresse e-mail et votre mot de passe.')
      return
    }
    setBusy(true)
    try {
      await login(email, password)
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

  return (
    <main className="login-page">
      <Fond />
      <form className="login-card" onSubmit={onSubmit} noValidate>
        <div className="login-marque">
          <img className="login-logo" src={`${import.meta.env.BASE_URL}images/cfao_logo.png`} alt="CFAO" />
          <h1>
            Reporting <span className="accent">RH</span>
          </h1>
        </div>
        {error && (
          <div role="alert" className="alert">
            {error}
          </div>
        )}
        <div className="field">
          <label htmlFor="email">Adresse e-mail</label>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Mot de passe</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="btn" type="submit" disabled={busy}>
          Se connecter
        </button>
      </form>
    </main>
  )
}
