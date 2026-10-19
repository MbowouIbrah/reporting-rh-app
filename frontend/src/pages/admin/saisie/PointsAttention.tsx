import type { AnomalieLot } from '../../../api/saisie'
import Volet from './Volet'

interface Groupe {
  titre: string
  aide: string
  codes: string[]
}

const GROUPES: Groupe[] = [
  { titre: 'Noms à vérifier', aide: 'Nom qui ne correspond pas au matricule, ou qui ressemble à un employé déjà connu : faute de frappe probable.',
    codes: ['NOM_PROCHE', 'NOM_INCOHERENT', 'NOM_SIMILAIRE'] },
  { titre: 'Changements d’affectation', aide: 'Service, site, contrat ou activité différents selon les mois : mutation ou erreur de saisie ?',
    codes: ['MUTATION'] },
  { titre: 'Valeurs corrigées automatiquement', aide: 'Espaces, casse, nombres saisis en texte, arrondis : rien à faire, à relire si besoin.',
    codes: ['NORMALISE', 'TEXTE_CONVERTI', 'PRECISION_TRONQUEE', 'MATRICULE_NUMERIQUE'] },
  { titre: 'Montants et référentiels', aide: 'Montants négatifs, postes nouveaux…',
    codes: ['MONTANT_NEGATIF', 'POSTE_NOUVEAU'] },
]

const AUTRES: Groupe = { titre: 'Autres points', aide: '', codes: [] }

export function repartir(anomalies: AnomalieLot[]) {
  const connus = new Set(GROUPES.flatMap((g) => g.codes))
  const sortie = GROUPES.map((g) => ({ ...g, lignes: anomalies.filter((a) => g.codes.includes(a.code)) }))
  sortie.push({ ...AUTRES, lignes: anomalies.filter((a) => !connus.has(a.code)) })
  return sortie.filter((g) => g.lignes.length > 0)
}

interface Props {
  anomalies: AnomalieLot[]
  /** Numéro de ligne du fichier : sans objet pour une saisie en grille. */
  afficherLigne: boolean
  /** Volet ouvert, partagé avec le reste de l'aperçu : un seul à la fois. */
  ouvert: string | null
  onOuvrir: (id: string) => void
}

/** Identifiant du volet des erreurs bloquantes, pour l'ouvrir d'office. */
export const VOLET_ERREURS = 'erreurs'

/** Erreurs puis avertissements, regroupés par nature avec une phrase d'explication. */
export default function PointsAttention({ anomalies, afficherLigne, ouvert, onOuvrir }: Props) {
  const erreurs = anomalies.filter((a) => a.gravite === 'bloquant')
  const groupes = repartir(anomalies.filter((a) => a.gravite !== 'bloquant'))
  return (
    <>
      {erreurs.length > 0 && (
        <Volet titre="Erreurs à corriger" valeur={erreurs.length} ton="ko"
          resume="bloquant : à corriger avant d’enregistrer" ouvert={ouvert === VOLET_ERREURS} onOuvrir={() => onOuvrir(VOLET_ERREURS)}>
          <Tableau lignes={erreurs} afficherLigne={afficherLigne} valeur />
        </Volet>
      )}
      {groupes.map((g) => (
        <Volet key={g.titre} titre={g.titre} valeur={g.lignes.length} resume={g.aide}
          ouvert={ouvert === g.titre} onOuvrir={() => onOuvrir(g.titre)}>
          <Tableau lignes={g.lignes} afficherLigne={afficherLigne} />
        </Volet>
      ))}
    </>
  )
}

function Tableau({ lignes, afficherLigne, valeur }: { lignes: AnomalieLot[]; afficherLigne: boolean; valeur?: boolean }) {
  return (
    <table className="dense">
      <thead>
        <tr>
          {afficherLigne && <th scope="col" className="num">Ligne</th>}
          <th scope="col">Colonne</th>
          {valeur && <th scope="col">Valeur</th>}
          <th scope="col">Détail</th>
        </tr>
      </thead>
      <tbody>
        {lignes.map((a, i) => (
          <tr key={i}>
            {afficherLigne && <td className="num">{a.ligne ?? ''}</td>}
            <td>{a.colonne}</td>
            {valeur && <td>{a.valeur}</td>}
            <td>{a.message}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
