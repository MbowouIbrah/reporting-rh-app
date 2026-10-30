import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '../auth/AuthContext'
import RequireAuth from '../auth/RequireAuth'
import Annuel from './Annuel'
import Individuel from './Individuel'
import Resume from './Resume'

// Bloc ACTIVITÉ de l'annuel : null tant qu'aucune donnée d'activité n'existe.
let activiteAnnuel: unknown = null
const cell = (m: string | null) => ({ m1: m, m, var: '0', var_pct: '0' })
const serie = Array.from({ length: 12 }, (_, i) => ({
  mois: i + 1, ms: i < 2 ? '1000' : null, effectif: null, absences: null, commissions: null, primes: null,
}))

function routes(avecMarge: boolean, perms: string[]) {
  return (url: string): unknown => {
    if (url.includes('/auth/me')) return { id: 1, email: 'a@b.c', fonction: '', permissions: perms }
    if (url.includes('/rapports/periodes')) return [{ annee: 2026, mois: 2 }]
    if (url.includes('/rapports/filtres')) return { services: [], sites: [], types_site: ['principal', 'agence'], postes: ['Chef atelier'] }
    if (url.includes('/rapports/individuel/tous')) return {
        annee: 2026, matricule: null, nom: null,
        rubriques: ['Salaire brut garanti', 'Commission', 'Logement site déporté'],
        exclues: ['Salaire brut garanti'],
        mois: [
          { mois: 1, present: true, effectif: 2, deporte: false, total: '150',
            montants: { 'Salaire brut garanti': '900', Commission: '150', 'Logement site déporté': '0' },
            staff: { 'Salaire brut garanti': 2, Commission: 1, 'Logement site déporté': 0 } },
          { mois: 2, present: false },
        ],
      }
    if (url.includes('/rapports/salaries')) return [{ matricule: 'E1', nom: 'Ann' }]
    if (url.includes('/rapports/mensuel'))
      return {
        synthese: {
          ms: cell('1000'), commissions: cell('10'), primes_total: cell('5'),
          ...(avecMarge ? { ca: null, marge: null, taux_marge: null } : {}),
        },
        controles: [], a_type_charge: [], b_service_activite: [], c_site: [],
        d_contrat: { effectifs: [], indicateurs: [], ventilation: [], total: cell('0') },
      }
    if (url.includes('/rapports/annuel'))
      return {
        serie_n: serie.map((s) => (avecMarge ? { ...s, ca: null, marge: null, taux_marge: null } : s)),
        serie_n1: serie, cumul_ytd: { ...cell('2000'), nb_mois: 2, nb_mois_n1: 2 },
        moyenne_mensuelle: cell('1000'), cumul_annee_n1: null, par_service: [],
        commissions_cumul: cell('10'), primes_cumul: cell('5'), effectif_moyen: cell('4'),
        frais_mission_ytd: '7', logement_ytd: '3', mois_fin: 2, effectif_fin: cell('4'),
        effectif_fin_contrat: { CDI: { ...cell('3'), part: '0.75' }, MAD: { ...cell('1'), part: '0.25' } },
        mad_fin: cell('2'), mad_deportes_fin: { ...cell('1'), part: '0.5' },
        ms_contrat: { CDI: { ...cell('1500'), part: '0.75' }, MAD: { ...cell('500'), part: '0.25' } },
        ...(avecMarge ? { ca_ytd: null, marge_ytd: null, ca_cumul: cell(null), ca_par_effectif: cell(null) } : {}),
        activite: activiteAnnuel,
        a_type_charge: [], b_service_activite: [], c_site: [],
        d_contrat: { effectifs: [], indicateurs: [{ contrat: 'TOTAL', debut: null, recrutements: null, departs: null, fin: 0, taux_rotation: null, absences: '0', taux_absenteisme: null }], ventilation: [], total: cell('0') },
      }
    return {}
  }
}

