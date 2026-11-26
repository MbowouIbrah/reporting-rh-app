import {
  createContext, type FocusEvent, type MouseEvent, type PointerEvent, type ReactNode,
  useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState,
} from 'react'
import { createPortal } from 'react-dom'

/** Une section de la carte de détail. */
export type Section =
  | { type: 'lignes'; titre: string; lignes: { k: string; v: ReactNode; fort?: boolean; sep?: boolean }[] }
  | { type: 'courbe'; mois: string[]; n: (number | null)[]; n1: (number | null)[]; legendeN: string; legendeN1: string }
  | { type: 'parts'; titre: string; parts: { nom: string; valeur: string; part: number; bo?: boolean }[] }
  | { type: 'calcul'; texte: string; mention?: string }

/** Carte de détail d'une case : titre, périodes, puis sections. */
export interface Carte {
  titre: string
  periodes: string
  sections: Section[]
}

interface Etat {
  cle: string
  carte: Carte
}

interface Ctx {
  id: string
  actif: string | null
  survoler: (cle: string, el: HTMLElement, carte: Carte) => void
  ouvrir: (cle: string, el: HTMLElement, carte: Carte) => void
  basculer: (cle: string, el: HTMLElement, carte: Carte) => void
  fermerBientot: () => void
}

const BulleCtx = createContext<Ctx | null>(null)

/** Délais : ouverture au survol (évite d'ouvrir en traversant les cases), fermeture (laisse le temps d'atteindre la carte). */
const DELAI_OUVERTURE = 150
const DELAI_FERMETURE = 200
const ECART = 6
const MARGE = 16

const NF1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const partTexte = (p: number) => `${NF1.format(p).replace(/[  ]/g, ' ')} %`

const LARGEUR = 312
const HAUTEUR = 56

/** Mini-courbe mensuelle : période en trait plein, comparaison en pointillé ; une valeur absente laisse un trou. */
function Courbe({ mois, n, n1, legendeN, legendeN1 }: Extract<Section, { type: 'courbe' }>) {
  const nb = mois.length
  const valeurs = [...n, ...n1].filter((v): v is number => v !== null && Number.isFinite(v))
  if (nb < 2 || n.filter((v) => v !== null).length < 2) return null
  const min = Math.min(...valeurs)
  const max = Math.max(...valeurs)
  const x = (i: number) => (i / (nb - 1)) * (LARGEUR - 8) + 4
  const y = (v: number) => HAUTEUR - 4 - ((v - min) / (max - min || 1)) * (HAUTEUR - 12)
  /** Suites de mois consécutifs renseignés : chacune est tracée seule, sans relier par-dessus un trou. */
  const traits = (serie: (number | null)[]) => {
    const suites: string[][] = []
    let cours: string[] = []
    serie.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        if (cours.length) suites.push(cours)
        cours = []
      } else cours.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    })
    if (cours.length) suites.push(cours)
    return suites
  }
  const dessiner = (serie: (number | null)[], style: 'n' | 'n1') =>
    traits(serie).map((s, i) =>
      s.length === 1 ? (
        <circle key={`${style}${i}`} cx={s[0].split(',')[0]} cy={s[0].split(',')[1]} r={2} fill={style === 'n' ? 'var(--navy)' : 'var(--muted-2)'} />
      ) : (
        <polyline
          key={`${style}${i}`}
          points={s.join(' ')}
          fill="none"
          stroke={style === 'n' ? 'var(--navy)' : 'var(--muted-2)'}
          strokeWidth={style === 'n' ? 2 : 1.5}
          strokeDasharray={style === 'n' ? undefined : '4 3'}
        />
      ),
    )
  return (
    <section className="bc-courbe">
      <h3>Mois par mois</h3>
      <svg viewBox={`0 0 ${LARGEUR} ${HAUTEUR + 8}`} role="img" aria-label={`Évolution mensuelle : ${legendeN} et ${legendeN1}`}>
        {dessiner(n1, 'n1')}
        {dessiner(n, 'n')}
        {mois.map((m, i) => (
          <text key={i} x={x(i).toFixed(1)} y={HAUTEUR + 7} fontSize={9} fill="var(--muted)" textAnchor="middle">{m}</text>
        ))}
      </svg>
      <div className="bc-leg">
        <span><i />{legendeN}</span>
        <span><i className="cmp" />{legendeN1}</span>
      </div>
    </section>
  )
}

