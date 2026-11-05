import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import RequireAuth from '../../auth/RequireAuth'
import Employes from './Employes'
import { erreurApi, monter, type Appel } from './testSupport'

const ANN = { id: 1, matricule: 'E1', nom: 'Ann', poste: 'Chef atelier', type_contrat: 'CDI', activite: 'SAV', site: 'Douala', service: 'SAV PL', actif: true }
const ELODIE = { id: 2, matricule: 'E2', nom: 'Élodie', poste: null, type_contrat: null, activite: null, site: null, service: null, actif: false }
const LISTES = { poste: ['Chef atelier', 'Mécanicien'], type_contrat: ['CDD', 'CDI'], activite: ['SAV'], site: ['Douala'], service: ['SAV PL'] }
const PERMS = ['saisie:write']

const servir = (a: Appel) => {
  if (a.method !== 'GET') return {}
  return a.url.endsWith('/salaries/listes') ? LISTES : [ANN, ELODIE]
}
const page = <Employes />
const ecritures = (appels: Appel[]) => appels.filter((a) => a.method !== 'GET')
const noms = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent)

afterEach(() => vi.restoreAllMocks())

test('liste des employés : matricule, nom, fiche et statut', async () => {
  monter(page, PERMS, servir)
  const ligne = await screen.findByRole('row', { name: /E1/ })
  expect(within(ligne).getByRole('rowheader')).toHaveTextContent('E1')
  expect(within(ligne).getAllByRole('cell').map((c) => c.textContent)).toEqual([
    'Ann', 'Chef atelier', 'CDI', 'SAV', 'Douala', 'SAV PL', 'Actif', 'ModifierDésactiver',
  ])
  const autre = screen.getByRole('row', { name: /E2/ })
  expect(within(autre).getAllByText('—')).toHaveLength(5)
  expect(within(autre).getByText('Inactif')).toBeInTheDocument()
  expect(screen.getByText('2 employés')).toBeInTheDocument()
})

test('sans le droit de saisie : renvoyé au Résumé', async () => {
  monter(
    <Routes>
      <Route path="/admin/employes" element={<RequireAuth perm="saisie:write"><Employes /></RequireAuth>} />
      <Route path="/resume" element={<p>Accueil</p>} />
    </Routes>,
    ['nominatif:read'], servir, '/admin/employes',
  )
  expect(await screen.findByText('Accueil')).toBeInTheDocument()
})

