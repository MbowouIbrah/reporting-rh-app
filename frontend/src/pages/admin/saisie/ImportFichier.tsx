import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { ApiError, queryRetry } from '../../../api/client'
import { envoyerFichier, lireAnomalies, urlRapport, type Lot } from '../../../api/saisie'
import Etat from '../../../components/Etat'
import { ChoixFichier } from '../../../components/Kit'
import BarreParcours from './BarreParcours'
import Etapes from './Etapes'
import PointsAttention, { VOLET_ERREURS } from './PointsAttention'

const ACCEPT = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

interface Props {
  fichier: File
  onLot: (lot: Lot) => void
  onAutre: (f: File | undefined) => void
  onRetour: () => void
}

/** Analyse d'un fichier : prêt -> aperçu ; refusé -> erreurs à corriger dans Excel, rapport téléchargeable. */
export default function ImportFichier({ fichier, onLot, onAutre, onRetour }: Props) {
  const [etat, setEtat] = useState<{ lot?: Lot; erreur?: string }>({})
  const [volet, setVolet] = useState<string>(VOLET_ERREURS)
  const [pied, setPied] = useState<HTMLElement | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let actif = true
    setEtat({})
    envoyerFichier(fichier)
      .then((lot) => {
        if (!actif) return
        if (lot.statut === 'pret') onLot(lot)
        else setEtat({ lot })
      })
      .catch((e) => {
        if (!actif) return
        const deja = e instanceof ApiError && e.status === 409
        setEtat({ erreur: deja ? 'Ce fichier a déjà été importé et enregistré.' : e instanceof Error ? e.message : 'Fichier illisible.' })
      })
    return () => { actif = false }
  }, [fichier, onLot])

  const lot = etat.lot
  const anomalies = useQuery({
    queryKey: ['saisie', 'anomalies', lot?.id],
    queryFn: () => lireAnomalies(lot!.id),
    enabled: !!lot,
    retry: queryRetry,
  })

  return (
    <section className="page-ecran rapport-excel saisie-apercu">
      <BarreParcours libelle="Renseigner des données" onRetour={onRetour}>
        <Etapes parcours="fichier" actuelle={0} />
      </BarreParcours>
      <h2 className="bandeau-titre">{lot || etat.erreur ? 'FICHIER REFUSÉ' : 'ANALYSE DU FICHIER'} — {fichier.name}</h2>
      {!lot && !etat.erreur && <Etat type="chargement" />}
      {(lot || etat.erreur) && (
        <p className="bandeau ko" role="alert">
          {etat.erreur ?? `Fichier refusé : ${lot!.nb_bloquants} erreur${lot!.nb_bloquants > 1 ? 's' : ''} à corriger. Cliquez une ligne, puis la cellule en rouge pour la corriger ici, ou corrigez le fichier Excel et importez-le de nouveau. Rien n’est enregistré pour l’instant.`}
        </p>
      )}
      {lot && (
        <div className="panneau">
          <div className="panneau-corps volets" role="region" aria-label="Erreurs du fichier">
            {anomalies.data && <PointsAttention anomalies={anomalies.data} lotId={lot?.id} onLot={(l) => (l.statut === 'pret' ? onLot(l) : setEtat({ lot: l }))} afficherLigne ouvert={volet} onOuvrir={setVolet} pied={pied} />}
          </div>
        </div>
      )}
      {/* Liens à gauche ; à droite, « Annuler (n modifications) » et « Enregistrer » des corrections. */}
      <div className="saisie-pied">
        <span className="pied-liens">
          {lot && <a className="bouton bouton-lien" href={urlRapport(lot.id)} download>Télécharger le rapport d’erreurs (xlsx)</a>}
          {(lot || etat.erreur) && <ChoixFichier variante="lien" libelle="Choisir un autre fichier" accept={ACCEPT} inputRef={input} onFichier={onAutre} />}
        </span>
        <span ref={setPied} className="pied-actions" />
      </div>
    </section>
  )
}

export { ACCEPT }
