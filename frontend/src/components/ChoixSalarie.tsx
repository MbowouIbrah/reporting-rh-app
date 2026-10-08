import { useId, useMemo, useRef, useState } from 'react'

export interface Salarie {
  matricule: string
  nom: string
}

const TOUS = { matricule: '', nom: 'Tous' }
const plier = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
const libelle = (s: Salarie) => (s.matricule ? `${s.nom} (${s.matricule})` : s.nom)

/** Liste déroulante des employés (nom et matricule liés), avec recherche sur l'un ou l'autre. */
export default function ChoixSalarie({
  salaries,
  valeur,
  onChange,
}: {
  salaries: Salarie[]
  /** Matricule choisi ; vide pour « Tous ». */
  valeur: string
  onChange: (matricule: string) => void
}) {
  const id = useId()
  const liste = useRef<HTMLUListElement>(null)
  const [ouvert, setOuvert] = useState(false)
  const [saisie, setSaisie] = useState('')
  const [actif, setActif] = useState(0)

  const choisi = salaries.find((s) => s.matricule === valeur) ?? (valeur ? { matricule: valeur, nom: valeur } : TOUS)
  const options = useMemo(() => {
    const t = plier(saisie.trim())
    const trouves = t ? salaries.filter((s) => plier(s.nom).includes(t) || plier(s.matricule).includes(t)) : salaries
    return t ? trouves : [TOUS, ...trouves]
  }, [salaries, saisie])

  const ouvrir = () => {
    if (ouvert) return
    setSaisie('')
    setActif(Math.max(0, salaries.findIndex((s) => s.matricule === valeur) + 1))
    setOuvert(true)
  }
  const fermer = () => {
    setOuvert(false)
    setSaisie('')
  }
  const choisir = (s: Salarie) => {
    fermer()
    if (s.matricule !== valeur) onChange(s.matricule)
  }
  const deplacer = (i: number) => {
    const n = Math.min(Math.max(i, 0), options.length - 1)
    setActif(n)
    liste.current?.children[n]?.scrollIntoView({ block: 'nearest' })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!ouvert) return ouvrir()
      deplacer(actif + (e.key === 'ArrowDown' ? 1 : -1))
    } else if (e.key === 'Enter' && ouvert) {
      e.preventDefault()
      if (options[actif]) choisir(options[actif])
    } else if (e.key === 'Escape' && ouvert) {
      e.preventDefault()
      fermer()
    }
  }

  return (
    <div className="choix-salarie">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-label="Employé"
        aria-autocomplete="list"
        aria-expanded={ouvert}
        aria-controls={`${id}-liste`}
        aria-activedescendant={ouvert && options[actif] ? `${id}-${actif}` : undefined}
        placeholder={ouvert ? 'Nom ou matricule' : undefined}
        autoComplete="off"
        maxLength={100}
        value={ouvert ? saisie : libelle(choisi)}
        onFocus={ouvrir}
        onClick={ouvrir}
        onBlur={fermer}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          setSaisie(e.target.value)
          setActif(0)
          setOuvert(true)
        }}
      />
      {ouvert && (
        <ul id={`${id}-liste`} role="listbox" aria-label="Employés" ref={liste}>
          {options.length === 0 && <li className="choix-vide">Aucun employé</li>}
          {options.map((s, i) => (
            <li
              key={s.matricule || '*'}
              id={`${id}-${i}`}
              role="option"
              aria-selected={s.matricule === valeur}
              className={i === actif ? 'actif' : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActif(i)}
              onClick={() => choisir(s)}
            >
              <span>{s.nom}</span>
              {s.matricule && <span className="choix-mat">{s.matricule}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
