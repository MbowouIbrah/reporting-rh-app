import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { useFiltres } from './useFiltres'

const PERIODES = [{ annee: 2025, mois: 12 }, { annee: 2026, mois: 1 }, { annee: 2026, mois: 2 }]

function enveloppe(chemin = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[chemin]}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (u) =>
    new Response(JSON.stringify(String(u).includes('/periodes') ? PERIODES : { services: [], sites: [] })),
  )
})
afterEach(() => vi.restoreAllMocks())

test('un filtre choisi sur une page vaut pour les autres ; une nouvelle année remet mois et comparaison à zéro', async () => {
  const mensuel = renderHook(() => useFiltres({ comparaison: 'periode' }), { wrapper: enveloppe() })
  await waitFor(() => expect(mensuel.result.current.filtres).toMatchObject({ annee: 2026, mois: 2 }))
  act(() => mensuel.result.current.set({ mois: 1, cmp_periode: '2025-12', service: 'SAV PL' }))
  expect(mensuel.result.current.filtres).toMatchObject({ mois: 1, ref_annee: 2025, ref_mois: 12, service: 'SAV PL' })

  // Autre page : même service ; le mois partagé n'est pas affiché, donc ignoré (dernier mois saisi)
  const annuel = renderHook(() => useFiltres({ avecMois: false, comparaison: 'annee' }), { wrapper: enveloppe() })
  await waitFor(() => expect(annuel.result.current.filtres).toMatchObject({ annee: 2026, mois: 2, service: 'SAV PL' }))
  expect(annuel.result.current.filtres?.ref_annee).toBeUndefined()

  act(() => annuel.result.current.set({ annee: 2025 }))
  expect(mensuel.result.current.filtres).toMatchObject({ annee: 2025, mois: 12, service: 'SAV PL' })
  expect(mensuel.result.current.filtres?.ref_annee).toBeUndefined()
})

test('un lien qui porte des filtres les impose dès le premier rendu', async () => {
  const { result } = renderHook(() => useFiltres({ comparaison: 'annee' }), {
    wrapper: enveloppe('/?annee=2025&cmp_annee=2026'),
  })
  await waitFor(() => expect(result.current.filtres).toMatchObject({ annee: 2025, mois: 12, ref_annee: 2026 }))
})
