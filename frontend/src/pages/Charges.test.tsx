import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import VersCharges from '../components/VersCharges'
import { viderPartage } from '../lib/filtresPartages'
import { erreurApi, monter } from './admin/testSupport'
import Charges from './Charges'

afterEach(() => {
  vi.restoreAllMocks()
  viderPartage()
})

const cell = (m1: string | null, m: string) => ({
  m1,
  m,
  var: m1 == null ? null : String(Number(m) - Number(m1)),
  var_pct: m1 == null ? null : String((Number(m) - Number(m1)) / Number(m1)),
})
const ligne = (libelle: string, m1: string | null, m: string, part: string, extra: Record<string, unknown> = {}) => ({
  libelle,
  ...cell(m1, m),
  part,
  effectif: 4,
  effectif1: m1 == null ? null : 3,
  effectif_var: m1 == null ? null : 1,
  effectif_var_pct: m1 == null ? null : '0.3333',
  entrees: 1,
  sorties: 0,
  budget: null,
  ecart_budget: null,
  realisation: null,
  ...extra,
})
const sans = { lignes: [], budget_raison: null, budget_total: null }

const donnees = {
  du: '2026-01',
  au: '2026-02',
  partiel: false,
  total: cell('1000000', '1150000'),
  effectif: { n: 8, n1: 6, var: 2, var_pct: '0.3333' },
  entrees: 2,
  sorties: 0,
  hors_total: { montant: '60', nb_rubriques: 1 },
  axes: {
    type: {
      lignes: [ligne('Salaires', '900000', '1000000', '0.87'), ligne('Primes', '100000', '150000', '0.13')],
      budget_raison: null,
      budget_total: null,
    },
    site: {
      lignes: [
        ligne('Douala', '600000', '700000', '0.61', {
          enfants: [ligne('Front office', '350000', '400000', '0.57'), ligne('Back office', '250000', '300000', '0.43')],
        }),
        ligne('Yaoundé', '400000', '450000', '0.39', { enfants: [ligne('Atelier', '400000', '450000', '1')] }),
      ],
      budget_raison: null,
      budget_total: null,
    },
    service: {
      lignes: [
        ligne('Atelier', '1000000', '1150000', '1', {
          enfants: [ligne('Vente', '600000', '700000', '0.61'), ligne('Après-vente', '400000', '450000', '0.39')],
        }),
      ],
      budget_raison: null,
      budget_total: null,
    },
    activite: sans,
    contrat: sans,
  },
  effectifs_contrat: [{ libelle: 'CDI', n: 6, n1: 5, var: 1, var_pct: '0.2', part: '1', entrees: 1, sorties: 0 }],
  activite: [{ cle: 'ventes', libelle: 'Ventes', ...cell('90', '100'), budget: '120', realisation: '0.8333333' }],
  lignes_ca_marge: null,
  cout_par_vente: { n: '11500', n1: '11111', var: '389', var_pct: '0.035' },
  objectifs_atteints: [1, 3],
}

const personnes = Array.from({ length: 12 }, (_, i) => ({
  matricule: `E${i + 1}`,
  nom: i === 0 ? 'Ann Dupont' : i === 1 ? 'Bob Martin' : `Agent ${i + 1}`,
  service: 'Atelier',
  site: 'Douala',
  activite: 'Front office',
  contrat: 'CDI',
  poste: 'Conseiller',
  ...cell('50000', '60000'),
  entree: i === 0,
  sortie: false,
  part: '0.05',
}))

// Mois disponibles : janvier 2025 à février 2026.
const periodes = Array.from({ length: 14 }, (_, i) => ({ annee: 2025 + Math.floor(i / 12), mois: (i % 12) + 1 }))

function ouvrir(perms: string[], chemin = '/charges', charges: unknown = donnees) {
  return monter(
    <Routes>
      <Route path="/charges" element={<Charges />} />
      <Route path="/mensuel" element={<VersCharges />} />
    </Routes>,
    perms,
    (a) => {
      if (a.url.includes('/rapports/periodes')) return periodes
      if (a.url.includes('/rapports/filtres')) return { services: [], sites: [], types_site: [], postes: [] }
      if (a.url.includes('/rapports/salaries')) return []
      if (a.url.includes('/rapports/charges/personnes')) return personnes
      if (a.url.includes('/rapports/charges')) return charges
      return {}
    },
    chemin,
  )
}

