import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../../auth/AuthContext'
import Journal from './Journal'

const evenement = {
  id: 7,
  ts: '2026-03-01T10:00:00',
  utilisateur_id: 1,
  action: 'update',
  entite: 'utilisateur',
  entite_id: '3',
  avant: { actif: true, nom: 'A' },
  apres: { actif: false, nom: 'A' },
}

function rendu() {
  const urls: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (u) => {
    const url = String(u)
    urls.push(url)
    if (url.includes('/auth/me'))
      return new Response(JSON.stringify({ id: 1, email: 'a@b.c', roles: [], permissions: ['audit:read'] }))
    return new Response(JSON.stringify([evenement]))
  })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <MemoryRouter>
          <Journal />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
  return urls
}

afterEach(() => vi.restoreAllMocks())

test('diff avant/après : seuls les champs modifiés sont listés', async () => {
  rendu()
  fireEvent.click(await screen.findByRole('button', { name: 'Voir' }))
  expect(await screen.findByRole('rowheader', { name: 'actif' })).toBeTruthy()
  expect(screen.queryByRole('rowheader', { name: 'nom' })).toBeNull()
})

test('Historique et filtre entité interrogent l’API avec les paramètres', async () => {
  const urls = rendu()
  fireEvent.click(await screen.findByRole('button', { name: 'Historique' }))
  await waitFor(() => expect(urls.some((u) => u.includes('entite=utilisateur') && u.includes('entite_id=3'))).toBe(true))
})
