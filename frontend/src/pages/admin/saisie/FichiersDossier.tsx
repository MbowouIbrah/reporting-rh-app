import { useState } from 'react'
import { ApiError } from '../../../api/client'
import { analyserFichierDossier, useFichiersDossier, type EtatFichier, type FichierDossier } from '../../../api/saisie'
import { Badge, Bouton } from '../../../components/Kit'
import { MOIS } from '../../../lib/format'

const ETATS: Record<EtatFichier, { libelle: string; ton: 'neutre' | 'succes' | 'alerte' | 'erreur' | 'info' }> = {
  a_traiter: { libelle: 'À analyser', ton: 'info' },
  en_verification: { libelle: 'En vérification', ton: 'alerte' },
  importe: { libelle: 'Importé', ton: 'succes' },
  annule: { libelle: 'Annulé', ton: 'neutre' },
  mois_introuvable: { libelle: 'Mois à choisir', ton: 'erreur' },
  trop_volumineux: { libelle: 'Trop volumineux (20 Mo maximum)', ton: 'erreur' },
}

const recu = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

interface Props {
  /** Ouvre le lot d'un fichier du dossier, comme après l'envoi d'un fichier. */
  onOuvrir: (nom: string, lotId: number) => void
}

/** Fichiers de paie déposés dans le dossier surveillé : état de chacun, analyse à la demande. */
export default function FichiersDossier({ onOuvrir }: Props) {
  const q = useFichiersDossier()
  const [enCours, setEnCours] = useState<string>()
  const [erreur, setErreur] = useState<string>()

  const analyser = async (nom: string, periode?: { annee: number; mois: number }) => {
    setEnCours(nom)
    setErreur(undefined)
    try {
      const lot = await analyserFichierDossier(nom, periode)
      onOuvrir(nom, lot.id)
    } catch (e) {
      setErreur(e instanceof ApiError && e.status === 409 && e.info?.lot_id ? 'Ce fichier a déjà été importé et enregistré.' : e instanceof Error ? e.message : 'Analyse impossible.')
      void q.refetch()
    } finally {
      setEnCours(undefined)
    }
  }

  const fichiers = q.data?.fichiers ?? []
  return (
    <section className="dossier-paie" aria-label="Fichiers du dossier de paie">
      <div className="dossier-paie-entete">
        <h3 className="saisie-sous-bandeau">FICHIERS DU DOSSIER DE PAIE</h3>
        <Bouton variante="lien" onClick={() => void q.refetch()} disabled={q.isFetching}>Actualiser</Bouton>
      </div>
      {erreur && <p className="bandeau ko" role="alert">{erreur}</p>}
      {q.isLoading ? (
        <p className="note">Chargement…</p>
      ) : q.isError ? (
        <p className="note">La liste du dossier de paie n’a pas pu être lue. Utilisez l’envoi manuel ou actualisez.</p>
      ) : !q.data?.actif ? (
        <p className="note">Dossier de paie non configuré (IMPORT_DIR) : utiliser l’envoi manuel.</p>
      ) : fichiers.length === 0 ? (
        <p className="note">Aucun fichier dans le dossier.</p>
      ) : (
        <table className="dense">
          <thead>
            <tr><th className="libelle">Nom</th><th className="libelle">Mois</th><th className="libelle">Reçu le</th><th className="libelle">État</th><th className="libelle">Action</th></tr>
          </thead>
          <tbody>
            {fichiers.map((f) => (
              <Ligne key={f.nom} f={f} occupe={enCours !== undefined} analyse={enCours === f.nom} onVoir={() => f.lot_id && onOuvrir(f.nom, f.lot_id)} onAnalyser={(p) => void analyser(f.nom, p)} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function Ligne({ f, occupe, analyse, onVoir, onAnalyser }: {
  f: FichierDossier
  occupe: boolean
  analyse: boolean
  onVoir: () => void
  onAnalyser: (periode?: { annee: number; mois: number }) => void
}) {
  const [choix, setChoix] = useState({ annee: String(new Date().getFullYear()), mois: '' })
  const etat = ETATS[f.etat]
  return (
    <tr>
      <td>{f.nom}</td>
      <td>{f.mois && f.annee ? `${MOIS[f.mois - 1]} ${f.annee}` : '—'}</td>
      <td>{recu(f.modifie_le)}</td>
      <td><Badge ton={etat.ton}>{etat.libelle}</Badge></td>
      <td>
        {f.etat === 'en_verification' && f.lot_id !== null && (
          <Bouton variante="secondaire" onClick={onVoir} aria-label={`Voir ${f.nom}`}>Voir</Bouton>
        )}
        {(f.etat === 'a_traiter' || f.etat === 'annule') && (
          <Bouton variante="secondaire" disabled={occupe} onClick={() => onAnalyser()} aria-label={`Analyser maintenant ${f.nom}`}>
            {analyse ? 'Analyse…' : 'Analyser maintenant'}
          </Bouton>
        )}
        {f.etat === 'mois_introuvable' && (
          <form className="dossier-paie-mois" aria-label={`Choix du mois de ${f.nom}`} onSubmit={(e) => {
            e.preventDefault()
            onAnalyser({ annee: Number(choix.annee), mois: Number(choix.mois) })
          }}>
            <select aria-label={`Mois de ${f.nom}`} value={choix.mois} onChange={(e) => setChoix({ ...choix, mois: e.target.value })}>
              <option value="" disabled>Mois…</option>
              {MOIS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <input type="number" aria-label={`Année de ${f.nom}`} min={2000} max={2100} value={choix.annee} onChange={(e) => setChoix({ ...choix, annee: e.target.value })} />
            <button type="submit" className="bouton bouton-secondaire" disabled={occupe || !choix.mois || !choix.annee}>{analyse ? 'Analyse…' : 'Analyser'}</button>
          </form>
        )}
      </td>
    </tr>
  )
}
