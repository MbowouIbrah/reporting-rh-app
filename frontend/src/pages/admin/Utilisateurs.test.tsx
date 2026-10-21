import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import Utilisateurs from './Utilisateurs'
import { erreurApi, monter, type Appel } from './testSupport'

const TOUT = { tout: true, perimetres: [], services: [], sites: [] }
const ADMIN = ['nominatif', 'marge', 'import', 'saisie', 'referentiel', 'comptes', 'journal']
const COMPTES = [
  { id: 1, email: 'admin@exemple.invalid', nom: 'Admin RH', fonction: 'DRH', actif: true, permissions: ADMIN, portee: TOUT },
  { id: 2, email: 'chef.sav@exemple.invalid', nom: 'Chef Sav', fonction: 'Chef SAV', actif: true, permissions: [], portee: { tout: false, perimetres: [5], services: [], sites: ['Douala'] } },
  { id: 3, email: 'dg@exemple.invalid', nom: 'Élise Directrice', fonction: '', actif: false, permissions: ['nominatif', 'marge'], portee: TOUT },
]
const PERIMETRES = [
  { id: 5, code: 'sav_pl', libelle: 'SAV PL', regles: [{ dimension: 'service', valeur: 'SAV PL' }] },
  { id: 6, code: 'dps', libelle: 'DPS', regles: [{ dimension: 'site', valeur: 'Yaoundé' }] },
]
const REFERENTIELS: Record<string, unknown> = {
  service: { valeurs: [{ id: 1, libelle: 'Commerce VN', actif: true }, { id: 2, libelle: 'SAV PL', actif: true }] },
  site: { valeurs: [{ id: 1, libelle: 'Douala', actif: true }, { id: 2, libelle: 'Yaoundé', actif: true }, { id: 3, libelle: 'Garoua', actif: true }] },
}
const PERMS = ['users:read', 'users:write']

const servir = (a: Appel) => {
  if (a.method === 'PUT') {
    const b = { ...a.body }
    delete b.password
    return { ...COMPTES.find((c) => a.url.endsWith(`/users/${c.id}`)), ...b }
  }
  if (a.method !== 'GET') return a.method === 'POST' ? { ...COMPTES[1], id: 9, nom: 'Nouveau', ...a.body } : {}
  if (a.url.endsWith('/perimetres')) return PERIMETRES
  const ref = a.url.match(/referentiels\/(\w+)/)
  return ref ? REFERENTIELS[ref[1]] : COMPTES
}
const page = <Utilisateurs />
const ecritures = (appels: Appel[]) => appels.filter((a) => a.method !== 'GET')
const liste = async () => within(await screen.findByRole('region', { name: 'Utilisateurs' }))
const ouvrir = async (nom: string) => {
  fireEvent.click(await (await liste()).findByRole('button', { name: new RegExp(nom) }))
  return within(await screen.findByRole('region', { name: nom }))
}
const enregistrer = () => fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))

afterEach(() => vi.restoreAllMocks())

test('liste : fonction, résumé des données visibles et statut', async () => {
  monter(page, PERMS, servir)
  const l = await liste()
  const chef = await l.findByRole('row', { name: /Chef Sav/ })
  expect(within(chef).getByText('Chef SAV')).toBeInTheDocument()
  expect(await within(chef).findByText('SAV PL, Douala')).toBeInTheDocument()
  const dg = l.getByRole('row', { name: /Élise Directrice/ })
  expect(within(dg).getByText('Toutes les données')).toBeInTheDocument()
  expect(within(dg).getByText('Inactif')).toBeInTheDocument()
  expect(within(l.getByRole('row', { name: /Admin RH/ })).getByText('(vous)')).toBeInTheDocument()
  expect(screen.getByText('3 utilisateurs')).toBeInTheDocument()
})

test('recherche sans accents par nom, adresse ou fonction', async () => {
  monter(page, PERMS, servir)
  await (await liste()).findByRole('row', { name: /Chef Sav/ })
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'elise' } })
  expect(screen.getByText('1 utilisateur')).toBeInTheDocument()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'drh' } })
  expect((await liste()).getByRole('row', { name: /Admin RH/ })).toBeInTheDocument()
})

