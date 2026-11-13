import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import Correspondance from './Correspondance'
import { erreurApi, monter, type Appel } from './testSupport'

const PERMS = ['referentiel:write']
const LIGNES = [
  { id: 1, colonne: 'BRUT', rubrique_id: 5, rubrique: 'Brut Réel' },
  { id: 2, colonne: 'CNPS PAT', rubrique_id: 6, rubrique: 'Charges Patronales' },
]
const COLONNES = [
  { id: 5, libelle: 'Brut Réel', nature: 'paie', unite: 'FCFA', actif: true, moteur: true, valeurs: 6, dernier_mois: 2 },
  { id: 6, libelle: 'Charges Patronales', nature: 'paie', unite: 'FCFA', actif: true, moteur: true, valeurs: 6, dernier_mois: 2 },
  { id: 9, libelle: 'Taux de remplissage', nature: 'activite', unite: '%', actif: true, moteur: true, valeurs: 0, dernier_mois: null },
]

const servir = (a: Appel) => {
  if (a.method !== 'GET') return {}
  if (a.url.includes('/colonnes/remplissage')) return { annee: 2026, annees: [2026], colonnes: COLONNES }
  return LIGNES
}
const ecritures = (appels: Appel[]) => appels.filter((a) => a.method !== 'GET')

afterEach(() => vi.restoreAllMocks())

test('liste les colonnes de la paie avec leur rubrique', async () => {
  monter(<Correspondance />, PERMS, servir)
  const ligne = await screen.findByRole('row', { name: /CNPS PAT/ })
  expect(within(ligne).getByText('Charges Patronales')).toBeInTheDocument()
  expect(screen.getByRole('row', { name: /BRUT/ })).toBeInTheDocument()
})

test('ajout : colonne et rubrique obligatoires, rubriques de paie seulement', async () => {
  const appels = monter(<Correspondance />, PERMS, servir)
  const form = within(await screen.findByRole('form', { name: 'Ajouter une correspondance' }))
  await screen.findByRole('row', { name: /BRUT/ })
  fireEvent.click(form.getByRole('button', { name: 'Ajouter' }))
  expect(await screen.findByText('Colonne obligatoire')).toBeInTheDocument()
  expect(screen.getByText('Rubrique obligatoire')).toBeInTheDocument()
  expect(ecritures(appels)).toHaveLength(0)
  await waitFor(() => expect([...(form.getByLabelText('Rubrique') as HTMLSelectElement).options]).toHaveLength(3))
  const options = [...(form.getByLabelText('Rubrique') as HTMLSelectElement).options].map((o) => o.textContent)
  expect(options).toEqual(['Choisir…', 'Brut Réel', 'Charges Patronales'])
  fireEvent.change(form.getByLabelText('Colonne de la paie'), { target: { value: ' ALLOC FAM ' } })
  fireEvent.change(form.getByLabelText('Rubrique'), { target: { value: '6' } })
  fireEvent.click(form.getByRole('button', { name: 'Ajouter' }))
  await waitFor(() => expect(ecritures(appels)).toHaveLength(1))
  expect(ecritures(appels)[0].url).toMatch(/\/parametrage\/correspondance-paie$/)
  expect(ecritures(appels)[0].body).toEqual({ colonne: 'ALLOC FAM', rubrique_id: 6 })
})

test('ajout refusé : le message du serveur est affiché', async () => {
  monter(<Correspondance />, PERMS, (a) => (a.method === 'POST' ? erreurApi(409, 'Cette colonne est déjà reliée à une rubrique') : servir(a)))
  const form = within(await screen.findByRole('form', { name: 'Ajouter une correspondance' }))
  await screen.findByRole('row', { name: /BRUT/ })
  await waitFor(() => expect([...(form.getByLabelText('Rubrique') as HTMLSelectElement).options]).toHaveLength(3))
  fireEvent.change(form.getByLabelText('Colonne de la paie'), { target: { value: 'BRUT' } })
  fireEvent.change(form.getByLabelText('Rubrique'), { target: { value: '5' } })
  fireEvent.click(form.getByRole('button', { name: 'Ajouter' }))
  expect(await screen.findByText('Cette colonne est déjà reliée à une rubrique')).toBeInTheDocument()
})

test('modification : PUT avec la nouvelle rubrique', async () => {
  const appels = monter(<Correspondance />, PERMS, servir)
  fireEvent.click(await screen.findByRole('button', { name: 'Modifier BRUT' }))
  fireEvent.change(screen.getByLabelText('Rubrique de BRUT'), { target: { value: '6' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
  await waitFor(() => expect(ecritures(appels)).toHaveLength(1))
  expect(ecritures(appels)[0].method).toBe('PUT')
  expect(ecritures(appels)[0].url).toMatch(/\/correspondance-paie\/1$/)
  expect(ecritures(appels)[0].body).toEqual({ colonne: 'BRUT', rubrique_id: 6 })
})

test('suppression : demande de confirmation puis DELETE', async () => {
  const appels = monter(<Correspondance />, PERMS, servir)
  fireEvent.click(await screen.findByRole('button', { name: 'Supprimer CNPS PAT' }))
  expect(await screen.findByText(/« CNPS PAT » ne sera plus lue/)).toBeInTheDocument()
  expect(ecritures(appels)).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }))
  await waitFor(() => expect(ecritures(appels)).toHaveLength(1))
  expect(ecritures(appels)[0].method).toBe('DELETE')
  expect(ecritures(appels)[0].url).toMatch(/\/correspondance-paie\/2$/)
})

test('aucune correspondance : état vide', async () => {
  monter(<Correspondance />, PERMS, (a) => (a.url.includes('remplissage') ? servir(a) : []))
  expect(await screen.findByText('Aucune correspondance')).toBeInTheDocument()
})
