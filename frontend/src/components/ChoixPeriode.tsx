import { ChevronDown } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { MOIS } from '../lib/format'

export interface OptionPeriode {
  /** Valeur renvoyée au choix ; vide pour l'option par défaut (mois d'avant). */
  valeur: string
  annee: number
  mois: number
}

/** Liste déroulante mois + année en un seul filtre : mois à gauche, année plus légère à droite, ordre chronologique. */
export default function ChoixPeriode({ libelle, options, valeur, onChange }: {
  libelle: string
  options: OptionPeriode[]
  valeur: string
  onChange: (valeur: string) => void
}) {
  const id = useId()
  const liste = useRef<HTMLUListElement>(null)
  const [ouvert, setOuvert] = useState(false)
  const [actif, setActif] = useState(0)
  const indexChoisi = Math.max(0, options.findIndex((o) => o.valeur === valeur))
  const choisi = options[indexChoisi]

  const deplacer = (i: number) => {
    const n = Math.min(Math.max(i, 0), options.length - 1)
    setActif(n)
    liste.current?.children[n]?.scrollIntoView({ block: 'nearest' })
  }
  const ouvrir = () => {
    setActif(indexChoisi)
    setOuvert(true)
    requestAnimationFrame(() => liste.current?.children[indexChoisi]?.scrollIntoView({ block: 'center' }))
  }
  const choisir = (o: OptionPeriode) => {
    setOuvert(false)
    if (o.valeur !== valeur) onChange(o.valeur)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!ouvert) return ouvrir()
      deplacer(actif + (e.key === 'ArrowDown' ? 1 : -1))
    } else if ((e.key === 'Enter' || e.key === ' ') && ouvert) {
      e.preventDefault()
      if (options[actif]) choisir(options[actif])
    } else if (e.key === 'Escape' && ouvert) {
      e.preventDefault()
      setOuvert(false)
    }
  }

  return (
    <div className="filtre choix-periode">
      <span id={`${id}-libelle`}>{libelle}</span>
      <button
        type="button"
        role="combobox"
        aria-labelledby={`${id}-libelle`}
        aria-haspopup="listbox"
        aria-expanded={ouvert}
        aria-controls={`${id}-liste`}
        aria-activedescendant={ouvert ? `${id}-${actif}` : undefined}
        onClick={() => (ouvert ? setOuvert(false) : ouvrir())}
        onBlur={() => setOuvert(false)}
        onKeyDown={onKeyDown}
      >
        {choisi && (
          <>
            <span className="periode-mois">{MOIS[choisi.mois - 1]}</span>
            <span className="periode-annee">{choisi.annee}</span>
          </>
        )}
        <ChevronDown aria-hidden="true" size={14} />
      </button>
      {ouvert && (
        <ul id={`${id}-liste`} role="listbox" aria-labelledby={`${id}-libelle`} ref={liste}>
          {options.map((o, i) => (
            <li
              key={o.valeur || '*'}
              id={`${id}-${i}`}
              role="option"
              aria-selected={o.valeur === valeur}
              className={i === actif ? 'actif' : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActif(i)}
              onClick={() => choisir(o)}
            >
              <span className="periode-mois">{MOIS[o.mois - 1]}</span>
              <span className="periode-annee">{o.annee}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
