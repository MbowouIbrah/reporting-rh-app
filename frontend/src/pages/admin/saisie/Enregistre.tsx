import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { apresImport } from '../../../api/pilotage'
import { annulerLot } from '../../../api/saisie'
import { Confirmer } from '../../../components/Kit'

/** Transmis par le parcours de saisie à la feuille DONNEES (état de navigation). */
export interface Enregistrement {
  lot: number
  fichier: string
  lignes: number
}

/**
 * Retour sur la feuille DONNEES après un enregistrement : confirmation, et possibilité de l'annuler.
 * L'état de navigation est lu une fois puis effacé, pour ne pas réafficher le bandeau au rechargement.
 */
export default function BandeauEnregistre() {
  const qc = useQueryClient()
  const loc = useLocation()
  const navigate = useNavigate()
  const [enr, setEnr] = useState(() => (loc.state as { enregistrement?: Enregistrement } | null)?.enregistrement ?? null)
  const [etat, setEtat] = useState<'ferme' | 'ouvert' | 'cours' | 'fait'>('ferme')

  useEffect(() => {
    if (loc.state) navigate({ pathname: loc.pathname, search: loc.search }, { replace: true, state: null })
  }, [loc, navigate])

  if (!enr) return null

  const annuler = async () => {
    setEtat('cours')
    try {
      await annulerLot(enr.lot)
      apresImport(qc)
      setEtat('fait')
    } catch {
      setEtat('ouvert')
    }
  }

  return (
    <>
      <p className={`bandeau ${etat === 'fait' ? 'ko' : 'ok'} bandeau-enregistre`} role="status">
        <span>
          {etat === 'fait'
            ? 'Enregistrement annulé : les données ont retrouvé leur état précédent.'
            : `Enregistré : ${enr.lignes} ligne${enr.lignes > 1 ? 's' : ''} (${enr.fichier}).`}
        </span>
        {etat !== 'fait' && (
          <button type="button" className="bouton bouton-lien" onClick={() => setEtat('ouvert')}>Annuler cet enregistrement</button>
        )}
        <button type="button" className="bandeau-fermer" aria-label="Fermer le message" onClick={() => setEnr(null)}>×</button>
      </p>
      <Confirmer
        ouvert={etat === 'ouvert' || etat === 'cours'}
        titre="Annuler cet enregistrement ?"
        confirmer="Annuler l’enregistrement"
        desactive={etat === 'cours'}
        onConfirmer={annuler}
        onAnnuler={() => setEtat('ferme')}
      >
        <p>Les lignes enregistrées seront retirées et les valeurs remplacées restaurées.</p>
      </Confirmer>
    </>
  )
}
