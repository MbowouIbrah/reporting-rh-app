/** Remet les filtres de la barre à leur valeur par défaut ; toujours présent, inactif quand rien n'est filtré. */
export default function BoutonReinitialiser({ actif, onClick, libelle = 'Réinitialiser les filtres' }: {
  actif: boolean
  onClick: () => void
  /** Ce que le bouton remet à zéro, dit en toutes lettres. */
  libelle?: string
}) {
  return (
    <button type="button" className="bouton bouton-secondaire reinitialiser" disabled={!actif} onClick={onClick}>
      {libelle}
    </button>
  )
}
