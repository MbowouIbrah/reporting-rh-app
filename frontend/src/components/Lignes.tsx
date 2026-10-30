import type { ReactNode } from 'react'
import type { Budget as BudgetCols, Cell, Val } from '../api/types'
import { cls, clsCharge, fcfa, pct } from '../lib/format'

type Budget = BudgetCols

/** Ligne période comparée | période | Variation | Var. % (+ Budget | Écart | % si fourni). */
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
          <td className="num">{fcfa(budget.budget ?? null)}</td>
          <td className={clsCharge(budget.ecart ?? null)}>{fcfa(budget.ecart ?? null)}</td>
          <td className={clsCharge(budget.ecart_pct ?? null)}>{pct(budget.ecart_pct ?? null)}</td>
        </>
      )}
    </tr>
  )
}
