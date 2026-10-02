import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../../auth/AuthContext'
import Parametrage from './Parametrage'

const data = {
  rubriques: [{ id: 1, libelle: 'Brut Réel', unite: 'FCFA', ordre: 1, actif: true, moteur: false }],
  regles: [{ id: 7, rubrique_id: 1, regle: 'exclu_total_ligne', date_debut: '2026-01-01', date_fin: null }],
  parametres: [{ id: 3, cle: 'jours_ouvres', valeur: '22.000', date_debut: '2026-01-01' }],
}

function rendu() {
  const appels: { url: string; init?: RequestInit }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, init) => {
    appels.push({ url: String(u), init })
    if (String(u).includes('/auth/me'))
      return new Response(JSON.stringify({ id: 1, email: 'a@b.c', roles: [], permissions: ['referentiel:write'] }))
    return new Response(JSON.stringify(init?.method === 'POST' ? {} : data))
  })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <MemoryRouter>
          <Parametrage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
  return appels
}

afterEach(() => vi.restoreAllMocks())

test('nouvelle valeur datée : envoyée en chaîne', async () => {
  const appels = rendu()
  fireEvent.change(await screen.findByLabelText('Nouvelle valeur'), { target: { value: '21,5' } })
  fireEvent.change(screen.getByLabelText('À partir du'), { target: { value: '2026-06-01' } })
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter la valeur' }))
  await waitFor(() => expect(appels.some((a) => a.init?.method === 'POST')).toBe(true))
  const post = appels.find((a) => a.init?.method === 'POST')!
  expect(post.url).toContain('/parametrage/parametres')
  expect(JSON.parse(String(post.init!.body))).toEqual({
    cle: 'jours_ouvres',
    valeur: '21,5',
    date_debut: '2026-06-01',
  })
})

test('valeur invalide : erreur, aucune écriture', async () => {
  const appels = rendu()
  fireEvent.change(await screen.findByLabelText('Nouvelle valeur'), { target: { value: 'abc' } })
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter la valeur' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Valeur invalide')
  expect(appels.some((a) => a.init?.method === 'POST')).toBe(false)
})

test('règle en cours : on propose de la terminer, pas de la modifier', async () => {
  rendu()
  expect(await screen.findByText(/\(en cours\)/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Terminer' })).toBeInTheDocument()
})