test('recherche par nom (sans accents) ou matricule, au-dessus du tableau', async () => {
  monter(page, PERMS, servir)
  await screen.findByRole('row', { name: /E1/ })
  const champ = screen.getByRole('searchbox', { name: 'Recherche' })
  fireEvent.change(champ, { target: { value: 'elo' } })
  expect(noms()).toEqual(['Élodie'])
  expect(screen.getByText('1 employé')).toBeInTheDocument()
  fireEvent.change(champ, { target: { value: 'e1' } })
  expect(noms()).toEqual(['Ann'])
  fireEvent.change(champ, { target: { value: 'zzz' } })
  expect(screen.queryByRole('table')).toBeNull()
  expect(screen.getByText('Aucun employé ne correspond à la recherche')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Effacer la recherche' }))
  expect(noms()).toEqual(['Ann', 'Élodie'])
})

test('création : POST /salaries avec la fiche choisie dans les listes', async () => {
  const appels = monter(page, PERMS, servir)
  fireEvent.click(await screen.findByRole('button', { name: 'Nouvel employé' }))
  const form = within(screen.getByRole('region', { name: 'Nouvel employé' }))
  fireEvent.change(form.getByLabelText('Matricule'), { target: { value: ' E9 ' } })
  fireEvent.change(form.getByLabelText('Nom'), { target: { value: 'Zoé' } })
  await waitFor(() => expect(form.getByRole('option', { name: 'Mécanicien' })).toBeInTheDocument())
  fireEvent.change(form.getByLabelText('Poste'), { target: { value: 'Mécanicien' } })
  fireEvent.change(form.getByLabelText('Type de contrat'), { target: { value: 'CDD' } })
  fireEvent.click(form.getByRole('button', { name: 'Créer l’employé' }))
  await waitFor(() => expect(ecritures(appels)).toHaveLength(1))
  expect(ecritures(appels)[0].method).toBe('POST')
  expect(ecritures(appels)[0].url).toMatch(/\/salaries$/)
  expect(ecritures(appels)[0].body).toEqual({
    matricule: 'E9', nom: 'Zoé', poste: 'Mécanicien', type_contrat: 'CDD', activite: null, site: null, service: null, actif: true,
  })
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Nouvel employé' })).toBeNull())
})

test('création sans matricule ni nom : champs invalides, aucun appel', async () => {
  const appels = monter(page, PERMS, servir)
  fireEvent.click(await screen.findByRole('button', { name: 'Nouvel employé' }))
  const form = within(screen.getByRole('region', { name: 'Nouvel employé' }))
  fireEvent.click(form.getByRole('button', { name: 'Créer l’employé' }))
  expect(await form.findByText('Matricule obligatoire')).toBeInTheDocument()
  expect(form.getByText('Nom obligatoire')).toBeInTheDocument()
  expect(form.getByLabelText('Matricule')).toHaveAttribute('aria-invalid', 'true')
  expect(form.getByLabelText('Nom')).toHaveAttribute('aria-invalid', 'true')
  expect(ecritures(appels)).toHaveLength(0)
})

test('création refusée par l’API : le message est affiché', async () => {
  monter(page, PERMS, (a) => (a.method === 'POST' ? erreurApi(409, 'Matricule déjà existant') : servir(a)))
  fireEvent.click(await screen.findByRole('button', { name: 'Nouvel employé' }))
  const form = within(screen.getByRole('region', { name: 'Nouvel employé' }))
  fireEvent.change(form.getByLabelText('Matricule'), { target: { value: 'E1' } })
  fireEvent.change(form.getByLabelText('Nom'), { target: { value: 'Doublon' } })
  fireEvent.click(form.getByRole('button', { name: 'Créer l’employé' }))
  expect(await form.findByRole('alert')).toHaveTextContent('Matricule déjà existant')
  expect(form.getByRole('button', { name: 'Créer l’employé' })).toBeEnabled()
})

test('modification : matricule figé, PUT /salaries/{id} avec la fiche complète', async () => {
  const appels = monter(page, PERMS, servir)
  fireEvent.click(await screen.findByRole('button', { name: 'Modifier Ann' }))
  const form = within(screen.getByRole('region', { name: 'Modifier l’employé' }))
  expect(form.getByLabelText('Matricule')).toBeDisabled()
  expect(form.getByLabelText('Matricule')).toHaveValue('E1')
  fireEvent.change(form.getByLabelText('Nom'), { target: { value: 'Ann Marie' } })
  fireEvent.change(form.getByLabelText('Service'), { target: { value: '' } })
  fireEvent.click(form.getByRole('button', { name: 'Enregistrer' }))
  await waitFor(() => expect(ecritures(appels)).toHaveLength(1))
  expect(ecritures(appels)[0].method).toBe('PUT')
  expect(ecritures(appels)[0].url).toMatch(/\/salaries\/1$/)
  expect(ecritures(appels)[0].body).toEqual({
    matricule: 'E1', nom: 'Ann Marie', poste: 'Chef atelier', type_contrat: 'CDI', activite: 'SAV', site: 'Douala', service: null, actif: true,
  })
})

test('désactivation : PUT avec la fiche et actif inversé', async () => {
  const appels = monter(page, PERMS, servir)
  fireEvent.click(await screen.findByRole('button', { name: 'Désactiver Ann' }))
  await waitFor(() => expect(ecritures(appels)).toHaveLength(1))
  expect(ecritures(appels)[0].url).toMatch(/\/salaries\/1$/)
  expect(ecritures(appels)[0].body).toMatchObject({ matricule: 'E1', nom: 'Ann', poste: 'Chef atelier', actif: false })
})

test('échec de l’API sur la liste : état d’erreur', async () => {
  monter(page, PERMS, () => erreurApi(500, 'boom'))
  expect(await screen.findByText('Le serveur a rencontré une erreur')).toBeInTheDocument()
})
