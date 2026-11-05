import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { api } from '../api/client'
import { AuthProvider, useAuth } from './AuthContext'
import RequireAuth from './RequireAuth'

const ME = { id: 1, email: 'a@b.c', nom: 'A', role: 'admin', permissions: [], doit_changer_mdp: false }

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

const rep = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status })

function Sortie() {
  const { logout } = useAuth()
  return <button onClick={() => void logout()}>sortir</button>
}

function monter(page: ReactNode) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/resume']}>
          <Routes>
            <Route path="/login" element={<p>connexion</p>} />
            <Route path="/changer-mot-de-passe" element={<p>changement</p>} />
            <Route path="/resume" element={<RequireAuth>{page}</RequireAuth>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

test('403 « mot de passe à changer » : le profil est relu et la page de changement s’ouvre', async () => {
  let appels = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (String(url).endsWith('/auth/me')) return rep({ ...ME, doit_changer_mdp: appels++ > 0 })
    return rep({ detail: { code: 'mot_de_passe_a_changer', message: 'À changer' } }, 403)
  })
  monter(<Page />)
  expect(await screen.findByText('changement')).toBeInTheDocument()
})

test('mot de passe à changer : jamais gardé dans l’onglet, le rechargement interroge le serveur', async () => {
  let reponse = { ...ME, doit_changer_mdp: true }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => rep(reponse))
  const { unmount } = render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/resume']}>
          <Routes>
            <Route path="/changer-mot-de-passe" element={<p>changement</p>} />
            <Route path="/resume" element={<RequireAuth><p>rapport</p></RequireAuth>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
  expect(await screen.findByText('changement')).toBeInTheDocument()
  expect(sessionStorage.getItem('reporting-rh:profil')).toBeNull()
  unmount()
  reponse = ME
  monter(<p>rapport</p>)
  expect(await screen.findByText('rapport')).toBeInTheDocument()
  expect(screen.queryByText('changement')).toBeNull()
})

test('déconnexion pendant une vérification : la réponse tardive ne rouvre pas la session', async () => {
  let liberer: (r: Response) => void = () => {}
  let appels = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (String(url).endsWith('/auth/logout')) return rep({})
    if (appels++ === 0) return rep(ME)
    return new Promise<Response>((resolve) => {
      liberer = resolve
    })
  })
  monter(<Sortie />)
  await screen.findByRole('button', { name: 'sortir' })
  window.dispatchEvent(new Event('focus'))
  await waitFor(() => expect(appels).toBe(2))
  fireEvent.click(screen.getByRole('button', { name: 'sortir' }))
  expect(await screen.findByText('connexion')).toBeInTheDocument()
  liberer(rep(ME))
  await new Promise((r) => setTimeout(r, 20))
  expect(screen.getByText('connexion')).toBeInTheDocument()
})
