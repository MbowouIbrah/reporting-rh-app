import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import ImportFichier from './ImportFichier'

afterEach(() => vi.restoreAllMocks())

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

test('fichier déjà en vérification : reprise des modifications enregistrées', async () => {
  const lot = { id: 7, statut: 'pret', fichier_nom: 'f.xlsx' }
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
    String(url).includes('reprise=reprendre')
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
  expect(fetch).toHaveBeenCalledTimes(2)
})