const NOMINATIF = ['report:read', 'nominatif:read']
const ligneDe = (nom: RegExp) => screen.findByRole('button', { name: nom })

test('six cartes : cinq cliquables vers leur tableau, Marques annoncée sans lien', async () => {
  ouvrir(['report:read'])
  await screen.findByRole('link', { name: /Types de charge/ })
  expect(document.querySelectorAll('.groupe .case')).toHaveLength(6)
  expect(screen.getAllByRole('link').filter((l) => l.classList.contains('tuile'))).toHaveLength(5)
  for (const [nom, cle] of [[/Types de charge/, 'type'], [/Sites/, 'site'], [/Services/, 'service'], [/Coût par vente/, 'act'], [/Effectifs/, 'eff']] as const) {
    expect(screen.getByRole('link', { name: nom })).toHaveAttribute('href', expect.stringContaining(`#${cle}`))
  }
  expect(screen.getByText('Marques').closest('.case')).not.toHaveAttribute('href')
})

test('clic sur une carte : tableau de l’axe, adresse et fil d’Ariane', async () => {
  ouvrir(['report:read'])
  fireEvent.click(await screen.findByRole('link', { name: /Sites/ }))
  expect(await screen.findByRole('heading', { name: 'Sites' })).toBeInTheDocument()
  expect(screen.getByRole('navigation', { name: "Fil d'Ariane" })).toHaveTextContent('Répartition des charges')
  expect(screen.getByRole('row', { name: /Douala/ })).toHaveTextContent('700 000')
  expect(screen.getByRole('row', { name: /Yaoundé/ })).toBeInTheDocument()
  expect(screen.getByRole('row', { name: /TOTAL/ })).toHaveTextContent('1 150 000')
  // Retour à la vue d'ensemble.
  fireEvent.click(screen.getByRole('button', { name: /Retour/ }))
  expect(await screen.findByRole('link', { name: /Types de charge/ })).toBeInTheDocument()
})

test('adresse avec #site : le tableau s’ouvre directement', async () => {
  ouvrir(['report:read'], '/charges#site')
  expect(await screen.findByRole('row', { name: /Douala/ })).toBeInTheDocument()
  expect(screen.queryByRole('row', { name: /Front office/ })).not.toBeInTheDocument()
})

test('dépliage : le détail apparaît sous la ligne et les lignes sœurs se referment', async () => {
  ouvrir(NOMINATIF, '/charges#site')
  const douala = await ligneDe(/Douala/)
  expect(douala).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(douala)
  expect(await screen.findByRole('row', { name: /Front office/ })).toHaveTextContent('400 000')
  expect(screen.getByRole('row', { name: /Back office/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Douala/ })).toHaveAttribute('aria-expanded', 'true')

  fireEvent.click(screen.getByRole('button', { name: /Yaoundé/ }))
  await waitFor(() => expect(screen.queryByRole('row', { name: /Front office/ })).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: /Douala/ })).toHaveAttribute('aria-expanded', 'false')
})

test('une seule ligne : elle s’ouvre d’elle-même', async () => {
  ouvrir(['report:read'], '/charges#service')
  expect(await screen.findByRole('row', { name: /Après-vente/ })).toBeInTheDocument()
  expect(screen.getByRole('row', { name: /Vente/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Atelier/ })).toHaveAttribute('aria-expanded', 'true')
})

test('échap replie le dernier niveau ouvert', async () => {
  ouvrir(['report:read'], '/charges#site')
  fireEvent.click(await ligneDe(/Douala/))
  await screen.findByRole('row', { name: /Front office/ })
  fireEvent.keyDown(screen.getByRole('row', { name: /Front office/ }), { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('row', { name: /Front office/ })).not.toBeInTheDocument())
})

