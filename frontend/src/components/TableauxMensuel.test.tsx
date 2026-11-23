import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { Mensuel } from '../api/types'
import TableauxMensuel from './TableauxMensuel'

const cell = (m: string) => ({ m1: m, m, var: '0', var_pct: '0' })
const donnees = (controles: unknown[]) =>
  ({
    synthese: { ms: cell('1000'), commissions: cell('10'), primes_total: cell('5') },
    controles, a_type_charge: [], b_service_activite: [], c_site: [],
    d_contrat: { effectifs: [], indicateurs: [], ventilation: [], total: cell('0') },
  }) as unknown as Mensuel
const lib = { prec: 'Janv. 2025', cour: 'Janv. 2026' }

test('un écart bloquant est signalé au-dessus des tableaux, pas un écart d’arrondi', () => {
  render(
    <TableauxMensuel
      d={donnees([
        { controle: 'Total services = MS globale', ecart: '12', bloquant: true },
        { controle: 'Écart d’arrondi', ecart: '0.4', bloquant: false },
      ])}
      lib={lib}
    />,
  )
  const alerte = screen.getByRole('alert')
  expect(alerte).toHaveTextContent('Contrôles de cohérence en écart : Total services = MS globale')
  expect(alerte).not.toHaveTextContent('arrondi')
})

test('sans écart, aucun bandeau de contrôles', () => {
  render(<TableauxMensuel d={donnees([])} lib={lib} />)
  expect(screen.queryByText(/Contrôles de cohérence/)).toBeNull()
  expect(screen.getByText('1. Reporting global')).toBeInTheDocument()
})
