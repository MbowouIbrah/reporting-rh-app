import type { Colonne } from '../hooks/useOrdreColonnes'
import { Confirmer } from './Kit'

/** Confirmation d'un changement de zone (entrée ou sortie du TOTAL), puis erreur d'enregistrement éventuelle. */
export default function ConfirmerColonne({ attente, erreur, confirmer, annuler }: {
  attente: Colonne | null
  erreur: string | null
  confirmer: () => void
  annuler: () => void
}) {
  return (
    <>
      <Confirmer
        ouvert={attente !== null}
        titre={attente?.exclu ? `Sortir « ${attente.colonne} » du TOTAL ?` : `Remettre « ${attente?.colonne ?? ''} » dans le TOTAL ?`}
        confirmer={attente?.exclu ? 'Sortir du TOTAL' : 'Remettre dans le TOTAL'}
        onConfirmer={confirmer}
        onAnnuler={annuler}
      >
        <p>Les totaux de tout l’historique seront recalculés, pour tous les utilisateurs.</p>
      </Confirmer>
      {erreur && <p className="bandeau ko" role="alert">{erreur}</p>}
    </>
  )
}
