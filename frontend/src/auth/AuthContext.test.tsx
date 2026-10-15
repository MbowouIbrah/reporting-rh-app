import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { api } from '../api/client'
import { AuthProvider } from './AuthContext'
import RequireAuth from './RequireAuth'

const ME = { id: 1, email: 'a@b.c', nom: 'A', role: 'admin', permissions: [] }

function Page() {
  const q = useQuery({ queryKey: ['x'], queryFn: () => api('/x'), retry: false })
  return <p>{q.isError ? 'erreur' : 'page'}</p>
}

afterEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
})

test('refresh refusé en cours de navigation : retour au login', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const u = String(url)
    if (u.endsWith('/auth/me')) return new Response(JSON.stringify(ME), { status: 200 })
    return new Response('{}', { status: 401 })
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/resume']}>
          <Routes>
            <Route path="/login" element={<p>connexion</p>} />
            <Route path="/resume" element={<RequireAuth><Page /></RequireAuth>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
  expect(await screen.findByText('connexion')).toBeInTheDocument()
})
