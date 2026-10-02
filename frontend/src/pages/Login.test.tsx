import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../auth/AuthContext'
import Login from './Login'

function rendu() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <MemoryRouter>
          <Login />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

test('affiche le formulaire et refuse un envoi vide', () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }))
  rendu()
  expect(screen.getByRole('heading', { name: /Reporting RH/ })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Renseignez')
})

test('identifiants refusés : message dédié', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ detail: 'Identifiants invalides' }), { status: 401 }),
  )
  rendu()
  fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'a@b.c' } })
  fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'x' } })
  fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Identifiants invalides'))
})
