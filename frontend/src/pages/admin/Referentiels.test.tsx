import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import RequireAuth from '../../auth/RequireAuth'
import Referentiels from './Referentiels'
import { erreurApi, monter, type Appel } from './testSupport'

const SITES = [
  { id: 1, libelle: 'Yaoundé', actif: true, type_site: 'principal' },
  { id: 2, libelle: 'Douala', actif: true, type_site: 'agence' },
]
const SERVICES = [{ id: 10, libelle: 'SAV PL', actif: false }]
const PERMS = ['referentiel:write', 'saisie:write']

const servir = (a: Appel) => {
  if (a.method === 'PUT' && a.url.includes('apercu=true')) return { perimetres_maj: 2, comptes_maj: 1 }
  if (a.method !== 'GET') return {}
  return { valeurs: a.url.endsWith('/site') ? SITES : SERVICES, alias: [] }
}
const page = <Referentiels />
const ecritures = (appels: Appel[]) => appels.filter((a) => a.method !== 'GET')

afterEach(() => vi.restoreAllMocks())

test('deux blocs : sites avec leur type et leur statut, services', async () => {
  monter(page, PERMS, servir)
  const sites = within(await screen.findByRole('region', { name: 'Sites' }))
  expect(await sites.findByRole('row', { name: /Douala/ })).toBeInTheDocument()
  expect(sites.getByLabelText('Type de site de Douala')).toHaveValue('agence')
  expect(sites.getByLabelText('Type de site de Yaoundé')).toHaveValue('principal')
  expect([...(sites.getByLabelText('Type de site de Douala') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['Principal', 'Agence', 'Déporté'])
  const services = within(screen.getByRole('region', { name: 'Services' }))
  const ligne = await services.findByRole('row', { name: /SAV PL/ })
  expect(within(ligne).getByText('Inactif')).toBeInTheDocument()
  expect(services.queryByRole('columnheader', { name: 'Type de site' })).toBeNull()
})

test('sans droit sur les référentiels : accès refusé', async () => {
  monter(
    <Routes>
      <Route path="/admin/referentiels" element={<RequireAuth perm="referentiel:write"><Referentiels /></RequireAuth>} />
    </Routes>,
    ['saisie:write'], servir, '/admin/referentiels',
  )
  expect(await screen.findByText('Accès refusé')).toBeInTheDocument()
})

test('ajout d’un site : POST /referentiels/site avec le type choisi', async () => {
  const appels = monter(page, PERMS, servir)
  const form = within(await screen.findByRole('form', { name: 'Ajouter un site' }))
  fireEvent.change(form.getByLabelText('Nouveau site'), { target: { value: ' Garoua Nord ' } })
  fireEvent.change(form.getByLabelText('Type de site'), { target: { value: 'deporte' } })
  fireEvent.click(form.getByRole('button', { name: 'Ajouter' }))
  await waitFor(() => expect(ecritures(appels)).toHaveLength(1))
  expect(ecritures(appels)[0].url).toMatch(/\/referentiels\/site$/)
  expect(ecritures(appels)[0].body).toEqual({ libelle: 'Garoua Nord', type_site: 'deporte' })
  await waitFor(() => expect(form.getByLabelText('Nouveau site')).toHaveValue(''))
})

test('ajout d’un service : POST /referentiels/service sans type de site', async () => {
  const appels = monter(page, PERMS, servir)
  const form = within(await screen.findByRole('form', { name: 'Ajouter un service' }))
  expect(form.queryByLabelText('Type de site')).toBeNull()
  fireEvent.change(form.getByLabelText('Nouveau service'), { target: { value: 'Qualité' } })
  fireEvent.click(form.getByRole('button', { name: 'Ajouter' }))
  await waitFor(() => expect(ecritures(appels)).toHaveLength(1))
  expect(ecritures(appels)[0].url).toMatch(/\/referentiels\/service$/)
  expect(ecritures(appels)[0].body).toEqual({ libelle: 'Qualité' })
})

test('ajout refusé par l’API (libellé existant) : message affiché, champ conservé', async () => {
  monter(page, PERMS, (a) => (a.method === 'POST' ? erreurApi(409, 'Libellé déjà utilisé') : servir(a)))
  const form = within(await screen.findByRole('form', { name: 'Ajouter un site' }))
  fireEvent.change(form.getByLabelText('Nouveau site'), { target: { value: 'Douala' } })
  fireEvent.click(form.getByRole('button', { name: 'Ajouter' }))
  expect(await form.findByRole('alert')).toHaveTextContent('Libellé déjà utilisé')
  expect(form.getByLabelText('Nouveau site')).toHaveValue('Douala')
})

test('ajout sans libellé : champ signalé invalide, aucun appel', async () => {
  const appels = monter(page, PERMS, servir)
  const form = within(await screen.findByRole('form', { name: 'Ajouter un site' }))
  fireEvent.click(form.getByRole('button', { name: 'Ajouter' }))
  expect(await form.findByText('Libellé obligatoire')).toBeInTheDocument()
  expect(form.getByLabelText('Nouveau site')).toHaveAttribute('aria-invalid', 'true')
  expect(ecritures(appels)).toHaveLength(0)
})

test('type de site : PUT /referentiels/site/{id} avec type_site', async () => {
  const appels = monter(page, PERMS, servir)
  fireEvent.change(await screen.findByLabelText('Type de site de Douala'), { target: { value: 'deporte' } })
  await waitFor(() => expect(ecritures(appels)).toHaveLength(1))
  expect(ecritures(appels)[0].url).toMatch(/\/referentiels\/site\/2$/)
  expect(ecritures(appels)[0].body).toEqual({ type_site: 'deporte' })
})

test('activation d’un service : PUT {actif}', async () => {
  const appels = monter(page, PERMS, servir)
  fireEvent.click(await screen.findByRole('button', { name: 'Réactiver SAV PL' }))
  await waitFor(() => expect(ecritures(appels)).toHaveLength(1))
  expect(ecritures(appels)[0].url).toMatch(/\/referentiels\/service\/10$/)
  expect(ecritures(appels)[0].body).toEqual({ actif: true })
})

test('renommage : aperçu des périmètres mis à jour, puis PUT avec le nouveau libellé', async () => {
  const appels = monter(page, PERMS, servir)
  fireEvent.click(await screen.findByRole('button', { name: 'Renommer Douala' }))
  const champ = screen.getByLabelText('Nouveau libellé de Douala')
  const valider = screen.getByRole('button', { name: 'Renommer' })
  expect(valider).toBeDisabled() // libellé inchangé
  fireEvent.change(champ, { target: { value: 'Douala Port' } })
  expect(await screen.findByText(/2 périmètres et 1 compte mis à jour/)).toHaveTextContent('« Douala » reste reconnu à l’import')
  const apercu = appels.find((a) => a.url.includes('apercu=true'))!
  expect(apercu.url).toMatch(/\/referentiels\/site\/2\?apercu=true$/)
  expect(apercu.body).toEqual({ libelle: 'Douala Port' })
  expect(ecritures(appels).filter((a) => !a.url.includes('apercu'))).toHaveLength(0) // rien d'écrit avant confirmation
  fireEvent.click(valider)
  await waitFor(() => expect(ecritures(appels).filter((a) => !a.url.includes('apercu'))).toHaveLength(1))
  const put = ecritures(appels).find((a) => !a.url.includes('apercu'))!
  expect(put.url).toMatch(/\/referentiels\/site\/2$/)
  expect(put.body).toEqual({ libelle: 'Douala Port' })
})

test('renommage en conflit : l’erreur de l’aperçu est affichée et la confirmation bloquée', async () => {
  monter(page, PERMS, (a) => (a.url.includes('apercu=true') ? erreurApi(409, 'Libellé déjà utilisé') : servir(a)))
  fireEvent.click(await screen.findByRole('button', { name: 'Renommer Douala' }))
  const champ = screen.getByLabelText('Nouveau libellé de Douala')
  fireEvent.change(champ, { target: { value: 'Yaoundé' } })
  expect(await screen.findByRole('alert')).toHaveTextContent('Libellé déjà utilisé')
  expect(champ).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByRole('button', { name: 'Renommer' })).toBeDisabled()
})
