import type { ReactNode } from 'react'
import type { Cell, Val } from '../api/types'
import { cls, fcfa, pct } from '../lib/format'

interface Budget {
  budget: Val
  ecart: Val
  ecart_pct: Val
}

/** Ligne M-1 | M | Variation | Var. % (+ Budget | Écart | % si fourni). */
export function LigneCell({
  label,
  cell,
  budget,
  className,
  fmt = fcfa,
}: {
  label: ReactNode
  cell: Cell
  budget?: Budget
  className?: string
  fmt?: (v: Val) => string
}) {
  return (
    <tr className={className}>
      <th scope="row">{label}</th>
      <td className="num">{fmt(cell.m1)}</td>
      <td className="num">{fmt(cell.m)}</td>
      <td className={cls(cell.var)}>{fmt(cell.var)}</td>
      <td className={cls(cell.var_pct)}>{pct(cell.var_pct)}</td>
      {budget && (
        <>
          <td className="num">{fcfa(budget.budget)}</td>
          <td className={cls(budget.ecart)}>{fcfa(budget.ecart)}</td>
          <td className={cls(budget.ecart_pct)}>{pct(budget.ecart_pct)}</td>
        </>
      )}
    </tr>
  )
}

export function EnTete({ premiere, budget }: { premiere: string; budget?: boolean }) {
  return (
    <thead>
      <tr>
        <th scope="col">{premiere}</th>
        <th scope="col">M-1</th>
        <th scope="col">M</th>
        <th scope="col">Variation</th>
        <th scope="col">Var. %</th>
        {budget && (
          <>
            <th scope="col">Budget</th>
            <th scope="col">Écart</th>
            <th scope="col">% Budget</th>
          </>
        )}
      </tr>
    </thead>
  )
}
