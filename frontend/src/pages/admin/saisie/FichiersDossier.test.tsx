import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import FichiersDossier from './FichiersDossier'
import ImportFichier from './ImportFichier'

afterEach(() => vi.restoreAllMocks())

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const fichier = (nom: string, etat: string, plus: object = {}) => ({
  nom, taille: 1200, modifie_le: '2026-10-28T08:30:00+00:00', annee: 2026, mois: 10, etat, lot_id: null, ...plus,
})

function rendre(reponse: (url: string, init?: RequestInit) => Response | Promise<Response>, onOuvrir = vi.fn()) {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, init) => reponse(String(u), init))
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FichiersDossier onOuvrir={onOuvrir} />
    </QueryClientProvider>,
  )
  return { fetch, onOuvrir }
}

test('tableau des fichiers : mois, état et action de chaque ligne', async () => {
  rendre(() => json(200, {
    actif: true,
    fichiers: [
      fichier('BrutFinal1026.csv', 'en_verification', { lot_id: 4 }),
      fichier('BrutFinal0926.csv', 'importe', { mois: 9, lot_id: 3 }),
      fichier('BrutFinal0826.csv', 'a_traiter', { mois: 8 }),
      fichier('export.csv', 'mois_introuvable', { annee: null, mois: null }),
    ],
  }))
  const table = within(await screen.findByRole('table'))
  expect(table.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Nom', 'Mois', 'Reçu le', 'État', 'Action'])
  const ligne = (nom: string) => within(table.getByText(nom).closest('tr')!)
  expect(ligne('BrutFinal1026.csv').getByText('Octobre 2026')).toBeTruthy()
  expect(ligne('BrutFinal1026.csv').getByText('En vérification')).toBeTruthy()
  expect(ligne('BrutFinal1026.csv').getByRole('button', { name: 'Voir BrutFinal1026.csv' })).toBeTruthy()
  expect(ligne('BrutFinal0926.csv').getByText('Importé')).toBeTruthy()
  expect(ligne('BrutFinal0926.csv').queryByRole('button')).toBeNull()
  expect(ligne('BrutFinal0826.csv').getByRole('button', { name: 'Analyser maintenant BrutFinal0826.csv' })).toBeTruthy()
  expect(ligne('export.csv').getByText('—')).toBeTruthy()
  expect(ligne('export.csv').getByText('Mois à choisir')).toBeTruthy()
  expect(ligne('export.csv').getByRole('button', { name: 'Analyser' })).toBeDisabled()
})

test('« Voir » ouvre le lot en vérification', async () => {
  const { onOuvrir } = rendre(() => json(200, { actif: true, fichiers: [fichier('BrutFinal1026.csv', 'en_verification', { lot_id: 4 })] }))
  fireEvent.click(await screen.findByRole('button', { name: 'Voir BrutFinal1026.csv' }))
  expect(onOuvrir).toHaveBeenCalledWith('BrutFinal1026.csv', 4)
})

test('mois introuvable : mois et année choisis, puis analyse avec ce mois', async () => {
  const lot = { id: 12, statut: 'pret', fichier_nom: 'export.csv' }
  const { fetch, onOuvrir } = rendre((_url, init) =>
    init?.method === 'POST' ? json(201, lot) : json(200, { actif: true, fichiers: [fichier('export.csv', 'mois_introuvable', { annee: null, mois: null })] }))
  const form = within(await screen.findByRole('form', { name: 'Choix du mois de export.csv' }))
  fireEvent.change(form.getByLabelText('Mois de export.csv'), { target: { value: '7' } })
  fireEvent.change(form.getByLabelText('Année de export.csv'), { target: { value: '2026' } })
  fireEvent.click(form.getByRole('button', { name: 'Analyser' }))
  await waitFor(() => expect(onOuvrir).toHaveBeenCalledWith('export.csv', 12))
  const envoi = fetch.mock.calls.map(([u]) => String(u)).find((u) => u.includes('/imports/dossier/export.csv'))
  expect(envoi).toMatch(/annee=2026/)
  expect(envoi).toMatch(/mois=7/)
})

test('« Analyser maintenant » : appel sans mois, erreur du serveur affichée', async () => {
  const { fetch, onOuvrir } = rendre((_url, init) =>
    init?.method === 'POST'
      ? json(422, { detail: 'Ce fichier ne ressemble pas à un export de paie.' })
      : json(200, { actif: true, fichiers: [fichier('BrutFinal0826.csv', 'a_traiter', { mois: 8 })] }))
  fireEvent.click(await screen.findByRole('button', { name: 'Analyser maintenant BrutFinal0826.csv' }))
  expect((await screen.findByRole('alert')).textContent).toMatch(/export de paie/)
  expect(onOuvrir).not.toHaveBeenCalled()
  const envoi = fetch.mock.calls.find(([, init]) => init?.method === 'POST')!
  expect(String(envoi[0])).toMatch(/\/imports\/dossier\/BrutFinal0826\.csv$/)
})

test('surveillance coupée, dossier vide et actualisation', async () => {
  let actif = false
  const { fetch } = rendre(() => json(200, actif ? { actif: true, fichiers: [] } : { actif: false, fichiers: [] }))
  expect(await screen.findByText('Dossier de paie non configuré (IMPORT_DIR) : utiliser l’envoi manuel.')).toBeTruthy()
  actif = true
  fireEvent.click(screen.getByRole('button', { name: 'Actualiser' }))
  expect(await screen.findByText('Aucun fichier dans le dossier.')).toBeTruthy()
  expect(fetch).toHaveBeenCalledTimes(2)
})

test('un lot du dossier s’ouvre sans renvoyer de fichier', async () => {
  const lot = { id: 4, statut: 'pret', fichier_nom: 'BrutFinal1026.csv' }
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
    String(url).includes('/anomalies') ? json(200, []) : json(200, lot))
  const onLot = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ImportFichier fichier={new File([], 'BrutFinal1026.csv')} lotId={4} onLot={onLot} onAutre={() => {}} onRetour={() => {}} />
    </QueryClientProvider>,
  )
  await waitFor(() => expect(onLot).toHaveBeenCalledWith(lot))
  const urls = fetch.mock.calls.map(([u, init]) => `${init?.method ?? 'GET'} ${String(u)}`)
  expect(urls.some((u) => u.startsWith('POST'))).toBe(false)
  expect(urls.some((u) => u.endsWith('/imports/4'))).toBe(true)
})
