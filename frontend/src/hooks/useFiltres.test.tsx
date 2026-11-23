import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { avecCascade, compatibles, facettes, sansIncompatibles, useFiltres } from './useFiltres'

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

test('pages annuelles : sans choix, le dernier mois comparé au mois d\'avant', async () => {
  const { result } = renderHook(() => useFiltres({ avecMois: false, comparaison: 'annee' }), { wrapper: enveloppe() })
  await waitFor(() => expect(result.current.filtres).toMatchObject({
    annee: 2026, mois: 2, du: '2026-02', au: '2026-02', cmp_du: '2026-01', cmp_au: '2026-01',
  }))
  expect(result.current.periode).toMatchObject({ min: 2025 * 12 + 11, max: 2026 * 12 + 1 })
})

test('un lien qui porte la période et la comparaison les impose dès le premier rendu', async () => {
  const { result } = renderHook(() => useFiltres({ avecMois: false, comparaison: 'annee' }), {
    wrapper: enveloppe('/?periode=2025-04..2026-03&comparee=2024-04..2025-03'),
  })
  await waitFor(() => expect(result.current.filtres).toMatchObject({
    annee: 2025, mois: 3, du: '2025-04', au: '2026-03', cmp_du: '2024-04', cmp_au: '2025-03',
  }))
  expect(result.current.calendrier).toBe('fiscal')
  // une comparaison qui n'a pas la même longueur est écartée au profit du défaut
  act(() => result.current.set({ comparee: '2025-01' }))
  expect(result.current.filtres).toMatchObject({ cmp_du: '2024-04', cmp_au: '2025-03' })
})

test('anciens liens : année, vue et mois traduits en période, puis anciennes clés retirées', async () => {
  const { result } = renderHook(() => useFiltres({ avecMois: false, comparaison: 'annee' }), {
    wrapper: enveloppe('/?annee=2025&vue=mois&fin=3&cmp_annee=2024'),
  })
  await waitFor(() => expect(result.current.filtres).toMatchObject({ du: '2025-03', au: '2025-03', cmp_du: '2025-02' }))
  await waitFor(() => expect(result.current.partage.vue).toBeUndefined())
  expect(result.current.partage).toMatchObject({ periode: '2025-03' })
  expect(result.current.partage.cmp_annee).toBeUndefined()
})

test('une nouvelle période remet la comparaison à son défaut ; une nouvelle année, le mois et la comparaison mensuelle', () => {
  const actuel = { annee: '2026', mois: '2', periode: '2026-02', comparee: '2025-02', cmp_periode: '2025-12', service: 'SAV PL' }
  expect(avecCascade({ periode: '2026-01' }, actuel)).toEqual({ periode: '2026-01', comparee: undefined })
  expect(avecCascade({ periode: '2026-02' }, actuel)).toEqual({ periode: '2026-02' })
  expect(avecCascade({ periode: '2026-01', comparee: '2025-01' }, actuel)).toEqual({ periode: '2026-01', comparee: '2025-01' })
  expect(avecCascade({ annee: 2025 }, actuel)).toEqual({ annee: 2025, mois: undefined, cmp_periode: undefined })
})

test("exercice fiscal : une période avril → mars donne l'exercice, le calendrier fiscal et les années d'exercice", async () => {
  const { result } = renderHook(() => useFiltres({ avecMois: false, comparaison: 'annee', avecCalendrier: true }), {
    wrapper: enveloppe('/?periode=2025-04..2026-03'),
  })
  await waitFor(() => expect(result.current.filtres).toMatchObject({ annee: 2025, mois: 3, calendrier: 'fiscal' }))
  expect(result.current.calendrier).toBe('fiscal')
  expect(result.current.annees).toEqual([2025])
  // une page sans calendrier reste civile
  const civil = renderHook(() => useFiltres({ comparaison: 'periode' }), { wrapper: enveloppe() })
  await waitFor(() => expect(civil.result.current.filtres).toMatchObject({ annee: 2026, mois: 2 }))
  expect(civil.result.current.filtres?.calendrier).toBeUndefined()
})

// [service, site, type de site, activité, contrat, poste]
const COMBIS = [
  ['DPS', 'SAV PL', 'Douala', 'principal', 'Atelier', 'CDI', 'Mécanicien'],
  ['DPS', 'SAV PL', 'Kribi', 'deporte', 'Atelier', 'CDD', ''],
  ['', 'Commerce VN', 'Douala', 'principal', 'Vente', 'CDI', 'Vendeur'],
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

test("filtres partagés venus d'une autre page : ceux sans correspondance sont écartés, dans l'ordre des filtres", () => {
  expect(compatibles(COMBIS, { service: 'Commerce VN', site: 'Kribi' })).toEqual({ service: 'Commerce VN' })
  expect(compatibles(COMBIS, { site: 'Kribi', type_contrat: 'CDD' })).toEqual({ site: 'Kribi', type_contrat: 'CDD' })
  // Employé : 8e colonne quand la session a le droit nominatif, ignorée sinon.
  const nominatives = COMBIS.map((c, i) => [...c, `E${i + 1}`])
  expect(compatibles(nominatives, { site: 'Kribi', matricule: 'E1' })).toEqual({ site: 'Kribi' })
  expect(compatibles(nominatives, { matricule: 'E3' })).toEqual({ matricule: 'E3' })
  expect(facettes(nominatives, { site: 'Douala' }).matricule).toEqual(['E1', 'E3'])
  expect(compatibles(COMBIS, { matricule: 'E9' })).toEqual({ matricule: 'E9' })
})

test('sélection multiple (R4) : valeurs jointes par « | », réduites aux seules compatibles', () => {
  // les facettes d'un autre filtre suivent l'union des choix
  expect(facettes(COMBIS, { site: 'Douala|Kribi' }).type_site).toEqual(['deporte', 'principal'])
  expect(facettes(COMBIS, { service: 'SAV PL|Commerce VN' }).poste).toEqual(['Mécanicien', 'Vendeur'])
  // un nouveau choix réduit une sélection multiple à ses valeurs encore possibles
  expect(sansIncompatibles(COMBIS, { site: 'Douala|Kribi' }, { service: 'Commerce VN' })).toEqual({
    service: 'Commerce VN',
    site: 'Douala',
  })
  expect(sansIncompatibles(COMBIS, { site: 'Douala|Kribi' }, { service: 'SAV PL' })).toEqual({ service: 'SAV PL' })
  expect(compatibles(COMBIS, { service: 'Commerce VN', site: 'Kribi|Douala' })).toEqual({ service: 'Commerce VN', site: 'Douala' })
})