test('liste de personnes : recherche et pagination, consultation enregistrée', async () => {
  const appels = ouvrir(NOMINATIF, '/charges#site')
  fireEvent.click(await ligneDe(/Douala/))
  fireEvent.click(await ligneDe(/Front office/))
  expect(await screen.findByText('Ann Dupont')).toBeInTheDocument()
  expect(screen.getByText(/Consultation enregistrée/)).toBeInTheDocument()
  const demande = appels.filter((a) => a.url.includes('/rapports/charges/personnes')).at(-1)!
  const p = new URL(demande.url, 'http://x').searchParams
  expect(p.get('axe')).toBe('site')
  expect(p.get('valeur')).toBe('Douala')
  expect(p.get('ligne_activite')).toBe('Front office')

  // Pagination : 12 personnes, 10 par page.
  expect(document.querySelector('.rang')).toHaveTextContent('1–12 sur 12')
  fireEvent.change(screen.getByLabelText(/Par page/), { target: { value: '10' } })
  await waitFor(() => expect(document.querySelector('.rang')).toHaveTextContent('1–10 sur 12'))
  fireEvent.click(screen.getByRole('button', { name: 'Page suivante' }))
  await waitFor(() => expect(document.querySelector('.rang')).toHaveTextContent('11–12 sur 12'))
  expect(screen.queryByText('Ann Dupont')).not.toBeInTheDocument()

  // Recherche sans accent ni casse.
  fireEvent.change(screen.getByLabelText(/Chercher une personne/), { target: { value: 'martin' } })
  expect(await screen.findByText('Bob Martin')).toBeInTheDocument()
  expect(screen.queryByText('Ann Dupont')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText(/Chercher une personne/), { target: { value: 'zzz' } })
  expect(await screen.findByText(/Aucune personne ne correspond/)).toBeInTheDocument()
})

test('activité unique : la liste des personnes suit directement la ligne', async () => {
  ouvrir(NOMINATIF, '/charges#site')
  fireEvent.click(await ligneDe(/Yaoundé/))
  expect(await screen.findByText('Ann Dupont')).toBeInTheDocument()
  expect(document.querySelector('tr.niv1')).toBeNull()
})

test('sans le droit nominatif : aucune liste de personnes, aucune requête nominative', async () => {
  const appels = ouvrir(['report:read'], '/charges#site')
  fireEvent.click(await ligneDe(/Douala/))
  await screen.findByRole('row', { name: /Front office/ })
  expect(screen.queryByRole('button', { name: /Front office/ })).not.toBeInTheDocument()
  // Yaoundé n'a qu'une activité : sans liste de personnes, rien à déplier.
  expect(screen.queryByRole('button', { name: /Yaoundé/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('row', { name: /Front office/ }))
  expect(screen.queryByText('Ann Dupont')).not.toBeInTheDocument()
  expect(appels.some((a) => a.url.includes('/rapports/charges/personnes'))).toBe(false)
})

test('note de comparaison partielle', async () => {
  ouvrir(['report:read'], '/charges', { ...donnees, partiel: true })
  expect(await screen.findByText(/Comparaison partielle/)).toBeInTheDocument()
})

test('pas de note partielle quand la comparaison est complète', async () => {
  ouvrir(['report:read'])
  await screen.findByRole('link', { name: /Types de charge/ })
  expect(screen.queryByText(/Comparaison partielle/)).not.toBeInTheDocument()
})

test('axe Types de charge : rubriques hors total mentionnées en pied', async () => {
  ouvrir(['report:read'], '/charges#type')
  expect(await screen.findByRole('row', { name: /Salaires/ })).toHaveTextContent('1 000 000')
  expect(screen.getByText(/non compris dans le total/)).toBeInTheDocument()
})

test('axe Effectifs : colonnes d’entrées et de sorties', async () => {
  ouvrir(['report:read'], '/charges#eff')
  expect(await screen.findByRole('columnheader', { name: 'Entrées' })).toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: 'Sorties' })).toBeInTheDocument()
  expect(screen.getByRole('row', { name: /TOTAL/ })).toHaveTextContent('100 %')
})

