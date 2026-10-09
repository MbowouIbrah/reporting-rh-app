const PARCOURS = {
  grille: ['Choix du mois', 'Employés concernés', 'Saisie des montants', 'Vérification et enregistrement'],
  fichier: ['Choix du fichier', 'Vérification et enregistrement'],
  budgets: ['Choix du mois', 'Saisie des budgets', 'Vérification et enregistrement'],
}

/** Fil d'étapes : où l'on est, ce qui est fait, ce qui reste. */
export default function Etapes({ parcours, actuelle }: { parcours: keyof typeof PARCOURS; actuelle: number }) {
  return (
    <ol className="saisie-etapes" aria-label="Étapes">
      {PARCOURS[parcours].map((libelle, i) => (
        <li key={libelle} className={i < actuelle ? 'faite' : i === actuelle ? 'active' : undefined} aria-current={i === actuelle ? 'step' : undefined}>
          <span className="saisie-etape-num" aria-hidden="true">{i < actuelle ? '✓' : i + 1}</span>
          {libelle}
        </li>
      ))}
    </ol>
  )
}
