import { useEffect, useId, useRef, useState } from 'react'
import { valeurs } from '../hooks/useFiltres'

const plier = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

/** Filtre à sélection multiple (R4) : cases à cocher, recherche dans les longues listes.
 *  Valeur : choix séparés par « | » ; vide : tous. */
export default function MultiChoix({ libelle, pluriel, tous = 'Tous', options, valeur, onChange, nomOption = (v) => v, souple = true }: {
  libelle: string
  /** Résumé au-delà de deux choix : « 3 sites ». */
  pluriel: string
  tous?: string
  options: string[]
  valeur: string
  onChange: (v: string) => void
  nomOption?: (v: string) => string
  souple?: boolean
}) {
  const id = useId()
  const racine = useRef<HTMLDivElement>(null)
  const bouton = useRef<HTMLButtonElement>(null)
  const [ouvert, setOuvert] = useState(false)
  const [saisie, setSaisie] = useState('')
  const choisis = valeurs(valeur)

  useEffect(() => {
    if (!ouvert) return
    const dehors = (e: MouseEvent) => {
      if (!racine.current?.contains(e.target as Node)) setOuvert(false)
    }
    document.addEventListener('mousedown', dehors)
    return () => document.removeEventListener('mousedown', dehors)
  }, [ouvert])

  const resume = choisis.length === 0 ? tous
    : choisis.length <= 2 ? choisis.map(nomOption).join(', ')
    : `${choisis.length} ${pluriel}`
  const t = plier(saisie.trim())
  const visibles = t ? options.filter((o) => plier(nomOption(o)).includes(t)) : options
  const basculer = (o: string) => {
    const s = new Set(choisis)
    if (s.has(o)) s.delete(o)
    else s.add(o)
    // ordre des options, pour une valeur stable (partage, lien)
    onChange(options.filter((x) => s.has(x)).concat(choisis.filter((x) => s.has(x) && !options.includes(x))).join('|'))
  }

  return (
    <div
      className={`filtre multi-choix${souple ? ' souple' : ''}`}
      ref={racine}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && ouvert) {
          e.stopPropagation()
          setOuvert(false)
          bouton.current?.focus()
        }
      }}
    >
      <span id={`${id}-lib`}>{libelle}</span>
      <button
        ref={bouton}
        type="button"
        className="multi-bouton"
        aria-haspopup="true"
        aria-expanded={ouvert}
        aria-controls={`${id}-menu`}
        aria-labelledby={`${id}-lib ${id}-val`}
        title={choisis.length > 2 ? choisis.map(nomOption).join(', ') : undefined}
        onClick={() => {
          setSaisie('')
          setOuvert(!ouvert)
        }}
      >
        <span id={`${id}-val`}>{resume}</span>
      </button>
      {ouvert && (
        <div id={`${id}-menu`} className="multi-menu" role="group" aria-labelledby={`${id}-lib`}>
          {options.length > 8 && (
            <input
              type="search"
              placeholder="Rechercher…"
              aria-label={`Rechercher dans ${libelle}`}
              value={saisie}
              maxLength={100}
              autoFocus
              onChange={(e) => setSaisie(e.target.value)}
            />
          )}
          <div className="multi-actions">
            <span>{choisis.length ? `${choisis.length} sur ${options.length}` : tous}</span>
            <button type="button" className="bouton-lien" disabled={!choisis.length} onClick={() => onChange('')}>
              Tout effacer
            </button>
          </div>
          <div className="multi-liste">
            {visibles.length === 0 && <p className="choix-vide">Aucun résultat</p>}
            {visibles.map((o) => (
              <label key={o}>
                <input type="checkbox" checked={choisis.includes(o)} onChange={() => basculer(o)} />
                {nomOption(o)}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
