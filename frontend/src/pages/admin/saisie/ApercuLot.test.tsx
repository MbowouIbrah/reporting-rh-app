import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { Lot } from '../../../api/saisie'
import ApercuLot from './ApercuLot'

// Les tableaux du Reporting mensuel sont testés avec Mensuel : ici on vérifie seulement ce qu'ils reçoivent.
vi.mock('../../Mensuel', () => ({
  Contenu: ({ lib }: { lib: { prec: string; cour: string } }) => <p>Tableaux {lib.cour} / {lib.prec}</p>,
}))

afterEach(() => vi.restoreAllMocks())

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const lot = (plus: Partial<Lot> = {}): Lot => ({
  id: 5, fichier_nom: 'BrutFinal1026.csv', statut: 'pret', nb_lignes: 1, nb_bloquants: 0, nb_avert: 0, stats: null, ...plus,
})

const apercu = (l: Lot) => ({
  lot: l, nouvelle: 1, modifiee: 0, identique: 0, effaces: 0, nouveaux_salaries: [],
  employes: { total: 1, nouveaux: 0, existants: 1 }, total_lot: '1000', absents: [], nb_absents: 0,
  lignes: [{ annee: 2026, mois: 10, matricule: 'EMP1', nom: 'A', nouveau_salarie: false, statut: 'nouvelle', total_avant: null, total_apres: '1000', changements: [] }],
})

function rendre(l: Lot) {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (u) => {
    const url = String(u)
    if (url.includes('/apercu-mois')) {
      return json(200, { annee: 2026, mois: url.includes('mois=9') ? 9 : 10, periodes: [[2026, 9], [2026, 10]], mensuel: {} })
    }
    return json(200, apercu(l))
  })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ApercuLot lot={l} parcours="fichier" onRetour={vi.fn()} onFini={vi.fn()} />
    </QueryClientProvider>,
  )
  return fetch
}

test('« Voir le mois » montre les tableaux du mois calculés sur le lot, puis revient aux contrôles', async () => {
  const fetch = rendre(lot())
  fireEvent.click(await screen.findByRole('button', { name: 'Voir le mois' }))
  expect(await screen.findByText('Tableaux Octobre 2026 / Septembre 2026')).toBeTruthy()
  expect(screen.getByRole('region', { name: 'Détail de l\'aperçu', hidden: true })).not.toBeVisible()
  const appel = fetch.mock.calls.find(([u]) => String(u).includes('/imports/5/apercu-mois'))!
  expect(JSON.parse(String(appel[1]!.body))).toEqual({ garder: [] })
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '2026-9' } })
  expect(await screen.findByText('Tableaux Septembre 2026 / Août 2026')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Revenir aux contrôles' }))
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Aperçu du mois' })).toBeNull())
})

test('fichier du dossier : le bouton final s’appelle « Rendre disponible »', async () => {
  rendre(lot({ origine: 'dossier' }))
  expect(await screen.findByRole('button', { name: 'Rendre disponible' })).toBeTruthy()
})

test('envoi manuel : le bouton final garde « Enregistrer 1 ligne »', async () => {
  rendre(lot({ origine: 'manuel' }))
  expect(await screen.findByRole('button', { name: 'Enregistrer 1 ligne' })).toBeTruthy()
})
