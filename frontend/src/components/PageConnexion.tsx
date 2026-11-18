import type { ReactNode } from 'react'

/** Page des écrans hors session (connexion, réinitialisation) : aplat navy à motif discret (R1), barre du haut, carte en verre. */
export default function PageConnexion({ children }: { children: ReactNode }) {
  const base = import.meta.env.BASE_URL
  return (
    <div className="login-page">
      <div className="login-bg" aria-hidden="true">
        <svg className="login-bg-motif" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1200 560" focusable="false">
          <defs>
            <pattern id="login-motif" width="60" height="60" patternUnits="userSpaceOnUse">
              <path d="M0 60 L60 0" className="login-motif-trait" />
              <circle cx="30" cy="30" r="1.5" className="login-motif-point" />
            </pattern>
          </defs>
          <rect width="1200" height="560" fill="url(#login-motif)" />
          <path d="M0 470 L400 470 L460 410 L1200 410" className="login-motif-ligne" />
        </svg>
        <div className="login-bg-bande" />
      </div>
      <header className="login-nav">
        <div className="login-nav-brand">
          <img src={`${base}images/cfao_logo.png`} alt="CFAO" />
          <h1 className="login-nav-label">
            Reporting RH<span>.</span>
          </h1>
        </div>
      </header>
      <main className="login-main">
        <div className="login-card login-card--glass">
          <div className="login-card-brand">
            <img className="login-logo" src={`${base}images/cfao_logo.png`} alt="" />
            <p className="login-marque-titre">
              Reporting <span>RH</span>
            </p>
          </div>
          {children}
        </div>
      </main>
    </div>
  )
}