function SectionCarte({ s }: { s: Section }) {
  if (s.type === 'courbe') return <Courbe {...s} />
  if (s.type === 'lignes')
    return (
      <section>
        <h3>{s.titre}</h3>
        {s.lignes.map((l, i) => (
          <div key={`${l.k}-${i}`} className={`bc-ligne${l.fort ? ' fort' : ''}${l.sep ? ' sep' : ''}`}>
            <span>{l.k}</span>
            <span>{l.v}</span>
          </div>
        ))}
      </section>
    )
  if (s.type === 'parts')
    return (
      <section>
        <h3>{s.titre}</h3>
        <div className="bc-compo">
          {s.parts.map((p, i) => (
            <div key={`${p.nom}-${i}`} className="bc-compo-ligne">
              <span className="nom">{p.nom}</span>
              <span className={`barre-part${p.bo ? ' bo' : ''}`} aria-hidden="true">
                <i style={{ width: `${Math.min(100, Math.max(0, p.part))}%` }} />
              </span>
              <span className="val">{p.valeur} <em>{partTexte(p.part)}</em></span>
            </div>
          ))}
        </div>
      </section>
    )
  return (
    <section>
      <h3>Calcul</h3>
      <p className="bc-calcul">{s.texte}</p>
      {s.mention && <span className="bc-mention">{s.mention}</span>}
    </section>
  )
}

/**
 * Carte de détail unique des cases : s'ouvre au survol (après un court délai), au focus clavier ou au toucher,
 * reste ouverte tant que le pointeur est sur la case ou sur la carte (WCAG 1.4.13), se ferme par Échap,
 * un clic ailleurs ou en quittant. Positionnée en `fixed` sous la case, au-dessus s'il manque de place.
 */
