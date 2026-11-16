import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Desabonnement from './Desabonnement'

function rendu(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/desabonnement" element={<Desabonnement />} />
      </Routes>
    </MemoryRouter>,
  )
}

const appels = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter(([u]) => String(u).endsWith('/notifications/desabonner'))

afterEach(() => vi.restoreAllMocks())

test('seul le bouton désabonne : aucun appel à l’ouverture de la page', async () => {
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"status":"ok"}', { status: 200 }))
  rendu('/desabonnement#jeton=abc')
  expect(screen.getByRole('button', { name: 'Me désabonner' })).toBeInTheDocument()
  await new Promise((r) => setTimeout(r, 20))
  expect(appels(spy)).toHaveLength(0)
})

test('clic : appel avec le jeton, puis message de succès', async () => {
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"status":"ok"}', { status: 200 }))
  rendu('/desabonnement#jeton=abc')
  fireEvent.click(screen.getByRole('button', { name: 'Me désabonner' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Vous ne recevrez plus d’e-mails')
  expect(appels(spy)).toHaveLength(1)
  expect(JSON.parse(String((appels(spy)[0][1] as RequestInit).body))).toEqual({ jeton: 'abc' })
})

test('lien refusé : message d’erreur', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ detail: 'Lien invalide' }), { status: 400 }))
  rendu('/desabonnement#jeton=faux')
  fireEvent.click(screen.getByRole('button', { name: 'Me désabonner' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Ce lien est invalide.')
})

test('lien sans jeton : message et aucun bouton', async () => {
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 200 }))
  rendu('/desabonnement')
  expect(screen.getByRole('alert')).toHaveTextContent('Ce lien est incomplet.')
  expect(screen.queryByRole('button', { name: 'Me désabonner' })).toBeNull()
  await waitFor(() => expect(appels(spy)).toHaveLength(0))
})
