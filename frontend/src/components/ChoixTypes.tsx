import { useEffect, useId, useRef, useState } from 'react'

/** Types d'indicateurs du Budget réalisé : chacun regroupe des cartes et des colonnes du suivi mensuel. */
export const GROUPES = [
  { id: 'activite', nom: 'Activité et productivité', aide: 'CA, marge, CA par salarié' },
  { id: 'masse', nom: 'Masse salariale', aide: 'Masse salariale, commissions, primes de productivité' },
  { id: 'effectif', nom: 'Effectif', aide: 'Effectif global, part des MAD, type de contrat' },
  { id: 'profil', nom: 'Profil des salariés', aide: 'Sexe, âge, ancienneté', neuf: true },
] as const

export type IdGroupe = (typeof GROUPES)[number]['id']

/** Réglage mémorisé : la liste des types masqués (vide : tout est affiché). Les identifiants inconnus sont ignorés. */
export function lireMasques(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) return null
  return GROUPES.map((g) => g.id).filter((id) => v.includes(id))
}

/** Filtre d'affichage « Types d'indicateurs » : liste de cases, tout coché par défaut ; ne touche pas aux données. */
export default function ChoixTypes({ masques, onChange }: { masques: string[]; onChange: (masques: string[]) => void }) {
  const id = useId()
  const racine = useRef<HTMLDivElement>(null)
  const bouton = useRef<HTMLButtonElement>(null)
  const [ouvert, setOuvert] = useState(false)
  const visibles = GROUPES.filter((g) => !masques.includes(g.id))

  useEffect(() => {
    if (!ouvert) return
    const dehors = (e: MouseEvent) => {
      if (!racine.current?.contains(e.target as Node)) setOuvert(false)
    }
    document.addEventListener('mousedown', dehors)
    return () => document.removeEventListener('mousedown', dehors)
  }, [ouvert])

  const resume = masques.length === 0 ? 'Tous' : visibles.length === 0 ? 'Aucun' : visibles.map((g) => g.nom).join(', ')
  const basculer = (cle: string) => onChange(masques.includes(cle) ? masques.filter((x) => x !== cle) : [...masques, cle])

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
      <span id={`${id}-lib`}>Types d’indicateurs</span>
      <button
        ref={bouton}
        type="button"
        className="multi-bouton"
        aria-haspopup="true"
        aria-expanded={ouvert}
        aria-controls={`${id}-menu`}
        aria-labelledby={`${id}-lib ${id}-val`}
        title={masques.length > 0 && visibles.length > 1 ? resume : undefined}
        onClick={() => setOuvert(!ouvert)}
      >
        <span id={`${id}-val`}>{resume}</span>
      </button>
      {ouvert && (
        <div id={`${id}-menu`} className="multi-menu types-menu" role="group" aria-labelledby={`${id}-lib`}>
          <p className="multi-compte" aria-live="polite">{visibles.length} sur {GROUPES.length}</p>
          <div className="multi-liste">
            {GROUPES.map((g) => (
              <label key={g.id}>
                <input type="checkbox" checked={!masques.includes(g.id)} onChange={() => basculer(g.id)} />
                <span className="types-nom">
                  {g.nom}
                  {'neuf' in g && <em className="types-neuf">nouveau</em>}
                  <small>{g.aide}</small>
                </span>
              </label>
            ))}
          </div>
          <div className="multi-pied types-pied">
            <button type="button" className="btn-link" disabled={masques.length === 0} onClick={() => onChange([])}>Tout afficher</button>
            <span>Mémorisé pour votre compte</span>
          </div>
        </div>
      )}
    </div>
  )
}
