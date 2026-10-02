import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '../auth/AuthContext'
import RequireAuth from '../auth/RequireAuth'
import Annuel from './Annuel'
import Individuel from './Individuel'
import Resume from './Resume'

const cell = (m: string | null) => ({ m1: m, m, var: '0', var_pct: '0' })
const serie = Array.from({ length: 12 }, (_, i) => ({
  mois: i + 1, ms: i < 2 ? '1000' : null, effectif: null, absences: null, commissions: null, primes: null,
}))

function routes(avecMarge: boolean, perms: string[]) {
  return (url: string): unknown => {
    if (url.includes('/auth/me')) return { id: 1, email: 'a@b.c', roles: [], permissions: perms }
    if (url.includes('/rapports/periodes')) return [{ annee: 2026, mois: 2, statut: 'ouverte' }]
    if (url.includes('/rapports/filtres')) return { services: [], sites: [] }
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
})

test('Résumé : tuiles marge absentes sans la permission', async () => {
  rendu(<Resume />, '/resume', ['report:read'])
  await screen.findByText('Masse salariale', { selector: '.micro' })
  expect(screen.queryByText('Marge', { selector: '.micro' })).toBeNull()
  expect(screen.queryByText('Chiffre d’affaires')).toBeNull()
})

test('Annuel : affiche Nb de mois saisis', async () => {
  rendu(<Annuel />, '/annuel', ['report:read'])
  expect(await screen.findByText('Nb de mois saisis')).toBeInTheDocument()
})

test('Individuel : message sans matricule', async () => {
  rendu(<Individuel />, '/individuel', ['report:read', 'nominatif:read'])
  expect(await screen.findByText('Sélectionnez un employé')).toBeInTheDocument()
})

test('Individuel : accès refusé sans nominatif:read', async () => {
  rendu(<Individuel />, '/individuel', ['report:read'])
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Accès refusé'))
})
