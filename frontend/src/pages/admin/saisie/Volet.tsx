import type { ReactNode } from 'react'

interface Props {
  titre: ReactNode
  resume?: ReactNode
  valeur: ReactNode
  ton?: 'ok' | 'ko'
  ouvert: boolean
  onOuvrir: () => void
  children: ReactNode
}

/** Bloc dépliable piloté par le parent, comme les volets du compte rendu cfaoacademy : un seul ouvert, seul son contenu défile. */
export default function Volet({ titre, resume, valeur, ton, ouvert, onOuvrir, children }: Props) {
  return (
    <div className={`volet${ouvert ? ' volet-ouvert' : ''}`}>
      <h3 className="volet-titre">
        <button type="button" className="volet-bouton" aria-expanded={ouvert} onClick={onOuvrir}>
          <span className="volet-fleche" aria-hidden="true">▸</span>
          <span className="volet-nom">{titre}</span>
          {resume && <span className="volet-resume">{resume}</span>}
          <span className={`volet-valeur${ton ? ` volet-valeur-${ton}` : ''}`}>{valeur}</span>
        </button>
      </h3>
      {ouvert && <div className="volet-corps">{children}</div>}
    </div>
  )
}
