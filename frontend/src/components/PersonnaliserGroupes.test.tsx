import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { CONFIG_ORIGINE, GRAPHES } from '../lib/groupesGraphes'
import PersonnaliserGroupes from './PersonnaliserGroupes'

const tous = new Set(GRAPHES.map((g) => g.id))

function fenetre(config = CONFIG_ORIGINE) {
  const onEnregistrer = vi.fn()
  const onAnnuler = vi.fn()
  render(<PersonnaliserGroupes config={config} dispo={tous} onEnregistrer={onEnregistrer} onAnnuler={onAnnuler} />)
  return { onEnregistrer, onAnnuler }
}

const enregistrer = () => fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
const sortie = (f: ReturnType<typeof fenetre>) => f.onEnregistrer.mock.calls[0][0]

test('personnaliser : sans changement, le réglage d’origine est rendu tel quel', () => {
  const f = fenetre()
  enregistrer()
  expect(sortie(f)).toEqual(CONFIG_ORIGINE)
})

test('personnaliser : masquer un groupe, en monter un, choisir celui qui s’ouvre en premier', () => {
  const f = fenetre()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Afficher Frais et avantages' }))
  // ordre affiché : ensemble, salaire, ventes, ateliers ; « Ventes, marge et commissions » monte d’un cran
  fireEvent.click(screen.getByRole('button', { name: 'Monter Ventes, marge et commissions' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Ouvrir sur Ventes, marge et commissions' }))
  enregistrer()
  expect(sortie(f)).toEqual({ perso: [], ordre: ['ensemble', 'ventes', 'salaire', 'ateliers'], defaut: 'ventes' })
})

test('personnaliser : masquer le groupe d’ouverture le fait passer au premier groupe affiché', () => {
  const f = fenetre()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Afficher Effectif et masse salariale' }))
  enregistrer()
  expect(sortie(f).defaut).toBe('salaire')
  expect(sortie(f).ordre).toEqual(['salaire', 'avantages', 'ventes', 'ateliers'])
})

test('personnaliser : un nouveau groupe est limité à 4 graphiques', () => {
  const f = fenetre()
  fireEvent.click(screen.getByRole('button', { name: 'Nouveau groupe' }))
  fireEvent.change(screen.getByLabelText('Nom du groupe'), { target: { value: '  Mes courbes ' } })
  for (const t of ['Salaire par mois (FCFA)', 'Primes par mois (FCFA)', 'CA par mois (FCFA)', 'Marge par mois (FCFA)']) {
    fireEvent.click(screen.getByRole('checkbox', { name: t }))
  }
  expect(screen.getByText(/Graphiques \(4\/4\)/)).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'Effectif' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Valider' }))
  enregistrer()
  const c = sortie(f)
  expect(c.perso).toHaveLength(1)
  expect(c.perso[0]).toMatchObject({ nom: 'Mes courbes', graphes: ['salaire', 'primes', 'ca', 'marge'] })
  expect(c.ordre).toEqual([...CONFIG_ORIGINE.ordre, c.perso[0].id])
})

test('personnaliser : « Valider » refusé sans nom ni graphique, un groupe créé peut être supprimé', () => {
  const f = fenetre()
  fireEvent.click(screen.getByRole('button', { name: 'Nouveau groupe' }))
  expect(screen.getByRole('button', { name: 'Valider' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Nom du groupe'), { target: { value: 'Test' } })
  expect(screen.getByRole('button', { name: 'Valider' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Effectif' }))
  fireEvent.click(screen.getByRole('button', { name: 'Valider' }))
  fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }))
  enregistrer()
  expect(sortie(f)).toEqual(CONFIG_ORIGINE)
})

test('personnaliser : « N’afficher que mes groupes », « Rétablir » et Annuler', () => {
  const config = { perso: [{ id: 'p-1', nom: 'Mes ventes', graphes: ['ca'] }], ordre: ['ensemble', 'p-1'], defaut: 'p-1' }
  const f = fenetre(config)
  fireEvent.click(screen.getByRole('button', { name: 'N’afficher que mes groupes' }))
  expect(screen.getByRole('checkbox', { name: 'Afficher Effectif et masse salariale' })).not.toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Rétablir les groupes d’origine' }))
  enregistrer()
  expect(sortie(f)).toEqual({ perso: config.perso, ordre: CONFIG_ORIGINE.ordre, defaut: 'ensemble' })
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
  expect(f.onAnnuler).toHaveBeenCalledTimes(1)
})

test('personnaliser : Enregistrer impossible quand aucun groupe n’est affiché', () => {
  fenetre()
  for (const c of screen.getAllByRole('checkbox')) fireEvent.click(c)
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled()
})

test('personnaliser : « N’afficher que mes groupes » affiche aussi les groupes perso masqués', () => {
  const perso = [{ id: 'p-1', nom: 'Mes ventes', graphes: ['ca'] }, { id: 'p-2', nom: 'Mes primes', graphes: ['primes'] }]
  const f = fenetre({ perso, ordre: ['ensemble', 'p-1'], defaut: 'ensemble' })
  fireEvent.click(screen.getByRole('button', { name: 'N’afficher que mes groupes' }))
  enregistrer()
  expect(sortie(f)).toEqual({ perso, ordre: ['p-1', 'p-2'], defaut: 'p-1' })
})

function fenetreNoms(onNoms: (n: Record<string, string>) => Promise<void>, noms: Record<string, string> = {}) {
  const onEnregistrer = vi.fn()
  render(<PersonnaliserGroupes config={CONFIG_ORIGINE} dispo={tous} noms={noms} onNoms={onNoms} onEnregistrer={onEnregistrer} onAnnuler={vi.fn()} />)
  return onEnregistrer
}

test('noms : section absente sans onNoms', () => {
  fenetre()
  expect(screen.queryByText('Noms des groupes (vus par tous)')).toBeNull()
})

test('noms : renommer un groupe puis enregistrer envoie le nom et applique le libellé', async () => {
  const onNoms = vi.fn().mockResolvedValue(undefined)
  const onEnregistrer = fenetreNoms(onNoms)
  expect(screen.getByText('Noms des groupes (vus par tous)')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Ventes, marge et commissions'), { target: { value: '  Nouveau nom ' } })
  expect(screen.getByRole('checkbox', { name: 'Afficher Nouveau nom' })).toBeInTheDocument()
  enregistrer()
  await waitFor(() => expect(onEnregistrer).toHaveBeenCalled())
  expect(onNoms).toHaveBeenCalledWith({ ventes: 'Nouveau nom' })
})

test('noms : champ vidé, la clé est retirée ; sans changement, rien n’est envoyé', async () => {
  const onNoms = vi.fn().mockResolvedValue(undefined)
  const onEnregistrer = fenetreNoms(onNoms, { ventes: 'Chiffre', salaire: 'Paie' })
  fireEvent.change(screen.getByLabelText('Ventes, marge et commissions'), { target: { value: '' } })
  enregistrer()
  await waitFor(() => expect(onEnregistrer).toHaveBeenCalled())
  expect(onNoms).toHaveBeenCalledWith({ salaire: 'Paie' })
})

test('noms : sans changement, onNoms n’est pas appelé', async () => {
  const onNoms = vi.fn().mockResolvedValue(undefined)
  const onEnregistrer = fenetreNoms(onNoms, { ventes: 'Chiffre' })
  enregistrer()
  await waitFor(() => expect(onEnregistrer).toHaveBeenCalled())
  expect(onNoms).not.toHaveBeenCalled()
})

test('noms : échec de l’envoi, message d’erreur et la fenêtre reste ouverte', async () => {
  const onNoms = vi.fn().mockRejectedValue(new Error('403'))
  const onEnregistrer = fenetreNoms(onNoms)
  fireEvent.change(screen.getByLabelText('Ventes, marge et commissions'), { target: { value: 'X' } })
  enregistrer()
  expect(await screen.findByRole('alert')).toHaveTextContent('Les noms des groupes n’ont pas pu être enregistrés')
  expect(onEnregistrer).not.toHaveBeenCalled()
})
