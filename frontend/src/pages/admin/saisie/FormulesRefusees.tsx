import type { ReactNode } from 'react'
import type { AnomalieLot } from '../../../api/saisie'

/** Codes contrôlés avant tout : le fichier est refusé et ne se corrige pas ici. */
export const CODES_FORMULE = ['FORMULE_SANS_VALEUR', 'ERREUR_EXCEL', 'LIAISON_ERREUR']

const OPTIONS: { titre: string; etapes: ReactNode[] }[] = [
  { titre: 'Le fichier source est disponible', etapes: [
    'Ouvrez le fichier dans Excel, le fichier source étant accessible.',
    <>Cliquez sur <strong>« Mettre à jour les liaisons »</strong> (ou Données › Modifier les liens › Mettre à jour les valeurs).</>,
    <>Enregistrez le fichier (<kbd>Ctrl+S</kbd>).</>,
    'Importez-le de nouveau ici.',
  ] },
  { titre: 'Le fichier source n’est plus disponible', etapes: [
    <>Fichier › <strong>Enregistrer sous</strong> : créez une copie du fichier.</>,
    <>Dans la copie, sélectionnez les colonnes concernées puis copiez-les (<kbd>Ctrl+C</kbd>).</>,
    <><strong>Collage spécial › Valeurs</strong> au même endroit (<kbd>Ctrl+Alt+V</kbd> puis <kbd>V</kbd>). LibreOffice : <kbd>Ctrl+Maj+V</kbd> › Valeurs seulement. Google Sheets : <kbd>Ctrl+Maj+V</kbd>.</>,
    'Saisissez les valeurs encore manquantes, enregistrez, puis importez cette copie.',
  ] },
]

/** Cellules à formule : où elles sont, ce qu'elles contiennent, puis la marche à suivre dans Excel. */
export function CellulesFormules({ anomalies, libelle, consigne }: { anomalies: AnomalieLot[]; libelle: string; consigne: string }) {
  return (
    <div className="formules-refusees">
      <table className="dense" aria-label={libelle}>
        <thead><tr><th>Ligne</th><th>Colonne</th><th>Formule ou contenu</th><th>Problème</th></tr></thead>
        <tbody>
          {anomalies.map((a, i) => (
            <tr key={i}><td>{a.ligne}</td><td>{a.colonne}</td><td className="formule">{a.valeur}</td><td>{a.message}</td></tr>
          ))}
        </tbody>
      </table>
      <h3>{consigne}</h3>
      <div className="marche-options">
        {OPTIONS.map((o, k) => (
          <section key={o.titre} aria-label={o.titre}>
            <h4>Cas {k + 1} : {o.titre}</h4>
            <ol className="marche">
              {o.etapes.map((e, i) => <li key={i}><span className="saisie-etape-num" aria-hidden="true">{i + 1}</span><span>{e}</span></li>)}
            </ol>
          </section>
        ))}
      </div>
    </div>
  )
}

/** Fichier refusé : formules sans valeur utilisable. */
export default function FormulesRefusees({ anomalies }: { anomalies: AnomalieLot[] }) {
  return <CellulesFormules anomalies={anomalies.filter((a) => CODES_FORMULE.includes(a.code))}
    libelle="Formules sans valeur utilisable" consigne="Comment corriger le fichier" />
}
