import { createContext, type FocusEvent, type MouseEvent, type ReactNode, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** Lignes d'une bulle : libellé, valeur. */
export type Detail = [string, string][]

interface Etat {
  cle: string
  detail: Detail
  x: number
  y: number
}

interface Ctx {
  id: string
  actif: string | null
  montrer: (cle: string, el: HTMLElement, detail: Detail) => void
  cacher: () => void
}

const BulleCtx = createContext<Ctx | null>(null)

/** Délai avant de cacher : le temps de passer d'une case à sa voisine sans faire clignoter la bulle. */
const DELAI = 120

/**
 * Bulle unique des cases (comme celle des graphiques) : elle glisse d'une case à l'autre au survol
 * et disparaît dès que le pointeur quitte les cases. Placée en `fixed` sous la case, alignée à droite.
 */
export function BulleCases({ children }: { children: ReactNode }) {
  const id = useId()
  const [etat, setEtat] = useState<Etat | null>(null)
  const [visible, setVisible] = useState(false)
  // Première apparition : la bulle se place sans glisser depuis son ancienne position.
  const [saut, setSaut] = useState(true)
  const minuteur = useRef<number | undefined>(undefined)
  const visibleRef = useRef(false)

  const cacherTout = useCallback(() => {
    window.clearTimeout(minuteur.current)
    visibleRef.current = false
    setVisible(false)
  }, [])

  const montrer = useCallback((cle: string, el: HTMLElement, detail: Detail) => {
    window.clearTimeout(minuteur.current)
    const r = el.getBoundingClientRect()
    setSaut(!visibleRef.current)
    visibleRef.current = true
    setEtat({ cle, detail, x: r.right, y: r.bottom + 2 })
    setVisible(true)
  }, [])

  const cacher = useCallback(() => {
    window.clearTimeout(minuteur.current)
    minuteur.current = window.setTimeout(cacherTout, DELAI)
  }, [cacherTout])

  // Position fixe : un défilement ou un redimensionnement la décrocherait de sa case.
  useEffect(() => {
    if (!visible) return
    window.addEventListener('scroll', cacherTout, true)
    window.addEventListener('resize', cacherTout)
    return () => {
      window.removeEventListener('scroll', cacherTout, true)
      window.removeEventListener('resize', cacherTout)
    }
  }, [visible, cacherTout])

  useEffect(() => () => window.clearTimeout(minuteur.current), [])

  return (
    <BulleCtx.Provider value={{ id, actif: visible ? (etat?.cle ?? null) : null, montrer, cacher }}>
      {children}
      {etat &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className={`bulle-case${visible ? ' visible' : ''}${saut ? ' saut' : ''}`}
            style={{ transform: `translate(${etat.x}px, ${etat.y}px) translateX(-100%)` }}
            aria-hidden={!visible}
          >
            {etat.detail.map(([k, v]) => (
              <div key={k}>
                <span>{k}</span>
                <span className="num">{v}</span>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </BulleCtx.Provider>
  )
}

/** Gestionnaires à poser sur une case qui a une bulle (survol et focus clavier). */
export function useBulleCase(cle: string, detail: Detail | undefined) {
  const c = useContext(BulleCtx)
  if (!c || !detail) return {}
  const montrer = (e: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => c.montrer(cle, e.currentTarget, detail)
  return {
    onMouseEnter: montrer,
    onFocus: montrer,
    onMouseLeave: c.cacher,
    onBlur: c.cacher,
    'aria-describedby': c.actif === cle ? c.id : undefined,
  }
}
