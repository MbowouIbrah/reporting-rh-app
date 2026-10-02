import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../../auth/AuthContext'
import Budgets from './Budgets'

const periodes = [{ id: 1, annee: 2026, mois: 3, statut: 'ouverte', close_le: null, ca: null }]
const vue = (statut: string) => ({
  periode_id: 1,
  annee: 2026,
  mois: 3,
  statut,
  lignes: {
    rubrique: [],
    service: [{ cible_id: 5, libelle: 'SAV PL', actif: true, valeur: null }],
    site: [],
  },
})

function rendu(statut = 'ouverte') {
  const appels: { url: string; init?: RequestInit }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, init) => {
    appels.push({ url: String(u), init })
    const url = String(u)
    if (url.includes('/auth/me'))
      return new Response(JSON.stringify({ id: 1, email: 'a@b.c', roles: [], permissions: ['saisie:write'] }))
    if (url.includes('/budgets')) return new Response(JSON.stringify(vue(statut)))
    return new Response(JSON.stringify(periodes))
  })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <MemoryRouter>
          <Budgets />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
  return appels
}

afterEach(() => vi.restoreAllMocks())

test('montant saisi : envoyé en chaîne pour la seule ligne modifiée', async () => {
  const appels = rendu()
  fireEvent.change(await screen.findByLabelText('Période'), { target: { value: '1' } })
  fireEvent.change(await screen.findByLabelText('Par service : SAV PL'), { target: { value: '900,5' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les budgets' }))
  await waitFor(() => expect(appels.some((a) => a.init?.method === 'PUT')).toBe(true))
  const put = appels.find((a) => a.init?.method === 'PUT')!
  expect(put.url).toContain('/budgets/1')
  expect(JSON.parse(String(put.init!.body))).toEqual({
    lignes: [{ axe: 'service', cible_id: 5, valeur: '900,5' }],
  })
})

test('montant invalide : erreur, aucune écriture', async () => {
  const appels = rendu()
  fireEvent.change(await screen.findByLabelText('Période'), { target: { value: '1' } })
  fireEvent.change(await screen.findByLabelText('Par service : SAV PL'), { target: { value: 'abc' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les budgets' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Montant invalide')
  expect(appels.some((a) => a.init?.method === 'PUT')).toBe(false)
})

test('période close : lecture seule', async () => {
  rendu('close')
  fireEvent.change(await screen.findByLabelText('Période'), { target: { value: '1' } })
  expect(await screen.findByText('Période close : saisie verrouillée.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Enregistrer les budgets' })).toBeNull()
})
