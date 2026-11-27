import { useEffect, useId, useRef, useState } from 'react'

export interface FiltreDispo { id: string; nom: string }

/** Filtres de données montrés par défaut : les autres s'ajoutent à la demande. */
export const FILTRES_PAR_DEFAUT = ['departement', 'site']

/** Réglage mémorisé : la liste des filtres affichés. */
export function lireAffiches(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : null
}

/** « Filtre de filtres » : choisit quels filtres de données apparaissent dans la barre. */
export default function ChoixFiltres({ dispo, affiches, onChange }: {
  dispo: FiltreDispo[]
  affiches: string[]
  onChange: (id: string, afficher: boolean) => void
}) {
  const id = useId()
  const racine = useRef<HTMLDivElement>(null)
  const bouton = useRef<HTMLButtonElement>(null)
  const [ouvert, setOuvert] = useState(false)
  const choisis = dispo.filter((d) => affiches.includes(d.id))

  useEffect(() => {
    if (!ouvert) return
    const dehors = (e: MouseEvent) => {
      if (!racine.current?.contains(e.target as Node)) setOuvert(false)
    }
    document.addEventListener('mousedown', dehors)
    return () => document.removeEventListener('mousedown', dehors)
  }, [ouvert])

  const resume = choisis.length === 0 ? 'Aucun' : choisis.length === dispo.length ? 'Tous' : `${choisis.length} sur ${dispo.length}`

  return (
    <div
      className="filtre multi-choix souple"
      ref={racine}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && ouvert) {
          e.stopPropagation()
          setOuvert(false)
          bouton.current?.focus()
        }
      }}
    >
      <span id={`${id}-lib`}>Filtrer par</span>
      <button
        ref={bouton}
        type="button"
        className="multi-bouton"
        aria-haspopup="true"
        aria-expanded={ouvert}
        aria-controls={`${id}-menu`}
        aria-labelledby={`${id}-lib ${id}-val`}
        title={choisis.length ? choisis.map((d) => d.nom).join(', ') : undefined}
        onClick={() => setOuvert(!ouvert)}
      >
        <span id={`${id}-val`}>{resume}</span>
      </button>
      {ouvert && (
        <div id={`${id}-menu`} className="multi-menu" role="group" aria-labelledby={`${id}-lib`}>
          <p className="multi-compte" aria-live="polite">{choisis.length} sur {dispo.length}</p>
          <div className="multi-liste">
            {dispo.map((d) => (
              <label key={d.id}>
                <input type="checkbox" checked={affiches.includes(d.id)} onChange={(e) => onChange(d.id, e.target.checked)} />
                {d.nom}
              </label>
            ))}
          </div>
          <div className="multi-pied filtres-choix-pied">Mémorisé pour votre compte</div>
        </div>
      )}
    </div>
  )
}
