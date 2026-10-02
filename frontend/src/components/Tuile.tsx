import type { Cell } from '../api/types'
import { isNeg, pct } from '../lib/format'

interface Props {
  titre: string
  valeur: string
  cell?: Cell
  /** Tuile héros : plus grande, occupe plus de place dans la grille. */
  hero?: boolean
  /** Explication quand la valeur est absente (« — »). */
  absence?: string
  /** Libellé de la comparaison, par défaut « vs M-1 ». */
  vs?: string
}

/** Variation lisible sans la couleur : flèche, signe et texte. */
export function Variation({ v, vs = 'vs M-1' }: { v: Cell['var_pct']; vs?: string }) {
  if (v === null || v === undefined) return <span className="variation">— {vs}</span>
  if (v === 'n/a') return <span className="variation">n/a {vs}</span>
  const n = Number(v)
  const etat = n === 0 ? 'stable' : isNeg(v) ? 'baisse' : 'hausse'
  const signe = n > 0 ? '+' : ''
  const fleche = etat === 'stable' ? '▬' : etat === 'baisse' ? '▼' : '▲'
  return (
    <span className={`variation ${etat === 'baisse' ? 'neg' : ''}`}>
      <span aria-hidden="true">{fleche}</span> {signe}
      {pct(v)} {vs}
      <span className="sr-only"> ({etat})</span>
    </span>
  )
}

export default function Tuile({ titre, valeur, cell, hero, absence, vs }: Props) {
  return (
    <div className={hero ? 'tuile tuile-hero' : 'tuile'}>
      <span className="micro">{titre}</span>
      <strong>{valeur}</strong>
      {cell && <Variation v={cell.var_pct} vs={vs} />}
      {valeur === '—' && absence && <span className="note">{absence}</span>}
    </div>
  )
}