test('fiche : sans changement, pas de barre Enregistrer', async () => {
  monter(page, PERMS, servir)
  const f = await ouvrir('Chef Sav')
  expect(f.getByLabelText('Nom')).toHaveValue('Chef Sav')
  expect(f.getByLabelText('Fonction')).toHaveValue('Chef SAV')
  expect(f.queryByRole('button', { name: 'Enregistrer' })).toBeNull()
  expect(f.getByRole('button', { name: 'Supprimer ce compte' })).toBeInTheDocument()
  fireEvent.change(f.getByLabelText('Nom'), { target: { value: 'Chef SAV PL' } })
  expect(f.getByRole('button', { name: 'Enregistrer' })).toBeInTheDocument()
  fireEvent.click(f.getByRole('button', { name: 'Annuler' }))
  expect(f.getByLabelText('Nom')).toHaveValue('Chef Sav')
  expect(f.queryByRole('button', { name: 'Enregistrer' })).toBeNull()
})

test('fiche : un nom corrigé n’envoie que le nom', async () => {
  const appels = monter(page, PERMS, servir)
  const f = await ouvrir('Chef Sav')
  fireEvent.change(f.getByLabelText('Nom'), { target: { value: ' Chef SAV PL ' } })
  enregistrer()
  await waitFor(() => expect(ecritures(appels)).toHaveLength(1))
  expect(ecritures(appels)[0]).toMatchObject({ method: 'PUT', url: expect.stringContaining('/users/2') })
  expect(ecritures(appels)[0].body).toEqual({ nom: 'Chef SAV PL' })
  expect(await screen.findByText('Modifications enregistrées.')).toBeInTheDocument()
})

test('fiche : espaces seuls = pas de modification ; après enregistrement, mot de passe vidé', async () => {
  const appels = monter(page, PERMS, servir)
  const f = await ouvrir('Chef Sav')
  fireEvent.change(f.getByLabelText('Nom'), { target: { value: 'Chef Sav ' } })
  expect(f.queryByRole('button', { name: 'Enregistrer' })).toBeNull()
  fireEvent.change(f.getByLabelText('Nouveau mot de passe'), { target: { value: '<mot-de-passe-test-12>' } })
  enregistrer()
  await waitFor(() => expect(ecritures(appels)).toHaveLength(1))
  expect(ecritures(appels)[0].body).toEqual({ password: '<mot-de-passe-test-12>' })
  await waitFor(() => expect(f.getByLabelText('Nouveau mot de passe')).toHaveValue(''))
  expect(f.queryByRole('button', { name: 'Enregistrer' })).toBeNull()
})

test('données visibles : périmètres, services et sites cochés partent avec les permissions', async () => {
  const appels = monter(page, PERMS, servir)
  const f = await ouvrir('Chef Sav')
  const services = within(await f.findByRole('group', { name: 'Services' }))
  // Le contenu d'un périmètre coché est affiché coché et grisé.
  expect(services.getByLabelText(/SAV PL/)).toBeChecked()
  expect(services.getByLabelText(/SAV PL/)).toBeDisabled()
  expect(services.getByText('via SAV PL')).toBeInTheDocument()
  fireEvent.click(within(f.getByRole('group', { name: 'Périmètres' })).getByLabelText('DPS'))
  expect(within(f.getByRole('group', { name: 'Sites' })).getByLabelText(/Yaoundé/)).toBeDisabled()
  fireEvent.click(services.getByLabelText('Commerce VN'))
  expect(services.getByLabelText('Tout')).toBeChecked()
  fireEvent.click(f.getByRole('checkbox', { name: /Voir les noms/ }))
  expect(f.getByText(/seulement ce service sur ce site/)).toBeInTheDocument()
  enregistrer()
  await waitFor(() => expect(ecritures(appels)).toHaveLength(1))
  expect(ecritures(appels)[0].body).toEqual({
    permissions: ['nominatif'],
    portee: { tout: false, perimetres: [5, 6], services: ['Commerce VN'], sites: ['Douala'] },
  })
})

