import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import RequireAuth from '../../auth/RequireAuth'
import Utilisateurs from './Utilisateurs'
import { erreurApi, monter, type Appel } from './testSupport'

const COMPTES = [
  { id: 1, email: 'admin@exemple.invalid', nom: 'Admin RH', actif: true, roles: [{ role: 'rh_admin', perimetre_id: null, nominatif: true }] },
  { id: 2, email: 'chef.sav@exemple.invalid', nom: 'Chef Sav', actif: true, roles: [{ role: 'lecteur_perimetre', perimetre_id: 5, nominatif: false }] },
  { id: 3, email: 'dg@exemple.invalid', nom: 'Élise Directrice', actif: false, roles: [{ role: 'lecteur_global', perimetre_id: null, nominatif: false }] },
]
const PERIMETRES = [
  { id: 5, code: 'sav_pl', libelle: 'SAV PL' },
  { id: 6, code: 'dps', libelle: 'DPS' },
]
const PERMS = ['users:read', 'users:write']

const servir = (a: Appel) => {
  if (a.method !== 'GET') return {}
  return a.url.endsWith('/perimetres') ? PERIMETRES : COMPTES
}
const page = <Utilisateurs />
const ecritures = (appels: Appel[]) => appels.filter((a) => a.method !== 'GET')
const tableau = async () => within(await screen.findByRole('region', { name: 'Utilisateurs' }))
const formulaire = async (titre: string) => within(await screen.findByRole('region', { name: titre }))

afterEach(() => vi.restoreAllMocks())

test('liste : rôle, périmètre, détail nominatif et statut', async () => {
  monter(page, PERMS, servir)
  const t = await tableau()
  const chef = await t.findByRole('row', { name: /Chef Sav/ })
  expect(within(chef).getByText('Lecteur à périmètre')).toBeInTheDocument()
  expect(await within(chef).findByText('SAV PL')).toBeInTheDocument()
  expect(within(chef).getByText('Non')).toBeInTheDocument()
  const dg = t.getByRole('row', { name: /Élise Directrice/ })
  expect(within(dg).getByText('Tous')).toBeInTheDocument()
  expect(within(dg).getByText('Oui')).toBeInTheDocument() // rôle global : détail nominatif d'office
  expect(within(dg).getByText('Inactif')).toBeInTheDocument()
  expect(within(dg).getByRole('button', { name: 'Réactiver Élise Directrice' })).toBeInTheDocument()
  expect(screen.getByText('3 utilisateurs')).toBeInTheDocument()
})

test('recherche sans accents par nom ou adresse', async () => {
  monter(page, PERMS, servir)
  await (await tableau()).findByRole('row', { name: /Chef Sav/ })
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'elise' } })
  expect(screen.getByText('1 utilisateur')).toBeInTheDocument()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'chef.sav@' } })
  expect((await tableau()).getByRole('row', { name: /Chef Sav/ })).toBeInTheDocument()
})

test('son propre compte : ni désactivation ni suppression', async () => {
  monter(page, PERMS, servir)
  const moi = await (await tableau()).findByRole('row', { name: /Admin RH/ })
  expect(within(moi).getByRole('button', { name: 'Modifier Admin RH' })).toBeInTheDocument()
  expect(within(moi).queryByRole('button', { name: /Désactiver|Supprimer/ })).toBeNull()
})

test('sans droit sur les utilisateurs : accès refusé', async () => {
  monter(
    <Routes>
      <Route path="/admin/utilisateurs" element={<RequireAuth perm="users:write"><Utilisateurs /></RequireAuth>} />
    </Routes>,
    ['saisie:write'], servir, '/admin/utilisateurs',
  )
  expect(await screen.findByText('Accès refusé')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'ADMINISTRATION DES UTILISATEURS' })).toBeNull()
})

