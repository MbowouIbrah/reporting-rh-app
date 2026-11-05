import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '../auth/AuthContext'
import RequireAuth from '../auth/RequireAuth'
import { cibleSure } from '../lib/connexion'
import ChangerMotDePasse from './ChangerMotDePasse'

const ME = { id: 1, email: 'admin@exemple.invalid', nom: 'Admin', fonction: '', permissions: [] }
const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status })

function rendu(url: string, me: unknown) {
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (u) =>
    String(u).endsWith('/auth/me') ? json(me) : json({ detail: 'inattendu' }, 500),
  )
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/changer-mot-de-passe" element={<ChangerMotDePasse />} />
            <Route path="/login" element={<p>page connexion</p>} />
            <Route path="/admin/utilisateurs" element={<RequireAuth><p>page cible</p></RequireAuth>} />
            <Route path="/resume" element={<RequireAuth><p>page résumé</p></RequireAuth>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
  return spy
}

function saisir(actuel: string, nouveau: string, confirmation = nouveau) {
  fireEvent.change(screen.getByLabelText('Mot de passe actuel'), { target: { value: actuel } })
  fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), { target: { value: nouveau } })
  fireEvent.change(screen.getByLabelText('Confirmer le mot de passe'), { target: { value: confirmation } })
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le mot de passe' }))
}

afterEach(() => vi.restoreAllMocks())

test('mot de passe provisoire : une page protégée mène au changement', async () => {
  rendu('/resume', { ...ME, doit_changer_mdp: true })
  expect(await screen.findByText('Changez votre mot de passe')).toBeInTheDocument()
  expect(screen.queryByText('page résumé')).not.toBeInTheDocument()
})

test('mot de passe déjà choisi : changement volontaire, retour à la page demandée', async () => {
  const spy = rendu('/changer-mot-de-passe?next=/admin/utilisateurs', { ...ME, doit_changer_mdp: false })
  await screen.findByText('Changer mon mot de passe')
  expect(screen.getByRole('link', { name: 'Annuler' })).toHaveAttribute('href', '/admin/utilisateurs')
  expect(screen.queryByRole('button', { name: 'Se déconnecter' })).toBeNull()
  spy.mockImplementation(async () => json({ ...ME, doit_changer_mdp: false }))
  saisir('<mot-de-passe-test-a1>', '<mot-de-passe-test-m1>')
  expect(await screen.findByRole('status')).toHaveTextContent('Mot de passe modifié.')
  fireEvent.click(screen.getByRole('link', { name: 'Continuer' }))
  expect(await screen.findByText('page cible')).toBeInTheDocument()
})

test('une adresse extérieure dans next mène au résumé', async () => {
  const spy = rendu('/changer-mot-de-passe?next=//exemple.org', { ...ME, doit_changer_mdp: false })
  await screen.findByText('Changer mon mot de passe')
  spy.mockImplementation(async () => json({ ...ME, doit_changer_mdp: false }))
  saisir('<mot-de-passe-test-a1>', '<mot-de-passe-test-m1>')
  expect(await screen.findByRole('link', { name: 'Continuer' })).toHaveAttribute('href', '/resume')
})

test('redirection imposée : après le changement, retour à la page demandée', async () => {
  const spy = rendu('/admin/utilisateurs?x=1', { ...ME, doit_changer_mdp: true })
  await screen.findByText('Changez votre mot de passe')
  expect(screen.queryByText('page cible')).toBeNull()
  spy.mockImplementation(async () => json({ ...ME, doit_changer_mdp: false }))
  saisir('<mot-de-passe-provisoire>', '<mot-de-passe-test-m1>')
  expect(await screen.findByText('page cible')).toBeInTheDocument()
})

test('cibleSure : seules les adresses internes sont gardées', () => {
  expect(cibleSure('/admin/utilisateurs?x=1')).toBe('/admin/utilisateurs?x=1')
  expect(cibleSure('//exemple.org')).toBe('/resume')
  expect(cibleSure('/\\exemple.org')).toBe('/resume')
  expect(cibleSure('https://exemple.org')).toBe('/resume')
  for (const piege of ['/\t/exemple.org', '/\n/exemple.org', '/\r/exemple.org']) {
    expect(cibleSure(piege)).toBe('/resume')
  }
  for (const page of ['/login', '/changer-mot-de-passe', '/reinitialiser', '/login/']) {
    expect(cibleSure(page)).toBe('/resume')
  }
  expect(cibleSure(null)).toBe('/resume')
})

test('sans session : retour à la connexion', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ detail: 'non' }, 401))
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/changer-mot-de-passe']}>
          <Routes>
            <Route path="/changer-mot-de-passe" element={<ChangerMotDePasse />} />
            <Route path="/login" element={<p>page connexion</p>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
  expect(await screen.findByText('page connexion')).toBeInTheDocument()
})

test('saisie incohérente : refusée sans appel au serveur', async () => {
  const spy = rendu('/changer-mot-de-passe', { ...ME, doit_changer_mdp: true })
  await screen.findByText('Changez votre mot de passe')
  saisir('<mot-de-passe-provisoire>', 'court')
  expect(screen.getByRole('alert')).toHaveTextContent('8 caractères')
  saisir('<mot-de-passe-provisoire>', '<mot-de-passe-test-m1>', '<mot-de-passe-test-m2>')
  expect(screen.getByRole('alert')).toHaveTextContent('pas identiques')
  expect(spy.mock.calls.filter(([u]) => String(u).includes('changer-mot-de-passe'))).toHaveLength(0)
})

test('mot de passe actuel faux : message du serveur, la page reste', async () => {
  const spy = rendu('/changer-mot-de-passe', { ...ME, doit_changer_mdp: true })
  await screen.findByText('Changez votre mot de passe')
  spy.mockImplementation(async (u) =>
    String(u).includes('changer-mot-de-passe')
      ? json({ detail: 'Mot de passe actuel incorrect' }, 400)
      : json({ ...ME, doit_changer_mdp: true }),
  )
  saisir('<mot-de-passe-faux>', '<mot-de-passe-test-m1>')
  expect(await screen.findByRole('alert')).toHaveTextContent('Mot de passe actuel incorrect')
  expect(screen.getByText('Changez votre mot de passe')).toBeInTheDocument()
})

test('succès : envoie les deux mots de passe et ouvre l’application', async () => {
  const spy = rendu('/changer-mot-de-passe', { ...ME, doit_changer_mdp: true })
  await screen.findByText('Changez votre mot de passe')
  spy.mockImplementation(async () => json({ ...ME, doit_changer_mdp: false }))
  saisir('<mot-de-passe-provisoire>', '<mot-de-passe-test-m1>')
  expect(await screen.findByText('page résumé')).toBeInTheDocument()
  const appel = spy.mock.calls.find(([u]) => String(u).includes('changer-mot-de-passe'))
  expect(JSON.parse(String(appel?.[1]?.body))).toEqual({ actuel: '<mot-de-passe-provisoire>', nouveau: '<mot-de-passe-test-m1>' })
})

test('déconnexion possible sans changer le mot de passe', async () => {
  const spy = rendu('/changer-mot-de-passe', { ...ME, doit_changer_mdp: true })
  await screen.findByText('Changez votre mot de passe')
  spy.mockImplementation(async () => json({}))
  fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }))
  await waitFor(() => expect(screen.getByText('page connexion')).toBeInTheDocument())
})