test('permissions : celles qui exigent toutes les données sont grisées et retirées', async () => {
  const appels = monter(page, PERMS, servir)
  const f = await ouvrir('Élise Directrice')
  const marge = f.getByRole('checkbox', { name: /Voir le CA et la marge/ })
  expect(marge).toBeChecked()
  expect(f.getByRole('checkbox', { name: /Consulter les rapports/ })).toBeDisabled()
  const sites = within(await f.findByRole('group', { name: 'Sites' }))
  fireEvent.click(sites.getByLabelText('Tout'))
  expect(marge).toBeDisabled()
  expect(marge).not.toBeChecked()
  expect(f.getByText(/Cases grisées : cochez « Tout »/)).toBeInTheDocument()
  expect(f.getByText(/ce compte ne verra aucun rapport/)).toBeInTheDocument()
  fireEvent.click(sites.getByLabelText('Yaoundé'))
  enregistrer()
  await waitFor(() => expect(ecritures(appels)).toHaveLength(1))
  expect(ecritures(appels)[0].body).toEqual({
    permissions: ['nominatif'],
    portee: { tout: false, perimetres: [], services: [], sites: ['Yaoundé'] },
  })
})

test('« Tout » dans les services et les sites = toutes les données', async () => {
  const appels = monter(page, PERMS, servir)
  const f = await ouvrir('Chef Sav')
  fireEvent.click(within(await f.findByRole('group', { name: 'Sites' })).getByLabelText('Tout'))
  expect(f.getByRole('checkbox', { name: /Voir le CA et la marge/ })).toBeDisabled()
  fireEvent.click(within(f.getByRole('group', { name: 'Services' })).getByLabelText('Tout'))
  expect(f.getByText(/ce compte voit toute l’entreprise/)).toBeInTheDocument()
  fireEvent.click(f.getByRole('checkbox', { name: /Voir le CA et la marge/ }))
  enregistrer()
  await waitFor(() => expect(ecritures(appels)).toHaveLength(1))
  expect(ecritures(appels)[0].body).toEqual({ permissions: ['marge'], portee: TOUT })
})

test('suppression annulée : la fiche revient', async () => {
  monter(page, PERMS, servir)
  const f = await ouvrir('Chef Sav')
  fireEvent.click(f.getByRole('button', { name: 'Supprimer ce compte' }))
  fireEvent.click(within(await screen.findByRole('region', { name: 'Supprimer le compte ?' })).getByRole('button', { name: 'Annuler' }))
  expect(await screen.findByRole('region', { name: 'Chef Sav' })).toBeInTheDocument()
  expect((await liste()).getByRole('row', { name: /Chef Sav/ })).not.toHaveClass('a-supprimer')
})

test('son propre compte : données, gestion des comptes et statut verrouillés, pas de suppression', async () => {
  monter(page, PERMS, servir)
  const f = await ouvrir('Admin RH')
  expect(within(f.getByRole('group', { name: 'Périmètres' })).getByLabelText('Tout')).toBeDisabled()
  expect(within(await f.findByRole('group', { name: 'Sites' })).getByLabelText('Douala')).toBeDisabled()
  expect(f.getByRole('checkbox', { name: /Gérer les comptes/ })).toBeDisabled()
  expect(f.getByRole('checkbox', { name: /Consulter le journal/ })).toBeEnabled()
  expect(f.getByRole('checkbox', { name: 'Compte actif' })).toBeDisabled()
  expect(f.queryByRole('button', { name: 'Supprimer ce compte' })).toBeNull()
})

test('changement de compte refusé tant que la fiche est modifiée', async () => {
  monter(page, PERMS, servir)
  const f = await ouvrir('Chef Sav')
  fireEvent.change(f.getByLabelText('Nom'), { target: { value: 'X' } })
  fireEvent.click((await liste()).getByRole('button', { name: /Élise Directrice/ }))
  expect(screen.getByRole('alert')).toHaveTextContent(/Enregistrez ou annulez/)
  expect(screen.queryByRole('region', { name: 'Élise Directrice' })).toBeNull()
})