function rendu(ui: ReactNode, chemin: string, perms: string[], avecMarge = false) {
  const r = routes(avecMarge, perms)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (u) => new Response(JSON.stringify(r(String(u)))))
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <MemoryRouter initialEntries={[chemin]}>
          <Routes>
            <Route path="/individuel" element={<RequireAuth perm="nominatif:read">{ui}</RequireAuth>} />
            <Route path="*" element={<RequireAuth>{ui}</RequireAuth>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

test('Résumé : marge vide (jamais 0) quand le CA est absent', async () => {
  rendu(<Resume />, '/resume', ['report:read', 'marge:read'], true)
  const tuile = (await screen.findByText('Marge', { selector: '.micro' })).closest('.tuile')!
  expect(tuile).toHaveTextContent('—')
  expect(tuile).not.toHaveTextContent('0')
  expect(tuile).toHaveTextContent(/Taux de marge\s*—/)
  expect(tuile).not.toHaveTextContent('vs')
  expect(screen.getByText('CA par salarié', { selector: '.micro' })).toBeInTheDocument()
  expect(screen.queryByText(/Masse salariale \d{4}/)).toBeNull()
})

test('Résumé : effectif global de fin, évolution et répartition par contrat en bulle', async () => {
  rendu(<Resume />, '/resume', ['report:read'])
  const tuile = (await screen.findByText('Évolution par rapport à Fév 2025')).closest('.tuile')!
  expect(tuile).toHaveTextContent(/Effectif global4Évolution par rapport à Fév 2025/)
  expect(tuile.querySelector('[role="tooltip"]')).toHaveTextContent(/CDI3 \(75\s%\)MAD1 \(25\s%\)/)
  expect(tuile.querySelector('[role="tooltip"]')).not.toHaveTextContent(/Effectif fin/)
  expect(document.querySelector('.cases')).not.toHaveTextContent(/mois saisi/)
  expect(screen.queryByText('CA par salarié', { selector: '.micro' })).toBeNull()
})

test('Résumé : MAD globaux, dont sites déportés avec leur part, masse salariale par contrat', async () => {
  rendu(<Resume />, '/resume', ['report:read'])
  const tuile = (await screen.findByText('Pourcentage MAD sites déportés')).closest('.tuile')!
  expect(tuile).toHaveTextContent(/MAD globaux2Pourcentage MAD sites déportés1 · 50\s%/)
  expect(tuile.querySelector('[role="tooltip"]')).toHaveTextContent(/MAD sites déportés1Part des MAD globaux50\s%/)
  const ms = screen.getByText('Masse salariale', { selector: '.micro' }).closest('.tuile')!
  expect(ms.querySelector('[role="tooltip"]')).toHaveTextContent(/MAD500\sFCFA \(25\s%\)/)
  expect(ms.querySelector('[role="tooltip"]')).not.toHaveTextContent(/Écart|Mois saisis/)
  expect(screen.queryByText(/MOYENNE MENSUELLE/)).toBeNull()
})

test('Résumé : tableau avec frais de mission, logement et ligne de total', async () => {
  rendu(<Resume />, '/resume', ['report:read'])
  await screen.findByText('TOTAL')
  const entetes = [...document.querySelectorAll('.suivi thead th')].map((t) => t.textContent)
  expect(entetes).toEqual(['MOIS', 'MASSE SALARIALE', 'COMMISSIONS', 'PRIMES PROD.', 'FRAIS DE MISSION', 'LOGEMENT SITE DÉPORTÉ'])
  expect(document.querySelector('.suivi tfoot')).toHaveTextContent(/TOTAL.*7.*3/)
})

test('Résumé : avec un filtre, tuiles CA et marge gardées avec « — »', async () => {
  rendu(<Resume />, '/resume?type_site=agence', ['report:read', 'marge:read'], true)
  for (const titre of ['Chiffre d’affaires', 'Marge', 'CA par salarié']) {
    const tuile = (await screen.findByText(titre, { selector: '.micro' })).closest('.tuile')!
    expect(tuile).toHaveTextContent(`${titre}—Non disponible pour ces filtres`)
  }
  expect(screen.getByText(/ne sont pas disponibles/)).toBeInTheDocument()
})

test('Résumé : tuiles marge absentes sans la permission', async () => {
  rendu(<Resume />, '/resume', ['report:read'])
  await screen.findByText('Masse salariale', { selector: '.micro' })
  expect(screen.queryByText('Marge', { selector: '.micro' })).toBeNull()
  expect(screen.queryByText('Chiffre d’affaires')).toBeNull()
})

test('Annuel : affiche la moyenne mensuelle', async () => {
  rendu(<Annuel />, '/annuel', ['report:read'])
  expect(await screen.findByText(/Moyenne mensuelle/)).toBeInTheDocument()
})

test('Annuel : bloc Activité masqué sans donnée, affiché avec la mention « partiel »', async () => {
  rendu(<Annuel />, '/annuel', ['report:read'])
  await screen.findByText(/Moyenne mensuelle/)
  expect(screen.queryByText('6. Activité')).toBeNull()
  activiteAnnuel = [
    { cle: 'ventes', libelle: 'Ventes', ...cell('12'), partiel: true },
    { cle: 'productivite', libelle: 'Productivité', ...cell('1.5') },
  ]
  try {
    rendu(<Annuel />, '/annuel', ['report:read'])
    expect(await screen.findByText('6. Activité')).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: /Ventes\s*partiel/ })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: 'Productivité' })).toBeInTheDocument()
  } finally {
    activiteAnnuel = null
  }
})

test('Annuel : filtres type de site, poste et employé (employé réservé au nominatif)', async () => {
  const { unmount } = rendu(<Annuel />, '/annuel', ['report:read', 'nominatif:read'])
  expect(await screen.findByRole('combobox', { name: 'Employé' })).toBeInTheDocument()
  expect(await screen.findByLabelText('Type de site')).toHaveTextContent('Agence')
  expect(await screen.findByLabelText('Poste')).toHaveTextContent('Chef atelier')
  unmount()
  rendu(<Annuel />, '/annuel', ['report:read'])
  expect(await screen.findByLabelText('Type de site')).toBeInTheDocument()
  expect(screen.queryByRole('combobox', { name: 'Employé' })).toBeNull()
})

test('Individuel : tous les salariés par défaut', async () => {
  rendu(<Individuel />, '/individuel', ['report:read', 'nominatif:read'])
  expect(await screen.findByRole('region', { name: 'Reporting individuel' })).toBeInTheDocument()
  await screen.findAllByText('150')
  const entetes = screen.getAllByRole('columnheader').map((th) => th.textContent)
  // colonnes exclues en tête, juste après le mois
  expect(entetes.slice(1, 4)).toEqual(['Salaire brut garanti', 'Commission', 'Logement site déporté'])
  const janvier = screen.getByRole('rowheader', { name: 'Janvier' }).closest('tr')!
  // logement sans objet hors site déporté, colonne exclue hachurée, total servi par le serveur
  expect(janvier.cells[1]).toHaveClass('exclu')
  expect(janvier.cells[3]).toHaveTextContent('-')
  expect(janvier.cells[4]).toHaveTextContent('150')
})

test('Individuel sans nominatif:read : renvoyé au Résumé, la page n’est pas révélée', async () => {
  // Route « * » : la redirection vers /resume affiche ce repère au lieu de la page.
  rendu(<p>Accueil</p>, '/individuel', ['report:read'])
  expect(await screen.findByText('Accueil')).toBeInTheDocument()
  expect(screen.queryByText('Accès refusé')).not.toBeInTheDocument()
})
