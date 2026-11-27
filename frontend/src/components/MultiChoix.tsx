import { useEffect, useId, useRef, useState } from 'react'
import { valeurs } from '../hooks/useFiltres'

const plier = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

/** Filtre à sélection multiple (R4), à la manière d'Excel : toutes les cases cochées par défaut (= tous),
 *  une ligne « Tout sélectionner / Tout désélectionner » en tête de liste, recherche dans les longues listes.
 *  Valeur : choix séparés par « | » ; vide : tous. Aucune case cochée n'est qu'un état de saisie :
 *  à la fermeture, le filtre revient à tous.
 *  R9 : avec `comparer`, deux boutons « Cumuler / Comparer » en tête de liste ; en « Comparer », on coche
 *  deux valeurs, la 1re est A, la 2e est B (ordre de clic gardé dans la valeur). */
export type ModeListe = 'cumuler' | 'comparer' | 'effacer'

export default function MultiChoix({ libelle, pluriel, tous = 'Tous', options, valeur, onChange, nomOption = (v) => v, souple = true, comparer, puce = false, limite }: {
  /** Présentation en puce « Libellé : valeur ▾ », navy et × quand le filtre est actif. */
  puce?: boolean
  /** Liste restreinte par un filtre parent (« Limité à : Commercial »). */
  limite?: string
  libelle: string
  /** Résumé au-delà de deux choix : « 3 sites ». */
  pluriel: string
  tous?: string
  options: string[]
  valeur: string
  onChange: (v: string) => void
  nomOption?: (v: string) => string
  souple?: boolean
  comparer?: {
    /** Cette liste est en mode « Comparer ». */
    actif: boolean
    /** Libellé d'une autre liste en comparaison (passer celle-ci en « Comparer » l'efface). */
    autre?: string
    onMode: (m: ModeListe) => void
  }
}) {
  const id = useId()
  const racine = useRef<HTMLDivElement>(null)
  const bouton = useRef<HTMLButtonElement>(null)
  const caseTout = useRef<HTMLInputElement>(null)
  const [ouvert, setOuvert] = useState(false)
  const [saisie, setSaisie] = useState('')
  const [aucun, setAucun] = useState(false)
  const choisis = valeurs(valeur)
  const cmp = !!comparer?.actif
  // cases cochées : toutes quand le filtre vaut « tous » (sauf en comparaison : seulement les choisies)
  const coches = cmp ? choisis.slice(0, 2) : aucun ? [] : choisis.length ? choisis : options

  useEffect(() => {
    if (!ouvert && aucun) {
      setAucun(false)
      onChange('')
    }
  }, [ouvert, aucun, onChange])

  useEffect(() => {
    if (!ouvert) return
    const dehors = (e: MouseEvent) => {
      if (!racine.current?.contains(e.target as Node)) setOuvert(false)
    }
    document.addEventListener('mousedown', dehors)
    return () => document.removeEventListener('mousedown', dehors)
  }, [ouvert])

  const resume = cmp ? (coches.length === 2 ? `⇄ ${coches.map(nomOption).join(' / ')}` : '⇄ Cochez 2 valeurs')
    : aucun ? 'Aucun'
    : choisis.length === 0 ? tous
    : choisis.length <= 2 ? choisis.map(nomOption).join(', ')
    : `${choisis.length} ${pluriel}`
  const t = plier(saisie.trim())
  const visibles = t ? options.filter((o) => plier(nomOption(o)).includes(t)) : options
  const appliquer = (s: Set<string>) => {
    const garde = options.filter((x) => s.has(x)) // ordre des options : valeur stable (partage, lien)
    if (!garde.length) return setAucun(true)
    setAucun(false)
    onChange(garde.length === options.length ? '' : garde.join('|'))
  }
  const basculer = (o: string) => {
    if (cmp) {
      // ordre de clic : la 1re cochée est A, la 2e est B
      const reste = coches.includes(o) ? coches.filter((x) => x !== o) : [...coches, o].slice(0, 2)
      return onChange(reste.join('|'))
    }
    const s = new Set(coches)
    if (s.has(o)) s.delete(o)
    else s.add(o)
    appliquer(s)
  }
  const tousVisibles = visibles.every((o) => coches.includes(o))
  const aucunVisible = !visibles.some((o) => coches.includes(o))
  // case « tout » à moitié cochée quand une partie seulement des valeurs affichées l'est
  useEffect(() => {
    if (caseTout.current) caseTout.current.indeterminate = !tousVisibles && !aucunVisible
  })

  return (
    <div
      className={`filtre multi-choix${souple ? ' souple' : ''}${puce ? ' puce' : ''}${puce && (cmp || choisis.length > 0) ? ' actif' : ''}`}
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
        className={`multi-bouton${cmp ? ' cmp' : ''}`}
        aria-haspopup="true"
        aria-expanded={ouvert}
        aria-controls={`${id}-menu`}
        aria-labelledby={`${id}-lib ${id}-val`}
        title={!cmp && choisis.length > 2 ? choisis.map(nomOption).join(', ') : undefined}
        onClick={() => {
          setSaisie('')
          setOuvert(!ouvert)
        }}
      >
        <span id={`${id}-val`}>{resume}</span>
      </button>
      {puce && (cmp || choisis.length > 0) && (
        <button
          type="button" className="puce-croix" aria-label={`Effacer le filtre ${libelle}`} title={`Effacer le filtre ${libelle}`}
          onClick={() => {
            setOuvert(false)
            if (comparer) comparer.onMode('effacer')
            else onChange('')
            bouton.current?.focus()
          }}
        >
          ×
        </button>
      )}
      {ouvert && (
        <div id={`${id}-menu`} className="multi-menu" role="group" aria-labelledby={`${id}-lib`}>
          {comparer && (
            <>
              <div className="multi-mode" role="group" aria-label="Mode du filtre">
                <button type="button" aria-pressed={!cmp} onClick={() => cmp && comparer.onMode('cumuler')}>Cumuler</button>
                <button type="button" aria-pressed={cmp} onClick={() => !cmp && comparer.onMode('comparer')}>Comparer</button>
              </div>
              <p className="multi-aide">
                {cmp ? 'Cochez 2 valeurs : A et B côte à côte, même période.'
                  : comparer.autre ? `Une seule comparaison à la fois : « Comparer » ici efface la comparaison ${comparer.autre}.`
                  : 'Les valeurs cochées sont additionnées.'}
              </p>
            </>
          )}
          {limite && <p className="multi-aide multi-limite">Limité à : {limite}</p>}
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
          <p className="multi-compte" aria-live="polite">
            {cmp ? `${coches.length} sur 2` : aucun ? 'Cochez au moins une valeur' : `${coches.length} sur ${options.length}`}
          </p>
          <div className="multi-liste">
            {visibles.length === 0 && <p className="choix-vide">Aucun résultat</p>}
            {visibles.length > 0 && !cmp && (
              <label className="multi-tout">
                <input
                  type="checkbox"
                  ref={caseTout}
                  checked={tousVisibles}
                  onChange={() => appliquer(tousVisibles
                    ? new Set(coches.filter((o) => !visibles.includes(o)))
                    : new Set([...coches, ...visibles]))}
                />
                {tousVisibles ? 'Tout désélectionner' : 'Tout sélectionner'}
              </label>
            )}
            {visibles.map((o) => {
              const rang = cmp ? coches.indexOf(o) : -1
              return (
                <label key={o}>
                  <input
                    type="checkbox"
                    checked={coches.includes(o)}
                    disabled={cmp && rang < 0 && coches.length >= 2}
                    onChange={() => basculer(o)}
                  />
                  {nomOption(o)}
                  {rang >= 0 && <span className={`multi-rep rep-${rang ? 'b' : 'a'}`} aria-label={rang ? 'sélection B' : 'sélection A'}>{rang ? 'B' : 'A'}</span>}
                </label>
              )
            })}
          </div>
          {comparer && (
            <div className="multi-pied">
              <button type="button" className="btn-link" onClick={() => comparer.onMode('effacer')}>Effacer</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