test('création depuis un modèle, puis sélection du nouveau compte', async () => {
  const appels = monter(page, PERMS, servir)
  await liste()
  fireEvent.click(screen.getByRole('button', { name: 'Nouveau compte' }))
  const f = within(await screen.findByRole('region', { name: 'Nouveau compte' }))
  fireEvent.click(f.getByRole('button', { name: 'Lecteur global' }))
  expect(f.getByLabelText('Fonction')).toHaveValue('Lecteur global')
  expect(within(await f.findByRole('group', { name: 'Services' })).getByLabelText('Tout')).toBeChecked()
  fireEvent.change(f.getByLabelText('Nom'), { target: { value: 'Nouveau' } })
  fireEvent.change(f.getByLabelText('Adresse e-mail'), { target: { value: 'n@exemple.invalid' } })
  fireEvent.change(f.getByLabelText('Mot de passe'), { target: { value: '<mot-de-passe-test-12>' } })
  fireEvent.click(f.getByRole('button', { name: 'Créer le compte' }))
  await waitFor(() => expect(ecritures(appels)).toHaveLength(1))
  expect(ecritures(appels)[0].body).toEqual({
    email: 'n@exemple.invalid', nom: 'Nouveau', fonction: 'Lecteur global', password: '<mot-de-passe-test-12>',
    permissions: ['nominatif', 'marge'], portee: TOUT,
  })
  expect(await screen.findByText('Compte de Nouveau créé.')).toBeInTheDocument()
})

test('création : champs obligatoires vérifiés avant envoi', async () => {
  const appels = monter(page, PERMS, servir)
  await liste()
  fireEvent.click(screen.getByRole('button', { name: 'Nouveau compte' }))
  const f = within(await screen.findByRole('region', { name: 'Nouveau compte' }))
  fireEvent.change(f.getByLabelText('Adresse e-mail'), { target: { value: 'a@b' } })
  fireEvent.change(f.getByLabelText('Mot de passe'), { target: { value: 'court' } })
  fireEvent.click(f.getByRole('button', { name: 'Créer le compte' }))
  expect(f.getByText('Nom obligatoire')).toBeInTheDocument()
  expect(f.getByText('Adresse e-mail invalide')).toBeInTheDocument()
  expect(f.getByText('12 caractères minimum')).toBeInTheDocument()
  expect(ecritures(appels)).toHaveLength(0)
  fireEvent.click(f.getByRole('button', { name: 'Annuler' }))
  expect(screen.queryByRole('region', { name: 'Nouveau compte' })).toBeNull()
})

test('erreur du serveur affichée dans la fiche', async () => {
  monter(page, PERMS, (a) => (a.method === 'PUT' ? erreurApi(409, 'Il doit rester au moins un gestionnaire des comptes actif') : servir(a)))
  const f = await ouvrir('Chef Sav')
  fireEvent.click(f.getByRole('checkbox', { name: 'Compte actif' }))
  enregistrer()
  expect(await f.findByRole('alert')).toHaveTextContent('au moins un gestionnaire')
})

test('suppression après confirmation', async () => {
  const appels = monter(page, PERMS, servir)
  const f = await ouvrir('Chef Sav')
  fireEvent.click(f.getByRole('button', { name: 'Supprimer ce compte' }))
  // La confirmation remplace la fiche ; la ligne du compte est signalée dans la liste.
  const d = within(await screen.findByRole('region', { name: 'Supprimer le compte ?' }))
  expect(screen.queryByRole('region', { name: 'Chef Sav' })).toBeNull()
  expect((await liste()).getByRole('row', { name: /Chef Sav/ })).toHaveClass('a-supprimer')
  fireEvent.click(d.getByRole('button', { name: 'Supprimer' }))
  await waitFor(() => expect(ecritures(appels)).toHaveLength(1))
  expect(ecritures(appels)[0]).toMatchObject({ method: 'DELETE', url: expect.stringContaining('/users/2') })
  expect(await screen.findByText('Compte de Chef Sav supprimé.')).toBeInTheDocument()
})
