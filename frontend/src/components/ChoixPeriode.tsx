import { useEffect, useId, useRef, useState } from 'react'
import {
  anneeDe, anneeEntiere, cliqueMois, indice, libelle, longueur as nbMois, moisDe, MOIS_GRILLE, mois as moisSel, plage, type Sel,
} from '../lib/periode'

interface Props {
  /** Intitulé du filtre (« Période », « Comparer à »). */
  titre: string
  valeur: Sel
  onChange: (s: Sel) => void
  /** Premier et dernier mois proposés (indices de mois). */
  min: number
  max: number
  /** Nombre de mois exigé (comparaison : autant de mois que la période). */
  longueur?: number
  /** Période à comparer : un clic sur l'année prend les mêmes mois de cette année. */
  modele?: Sel
  /** Un seul mois à la fois : ni plage, ni clic sur l'année (sélecteur d'un mois). */
  moisSeul?: boolean
}

const MOIS_NOMS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** Calendrier compact (R6) : ◀ année ▶, 12 mois, un seul bouton OK. Rien ne s'applique avant OK ;
 *  Échap ou un clic à côté annule. */
export default function ChoixPeriode({ titre, valeur, onChange, min, max, longueur, modele, moisSeul = false }: Props) {
  const id = useId()
  const racine = useRef<HTMLDivElement>(null)
  const bouton = useRef<HTMLButtonElement>(null)
  const [ouvert, setOuvert] = useState(false)
  const [brouillon, setBrouillon] = useState<Sel | null>(valeur)
  const [annee, setAnnee] = useState(anneeDe(valeur.f))
  const [survol, setSurvol] = useState<number | null>(null)

  useEffect(() => {
    if (!ouvert) return
    const dehors = (e: MouseEvent) => {
      if (!racine.current?.contains(e.target as Node)) setOuvert(false)
    }
    document.addEventListener('mousedown', dehors)
    return () => document.removeEventListener('mousedown', dehors)
  }, [ouvert])

  const ouvrir = () => {
    setBrouillon(valeur)
    setAnnee(Math.min(Math.max(anneeDe(valeur.f), anneeDe(min)), anneeDe(max)))
    setSurvol(null)
    setOuvert(true)
  }
  const fermer = () => {
    setOuvert(false)
    bouton.current?.focus()
  }

  // Les mêmes mois que la période, dans l'année affichée (comparaison : toute autre année de la même longueur).
  const memesMois = (): Sel | null => {
    if (!modele || longueur === undefined) return null
    const d = indice(annee, moisDe(modele.d))
    return plage(d, d + longueur - 1, max)
  }
  const anneeChoisie = (() => {
    if (moisSeul) return false
    const m = memesMois()
    if (m) return !!brouillon && brouillon.d === m.d && brouillon.f === m.f
    return !!brouillon && brouillon.type === 'annee' && anneeDe(brouillon.d) === annee
  })()

  const cliqueAnnee = () => setBrouillon(anneeChoisie ? null : (memesMois() ?? anneeEntiere(annee, min, max)))
  const cliqueUnMois = (i: number) => setBrouillon(moisSeul ? moisSel(i) : cliqueMois(brouillon, i, max))

  const mauvaiseLongueur = !!brouillon && longueur !== undefined && nbMois(brouillon) !== longueur
  const aide = !brouillon
    ? (moisSeul ? 'Cliquez un mois.' : 'Cliquez l’année ou un mois.')
    : mauvaiseLongueur
      ? `Il faut ${longueur} mois, comme la période`
      : brouillon.type === 'mois' && !moisSeul && longueur === undefined
        ? <><strong>{libelle(brouillon)}</strong> · un 2e mois pour une période</>
        : <strong>{libelle(brouillon)}</strong>

  const appliquer = () => {
    if (!brouillon || mauvaiseLongueur) return
    onChange(brouillon)
    fermer()
  }
  const apercu = (i: number) => {
    if (moisSeul || survol === null || !brouillon || brouillon.type !== 'mois') return false
    return i !== brouillon.d && i >= Math.min(brouillon.d, survol) && i <= Math.max(brouillon.d, survol)
  }

  return (
    <div
      className="filtre multi-choix"
      ref={racine}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && ouvert) {
          e.stopPropagation()
          fermer()
        }
      }}
    >
      <span id={`${id}-lib`}>{titre}</span>
      <button
        ref={bouton}
        type="button"
        className="multi-bouton periode-bouton"
        aria-haspopup="dialog"
        aria-expanded={ouvert}
        aria-controls={`${id}-menu`}
        aria-labelledby={`${id}-lib ${id}-val`}
        onClick={() => (ouvert ? setOuvert(false) : ouvrir())}
      >
        <span id={`${id}-val`}>{libelle(valeur)}</span>
      </button>
      {ouvert && (
        <div id={`${id}-menu`} className="multi-menu cal" role="dialog" aria-label={titre}>
          <div className="cal-tete">
            <button
              type="button" className="bouton bouton-secondaire" aria-label="Année précédente"
              disabled={annee <= anneeDe(min)} onClick={() => setAnnee(annee - 1)}
            >
              ◀
            </button>
            {moisSeul ? (
              <span className="cal-annee statique">{annee}</span>
            ) : (
              <button
                type="button" className={`cal-annee${anneeChoisie ? ' sel' : ''}`} aria-pressed={anneeChoisie}
                title={`Toute l’année ${annee}`} onClick={cliqueAnnee}
              >
                {annee}
              </button>
            )}
            <button
              type="button" className="bouton bouton-secondaire" aria-label="Année suivante"
              disabled={annee >= anneeDe(max)} onClick={() => setAnnee(annee + 1)}
            >
              ▶
            </button>
          </div>
          <div className="cal-grille" onMouseLeave={() => setSurvol(null)}>
            {MOIS_GRILLE.map((court, j) => {
              const i = annee * 12 + j
              const hors = i < min || i > max
              const sel = !!brouillon && (i === brouillon.d || i === brouillon.f)
              const dans = !!brouillon && i > brouillon.d && i < brouillon.f
              const classe = sel ? 'sel' : dans ? 'dans' : apercu(i) && !hors ? 'apercu' : undefined
              return (
                <button
                  key={j} type="button" className={classe} aria-pressed={sel} aria-label={`${MOIS_NOMS[j]} ${annee}`}
                  disabled={hors} onMouseEnter={() => setSurvol(i)} onClick={() => cliqueUnMois(i)}
                >
                  {court}
                </button>
              )
            })}
          </div>
          <div className="cal-pied">
            <p className="cal-choix" aria-live="polite">{aide}</p>
            <button type="button" className="bouton bouton-primaire" disabled={!brouillon || mauvaiseLongueur} onClick={appliquer}>
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
