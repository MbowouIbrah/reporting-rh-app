import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { AuthProvider } from '../../auth/AuthContext'
import Referentiels from './Referentiels'

afterEach(() => vi.restoreAllMocks())

test('renommage : aperçu du nombre de périmètres avant confirmation', async () => {
  const appels: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, init) => {
    const url = String(u)
    appels.push(`${init?.method ?? 'GET'} ${url}`)
    if (url.includes('/auth/me'))
      return new Response(JSON.stringify({ id: 1, email: 'a@b.c', roles: [], permissions: ['referentiel:write'] }))
    if (url.includes('apercu=true')) return new Response(JSON.stringify({ perimetres_maj: 2 }))
    return new Response(JSON.stringify({ valeurs: [{ id: 5, libelle: 'SAV PL', actif: true }], alias: [] }))
  })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <MemoryRouter>
          <Referentiels />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Renommer' }))
  fireEvent.change(screen.getByLabelText('Nouveau libellé'), { target: { value: 'SAV Poids Lourds' } })
  expect(await screen.findByText(/2 périmètres mis à jour/)).toBeInTheDocument()
  expect(appels.some((a) => a.startsWith('PUT') && !a.includes('apercu'))).toBe(false)
})
