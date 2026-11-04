import { Check } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { descGroupe, type Groupe, VUE_TOUT } from '../lib/groupesGraphes'

/** Menu « Groupe : … » : un groupe de graphiques à la fois, ou tous les groupes. */
export default function MenuGroupes({ groupes, vue, defaut, onVue, onPersonnaliser }: {
  groupes: Groupe[]
  vue: string
  defaut: string
  onVue: (vue: string) => void
  onPersonnaliser: () => void
}) {
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
  const courant = groupes.find((g) => g.id === vue)
  const choisir = (action: () => void) => () => {
    if (ref.current) ref.current.open = false
    action()
  }
  return (
    <details className="menu-groupes" ref={ref}>
      <summary>{courant ? `Groupe : ${courant.nom}` : 'Tous les groupes'}</summary>
      <div className="menu-groupes-corps" role="group" aria-label="Groupes de graphiques">
        <ul>
          {groupes.map((g) => {
            const actif = g.id === vue
            return (
              <li key={g.id}>
                <button type="button" className="menu-groupes-ligne" aria-current={actif ? 'true' : undefined} onClick={choisir(() => onVue(g.id))}>
                  <span className="menu-groupes-coche" aria-hidden="true">{actif && <Check size={14} />}</span>
                  <span className="menu-groupes-texte">
                    <strong>{g.nom}</strong>
                    {g.id === defaut && <em className="menu-groupes-defaut"> par défaut</em>}
                    <small>{descGroupe(g)}</small>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <hr />
        <button
          type="button"
          className="menu-groupes-ligne"
          aria-current={vue === VUE_TOUT ? 'true' : undefined}
          onClick={choisir(() => onVue(VUE_TOUT))}
        >
          <span className="menu-groupes-coche" aria-hidden="true">{vue === VUE_TOUT && <Check size={14} />}</span>
          <span className="menu-groupes-texte">
            <strong>{`Tout afficher (${groupes.length} groupe${groupes.length > 1 ? 's' : ''})`}</strong>
            {defaut === VUE_TOUT && <em className="menu-groupes-defaut"> par défaut</em>}
          </span>
        </button>
        <button type="button" className="menu-groupes-ligne" onClick={choisir(onPersonnaliser)}>
          <span className="menu-groupes-coche" aria-hidden="true" />
          <span className="menu-groupes-texte">
            <strong>Personnaliser…</strong>
          </span>
        </button>
      </div>
    </details>
  )
}
