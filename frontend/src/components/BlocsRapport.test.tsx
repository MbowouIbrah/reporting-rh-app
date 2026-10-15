import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { Cell } from '../api/types'
import { type Blocs, Sites } from './BlocsRapport'

const cell: Cell = { m1: '10', m: '12', var: '2', var_pct: '0.2' }

const d = {
  c_site: [
    {
      site: 'Douala',
      ms: cell,
      effectif: { m: '5', m1: '4', var: '1', var_pct: '0.25' },
      effectif_contrat: {
        CDI: { m: '3', m1: '3', var: '0', var_pct: '0' },
        CDD: { m: '1', m1: '1', var: '0', var_pct: '0' },
        MAD: { m: '1', m1: '0', var: '1', var_pct: null },
      },
    },
  ],
} as unknown as Blocs

test('effectifs d’un site : repliés par défaut, la ligne Staff se déplie au clic par nature de contrat', () => {
  render(<Sites d={d} lib={{ prec: 'M-1', cour: 'M' }} />)
  const bouton = screen.getByRole('button', { name: 'Détail des effectifs de Douala' })
  expect(bouton).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('CDI')).toBeNull()

  fireEvent.click(bouton)
  expect(bouton).toHaveAttribute('aria-expanded', 'true')
  const lignes = ['CDI', 'CDD', 'MAD'].map((c) => screen.getByText(c).closest('tr')!)
  expect(lignes[0]).toHaveTextContent('33')
  expect(lignes[1]).toHaveTextContent('11')
  expect(lignes[2]).toHaveTextContent('01')

  fireEvent.click(bouton.closest('tr')!.cells[1])
  expect(bouton).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('CDI')).toBeNull()
})
