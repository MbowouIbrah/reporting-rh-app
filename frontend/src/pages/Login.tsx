import { type FormEvent, useState } from 'react'

/** Page de connexion. L'authentification réelle arrive en P2 (POST /auth/login). */
export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email || !password) {
      setError('Renseignez votre adresse e-mail et votre mot de passe.')
      return
    }
    setError('L’authentification sera activée à la prochaine étape.')
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={onSubmit} noValidate>
        <span className="micro">CFAO · Ressources humaines</span>
        <h1>
          Reporting <span className="accent">RH</span>
        </h1>
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
        <button className="btn" type="submit">
          Se connecter
        </button>
      </form>
    </main>
  )
}
