import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { Cell } from '../api/types'
import { Activite, type Blocs, Contrats, ServicesActivites, Sites, TypesCharge, TypesExclus } from './BlocsRapport'

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

test('activité dépliée par contrat : contrats à zéro masqués, ouvrir un autre site replie le précédent', () => {
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

test('clic sur le site : toutes ses activités dépliées, bordure gauche, un seul site ouvert', () => {
  const deux = { c_site: [site('Douala'), site('Yaoundé')].map((s) => ({ ...s, activites: [s.activites[0], { ...s.activites[0], activite: 'VO' }] })) } as unknown as Blocs
  const { container } = render(<Sites d={deux} lib={lib} />)
  const douala = screen.getByRole('button', { name: 'Détail par contrat de toutes les activités (Douala)' })
  fireEvent.click(douala)
  expect(douala).toHaveAttribute('aria-expanded', 'true')
  expect(douala.closest('th')).toHaveClass('ouvert')
  expect(screen.getAllByText('CDI')).toHaveLength(2)
  // replier une activité laisse l'autre ouverte
  fireEvent.click(screen.getByRole('button', { name: 'Détail par contrat de VO (Douala)' }))
  expect(screen.getAllByText('CDI')).toHaveLength(1)
  expect(douala).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(screen.getByRole('button', { name: 'Détail par contrat de toutes les activités (Yaoundé)' }))
  expect(container.querySelectorAll('th.nom.ouvert')).toHaveLength(1)
  expect(screen.getAllByText('CDI')).toHaveLength(2)
  expect(screen.getByRole('button', { name: 'Détail par contrat de VN (Douala)' })).toHaveAttribute('aria-expanded', 'false')
})

test('en-tête de la répartition sur une seule ligne', () => {
  const { container } = render(<Sites d={d} lib={lib} />)
  expect(container.querySelectorAll('table.repartition thead tr')).toHaveLength(1)
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

test('Activité : thèmes fusionnés, colonnes Réalisé puis Objectif avec taux de réalisation', () => {
  const lignes = [
    { cle: 'ventes', libelle: 'Ventes', groupe: 'Commercial', ...cell, budget: '10', ecart: '2', ecart_pct: '0.2', realisation: '1.2' },
    { cle: 'productivite', libelle: 'Productivité', groupe: 'Productivité', ...cell, budget: '3', ecart: '-0.5', ecart_pct: '-0.1667', realisation: '0.8' },
    { cle: 'devis', libelle: 'Devis', groupe: 'Atelier', ...cell },
    { cle: 'transformation', libelle: 'Taux de transformation', groupe: 'Atelier', m1: '0.5', m: '0.75', var: '0.25', var_pct: '0.5' },
  ]
  const { container } = render(<Activite lignes={lignes} lib={lib} titre="4. Activité" />)
  expect(screen.getByText('Réalisé')).toBeInTheDocument()
  expect(screen.getAllByRole('columnheader').map((th) => th.textContent).filter(Boolean)).toEqual(
    ['4. Activité', 'Réalisé', 'Objectif', 'Thème', 'Indicateur', 'M-1', 'M', 'Écart', 'Écart %', 'Objectif', 'Écart', 'Réalisation'],
  )
  // Un tbody par thème, thème fusionné sur ses lignes.
  expect(container.querySelectorAll('tbody.bloc')).toHaveLength(3)
  expect(screen.getByRole('rowheader', { name: 'Atelier' })).toHaveAttribute('rowspan', '2')
  const ventes = cellsTr(screen.getByText('Ventes').closest('tr')!)
  expect(ventes.at(-2)!.className).toBe('num bon')
  expect(ventes.at(-1)!.querySelector('.jauge.atteint')).not.toBeNull()
  const prod = cellsTr(screen.getByText('Productivité', { selector: 'th.libelle' }).closest('tr')!)
  expect(prod.at(-2)!.className).toBe('num neg')
  expect(prod.at(-1)!.querySelector('.jauge:not(.atteint)')).not.toBeNull()
  // Sans objectif : une cellule vide sur les trois colonnes.
  expect(cellsTr(screen.getByText('Devis').closest('tr')!).at(-1)).toHaveAttribute('colspan', '3')
  // Le taux de transformation s'affiche en pourcentage.
  expect(screen.getByText('Taux de transformation').closest('tr')!.textContent).toMatch(/75\s*%/)
})

test('Contrats : structure de répartition, masse et effectif côte à côte, total par contrat', () => {
  const c = (m: string) => ({ m1: m, m, var: '0', var_pct: '0' })
  const total = { rubrique: 'TOTAL CHARGES', exclu: false, ...c('100') }
  const d = {
    a_type_charge: [total],
    d_contrat: {
      effectifs: [], indicateurs: [], ventilation: [], total: c('5'),
      blocs: [{ contrat: 'CDI', total: c('100'), effectif: c('5'), part_globale: '1', part_masse_globale: '1',
        activites: [{ activite: 'VN', ...c('100'), effectif: c('5'), part: '1', part_masse: '1' }] }],
    },
  } as unknown as Blocs
  render(<Contrats d={d} lib={lib} titre="5. Répartition par nature de contrat" />)
  expect(screen.getByText('Masse salariale (FCFA)')).toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: 'Contrat' })).toBeInTheDocument()
  expect(screen.getByRole('rowheader', { name: 'Total contrat' })).toBeInTheDocument()
  expect(screen.getByRole('rowheader', { name: 'TOTAL GÉNÉRAL' })).toBeInTheDocument()
  expect(screen.queryByText('Budget')).toBeNull()
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

test('Activité : la masse salariale par vente est un coût, atteint quand elle reste à l’objectif ou en dessous', () => {
  const lignes = [
    { cle: 'ms_par_vente', libelle: 'MS par vente', groupe: 'Commercial', ...cell, budget: '10', ecart: '-2', ecart_pct: '-0.2', realisation: '0.8' },
    { cle: 'ventes', libelle: 'Ventes', groupe: 'Commercial', ...cell, budget: '10', ecart: '-2', ecart_pct: '-0.2', realisation: '0.8' },
  ]
  const { container } = render(<Activite lignes={lignes} lib={lib} titre="4. Activité" />)
  const ms = cellsTr(screen.getByText('MS par vente').closest('tr')!)
  expect(ms.at(-2)!.className).toBe('num bon')
  expect(ms.at(-1)!.querySelector('.jauge')).toHaveClass('atteint')
  const ventes = cellsTr(screen.getByText('Ventes').closest('tr')!)
  expect(ventes.at(-2)!.className).toBe('num neg')
  expect(ventes.at(-1)!.querySelector('.jauge')).not.toHaveClass('atteint')
  expect(container.querySelectorAll('.jauge')).toHaveLength(2)
})
