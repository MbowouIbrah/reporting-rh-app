import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export const ID_LISTE = 'grille-choix'
export const idOption = (i: number) => `${ID_LISTE}-${i}`

interface Props {
  /** Cellule de la grille sous laquelle la liste s'ouvre. */
  ancre: HTMLElement
  options: string[]
  actif: number
  valeur: string
  onChoisir: (v: string) => void
  onSurvol: (i: number) => void
}

/**
 * Valeurs proposées pour une cellule Poste, Site, Service… de la grille (remplace la liste native du
 * navigateur). Posée au-dessus de la page : le panneau défilant de la grille ne la coupe pas. La saisie
 * reste dans la cellule ; la souris et les flèches choisissent sans lui retirer le focus.
 */
export default function ListeChoix({ ancre, options, actif, valeur, onChoisir, onSurvol }: Props) {
  const liste = useRef<HTMLUListElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number; haut: boolean } | null>(null)

  useLayoutEffect(() => {
    const placer = () => {
      const r = ancre.getBoundingClientRect()
      const bas = window.innerHeight - r.bottom
      // Peu de place sous la cellule : la liste s'ouvre au-dessus.
      const haut = bas < 220 && r.top > bas
      setPos({ top: haut ? r.top - 2 : r.bottom + 2, left: r.left, width: r.width, haut })
    }
    placer()
    window.addEventListener('scroll', placer, true)
    window.addEventListener('resize', placer)
    return () => {
      window.removeEventListener('scroll', placer, true)
      window.removeEventListener('resize', placer)
    }
  }, [ancre])

  useEffect(() => {
    liste.current?.querySelector<HTMLElement>(`#${idOption(actif)}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [actif])

  if (!pos || options.length === 0) return null
  return createPortal(
    <ul
      ref={liste}
      id={ID_LISTE}
      role="listbox"
      aria-label="Valeurs proposées"
      className="liste-choix"
      style={{
        left: pos.left,
        minWidth: Math.max(pos.width, 200),
        ...(pos.haut ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
      }}
      // La cellule garde le focus : un clic dans la liste ne la fait pas quitter.
      onMouseDown={(e) => e.preventDefault()}
    >
      {options.map((o, i) => (
        <li
          key={o}
          id={idOption(i)}
          role="option"
          aria-selected={o === valeur}
          className={i === actif ? 'actif' : undefined}
          onMouseEnter={() => onSurvol(i)}
          onClick={() => onChoisir(o)}
        >
          {o}
        </li>
      ))}
    </ul>,
    document.body,
  )
}
