import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface Props {
  /** Écran auquel la flèche ramène. */
  libelle: string
  vers?: string
  onRetour?: () => void
  desactive?: boolean
  /** Fil d'étapes, aligné à droite de la barre. */
  children?: ReactNode
}

/** Barre du parcours de saisie : retour en haut à gauche, fil d'étapes à droite. */
export default function BarreParcours({ libelle, vers, onRetour, desactive, children }: Props) {
  const contenu = (
    <>
      <ArrowLeft aria-hidden="true" size={18} strokeWidth={2.25} />
      {libelle}
    </>
  )
  const nom = `Retour : ${libelle}`
  return (
    <div className="barre-parcours">
      {vers ? (
        <Link className="barre-retour" to={vers} aria-label={nom}>{contenu}</Link>
      ) : (
        <button type="button" className="barre-retour" onClick={onRetour} disabled={desactive} aria-label={nom}>{contenu}</button>
      )}
      {children}
    </div>
  )
}
