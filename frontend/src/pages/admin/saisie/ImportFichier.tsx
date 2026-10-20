import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, queryRetry } from '../../../api/client'
import { envoyerFichier, lireAnomalies, urlRapport, type Lot } from '../../../api/saisie'
import Etat from '../../../components/Etat'
import { Bouton, ChoixFichier } from '../../../components/Kit'
import BarreParcours from './BarreParcours'
import Etapes from './Etapes'
import FormulesRefusees, { CODES_FORMULE } from './FormulesRefusees'
import PointsAttention, { aConfirmer, repartir, VOLET_ERREURS } from './PointsAttention'

const ACCEPT = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

interface Props {
  fichier: File
  onLot: (lot: Lot) => void
  onAutre: (f: File | undefined) => void
  onRetour: () => void
}

/** Analyse d'un fichier : prêt -> aperçu ; refusé -> erreurs à corriger dans Excel, rapport téléchargeable. */
export default function ImportFichier({ fichier, onLot, onAutre, onRetour }: Props) {
  const [etat, setEtat] = useState<{ lot?: Lot; erreur?: string; modifications?: number }>({})
  // Choix fait pour ce fichier-là seulement : un autre fichier repose la question.
  const [reprise, setReprise] = useState<{ fichier: File; choix: 'reprendre' | 'recommencer' }>()
  const choix = reprise?.fichier === fichier ? reprise.choix : undefined
  const [volet, setVolet] = useState<string>(VOLET_ERREURS)
  const [pied, setPied] = useState<HTMLElement | null>(null)
  const input = useRef<HTMLInputElement>(null)

  // Lot prêt : on n'avance que si aucun point « à confirmer » n'attend de solution.
  const avancer = useCallback(async (l: Lot, actif: () => boolean = () => true) => {
    if (l.statut !== 'pret') return setEtat({ lot: l })
    const anos = await lireAnomalies(l.id)
    if (!actif()) return
    if (!anos.some(aConfirmer)) return onLot(l)
    setVolet((v) => repartir(anos).find((g) => g.lignes.some(aConfirmer))?.id ?? v)
    setEtat({ lot: l })
  }, [onLot])

  useEffect(() => {
    let actif = true
    setEtat({})
    envoyerFichier(fichier, choix)
      .then((lot) => (actif ? avancer(lot, () => actif) : undefined))
      .catch((e) => {
        if (!actif) return
        const deja = e instanceof ApiError && e.status === 409
        if (deja && e.info?.reprise) return setEtat({ modifications: Number(e.info.modifications) })
        setEtat({ erreur: deja ? 'Ce fichier a déjà été importé et enregistré.' : e instanceof Error ? e.message : 'Fichier illisible.' })
      })
    return () => { actif = false }
  }, [fichier, choix, avancer])

  const lot = etat.lot
  const anomalies = useQuery({
    queryKey: ['saisie', 'anomalies', lot?.id],
    queryFn: () => lireAnomalies(lot!.id),
    enabled: !!lot,
    retry: queryRetry,
  })
  const formules = !!anomalies.data?.some((a) => CODES_FORMULE.includes(a.code))
  const pret = lot?.statut === 'pret'
  const nbConfirmer = anomalies.data?.filter(aConfirmer).length ?? 0

  return (
    <section className="page-ecran rapport-excel saisie-apercu">
      <BarreParcours libelle="Renseigner des données" onRetour={onRetour}>
        <Etapes parcours="fichier" actuelle={0} />
      </BarreParcours>
      <h2 className="bandeau-titre">{pret ? 'POINTS À CONFIRMER' : lot || etat.erreur ? 'FICHIER REFUSÉ' : 'ANALYSE DU FICHIER'} — {fichier.name}</h2>
      {etat.modifications !== undefined && (
        <p className="bandeau ko" role="status">
          <span>
            Ce fichier est déjà en cours de vérification, avec {etat.modifications} modification{etat.modifications > 1 ? 's' : ''} enregistrée{etat.modifications > 1 ? 's' : ''}.
          </span>
          <Bouton variante="secondaire" onClick={() => setReprise({ fichier, choix: 'reprendre' })}>Reprendre la vérification</Bouton>
          <button type="button" className="bouton bouton-lien" onClick={() => setReprise({ fichier, choix: 'recommencer' })}>Tout annuler et recommencer</button>
        </p>
      )}
      {!lot && !etat.erreur && etat.modifications === undefined && <Etat type="chargement" />}
      {(lot || etat.erreur) && (
        <p className="bandeau ko" role="alert">
          {etat.erreur ?? (pret ? `${nbConfirmer} point${nbConfirmer > 1 ? 's' : ''} à confirmer avant de continuer : choisissez une solution pour chacun, puis Enregistrer. Rien n’est enregistré pour l’instant.` : formules ? 'Fichier refusé : des formules n’ont pas de valeur utilisable. Corrigez le fichier dans Excel, puis importez-le de nouveau. Rien n’est enregistré.' : `Fichier refusé : ${lot!.nb_bloquants} erreur${lot!.nb_bloquants > 1 ? 's' : ''} à corriger. Cliquez une ligne, puis la cellule en rouge pour la corriger ici, ou corrigez le fichier Excel et importez-le de nouveau. Rien n’est enregistré pour l’instant.`)}
        </p>
      )}
      {lot && formules && <FormulesRefusees anomalies={anomalies.data!} />}
      {lot && !formules && (
        <div className="panneau">
          <div className="panneau-corps volets" role="region" aria-label="Erreurs du fichier">
            {anomalies.data && <PointsAttention anomalies={anomalies.data} lotId={lot?.id} onLot={(l) => void avancer(l).catch((e) => setEtat({ erreur: e instanceof Error ? e.message : 'Erreur.' }))} afficherLigne ouvert={volet} onOuvrir={setVolet} pied={pied} />}
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
