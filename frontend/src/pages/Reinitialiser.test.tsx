import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { mdpTest } from '../test/identites'
import Reinitialiser from './Reinitialiser'

const MDP_A = mdpTest()
const MDP_B = mdpTest()
const NOUVEAU = mdpTest()

function rendu(url = '/reinitialiser#jeton=abc') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Reinitialiser />
    </MemoryRouter>,
  )
}

function saisir(nouveau: string, confirmation: string) {
  fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), { target: { value: nouveau } })
  fireEvent.change(screen.getByLabelText('Confirmer le mot de passe'), { target: { value: confirmation } })
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le mot de passe' }))
}

afterEach(() => vi.restoreAllMocks())

test('mots de passe différents : refusé sans appel', () => {
  const spy = vi.spyOn(globalThis, 'fetch')
  rendu()
  saisir(MDP_A, MDP_B)
  expect(screen.getByRole('alert')).toHaveTextContent('Les deux mots de passe ne sont pas identiques.')
  expect(spy).not.toHaveBeenCalled()
})

test('mot de passe trop court : refusé sans appel', () => {
  const spy = vi.spyOn(globalThis, 'fetch')
  rendu()
  saisir('court', 'court')
  expect(screen.getByRole('alert')).toHaveTextContent('8 caractères')
  expect(spy).not.toHaveBeenCalled()
})

test('succès : message et lien vers la connexion', async () => {
  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"status":"ok"}', { status: 200 }))
  rendu()
  saisir(NOUVEAU, NOUVEAU)
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('modifié'))
  expect(screen.getByRole('link', { name: 'Se connecter' })).toHaveAttribute('href', '/login')
  expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toEqual({ jeton: 'abc', password: NOUVEAU })
})

test('lien invalide ou expiré (400) : message et lien pour une nouvelle demande', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ detail: 'Lien invalide ou expiré' }), { status: 400 }),
  )
  rendu()
  saisir(NOUVEAU, NOUVEAU)
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Ce lien est invalide ou a expiré.'))
  expect(screen.getByRole('link', { name: 'Demander un nouveau lien' })).toHaveAttribute('href', '/login?oubli=1')
})

test('mot de passe refusé par le serveur (422) : message du serveur affiché', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ detail: 'Le mot de passe doit différer de l’actuel' }), { status: 422 }),
  )
  rendu()
  saisir(NOUVEAU, NOUVEAU)
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Le mot de passe doit différer de l’actuel'))
})

test("sans jeton dans l'adresse : erreur directe", () => {
  rendu('/reinitialiser')
  expect(screen.getByRole('alert')).toHaveTextContent('Ce lien est invalide ou a expiré.')
  expect(screen.queryByLabelText('Nouveau mot de passe')).not.toBeInTheDocument()
})
