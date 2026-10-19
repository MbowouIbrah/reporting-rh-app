import type { AnomalieLot } from '../../../api/saisie'

/** Codes contrôlés avant tout : le fichier est refusé et ne se corrige pas ici. */
export const CODES_FORMULE = ['FORMULE_SANS_VALEUR', 'ERREUR_EXCEL', 'LIAISON_ERREUR']

/** Formules sans valeur utilisable : où elles sont, et comment corriger le fichier dans Excel. */
export default function FormulesRefusees({ anomalies }: { anomalies: AnomalieLot[] }) {
  const formules = anomalies.filter((a) => CODES_FORMULE.includes(a.code))
  return (
    <div className="formules-refusees">
      <table className="dense" aria-label="Formules sans valeur utilisable">
        <thead><tr><th>Ligne</th><th>Colonne</th><th>Formule ou contenu</th><th>Problème</th></tr></thead>
        <tbody>
          {formules.map((a, i) => (
            <tr key={i}><td>{a.ligne}</td><td>{a.colonne}</td><td className="formule">{a.valeur}</td><td>{a.message}</td></tr>
          ))}
        </tbody>
      </table>
      <h3>Comment corriger le fichier</h3>
      <ol>
        <li>Ouvrez le fichier dans Excel avec le fichier source disponible, acceptez « Mettre à jour les liaisons », enregistrez, puis importez-le de nouveau.</li>
        <li>Si le fichier source n’est plus disponible : « Enregistrer sous » une copie, sélectionnez les colonnes concernées, Copier, puis Collage spécial › Valeurs (LibreOffice : Valeurs seulement ; Google Sheets : Ctrl+Maj+V). Importez cette copie.</li>
      </ol>
    </div>
  )
}
