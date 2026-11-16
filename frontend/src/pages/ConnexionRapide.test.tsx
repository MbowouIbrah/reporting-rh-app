import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '../auth/AuthContext'
import ConnexionRapide from './ConnexionRapide'

const ME = { id: 1, email: 'drh@example.com', nom: 'DRH', roles: [], permissions: [], perimetre: null }

function rendu(url: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/connexion-rapide" element={<ConnexionRapide />} />
            <Route path="/resume" element={<p>Résumé</p>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

/** Appels envoyés à /auth/lien. */
const appelsLien = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter(([u]) => String(u).endsWith('/auth/lien'))

afterEach(() => vi.restoreAllMocks())

test('lien valide : un seul appel avec le jeton, puis le Résumé', async () => {
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (u) =>
    String(u).endsWith('/auth/lien') ? new Response(JSON.stringify(ME), { status: 200 }) : new Response('{}', { status: 401 }),
  )
  rendu('/connexion-rapide#jeton=abc')
  expect(await screen.findByText('Résumé')).toBeInTheDocument()
  const appels = appelsLien(spy)
  expect(appels).toHaveLength(1)
  expect(JSON.parse(String((appels[0][1] as RequestInit).body))).toEqual({ jeton: 'abc' })
})

test('lien refusé : message et retour à la connexion', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ detail: 'Lien invalide ou expiré' }), { status: 401 }))
  rendu('/connexion-rapide#jeton=abc')
  expect(await screen.findByRole('alert')).toHaveTextContent('Ce lien est invalide ou a expiré.')
  expect(screen.getByRole('link', { name: 'Se connecter avec son mot de passe' })).toHaveAttribute('href', '/login')
})

test('lien déjà utilisé : il ne sert qu’une fois', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ detail: 'Lien déjà utilisé' }), { status: 410 }))
  rendu('/connexion-rapide#jeton=abc')
  expect(await screen.findByRole('alert')).toHaveTextContent('Ce lien a déjà servi')
  expect(screen.getByRole('link', { name: 'Se connecter avec son mot de passe' })).toHaveAttribute('href', '/login')
})

test('lien sans jeton : aucun appel', async () => {
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 401 }))
  rendu('/connexion-rapide')
  expect(screen.getByRole('alert')).toHaveTextContent('Ce lien est incomplet.')
  await waitFor(() => expect(appelsLien(spy)).toHaveLength(0))
})
