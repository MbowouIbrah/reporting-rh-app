import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Cloche from './Cloche'

const LISTE = {
  non_lues: 1,
  notifications: [
    { id: 5, type: 'donnees_disponibles', titre: 'Les données d’octobre 2026 sont disponibles', texte: 'Le rapport du mois est consultable.', lien: '/charges', cree_le: '2026-11-02T08:00:00+00:00', lue: false },
    { id: 4, type: 'lot_publie', titre: 'Septembre 2026 publié', texte: 'Fichier a.csv', lien: null, cree_le: '2026-10-02T08:00:00+00:00', lue: true },
  ],
}

function rendu() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Cloche />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const appels = (spy: { mock: { calls: unknown[][] } }, fin: string) => spy.mock.calls.filter(([u]) => String(u).endsWith(fin))

function serveur(liste = LISTE) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, init) => {
    const url = String(u)
    if (url.endsWith('/notifications') && (!init || !init.method || init.method === 'GET')) return new Response(JSON.stringify(liste), { status: 200 })
    return new Response('{"status":"ok"}', { status: 200 })
  })
}

afterEach(() => vi.restoreAllMocks())

test('le bouton annonce le nombre de non lues et la liste s’ouvre', async () => {
  serveur()
  rendu()
  const bouton = await screen.findByRole('button', { name: 'Notifications, 1 non lue' })
  expect(bouton).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(bouton)
  expect(bouton).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText('Les données d’octobre 2026 sont disponibles')).toBeInTheDocument()
  expect(screen.getByText('Septembre 2026 publié')).toBeInTheDocument()
})

test('ouvrir le lien marque la notification lue', async () => {
  const spy = serveur()
  rendu()
  fireEvent.click(await screen.findByRole('button', { name: /Notifications/ }))
  const lien = screen.getByRole('link', { name: 'Ouvrir' })
  expect(lien).toHaveAttribute('href', '/charges')
  fireEvent.click(lien)
  await waitFor(() => expect(appels(spy, '/notifications/5/lue')).toHaveLength(1))
})

test('« Tout marquer comme lu » appelle le serveur', async () => {
  const spy = serveur()
  rendu()
  fireEvent.click(await screen.findByRole('button', { name: /Notifications/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Tout marquer comme lu' }))
  await waitFor(() => expect(appels(spy, '/notifications/tout-lu')).toHaveLength(1))
})

test('aucune notification : message et pas de compteur', async () => {
  serveur({ non_lues: 0, notifications: [] })
  rendu()
  const bouton = await screen.findByRole('button', { name: 'Notifications' })
  fireEvent.click(bouton)
  expect(screen.getByText('Aucune notification.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Tout marquer comme lu' })).toBeNull()
})
