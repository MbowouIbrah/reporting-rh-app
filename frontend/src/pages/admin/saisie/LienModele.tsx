import { useState, type ReactNode } from 'react'
import { telechargerModele, type LigneSaisie } from '../../../api/saisie'

interface Props {
  annee: number
  mois: number
  /** Lignes du modèle, lues au clic : la sélection et les valeurs du moment. */
  lignes: () => LigneSaisie[]
  title?: string
  children: ReactNode
}

/** Modèle Excel qui reprend exactement les lignes à l'écran (aucune : modèle vide, en-tête seul). */
export default function LienModele({ annee, mois, lignes, title, children }: Props) {
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const telecharger = async () => {
    setEnCours(true)
    setErreur(null)
    try {
      await telechargerModele(annee, mois, lignes())
    } catch (e) {
      setErreur(`Modèle indisponible : ${e instanceof Error ? e.message : 'erreur inconnue'}.`)
    }
    setEnCours(false)
  }
  return (
    <>
      <button type="button" className="bouton bouton-lien" onClick={telecharger} disabled={enCours} title={title}>
        {enCours ? 'Préparation du modèle…' : children}
      </button>
      {erreur && <span className="note" role="alert">{erreur}</span>}
    </>
  )
}
