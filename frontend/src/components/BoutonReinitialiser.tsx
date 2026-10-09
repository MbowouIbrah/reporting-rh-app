/** Remet les filtres de la barre à leur valeur par défaut ; toujours présent, inactif quand rien n'est filtré. */
export default function BoutonReinitialiser({ actif, onClick }: { actif: boolean; onClick: () => void }) {
  return (
    <button type="button" className="bouton bouton-secondaire reinitialiser" disabled={!actif} onClick={onClick}>
      Réinitialiser
    </button>
  )
}
