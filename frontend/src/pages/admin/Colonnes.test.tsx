import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import Colonnes from './Colonnes'
import { erreurApi, monter, type Appel } from './testSupport'

const col = (id: number, libelle: string, o: Partial<{ nature: string; unite: string; actif: boolean; moteur: boolean; valeurs: number; dernier_mois: number | null }> = {}) => ({
  id, libelle, nature: 'paie', unite: 'FCFA', actif: true, moteur: false, valeurs: 0, dernier_mois: null, ...o,
})
const COLS = [
  col(1, 'Brut Réel', { moteur: true, valeurs: 120, dernier_mois: 3 }),
  col(2, 'Prime de vacances', { valeurs: 4, dernier_mois: 2 }),
  col(3, 'Prime vide'),
  col(4, 'Ancienne prime', { actif: false }),
  col(5, 'Ventes', { nature: 'activite', unite: 'nombre', valeurs: 10, dernier_mois: 3 }),
]
const servir = (a: Appel) => {
  if (a.method !== 'GET') return {}
  const annee = /annee=(\d+)/.exec(a.url)?.[1]
  return annee === '2025'
    ? { annee: 2025, annees: [2026, 2025], colonnes: COLS.map((c) => ({ ...c, valeurs: 0, dernier_mois: null })) }
    : { annee: 2026, annees: [2026, 2025], colonnes: COLS }
}
const PERMS = ['referentiel:write']
const ecritures = (appels: Appel[]) => appels.filter((a) => a.method !== 'GET')
const ligne = async (nom: string) => (await screen.findByRole('rowheader', { name: nom })).closest('tr') as HTMLElement

afterEach(() => vi.restoreAllMocks())

test('liste : nature, unité, valeurs, dernier mois, état et badge Vide', async () => {
  monter(<Colonnes />, PERMS, servir)
  const brut = await ligne('Brut Réel')
  expect(within(brut).getByText('120')).toBeInTheDocument()
  expect(within(brut).getByText('Mars')).toBeInTheDocument()
  expect(within(await ligne('Ventes')).getByText('Activité')).toBeInTheDocument()
  expect(within(await ligne('Prime vide')).getByText('Vide')).toBeInTheDocument()
  // Une colonne inactive vide n'a pas de badge.
  const ancienne = await ligne('Ancienne prime')
  expect(within(ancienne).getByText('Inactive')).toBeInTheDocument()
  expect(within(ancienne).queryByText('Vide')).toBeNull()
})

test('rubrique lue par les KPI : pas de bouton, une explication', async () => {
  monter(<Colonnes />, PERMS, servir)
  const brut = await ligne('Brut Réel')
  expect(within(brut).queryByRole('button')).toBeNull()
  expect(within(brut).getByText('Utilisée par les KPI')).toHaveAttribute('title')
})

test('ajout : libellé obligatoire, puis POST avec nature et unité', async () => {
  const appels = monter(<Colonnes />, PERMS, servir)
  const form = await screen.findByRole('form', { name: 'Ajouter une colonne' })
  fireEvent.click(within(form).getByRole('button', { name: 'Ajouter' }))
  expect(await within(form).findByText('Libellé obligatoire')).toBeInTheDocument()
  expect(ecritures(appels)).toHaveLength(0)
  fireEvent.change(within(form).getByLabelText('Nouvelle colonne'), { target: { value: ' Clients ' } })
  fireEvent.change(within(form).getByLabelText('Nature'), { target: { value: 'activite' } })
  expect(within(form).getByLabelText('Unité')).toHaveValue('nombre')
  fireEvent.click(within(form).getByRole('button', { name: 'Ajouter' }))
  await waitFor(() => expect(ecritures(appels)).toHaveLength(1))
  expect(ecritures(appels)[0]).toMatchObject({ method: 'POST', body: { libelle: 'Clients', nature: 'activite', unite: 'nombre' } })
  expect(ecritures(appels)[0].url).toContain('/parametrage/rubriques')
})

test('ajout refusé : message du serveur', async () => {
  monter(<Colonnes />, PERMS, (a) => (a.method === 'POST' ? erreurApi(409, 'Libellé déjà utilisé') : servir(a)))
  const form = await screen.findByRole('form', { name: 'Ajouter une colonne' })
  fireEvent.change(within(form).getByLabelText('Nouvelle colonne'), { target: { value: 'Brut Réel' } })
  fireEvent.click(within(form).getByRole('button', { name: 'Ajouter' }))
  expect(await within(form).findByRole('alert')).toHaveTextContent('Libellé déjà utilisé')
})

test('désactiver une colonne remplie : confirmation avec le nombre de valeurs', async () => {
  const appels = monter(<Colonnes />, PERMS, servir)
  fireEvent.click(await screen.findByRole('button', { name: 'Désactiver Prime de vacances' }))
  const dlg = await screen.findByRole('dialog', { name: 'Désactiver « Prime de vacances » ?' })
  expect(dlg).toHaveTextContent('4 valeurs en 2026.')
  expect(ecritures(appels)).toHaveLength(0)
  fireEvent.click(within(dlg).getByRole('button', { name: 'Désactiver' }))
  await waitFor(() => expect(ecritures(appels)).toHaveLength(1))
  expect(ecritures(appels)[0]).toMatchObject({ method: 'PUT', body: { actif: false } })
  expect(ecritures(appels)[0].url).toContain('/parametrage/rubriques/2')
})

test('désactiver une colonne vide ou réactiver : sans confirmation', async () => {
  const appels = monter(<Colonnes />, PERMS, servir)
  fireEvent.click(await screen.findByRole('button', { name: 'Désactiver Prime vide' }))
  await waitFor(() => expect(ecritures(appels)).toHaveLength(1))
  expect(ecritures(appels)[0]).toMatchObject({ method: 'PUT', body: { actif: false } })
  fireEvent.click(screen.getByRole('button', { name: 'Réactiver Ancienne prime' }))
  await waitFor(() => expect(ecritures(appels)).toHaveLength(2))
  expect(ecritures(appels)[1]).toMatchObject({ method: 'PUT', body: { actif: true } })
  expect(screen.queryByRole('dialog')).toBeNull()
})

test("changer d'année : remplissage relu pour l'année choisie", async () => {
  const appels = monter(<Colonnes />, PERMS, servir)
  const annee = await screen.findByLabelText('Remplissage en')
  expect(annee).toHaveValue('2026')
  fireEvent.change(annee, { target: { value: '2025' } })
  await waitFor(() => expect(appels.some((a) => a.url.includes('annee=2025'))).toBe(true))
  expect(await within(await ligne('Prime de vacances')).findByText('Vide')).toBeInTheDocument()
})