test('axe Activité : indicateurs avec objectif et réalisé', async () => {
  ouvrir(['report:read'], '/charges#act')
  expect(await screen.findByRole('heading', { name: /^Activité/ })).toBeInTheDocument()
  const ventes = screen.getByRole('row', { name: /^Ventes/ })
  expect(within(ventes).getByText('120')).toBeInTheDocument()
  expect(within(ventes).getByText(/83/)).toBeInTheDocument()
  expect(screen.getByRole('row', { name: /Coût par vente/ })).toBeInTheDocument()
  expect(screen.queryByRole('row', { name: /Chiffre d'affaires/ })).not.toBeInTheDocument()
})

test('axe Activité : chiffre d’affaires et marge si le serveur les fournit', async () => {
  ouvrir(['report:read', 'marge:read'], '/charges#act', {
    ...donnees,
    lignes_ca_marge: { ca: cell('5000000', '6000000'), marge: cell('800000', '900000') },
  })
  expect(await screen.findByRole('row', { name: /Chiffre d'affaires/ })).toBeInTheDocument()
  expect(screen.getByRole('row', { name: /Marge/ })).toBeInTheDocument()
})

test('axe sans donnée : message de bloc vide', async () => {
  const vide = { ...donnees, axes: { ...donnees.axes, site: sans } }
  ouvrir(['report:read'], '/charges#site', vide)
  expect(await screen.findByText('Aucune donnée pour cette sélection.')).toBeInTheDocument()
})

test('erreur du serveur : message avec relance', async () => {
  monter(
    <Charges />,
    ['report:read'],
    (a) => {
      if (a.url.includes('/rapports/periodes')) return periodes
      if (a.url.includes('/rapports/filtres')) return { services: [], sites: [], types_site: [], postes: [] }
      if (a.url.includes('/rapports/salaries')) return []
      if (a.url.includes('/rapports/charges')) return erreurApi(500, 'panne')
      return {}
    },
    '/charges',
  )
  await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(1))
})

test('ancienne adresse /mensuel : mois et comparaison repris dans la page des charges', async () => {
  const appels = ouvrir(['report:read'], '/mensuel?annee=2025&mois=3&cmp_periode=2025-01')
  await waitFor(() => expect(appels.some((a) => a.url.includes('/rapports/charges?') && a.url.includes('du='))).toBe(true))
  const u = new URL(appels.filter((a) => a.url.includes('/rapports/charges?')).at(-1)!.url, 'http://x').searchParams
  expect(u.get('du')).toBe('2025-03')
  expect(u.get('au')).toBe('2025-03')
  expect(u.get('cmp_du')).toBe('2025-01')
  expect(u.get('cmp_au')).toBe('2025-01')
})

test('comparaison partielle : même note dans le tableau d’un axe', async () => {
  ouvrir(['report:read'], '/charges#type', { ...donnees, partiel: true })
  expect(await screen.findByText(/Comparaison partielle/)).toBeInTheDocument()
})

test('comparaison partielle : même note dans le tableau de l’activité', async () => {
  ouvrir(['report:read'], '/charges#act', { ...donnees, partiel: true })
  expect(await screen.findByText(/Comparaison partielle/)).toBeInTheDocument()
})

test('note de comparaison des cartes : période comparée en mois abrégés, donnée par le serveur', async () => {
  ouvrir(['report:read'], '/charges', { ...donnees, du: '2026-02', au: '2026-02', cmp_du: '2026-01', cmp_au: '2026-01' })
  expect(await screen.findByText(/comparé à janv\. 2026/)).toBeInTheDocument()
})

test('Primes d’un mois seul : le tableau des types annonce la période comparée', async () => {
  const primes = ligne('Primes', '100000', '150000', '0.13', { cmp_primes: true })
  const type = { ...donnees.axes.type, lignes: [donnees.axes.type.lignes[0], primes] }
  ouvrir(['report:read'], '/charges#type', {
    ...donnees, du: '2026-02', au: '2026-02', cmp_primes_du: '2025-02', cmp_primes_au: '2025-02', axes: { ...donnees.axes, type },
  })
  expect(await screen.findByText(/Primes : comparées à févr\. 2025/)).toBeInTheDocument()
  expect(screen.getByRole('rowheader', { name: 'Primes' })).toHaveAttribute('title', expect.stringContaining('même mois'))
})

test('axe Effectifs : écart d’effectif donné par le serveur', async () => {
  ouvrir(['report:read'], '/charges#eff')
  const total = await screen.findByRole('row', { name: /TOTAL/ })
  expect(total).toHaveTextContent('+2')
})
