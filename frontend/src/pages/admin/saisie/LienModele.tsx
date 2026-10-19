import { useRef, useState, type ReactNode } from 'react'
import { telechargerModele, type LigneSaisie } from '../../../api/saisie'
import { ACCEPT } from './ImportFichier'

interface Props {
  annee: number
  mois: number
  /** Lignes du modèle, lues au clic : la sélection et les valeurs du moment. */
  lignes: () => LigneSaisie[]
  title?: string
  /** Fichier rempli choisi : ouvre l'aperçu d'import. */
  onImporter: (f: File) => void
  children: ReactNode
}

/** Modèle Excel qui reprend exactement les lignes à l'écran (aucune : modèle vide, en-tête seul).
 *  Une fois téléchargé, tant que rien ne change à l'écran, le lien propose d'importer le fichier rempli. */
export default function LienModele({ annee, mois, lignes, title, onImporter, children }: Props) {
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [exporte, setExporte] = useState<string | null>(null)
  const fichierRef = useRef<HTMLInputElement>(null)
  const telecharger = async () => {
    setEnCours(true)
    setErreur(null)
    try {
      const l = lignes()
      await telechargerModele(annee, mois, l)
      setExporte(JSON.stringify(l))
    } catch (e) {
      setErreur(`Modèle indisponible : ${e instanceof Error ? e.message : 'erreur inconnue'}.`)
    }
    setEnCours(false)
  }
  if (exporte !== null && exporte === JSON.stringify(lignes())) {
    return (
      <span className="saisie-lien-modele">
        <button type="button" className="bouton bouton-lien" onClick={() => fichierRef.current?.click()}
          title="Le fichier téléchargé, une fois rempli dans Excel">
          Importer le fichier rempli (.xlsx)
        </button>
        <input ref={fichierRef} type="file" accept={ACCEPT} hidden tabIndex={-1} aria-hidden="true"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onImporter(f) }} />
        <button type="button" className="bouton bouton-lien" onClick={telecharger} disabled={enCours}>
          {enCours ? 'Préparation du modèle…' : 'Télécharger à nouveau'}
        </button>
      </span>
    )
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
