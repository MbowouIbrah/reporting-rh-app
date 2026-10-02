import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { AuthProvider } from '../../auth/AuthContext'
import Utilisateurs from './Utilisateurs'

const admin = { id: 1, email: 'admin@exemple.invalid', nom: 'Admin', actif: true, roles: [{ role: 'rh_admin', perimetre_id: null, nominatif: false }] }

afterEach(() => vi.restoreAllMocks())

test('désactivation du dernier admin refusée : le message du serveur est affiché', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, init) => {
    const url = String(u)
    if (url.includes('/auth/me'))
      return new Response(JSON.stringify({ id: 1, email: 'admin@exemple.invalid', roles: [], permissions: ['users:read'] }))
    if (init?.method === 'PUT')
      return new Response(JSON.stringify({ detail: 'Il doit rester au moins un administrateur actif' }), { status: 409 })
    return new Response(JSON.stringify(url.endsWith('/users') ? [admin] : []))
  })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <MemoryRouter>
          <Utilisateurs />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Désactiver' }))
  expect(await screen.findByText(/au moins un administrateur actif/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Supprimer' })).toBeNull() // pas d'auto-suppression
})
