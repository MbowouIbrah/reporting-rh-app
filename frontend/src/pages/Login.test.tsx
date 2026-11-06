import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

const connexion = () => within(screen.getByRole('group', { name: 'Connexion' }))
const oubli = () => within(screen.getByRole('group', { name: 'Mot de passe oublié' }))

/** Réponse neuve à chaque appel (le corps d'une Response ne se lit qu'une fois). */
const repondre = (corps: string, status: number) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(corps, { status }))

/** Appels à l'API qui portent un corps JSON (hors /auth/me et /auth/refresh). */
function appels(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.body)
    .map(([url, init]) => [String(url), JSON.parse(String((init as RequestInit).body))] as const)
}

test('affiche le formulaire et refuse un envoi vide', () => {
  repondre('{}', 401)
  rendu()
  expect(screen.getByRole('heading', { name: /Reporting RH/ })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Renseignez')
})

test('identifiants refusés : message dédié', async () => {
  repondre(JSON.stringify({ detail: 'Identifiants invalides' }), 401)
  rendu()
  fireEvent.change(connexion().getByLabelText('Adresse e-mail'), { target: { value: 'a@b.c' } })
  fireEvent.change(connexion().getByLabelText('Mot de passe'), { target: { value: 'x' } })
  fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Identifiants invalides'))
})

test('trop de tentatives : le message le dit au lieu de parler de panne', async () => {
  repondre('<html>429</html>', 429)
  rendu()
  fireEvent.change(connexion().getByLabelText('Adresse e-mail'), { target: { value: 'a@b.c' } })
  fireEvent.change(connexion().getByLabelText('Mot de passe'), { target: { value: 'x' } })
  fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Trop de tentatives'))
})

test('serveur arrêté derrière la passerelle : le message le dit', async () => {
  repondre('<html>502</html>', 502)
  rendu()
  fireEvent.change(connexion().getByLabelText('Adresse e-mail'), { target: { value: 'a@b.c' } })
  fireEvent.change(connexion().getByLabelText('Mot de passe'), { target: { value: 'x' } })
  fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Le serveur est injoignable'))
})

test('erreur du serveur : le code est donné, avec la marche à suivre', async () => {
  repondre(JSON.stringify({ detail: 'x' }), 500)
  rendu()
  fireEvent.change(connexion().getByLabelText('Adresse e-mail'), { target: { value: 'a@b.c' } })
  fireEvent.change(connexion().getByLabelText('Mot de passe'), { target: { value: 'x' } })
  fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Le serveur a rencontré une erreur (500)'))
})

test('le choix « Se souvenir de moi » est transmis à la connexion', async () => {
  const spy = repondre('{}', 401)
  rendu()
  fireEvent.change(connexion().getByLabelText('Adresse e-mail'), { target: { value: 'a@b.c' } })
  fireEvent.change(connexion().getByLabelText('Mot de passe'), { target: { value: 'x' } })
  fireEvent.click(connexion().getByLabelText('Se souvenir de moi'))
  fireEvent.click(connexion().getByRole('button', { name: 'Se connecter' }))
  await waitFor(() => expect(appels(spy)).toHaveLength(1))
  expect(appels(spy)[0][1]).toEqual({ email: 'a@b.c', password: 'x', remember: true })
})

test('sans la case cochée, remember vaut faux', async () => {
  const spy = repondre('{}', 401)
  rendu()
  fireEvent.change(connexion().getByLabelText('Adresse e-mail'), { target: { value: 'a@b.c' } })
  fireEvent.change(connexion().getByLabelText('Mot de passe'), { target: { value: 'x' } })
  fireEvent.click(connexion().getByRole('button', { name: 'Se connecter' }))
  await waitFor(() => expect(appels(spy)).toHaveLength(1))
  expect(appels(spy)[0][1]).toMatchObject({ remember: false })
})

test('le bouton œil affiche puis masque le mot de passe', () => {
  repondre('{}', 401)
  rendu()
  const champ = connexion().getByLabelText('Mot de passe')
  expect(champ).toHaveAttribute('type', 'password')
  fireEvent.click(connexion().getByRole('button', { name: 'Afficher le mot de passe' }))
  expect(champ).toHaveAttribute('type', 'text')
  fireEvent.click(connexion().getByRole('button', { name: 'Masquer le mot de passe' }))
  expect(champ).toHaveAttribute('type', 'password')
})

test('aucune connexion Microsoft ou Google', () => {
  repondre('{}', 401)
  rendu()
  expect(connexion().queryByRole('button', { name: /Microsoft|Google/ })).toBeNull()
})

test('mot de passe oublié : bascule de panneau et message neutre', async () => {
  const spy = repondre('{"status":"ok"}', 200)
  rendu()
  expect(screen.queryByRole('group', { name: 'Mot de passe oublié' })).not.toBeInTheDocument()
  fireEvent.click(connexion().getByRole('button', { name: 'Mot de passe oublié ?' }))
  expect(screen.queryByRole('group', { name: 'Connexion' })).not.toBeInTheDocument()
  fireEvent.change(oubli().getByLabelText('Adresse e-mail'), { target: { value: 'inconnu@b.c' } })
  fireEvent.click(oubli().getByRole('button', { name: 'Envoyer le lien' }))
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      "Si un compte existe pour cette adresse, un lien de réinitialisation vient d'être envoyé.",
    ),
  )
  const [[url, corps]] = appels(spy)
  expect(url).toMatch(/\/auth\/mot-de-passe-oublie$/)
  expect(corps).toEqual({ email: 'inconnu@b.c' })
  fireEvent.click(oubli().getByRole('button', { name: /Retour à la connexion/ }))
  expect(screen.getByRole('group', { name: 'Connexion' })).toBeInTheDocument()
})

test('mot de passe oublié : adresse vide refusée sans appel', () => {
  const spy = repondre('{}', 401)
  rendu()
  fireEvent.click(connexion().getByRole('button', { name: 'Mot de passe oublié ?' }))
  fireEvent.click(oubli().getByRole('button', { name: 'Envoyer le lien' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Renseignez votre adresse e-mail.')
  expect(appels(spy)).toHaveLength(0)
})
