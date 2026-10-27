import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { Cell } from '../api/types'
import { type Blocs, ServicesActivites, Sites, TypesCharge } from './BlocsRapport'

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

test('répartition par site : ligne TOTAL GÉNÉRAL en masse salariale et Staff', () => {
  const avecTotal = { ...d, c_site_total: { ms: { m1: '20', m: '24', var: '4', var_pct: '0.2' }, effectif: { m: '10', m1: '8', var: '2', var_pct: '0.25' } } } as unknown as Blocs
  render(<Sites d={avecTotal} lib={{ prec: 'M-1', cour: 'M' }} />)
  const total = screen.getByText('TOTAL GÉNÉRAL').closest('tr')!
  expect(total).toHaveTextContent(/Masse salariale.*20.*24/)
  expect(total.nextElementSibling).toHaveTextContent(/Staff.*8.*10/)
})

test('répartition par service : dépliage par contrat', () => {
  const svc = {
    a_type_charge: [],
    d_contrat: { total: cell },
    b_service_activite: [{
      service: 'SAV PL', total: cell, effectif: cell,
      activites: [{ activite: 'Atelier', ...cell, effectif: cell }],
      ms_contrat: { CDI: { m: '700', m1: '600', var: '100', var_pct: '0.1667' } },
      effectif_contrat: { CDI: { m: '3', m1: '2', var: '1', var_pct: '0.5' } },
    }],
  } as unknown as Blocs
  render(<ServicesActivites d={svc} lib={{ prec: 'M-1', cour: 'M' }} />)
  const bouton = screen.getByRole('button', { name: 'Détail par contrat de SAV PL' })
  expect(screen.queryByText('Staff CDI')).toBeNull()
  fireEvent.click(bouton)
  expect(screen.getByText('CDI').closest('tr')).toHaveTextContent(/600.*700/)
  expect(screen.getByText('Staff CDI').closest('tr')).toHaveTextContent(/2.*3/)
})

test('reporting global : CA et marge sous le TOTAL GÉNÉRAL, budget vide, absents sans le droit', () => {
  const total = { rubrique: 'TOTAL CHARGES', exclu: false, ...cell, budget: '20', ecart: '8', ecart_pct: '0.4' }
  const blocs = { a_type_charge: [total], lignes_ca_marge: { ca: cell, marge: cell } } as unknown as Blocs
  const { unmount } = render(<TypesCharge d={blocs} lib={{ prec: 'M-1', cour: 'M' }} />)
  const lignes = screen.getAllByRole('row').map((r) => r.querySelector('th')?.textContent)
  expect(lignes.slice(-4)).toEqual(['TOTAL GÉNÉRAL', 'Pour information, hors total', "Chiffre d'affaires", 'Marge'])
  const ca = screen.getByText("Chiffre d'affaires").closest('tr')!
  expect([...ca.querySelectorAll('td')].slice(-3).map((c) => c.textContent)).toEqual(['—', '—', '—'])
  unmount()
  render(<TypesCharge d={{ a_type_charge: [total] } as unknown as Blocs} lib={{ prec: 'M-1', cour: 'M' }} />)
  expect(screen.queryByText("Chiffre d'affaires")).toBeNull()
})
