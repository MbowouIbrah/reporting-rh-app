import { useEffect, useRef } from 'react'
import type { ChoixGraphes as Choix } from '../lib/choixGraphes'

/** Menu « Graphiques (n/N) » : une case par graphique disponible, et « Tout afficher ». */
export default function ChoixGraphes({ graphes, choix }: { graphes: { id: string; titre: string }[]; choix: Choix }) {
  const n = graphes.filter((g) => choix.visible(g.id)).length
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    // fermeture par Échap (retour sur le bouton) ou par un clic à côté du menu
    const fermer = (e: KeyboardEvent | MouseEvent) => {
      const d = ref.current
      if (!d?.open) return
      if (e instanceof KeyboardEvent) {
        if (e.key !== 'Escape') return
        d.open = false
        d.querySelector('summary')?.focus()
      } else if (!d.contains(e.target as Node)) d.open = false
    }
    document.addEventListener('keydown', fermer)
    document.addEventListener('mousedown', fermer)
    return () => {
      document.removeEventListener('keydown', fermer)
      document.removeEventListener('mousedown', fermer)
    }
  }, [])
  return (
    <details className="choix-graphes" ref={ref}>
      <summary>{`Graphiques (${n}/${graphes.length})`}</summary>
      <div className="choix-graphes-corps" role="group" aria-label="Graphiques affichés">
        <ul>
          {graphes.map((g) => (
            <li key={g.id}>
              <label>
                <input type="checkbox" checked={choix.visible(g.id)} onChange={() => choix.basculer(g.id)} />
                {g.titre}
              </label>
            </li>
          ))}
        </ul>
        <button type="button" className="bouton bouton-secondaire" onClick={choix.toutAfficher} disabled={n === graphes.length}>
          Tout afficher
        </button>
      </div>
    </details>
  )
}
