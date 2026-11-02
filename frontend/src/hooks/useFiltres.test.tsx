import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { avecCascade, facettes, sansIncompatibles, useFiltres } from './useFiltres'

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

test("changer de calendrier ou d'exercice remet la comparaison annuelle à zéro, sans toucher au mois", () => {
  const actuel = { annee: '2026', mois: '2', cmp_annee: '2025', cmp_periode: '2025-12', service: 'SAV PL' }
  expect(avecCascade({ calendrier: 'fiscal' }, actuel)).toEqual({ calendrier: 'fiscal', cmp_annee: undefined })
  expect(avecCascade({ exercice: 2024 }, actuel)).toEqual({ exercice: 2024, cmp_annee: undefined })
  expect(avecCascade({ calendrier: 'fiscal' }, { ...actuel, calendrier: 'fiscal' })).toEqual({ calendrier: 'fiscal' })
})

test("en fiscal : années d'exercice, exercice et mois par défaut", async () => {
  const { result } = renderHook(() => useFiltres({ avecMois: false, comparaison: 'annee', avecCalendrier: true }), {
    wrapper: enveloppe('/?calendrier=fiscal'),
  })
  await waitFor(() => expect(result.current.filtres).toMatchObject({ annee: 2025, mois: 2, calendrier: 'fiscal' }))
  expect(result.current.calendrier).toBe('fiscal')
  expect(result.current.annees).toEqual([2025])
  // une page sans calendrier reste civile
  const civil = renderHook(() => useFiltres({ comparaison: 'periode' }), { wrapper: enveloppe() })
  await waitFor(() => expect(civil.result.current.filtres).toMatchObject({ annee: 2026, mois: 2 }))
  expect(civil.result.current.filtres?.calendrier).toBeUndefined()
  // choisir un exercice ne change pas l'année civile de Mensuel
  act(() => result.current.set({ annee: 2024 }))
  expect(result.current.filtres).toMatchObject({ annee: 2024, mois: 3 })
  expect(civil.result.current.filtres).toMatchObject({ annee: 2026, mois: 2 })
})

// [service, site, type de site, activité, contrat, poste]
const COMBIS = [
  ['SAV PL', 'Douala', 'principal', 'Atelier', 'CDI', 'Mécanicien'],
  ['SAV PL', 'Kribi', 'deporte', 'Atelier', 'CDD', ''],
  ['Commerce VN', 'Douala', 'principal', 'Vente', 'CDI', 'Vendeur'],
]

test('facettes : seules les valeurs compatibles avec les autres choix, la valeur choisie gardée', () => {
  const f = facettes(COMBIS, { service: 'SAV PL' })
  expect(f.site).toEqual(['Douala', 'Kribi'])
  expect(f.service).toEqual(['Commerce VN', 'SAV PL']) // sa propre liste ne se restreint pas
  expect(f.poste).toEqual(['Mécanicien']) // valeur vide jamais proposée
  expect(facettes(COMBIS, { type_site: 'deporte' }).type_contrat).toEqual(['CDD'])
  expect(facettes(COMBIS, { site: 'Kribi', type_contrat: 'CDI' }).site).toEqual(['Douala', 'Kribi'])
})

test('un nouveau choix efface les filtres devenus incompatibles', () => {
  expect(sansIncompatibles(COMBIS, { site: 'Kribi', type_contrat: 'CDD' }, { service: 'Commerce VN' })).toEqual({
    service: 'Commerce VN',
    site: undefined,
    type_contrat: undefined,
  })
  expect(sansIncompatibles(COMBIS, { site: 'Douala' }, { service: 'Commerce VN' })).toEqual({ service: 'Commerce VN' })
  expect(sansIncompatibles(COMBIS, { site: 'Kribi' }, { service: undefined })).toEqual({ service: undefined })
})
