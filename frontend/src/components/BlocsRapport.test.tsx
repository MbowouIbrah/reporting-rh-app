import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { Cell } from '../api/types'
import { Activite, type Blocs, ServicesActivites, Sites, TypesCharge, TypesExclus } from './BlocsRapport'

const cell: Cell = { m1: '10', m: '12', var: '2', var_pct: '0.2' }

const eff = { m: '5', m1: '4', var: '1', var_pct: '0.25' }
const zero = { m: '0', m1: '0', var: '0', var_pct: null }

const site = (nom: string) => ({
  site: nom,
  ms: cell,
  effectif: eff,
  activites: [
    {
      activite: 'VN', ...cell, effectif: eff,
      contrats: {
        CDI: { ms: { m: '700', m1: '600', var: '100', var_pct: '0.1667' }, effectif: { m: '3', m1: '2', var: '1', var_pct: '0.5' } },
        CDD: { ms: zero, effectif: zero },
      },
    },
    { activite: 'APV', ...cell, effectif: eff },
    { activite: 'Vide', ...zero, effectif: zero },
  ],
})

const d = { c_site: [site('Douala'), site('Yaoundé')] } as unknown as Blocs
const lib = { prec: 'M-1', cour: 'M' }

test('répartition par site : une ligne par activité, total du bloc, activités à zéro masquées, plus de Staff', () => {
  const { container } = render(<Sites d={d} lib={lib} />)
  const douala = container.querySelectorAll('tbody.bloc')[0]
  expect([...douala.querySelectorAll('tr')].map((tr) => tr.className)).toEqual(['activite', 'activite', 'total-bloc'])
  expect(douala.querySelector('th.nom')).toHaveAttribute('rowspan', '3')
  expect(screen.getAllByText('Total site')).toHaveLength(2)
  expect(screen.queryByText('Vide')).toBeNull()
  expect(screen.queryByText(/Staff/)).toBeNull()
  // masse (5 colonnes), gouttière, effectif (4 colonnes)
  expect(douala.querySelector('tr.activite')!.querySelectorAll('td')).toHaveLength(10)
  expect(douala.querySelector('tr.activite td.gouttiere')).not.toBeNull()
})

test('activité dépliée par contrat : contrats à zéro masqués, une seule ouverte à la fois', () => {
  render(<Sites d={d} lib={lib} />)
  const vn = screen.getByRole('button', { name: 'Détail par contrat de VN (Douala)' })
  expect(vn).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('CDI')).toBeNull()
  expect(screen.queryByRole('button', { name: /de APV/ })).toBeNull()

  fireEvent.click(vn)
  expect(vn).toHaveAttribute('aria-expanded', 'true')
  const cdi = screen.getByText('CDI').closest('tr')!
  expect(cdi).toHaveClass('contrat')
  expect(cdi).toHaveTextContent(/600.*700.*100/)
  expect(screen.queryByText('CDD')).toBeNull()
  expect(vn.closest('tbody')!.querySelector('th.nom')).toHaveAttribute('rowspan', '4')

  fireEvent.click(screen.getByRole('button', { name: 'Détail par contrat de VN (Yaoundé)' }))
  expect(vn).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getAllByText('CDI')).toHaveLength(1)
})

test('répartition par site : ligne TOTAL GÉNÉRAL avec masse et effectif sur la même ligne', () => {
  const avecTotal = { ...d, c_site_total: { ms: { m1: '20', m: '24', var: '4', var_pct: '0.2' }, effectif: { m: '10', m1: '8', var: '2', var_pct: '0.25' } } } as unknown as Blocs
  render(<Sites d={avecTotal} lib={lib} />)
  expect(screen.getByText('TOTAL GÉNÉRAL').closest('tr')).toHaveTextContent(/20.*24.*8.*10/)
})

test('écart nul en gris, baisse en rouge', () => {
  const baisse = { c_site: [{ site: 'Douala', ms: { m1: '12', m: '10', var: '-2', var_pct: '-0.1667' }, effectif: { m: '4', m1: '4', var: '0', var_pct: '0' } }] } as unknown as Blocs
  const { container } = render(<Sites d={baisse} lib={lib} />)
  const tds = container.querySelectorAll('tr.total-bloc td')
  expect(tds[2]).toHaveClass('neg')
  expect(tds[8]).toHaveClass('nul')
})

test('répartition par service : activité dépliée par contrat, Total service', () => {
  const svc = {
    a_type_charge: [],
    d_contrat: { total: cell },
    b_service_activite: [{
      service: 'SAV PL', total: cell, effectif: cell,
      activites: [{ activite: 'Atelier', ...cell, effectif: cell,
        contrats: { CDI: { ms: { m: '700', m1: '600', var: '100', var_pct: '0.1667' }, effectif: { m: '3', m1: '2', var: '1', var_pct: '0.5' } } } }],
    }],
  } as unknown as Blocs
  render(<ServicesActivites d={svc} lib={lib} />)
  expect(screen.getByText('Total service')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Détail par contrat de Atelier (SAV PL)' }))
  expect(screen.getByText('CDI').closest('tr')).toHaveTextContent(/600.*700.*2.*3/)
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

test('TypesCharge liste les rubriques comptées sans groupe ; les hors total vont dans TypesExclus', () => {
  const r = (rubrique: string, exclu = false) => ({ rubrique, exclu, ...cell })
  const blocs = {
    a_type_charge: [
      r('Salaire brut garantie'),
      r('Bonus', true),
      r('Prime sur ventes'),
      { rubrique: 'TOTAL CHARGES', exclu: false, ...cell },
    ],
  } as unknown as Blocs
  const { container } = render(<TypesCharge d={blocs} lib={lib} />)
  const lignes = [...container.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('th')?.textContent)
  expect(lignes.slice(0, 2)).toEqual(['Salaire brut garantie', 'Prime sur ventes'])
  expect(container.querySelector('tr.exclu')).toBeNull()
  expect(container.querySelector('tr.sous-total')).toBeNull()
  const exclus = render(<TypesExclus d={blocs} lib={lib} />).container
  expect([...exclus.querySelectorAll('tbody tr.exclu th')].map((th) => th.textContent)).toEqual(['Bonus'])
})

test('parts : badges neutres dans les colonnes Part, parts globales sous le nom', () => {
  const avecParts = {
    c_site: [{ ...site('Douala'), part_globale: '0.6', part_masse_globale: '0.7',
      activites: [{ activite: 'VN', ...cell, effectif: cell, part: '0.25', part_masse: '0.4' }] }],
  } as unknown as Blocs
  const { container } = render(<Sites d={avecParts} lib={lib} />)
  expect([...container.querySelectorAll('tr.activite .part-badge')].map((b) => b.textContent?.replace(/\s/g, ' '))).toEqual(['40 %', '25 %'])
  const globales = [...container.querySelectorAll('.part-globale')].map((b) => b.textContent?.replace(/\s/g, ' '))
  expect(globales).toEqual(['Masse globale 70 %', 'Effectif global 60 %'])
  expect(container.querySelectorAll('thead th[scope="col"]')).toHaveLength(11)
})
