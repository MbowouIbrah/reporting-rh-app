import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { api, ApiError, ErreurReseau, setUnauthorizedHandler } from '../api/client'
import { connexionPerdue, verifierConnexion } from '../lib/etatConnexion'
import BandeauConnexion from './BandeauConnexion'
import { etatErreur } from './Etat'

afterEach(() => {
  vi.unstubAllGlobals()
  setUnauthorizedHandler(() => {})
})

const reponse = (status: number) => new Response('{}', { status })

function afficher() {
  const qc = new QueryClient()
  render(<QueryClientProvider client={qc}><BandeauConnexion /></QueryClientProvider>)
  return qc
}

it('une panne de fetch donne une ErreurReseau et affiche le bandeau', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
  afficher()
  expect(screen.queryByRole('alert')).toBeNull()
  await expect(api('/x')).rejects.toBeInstanceOf(ErreurReseau)
  expect(await screen.findByText('Connexion perdue.')).toBeInTheDocument()
})

it('une passerelle en panne vaut une panne de connexion', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponse(502)))
  await expect(api('/x')).rejects.toBeInstanceOf(ErreurReseau)
  await waitFor(() => expect(connexionPerdue()).toBe(true))
})

it('un échec isolé alors que le serveur répond ne déclare pas de panne', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('x')).mockResolvedValue(reponse(401)))
  await expect(api('/x')).rejects.toBeInstanceOf(ErreurReseau)
  await act(() => verifierConnexion())
  expect(connexionPerdue()).toBe(false)
})

it('une annulation demandée par l’appelant ne déclare pas de panne', async () => {
  const f = vi.fn().mockRejectedValue(new DOMException('annulé', 'AbortError'))
  vi.stubGlobal('fetch', f)
  const c = new AbortController()
  c.abort()
  await expect(api('/x', { signal: c.signal })).rejects.toBeInstanceOf(DOMException)
  expect(f).toHaveBeenCalledTimes(1)
})

it('une panne pendant le renouvellement du jeton ne déconnecte pas', async () => {
  const deconnecte = vi.fn()
  setUnauthorizedHandler(deconnecte)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reponse(401)).mockRejectedValue(new TypeError('x')))
  await expect(api('/x')).rejects.toBeInstanceOf(ErreurReseau)
  expect(deconnecte).not.toHaveBeenCalled()
})

it('Réessayer rétablit et relance seulement les requêtes en erreur', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('x')))
  const qc = afficher()
  await act(async () => {
    await qc.fetchQuery({ queryKey: ['e'], queryFn: () => Promise.reject(new ErreurReseau()) }).catch(() => {})
    await qc.fetchQuery({ queryKey: ['s'], queryFn: () => 1 })
    await verifierConnexion()
  })
  const espion = vi.spyOn(qc, 'invalidateQueries')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponse(200)))
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  const filtre = espion.mock.calls[0][0]!.predicate!
  expect(filtre(qc.getQueryCache().find({ queryKey: ['e'] })!)).toBe(true)
  expect(filtre(qc.getQueryCache().find({ queryKey: ['s'] })!)).toBe(false)
})

it('etatErreur donne la cause', () => {
  expect(etatErreur(new ErreurReseau())).toBe('reseau')
  expect(etatErreur(new ApiError(500, 'x'))).toBe('serveur')
  expect(etatErreur(new ApiError(404, 'x'))).toBe('404')
  expect(etatErreur(new Error('x'))).toBe('erreur')
})
