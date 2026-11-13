import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import ImportFichier from './ImportFichier'

afterEach(() => vi.restoreAllMocks())

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

test('fichier déjà en vérification : reprise des modifications enregistrées', async () => {
  const lot = { id: 7, statut: 'pret', fichier_nom: 'f.xlsx' }
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
    String(url).includes('/anomalies')
      ? json(200, [])
      : String(url).includes('reprise=reprendre')
      ? json(201, lot)
      : json(409, { detail: { message: 'Vérification en cours pour ce fichier', lot_id: 7, reprise: true, modifications: 3 } }))
  const onLot = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ImportFichier fichier={new File(['x'], 'f.xlsx')} onLot={onLot} onAutre={() => {}} onRetour={() => {}} />
    </QueryClientProvider>,
  )
  expect(await screen.findByText(/3 modifications enregistrées/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Tout annuler et recommencer' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Reprendre la vérification' }))
  await waitFor(() => expect(onLot).toHaveBeenCalledWith(lot))
  // 409, réimport en reprise, puis lecture des points (aucun à confirmer : on avance).
  expect(fetch).toHaveBeenCalledTimes(3)
})

test('export de paie sans mois dans le nom : choix du mois, puis envoi avec année et mois', async () => {
  const lot = { id: 9, statut: 'pret', fichier_nom: 'export.csv' }
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
    String(url).includes('/anomalies')
      ? json(200, [])
      : String(url).includes('mois=10')
      ? json(201, lot)
      : json(422, { detail: 'Mois du fichier introuvable : son nom n’est pas de la forme BrutFinalMMAA. Choisir le mois à importer.' }))
  const onLot = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ImportFichier fichier={new File(['x'], 'export.csv')} onLot={onLot} onAutre={() => {}} onRetour={() => {}} />
    </QueryClientProvider>,
  )
  const form = within(await screen.findByRole('form', { name: 'Mois du fichier' }))
  expect(screen.queryByRole('button', { name: 'Importer ce mois' })).toBeDisabled()
  fireEvent.change(form.getByLabelText('Mois'), { target: { value: '10' } })
  fireEvent.change(form.getByLabelText('Année'), { target: { value: '2026' } })
  fireEvent.click(form.getByRole('button', { name: 'Importer ce mois' }))
  await waitFor(() => expect(onLot).toHaveBeenCalledWith(lot))
  const envoi = fetch.mock.calls.map(([u]) => String(u)).find((u) => u.includes('mois=10'))
  expect(envoi).toMatch(/annee=2026/)
})
