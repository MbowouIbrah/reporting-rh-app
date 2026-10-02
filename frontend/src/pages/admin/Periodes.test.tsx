import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../../auth/AuthContext'
import Periodes from './Periodes'

const base = { id: 1, annee: 2026, mois: 3, statut: 'ouverte', close_le: null, ca: null }

function rendu(periodes: unknown[]) {
  const appels: { url: string; init?: RequestInit }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, init) => {
    appels.push({ url: String(u), init })
    if (String(u).includes('/auth/me'))
      return new Response(JSON.stringify({ id: 1, email: 'a@b.c', roles: [], permissions: ['saisie:write'] }))
    return new Response(JSON.stringify(init?.method === 'PUT' ? { ...base, ca: '12.500' } : periodes))
  })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <MemoryRouter>
          <Periodes />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
  return appels
}

afterEach(() => vi.restoreAllMocks())

test('CA saisi : envoyé en chaîne, virgule normalisée côté serveur', async () => {
  const appels = rendu([base])
  const champ = await screen.findByLabelText('Chiffre d’affaires')
  fireEvent.change(champ, { target: { value: '12,5' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
  await waitFor(() => expect(appels.some((a) => a.init?.method === 'PUT')).toBe(true))
  const put = appels.find((a) => a.init?.method === 'PUT')!
  expect(put.url).toContain('/periodes/1/ca')
  expect(JSON.parse(String(put.init!.body))).toEqual({ valeur: '12,5' })
})

test('montant invalide : erreur, aucune requête d’écriture', async () => {
  const appels = rendu([base])
  fireEvent.change(await screen.findByLabelText('Chiffre d’affaires'), { target: { value: 'abc' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Montant invalide')
  expect(appels.some((a) => a.init?.method === 'PUT')).toBe(false)
})

test('période close : saisie verrouillée, réouverture proposée', async () => {
  rendu([{ ...base, statut: 'close', ca: '5.000' }])
  expect(await screen.findByText('Close')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Rouvrir' })).toBeInTheDocument()
})