test('création : contrôles immédiats, puis envoi du compte', async () => {
  const appels = monter(page, PERMS, servir)
  fireEvent.click(await screen.findByRole('button', { name: 'Nouvel utilisateur' }))
  const f = await formulaire('Nouvel utilisateur')
  fireEvent.change(f.getByLabelText('Adresse e-mail'), { target: { value: 'pas-une-adresse' } })
  fireEvent.change(f.getByLabelText('Mot de passe'), { target: { value: 'court' } })
  fireEvent.click(f.getByRole('button', { name: 'Créer l’utilisateur' }))
  expect(await f.findByText('Nom obligatoire')).toBeInTheDocument()
  expect(f.getByText('Adresse e-mail invalide')).toBeInTheDocument()
  expect(f.getByText('12 caractères minimum')).toBeInTheDocument()
  expect(f.getByText('Périmètre obligatoire')).toBeInTheDocument()
  expect(ecritures(appels)).toEqual([])

  fireEvent.change(f.getByLabelText('Nom'), { target: { value: ' Paul Neuf ' } })
  fireEvent.change(f.getByLabelText('Adresse e-mail'), { target: { value: 'paul@exemple.invalid' } })
  fireEvent.change(f.getByLabelText('Mot de passe'), { target: { value: '<mot-de-passe-test-s>' } })
  await f.findByRole('option', { name: 'DPS' })
  fireEvent.change(f.getByLabelText('Périmètre'), { target: { value: '6' } })
  fireEvent.click(f.getByLabelText('Accès au détail nominatif'))
  fireEvent.click(f.getByRole('button', { name: 'Créer l’utilisateur' }))
  await waitFor(() => expect(ecritures(appels)).toHaveLength(1))
  expect(ecritures(appels)[0]).toMatchObject({
    method: 'POST',
    body: { email: 'paul@exemple.invalid', nom: 'Paul Neuf', password: '<mot-de-passe-test-s>', roles: [{ role: 'lecteur_perimetre', perimetre_id: 6, nominatif: true }] },
  })
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Nouvel utilisateur' })).toBeNull())
})

test('rôle global : pas de périmètre, détail nominatif d’office', async () => {
  const appels = monter(page, PERMS, servir)
  fireEvent.click(await screen.findByRole('button', { name: 'Nouvel utilisateur' }))
  const f = await formulaire('Nouvel utilisateur')
  fireEvent.change(f.getByLabelText('Rôle'), { target: { value: 'lecteur_global' } })
  expect(f.queryByLabelText('Périmètre')).toBeNull()
  expect(f.queryByLabelText('Accès au détail nominatif')).toBeNull()
  fireEvent.change(f.getByLabelText('Nom'), { target: { value: 'Dir' } })
  fireEvent.change(f.getByLabelText('Adresse e-mail'), { target: { value: 'dir@exemple.invalid' } })
  fireEvent.change(f.getByLabelText('Mot de passe'), { target: { value: '<mot-de-passe-test-s>' } })
  fireEvent.click(f.getByRole('button', { name: 'Créer l’utilisateur' }))
  await waitFor(() => expect(ecritures(appels)).toHaveLength(1))
  expect(ecritures(appels)[0].body?.roles).toEqual([{ role: 'lecteur_global', perimetre_id: null, nominatif: true }])
})

test('modification du périmètre : les rôles sont envoyés', async () => {
  const appels = monter(page, PERMS, servir)
  fireEvent.click(await screen.findByRole('button', { name: 'Modifier Chef Sav' }))
  const f = await formulaire('Modifier l’utilisateur')
  await waitFor(() => expect(f.getByLabelText('Périmètre')).toHaveValue('5'))
  fireEvent.change(f.getByLabelText('Périmètre'), { target: { value: '6' } })
  fireEvent.click(f.getByRole('button', { name: 'Enregistrer' }))
  await waitFor(() => expect(ecritures(appels)).toHaveLength(1))
  expect(ecritures(appels)[0].body?.roles).toEqual([{ role: 'lecteur_perimetre', perimetre_id: 6, nominatif: false }])
})

test('son propre compte : rôle verrouillé, jamais envoyé', async () => {
  const appels = monter(page, PERMS, servir)
  fireEvent.click(await screen.findByRole('button', { name: 'Modifier Admin RH' }))
  const f = await formulaire('Modifier l’utilisateur')
  expect(f.getByLabelText('Rôle')).toBeDisabled()
  fireEvent.click(f.getByRole('button', { name: 'Enregistrer' }))
  await waitFor(() => expect(ecritures(appels)).toHaveLength(1))
  expect(ecritures(appels)[0].body).not.toHaveProperty('roles')
})

