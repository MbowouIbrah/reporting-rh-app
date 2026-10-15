import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { Cell } from '../api/types'
import { type Blocs, Sites } from './BlocsRapport'

const cell: Cell = { m1: '10', m: '12', var: '2', var_pct: '0.2' }

const site = (nom: string) => ({
  site: nom,
  ms: cell,
  effectif: { m: '5', m1: '4', var: '1', var_pct: '0.25' },
  effectif_contrat: {
    CDI: { m: '3', m1: '3', var: '0', var_pct: '0' },
    CDD: { m: '1', m1: '1', var: '0', var_pct: '0' },
    MAD: { m: '1', m1: '0', var: '1', var_pct: null },
  },
  ms_contrat: {
    CDI: { m: '700', m1: '600', var: '100', var_pct: '0.1667' },
    CDD: { m: '200', m1: '200', var: '0', var_pct: '0' },
    MAD: { m: '100', m1: '0', var: '100', var_pct: null },
  },
})

const d = { c_site: [site('Douala'), site('Yaoundé')] } as unknown as Blocs

test('détail d’un site : replié par défaut, se déplie au clic en masse salariale et Staff par contrat', () => {
  render(<Sites d={d} lib={{ prec: 'M-1', cour: 'M' }} />)
  const bouton = screen.getByRole('button', { name: 'Détail par contrat de Douala' })
  expect(bouton).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('CDI')).toBeNull()

  fireEvent.click(bouton)
  expect(bouton).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText('CDI').closest('tr')).toHaveTextContent(/600.*700/)
  expect(screen.getByText('Staff CDI').closest('tr')).toHaveTextContent('33')
  expect(screen.getByText('Staff MAD').closest('tr')).toHaveTextContent('01')

  fireEvent.click(bouton.closest('tr')!.cells[1])
  expect(bouton).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('CDI')).toBeNull()
})

test('un seul site déplié à la fois', () => {
  render(<Sites d={d} lib={{ prec: 'M-1', cour: 'M' }} />)
  const douala = screen.getByRole('button', { name: 'Détail par contrat de Douala' })
  const yaounde = screen.getByRole('button', { name: 'Détail par contrat de Yaoundé' })
  fireEvent.click(douala)
  fireEvent.click(yaounde)
  expect(douala).toHaveAttribute('aria-expanded', 'false')
  expect(yaounde).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getAllByText('CDI')).toHaveLength(1)
})
