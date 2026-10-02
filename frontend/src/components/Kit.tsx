import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Ton = 'neutre' | 'succes' | 'alerte' | 'erreur' | 'info'

/** Pastille de statut : le texte porte le sens, la couleur renforce. */
export function Badge({ ton = 'neutre', children }: { ton?: Ton; children: ReactNode }) {
  return <span className={`badge badge-${ton}`}>{children}</span>
}

export function Bouton({
  variante = 'primaire',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: 'primaire' | 'secondaire' | 'lien' }) {
  return <button type="button" className={`bouton bouton-${variante} ${className ?? ''}`.trim()} {...rest} />
}

export function Carte({ titre, children, actions }: { titre?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="carte">
      {(titre || actions) && (
        <header className="carte-entete">
          {titre && <h3>{titre}</h3>}
          {actions}
        </header>
      )}
      {children}
    </section>
  )
}

/** Section repliable native (clavier et lecteurs d'écran gérés par <details>). */
export function Section({
  titre,
  resume,
  ouverte = true,
  children,
}: {
  titre: string
  resume?: ReactNode
  ouverte?: boolean
  children: ReactNode
}) {
  return (
    <details className="section" open={ouverte}>
      <summary>
        <span className="section-titre">{titre}</span>
        {resume && <span className="note">{resume}</span>}
      </summary>
      <div className="section-corps">{children}</div>
    </details>
  )
}