test('modification du nom seul : ni rôles ni mot de passe envoyés', async () => {
  const appels = monter(page, PERMS, servir)
  fireEvent.click(await screen.findByRole('button', { name: 'Modifier Chef Sav' }))
  const f = await formulaire('Modifier l’utilisateur')
  expect(f.getByLabelText('Adresse e-mail')).toBeDisabled()
  expect(f.getByLabelText('Nom')).toHaveValue('Chef Sav')
  await waitFor(() => expect(f.getByLabelText('Périmètre')).toHaveValue('5'))
  fireEvent.change(f.getByLabelText('Nom'), { target: { value: 'Chef SAV PL' } })
  fireEvent.click(f.getByRole('button', { name: 'Enregistrer' }))
  await waitFor(() => expect(ecritures(appels)).toHaveLength(1))
  const [put] = ecritures(appels)
  expect(put).toMatchObject({ method: 'PUT', body: { nom: 'Chef SAV PL' } })
  expect(put.url).toMatch(/\/users\/2$/)
  expect(put.body).not.toHaveProperty('password')
  expect(put.body).not.toHaveProperty('roles')
})

test('modification : un nouveau mot de passe trop court est refusé', async () => {
  const appels = monter(page, PERMS, servir)
  fireEvent.click(await screen.findByRole('button', { name: 'Modifier Chef Sav' }))
  const f = await formulaire('Modifier l’utilisateur')
  fireEvent.change(f.getByLabelText('Nouveau mot de passe (facultatif)'), { target: { value: 'abc' } })
  fireEvent.click(f.getByRole('button', { name: 'Enregistrer' }))
  expect(await f.findByText('12 caractères minimum')).toBeInTheDocument()
  expect(ecritures(appels)).toEqual([])
})

test('désactivation : seul le statut est envoyé', async () => {
  const appels = monter(page, PERMS, servir)
  fireEvent.click(await screen.findByRole('button', { name: 'Désactiver Chef Sav' }))
  await waitFor(() => expect(ecritures(appels)).toHaveLength(1))
  expect(ecritures(appels)[0]).toMatchObject({ method: 'PUT', body: { actif: false } })
  expect(Object.keys(ecritures(appels)[0].body ?? {})).toEqual(['actif'])
})

test('suppression : confirmation, puis DELETE', async () => {
  const appels = monter(page, PERMS, servir)
  fireEvent.click(await screen.findByRole('button', { name: 'Supprimer Chef Sav' }))
  const d = within(await screen.findByRole('dialog', { name: 'Supprimer l’utilisateur ?' }))
  expect(d.getByText(/Chef Sav \(chef\.sav@x\.fr\)/)).toBeInTheDocument()
  expect(ecritures(appels)).toEqual([])
  fireEvent.click(d.getByRole('button', { name: 'Supprimer' }))
  await waitFor(() => expect(ecritures(appels)).toHaveLength(1))
  expect(ecritures(appels)[0].method).toBe('DELETE')
  expect(ecritures(appels)[0].url).toMatch(/\/users\/2$/)
})

test('refus du serveur affiché', async () => {
  monter(page, PERMS, (a) => (a.method === 'PUT' ? erreurApi(409, 'Il doit rester au moins un administrateur actif') : servir(a)))
  fireEvent.click(await screen.findByRole('button', { name: 'Désactiver Chef Sav' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Il doit rester au moins un administrateur actif')
})

test('création refusée par le serveur : message dans le formulaire, qui reste ouvert', async () => {
  monter(page, PERMS, (a) => (a.method === 'POST' ? erreurApi(409, 'Conflit : doublon ou référence invalide') : servir(a)))
  fireEvent.click(await screen.findByRole('button', { name: 'Nouvel utilisateur' }))
  const f = await formulaire('Nouvel utilisateur')
  fireEvent.change(f.getByLabelText('Rôle'), { target: { value: 'rh_admin' } })
  fireEvent.change(f.getByLabelText('Nom'), { target: { value: 'Double' } })
  fireEvent.change(f.getByLabelText('Adresse e-mail'), { target: { value: 'admin@exemple.invalid' } })
  fireEvent.change(f.getByLabelText('Mot de passe'), { target: { value: '<mot-de-passe-test-s>' } })
  fireEvent.click(f.getByRole('button', { name: 'Créer l’utilisateur' }))
  expect(await f.findByRole('alert')).toHaveTextContent('Conflit : doublon ou référence invalide')
})
