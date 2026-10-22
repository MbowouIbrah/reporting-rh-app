import type { CSSProperties, ReactNode } from 'react'

/** Formes flottantes du fond : [taille, haut, gauche, délai, durée, dérive Y, dérive X, rotation, opacité, ronde]. */
const PARTICULES: [number, string, string, string, string, number, number, number, number, boolean][] = [
  [48, '14%', '12%', '0s', '7.2s', 68, 32, 16, 0.24, false],
  [22, '28%', '22%', '-2.2s', '5.4s', 44, -28, 0, 0.42, true],
  [56, '46%', '8%', '-4.5s', '8.2s', 80, 38, 20, 0.18, false],
  [30, '68%', '18%', '-1.2s', '6.1s', 52, -36, 12, 0.32, false],
  [18, '82%', '10%', '-3.8s', '4.9s', 58, 24, 0, 0.48, true],
  [40, '22%', '78%', '-5.2s', '7.5s', 88, -44, 22, 0.2, false],
  [26, '36%', '88%', '-1.8s', '5.6s', 50, 30, 0, 0.38, true],
  [52, '54%', '72%', '0s', '7s', 72, 36, 18, 0.28, false],
  [34, '70%', '84%', '-2.6s', '6.4s', 64, -38, 14, 0.34, false],
  [20, '16%', '92%', '-4s', '5s', 46, 28, 0, 0.45, true],
  [36, '88%', '76%', '-6s', '7.8s', 70, -32, 16, 0.22, false],
  [24, '40%', '6%', '-3.2s', '5.8s', 54, 26, 0, 0.3, true],
]

/** Page des écrans hors session (connexion, réinitialisation) : photo sombre, formes animées, barre du haut, carte en verre. */
export default function PageConnexion({ children }: { children: ReactNode }) {
  const base = import.meta.env.BASE_URL
  return (
    <div className="login-page">
      <div className="login-bg" aria-hidden="true">
        <div className="login-bg-photo" style={{ backgroundImage: `url('${base}images/fond.webp')` }} />
        <div className="login-bg-vignette" />
        <ul className="login-particles">
          {PARTICULES.map(([taille, haut, gauche, delai, duree, dy, dx, rotation, opacite, ronde], i) => (
            <li
              key={i}
              className={ronde ? 'login-particle login-particle--round' : 'login-particle'}
              style={
                {
                  '--p-size': `${taille}px`,
                  '--p-top': haut,
                  '--p-left': gauche,
                  '--p-delay': delai,
                  '--p-dur': duree,
                  '--p-drift-y': `${dy}px`,
                  '--p-drift-x': `${dx}px`,
                  '--p-spin': `${rotation}deg`,
                  '--p-opacity': opacite,
                } as CSSProperties
              }
            />
          ))}
        </ul>
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