export function BulleCases({ children, inactif = false }: { children: ReactNode; inactif?: boolean }) {
  const id = useId()
  const [etat, setEtat] = useState<Etat | null>(null)
  const [visible, setVisible] = useState(false)
  // Première ouverture : la carte se place sans glisser depuis son ancienne position.
  const [saut, setSaut] = useState(true)
  const refCarte = useRef<HTMLDivElement>(null)
  const refCase = useRef<HTMLElement | null>(null)
  const refCle = useRef<string | null>(null)
  const tOuvrir = useRef<number | undefined>(undefined)
  const tFermer = useRef<number | undefined>(undefined)
  const visibleRef = useRef(false)

  const placer = useCallback(() => {
    const carte = refCarte.current
    const el = refCase.current
    if (!carte || !el) return
    const r = el.getBoundingClientRect()
    const w = carte.offsetWidth
    const h = carte.offsetHeight
    const left = Math.min(Math.max(MARGE, r.left), window.innerWidth - w - MARGE)
    let top = r.bottom + ECART
    if (top + h > window.innerHeight - 12 && r.top - h - ECART > 12) top = r.top - h - ECART
    carte.style.left = `${left}px`
    carte.style.top = `${Math.max(12, top)}px`
  }, [])

  const annuler = useCallback(() => {
    window.clearTimeout(tOuvrir.current)
    window.clearTimeout(tFermer.current)
  }, [])

  const fermer = useCallback(() => {
    annuler()
    visibleRef.current = false
    refCle.current = null
    setVisible(false)
  }, [annuler])

  const fermerBientot = useCallback(() => {
    annuler()
    tFermer.current = window.setTimeout(fermer, DELAI_FERMETURE)
  }, [annuler, fermer])

  const ouvrir = useCallback((cle: string, el: HTMLElement, carte: Carte) => {
    annuler()
    refCase.current = el
    if (visibleRef.current && refCle.current === cle) return
    setSaut(!visibleRef.current)
    visibleRef.current = true
    refCle.current = cle
    setEtat({ cle, carte })
    setVisible(true)
  }, [annuler])

  const survoler = useCallback((cle: string, el: HTMLElement, carte: Carte) => {
    annuler()
    if (visibleRef.current && refCle.current === cle) return
    // Déjà ouverte sur une case voisine : la carte glisse sans attendre.
    tOuvrir.current = window.setTimeout(() => ouvrir(cle, el, carte), visibleRef.current ? 0 : DELAI_OUVERTURE)
  }, [annuler, ouvrir])

  const basculer = useCallback((cle: string, el: HTMLElement, carte: Carte) => {
    if (visibleRef.current && refCle.current === cle) fermer()
    else ouvrir(cle, el, carte)
  }, [fermer, ouvrir])

  // Chargement en cours : valeurs pas encore à jour, la carte se ferme et ne s'ouvre plus jusqu'à la réponse.
  useEffect(() => {
    if (inactif) fermer()
  }, [inactif, fermer])

  // Contenu ou case changés : la carte est replacée une fois sa hauteur connue.
  useLayoutEffect(() => {
    if (etat) placer()
  }, [etat, placer])

  // Échap, clic hors des cases et de la carte ; défilement et redimensionnement : la carte suit sa case.
  useEffect(() => {
    if (!visible) return
    const touche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fermer()
    }
    const hors = (e: globalThis.PointerEvent) => {
      const cible = e.target as Element | null
      if (!cible?.closest?.('[data-carte-case], .bulle-case')) fermer()
    }
    const suivre = (e: Event) => {
      if (e.target instanceof Node && refCarte.current?.contains(e.target)) return
      placer()
    }
    document.addEventListener('keydown', touche)
    document.addEventListener('pointerdown', hors)
    window.addEventListener('scroll', suivre, true)
    window.addEventListener('resize', placer)
    return () => {
      document.removeEventListener('keydown', touche)
      document.removeEventListener('pointerdown', hors)
      window.removeEventListener('scroll', suivre, true)
      window.removeEventListener('resize', placer)
    }
  }, [visible, fermer, placer])

  useEffect(() => () => {
    window.clearTimeout(tOuvrir.current)
    window.clearTimeout(tFermer.current)
  }, [])

  return (
    <BulleCtx.Provider value={inactif ? null : { id, actif: visible ? (etat?.cle ?? null) : null, survoler, ouvrir, basculer, fermerBientot }}>
      {children}
      {etat &&
        createPortal(
          <div
            ref={refCarte}
            id={id}
            role="tooltip"
            className={`bulle-case${visible ? ' visible' : ''}${saut ? ' saut' : ''}`}
            aria-hidden={!visible}
            onPointerEnter={annuler}
            onPointerLeave={fermerBientot}
          >
            <header>
              <h2>{etat.carte.titre}</h2>
              <p>{etat.carte.periodes}</p>
            </header>
            {etat.carte.sections.map((s, i) => (
              <SectionCarte key={i} s={s} />
            ))}
          </div>,
          document.body,
        )}
    </BulleCtx.Provider>
  )
}

/** Gestionnaires à poser sur une case qui a une carte (survol, focus clavier, toucher). */
export function useBulleCase(cle: string, carte: Carte | undefined) {
  const c = useContext(BulleCtx)
  // Dernier appui : au toucher, le focus qui précède le clic ne doit pas ouvrir (le clic bascule).
  const toucher = useRef(false)
  if (!c || !carte) return {}
  return {
    onPointerEnter: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'touch') c.survoler(cle, e.currentTarget, carte)
    },
    onPointerLeave: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'touch') c.fermerBientot()
    },
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      toucher.current = e.pointerType === 'touch'
    },
    onFocus: (e: FocusEvent<HTMLElement>) => {
      if (!toucher.current) c.ouvrir(cle, e.currentTarget, carte)
    },
    onBlur: () => {
      toucher.current = false
      c.fermerBientot()
    },
    onClick: (e: MouseEvent<HTMLElement>) => {
      if (toucher.current) c.basculer(cle, e.currentTarget, carte)
      else c.ouvrir(cle, e.currentTarget, carte)
      toucher.current = false
    },
    'aria-describedby': c.actif === cle ? c.id : undefined,
    'data-carte-case': '',
  }
}
