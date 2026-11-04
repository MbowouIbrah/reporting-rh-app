import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { Cell } from '../api/types'
import { Activite, type Blocs, ServicesActivites, Sites, TypesCharge, TypesExclus } from './BlocsRapport'

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
  expect(lignes.slice(-3)).toEqual(['TOTAL GÉNÉRAL', "Chiffre d'affaires", 'Marge'])
  const ca = screen.getByText("Chiffre d'affaires").closest('tr')!
  expect([...ca.querySelectorAll('td')].slice(-3).map((c) => c.textContent)).toEqual(['—', '—', '—'])
  unmount()
  render(<TypesCharge d={{ a_type_charge: [total] } as unknown as Blocs} lib={{ prec: 'M-1', cour: 'M' }} />)
  expect(screen.queryByText("Chiffre d'affaires")).toBeNull()
})

test('Activité : lignes de l’activité, mention « partiel » seulement sur la ligne incomplète', () => {
  const lignes = [
    { cle: 'ventes', libelle: 'Ventes', ...cell, partiel: true as const },
    { cle: 'productivite', libelle: 'Productivité', m1: '1.5', m: '2.25', var: '0.75', var_pct: '0.5' },
  ]
  render(<Activite lignes={lignes} lib={{ prec: 'M-1', cour: 'M' }} />)
  expect(screen.getByRole('rowheader', { name: /Ventes\s*partiel/ })).toBeInTheDocument()
  expect(screen.getByRole('rowheader', { name: 'Productivité' })).toBeInTheDocument()
  expect(screen.getAllByText('partiel')).toHaveLength(1)
  // Les ratios gardent deux décimales.
  expect(screen.getByText(/2,25/)).toBeInTheDocument()
})

const lib = { prec: 'M-1', cour: 'M' }
const cellsTr = (tr: Element) => [...tr.querySelectorAll('td')]

test('écart d’un résultat (CA, marge) : dépasser l’objectif est bon, rester dessous est mauvais', () => {
  const total = { rubrique: 'TOTAL CHARGES', exclu: false, ...cell }
  const objectif = { ...cell, budget: '100', ecart: '20', ecart_pct: '0.2' }
  const manque = { ...cell, budget: '100', ecart: '-30', ecart_pct: '-0.3' }
  const blocs = { a_type_charge: [total], lignes_ca_marge: { ca: objectif, marge: manque } } as unknown as Blocs
  render(<TypesCharge d={blocs} lib={lib} />)
  const ca = cellsTr(screen.getByText("Chiffre d'affaires").closest('tr')!)
  expect(ca.slice(-2).map((c) => c.className)).toEqual(['num bon', 'num bon'])
  const marge = cellsTr(screen.getByText('Marge').closest('tr')!)
  expect(marge.slice(-2).map((c) => c.className)).toEqual(['num neg', 'num neg'])
})

test('reporting global : pas de ligne « dont Frais de mission » sous le TOTAL GÉNÉRAL', () => {
  const total = { rubrique: 'TOTAL CHARGES', exclu: false, ...cell, budget: '20', ecart: '8', ecart_pct: '0.4' }
  const frais = { ...cell, budget: '9', ecart: '3', ecart_pct: '0.33' }
  const blocs = { a_type_charge: [total], frais_mission: frais, lignes_ca_marge: { ca: cell, marge: cell } } as unknown as Blocs
  render(<TypesCharge d={blocs} lib={lib} />)
  const lignes = screen.getAllByRole('row').map((r) => r.querySelector('th')?.textContent)
  expect(lignes.slice(-3)).toEqual(['TOTAL GÉNÉRAL', "Chiffre d'affaires", 'Marge'])
  expect(screen.queryByText('dont Frais de mission')).toBeNull()
})

test('reporting global : mention « partiel » sur un budget de CA incomplet', () => {
  const total = { rubrique: 'TOTAL CHARGES', exclu: false, ...cell }
  const ca = { ...cell, budget: '100', ecart: '5', ecart_pct: '0.05', budget_partiel: true as const }
  render(<TypesCharge d={{ a_type_charge: [total], lignes_ca_marge: { ca, marge: cell } } as unknown as Blocs} lib={lib} />)
  expect(screen.getAllByText('partiel')).toHaveLength(1)
  expect(cellsTr(screen.getByText("Chiffre d'affaires").closest('tr')!).at(-3)).toHaveTextContent('partiel')
})

test('Activité : colonnes Objectif, Écart et Écart % sur les lignes qui ont un objectif, grille à 7 colonnes', () => {
  const lignes = [
    { cle: 'ventes', libelle: 'Ventes', ...cell, budget: '10', ecart: '2', ecart_pct: '0.2' },
    { cle: 'productivite', libelle: 'Productivité', ...cell, budget: '3', ecart: '-0.5', ecart_pct: '-0.1667' },
    { cle: 'devis', libelle: 'Devis', ...cell },
  ]
  render(<Activite lignes={lignes} lib={lib} />)
  expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Indicateur', 'M-1', 'M', 'Variation', 'Var. %', 'Objectif', 'Écart', 'Écart %'])
  const ventes = cellsTr(screen.getByText('Ventes').closest('tr')!)
  expect(ventes).toHaveLength(7)
  expect(ventes.slice(-2).map((c) => c.className)).toEqual(['num bon', 'num bon'])
  const prod = cellsTr(screen.getByText('Productivité').closest('tr')!)
  expect(prod.slice(-2).map((c) => c.className)).toEqual(['num neg', 'num neg'])
  // Sans objectif sur la ligne : cellules vides, pas de couleur.
  const devis = cellsTr(screen.getByText('Devis').closest('tr')!)
  expect(devis).toHaveLength(7)
  expect(devis.slice(-3).map((c) => c.textContent)).toEqual(['—', '—', '—'])
})

test('TypesCharge groupe les rubriques comptées par famille, sans sous-total ; les hors total vont dans TypesExclus', () => {
  const r = (rubrique: string, famille: string, exclu = false) => ({ rubrique, famille, exclu, ...cell })
  const blocs = {
    a_type_charge: [
      r('Salaire brut garantie', 'salaire'),
      r('Bonus', 'primes', true),
      r('Prime sur ventes', 'primes'),
      { rubrique: 'TOTAL CHARGES', famille: null, exclu: false, ...cell },
    ],
    a_familles: [
      { famille: 'salaire', hors_total: null, hors_total_m1: null, ...cell },
      { famille: 'primes', hors_total: '12', hors_total_m1: '10', ...cell },
    ],
  } as unknown as Blocs
  const { container } = render(<TypesCharge d={blocs} lib={lib} />)
  const lignes = [...container.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('th')?.textContent)
  expect(lignes.slice(0, 4)).toEqual(['Salaire', 'Salaire brut garantie', 'Primes', 'Prime sur ventes'])
  expect(container.querySelector('tr.exclu')).toBeNull()
  expect(container.querySelector('tr.sous-total')).toBeNull()
  const exclus = render(<TypesExclus d={blocs} lib={lib} />).container
  expect([...exclus.querySelectorAll('tbody tr.exclu th')].map((th) => th.textContent)).toEqual(['Bonus'])
})
