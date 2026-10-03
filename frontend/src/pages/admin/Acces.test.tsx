import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { AuthProvider } from '../../auth/AuthContext'
import Acces from './Acces'

afterEach(() => vi.restoreAllMocks())

test('liste les utilisateurs avec leur rôle et leur périmètre', async () => {
  const users = [
    { id: 1, email: 'a@exemple.invalid', nom: 'Admin', actif: true, roles: [{ role: 'rh_admin', perimetre_id: null, nominatif: false }] },
    { id: 2, email: 'b@exemple.invalid', nom: 'Chef', actif: true, roles: [{ role: 'lecteur_perimetre', perimetre_id: 7, nominatif: false }] },
  ]
  const pers = [{ id: 7, libelle: 'Equipment', regles: [{ dimension: 'service', valeur: 'SAV PL' }] }]
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (u) => {
    const url = String(u)
    if (url.includes('/auth/me'))
      return new Response(JSON.stringify({ id: 1, email: 'a@exemple.invalid', roles: [], permissions: ['users:read'] }))
    return new Response(JSON.stringify(url.includes('/perimetres') ? pers : url.endsWith('/users') ? users : []))
  })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <MemoryRouter>
          <Acces />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
  expect(await screen.findByText('Chef')).toBeInTheDocument()
  expect(screen.getByText('Equipment')).toBeInTheDocument()
  expect(screen.getByText(/Services : SAV PL/)).toBeInTheDocument()
  expect(screen.getAllByText('Toute l’entreprise').length).toBeGreaterThan(0)
})
