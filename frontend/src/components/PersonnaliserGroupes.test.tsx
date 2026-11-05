import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { CONFIG_ORIGINE, GRAPHES, VUE_TOUT } from '../lib/groupesGraphes'
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
const renommer = (actuel: string, nom: string) => {
  fireEvent.click(screen.getByRole('button', { name: `Modifier ${actuel}` }))
  fireEvent.change(screen.getByLabelText('Nom du groupe'), { target: { value: nom } })
  fireEvent.click(screen.getByRole('button', { name: 'Valider' }))
}

test('personnaliser : sans changement, le réglage d’origine est rendu tel quel', () => {
  const f = fenetre()
  enregistrer()
  expect(sortie(f)).toEqual(CONFIG_ORIGINE)
})

test('personnaliser : masquer un groupe et en monter un : les groupes cochés s’affichent directement', () => {
  const f = fenetre()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Afficher Frais et avantages' }))
  // le groupe décoché garde sa place : « Ventes, marge et commissions » monte de deux crans pour passer devant « Salaires »
  fireEvent.click(screen.getByRole('button', { name: 'Monter Ventes, marge et commissions' }))
  fireEvent.click(screen.getByRole('button', { name: 'Monter Ventes, marge et commissions' }))
  enregistrer()
  expect(sortie(f)).toEqual({ perso: [], ordre: ['ensemble', 'ventes', 'salaire', 'ateliers'], defaut: VUE_TOUT })
})

test('personnaliser : décocher un groupe le laisse à sa place dans la liste', () => {
  fenetre()
  const noms = () => screen.getAllByRole('checkbox', { name: /^Afficher / }).map((c) => c.getAttribute('aria-label'))
  const avant = noms()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Afficher Salaires, primes et charges' }))
  expect(noms()).toEqual(avant)
  expect(screen.getByRole('checkbox', { name: 'Afficher Salaires, primes et charges' })).not.toBeChecked()
})

test('personnaliser : « Afficher tous les groupes » recoche tout, décocher un groupe la décoche', () => {
  const f = fenetre()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Afficher Frais et avantages' }))
  const tout = screen.getByRole('checkbox', { name: 'Afficher tous les groupes' })
  fireEvent.click(tout)
  expect(screen.getByRole('checkbox', { name: 'Afficher Frais et avantages' })).toBeChecked()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Afficher Atelier et productivité' }))
  expect(tout).not.toBeChecked()
  enregistrer()
  expect(sortie(f).defaut).toBe(VUE_TOUT)
})

test('personnaliser : un seul groupe affiché est le groupe par défaut', () => {
  const f = fenetre()
  for (const n of ['Effectif et masse salariale', 'Salaires, primes et charges', 'Frais et avantages', 'Ventes, marge et commissions'])
    fireEvent.click(screen.getByRole('checkbox', { name: `Afficher ${n}` }))
  enregistrer()
  expect(sortie(f)).toMatchObject({ ordre: ['ateliers'], defaut: 'ateliers' })
})

test('personnaliser : masquer un groupe laisse les autres affichés ensemble', () => {
  const f = fenetre()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Afficher Effectif et masse salariale' }))
  enregistrer()
  expect(sortie(f).defaut).toBe(VUE_TOUT)
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
  expect(sortie(f)).toEqual({ perso: config.perso, ordre: CONFIG_ORIGINE.ordre, defaut: VUE_TOUT })
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
  expect(f.onAnnuler).toHaveBeenCalledTimes(1)
})

test('personnaliser : Enregistrer impossible quand aucun groupe n’est affiché', () => {
  fenetre()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Afficher tous les groupes' }))
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled()
})

test('personnaliser : « N’afficher que mes groupes » affiche aussi les groupes perso masqués', () => {
  const perso = [{ id: 'p-1', nom: 'Mes ventes', graphes: ['ca'] }, { id: 'p-2', nom: 'Mes primes', graphes: ['primes'] }]
  const f = fenetre({ perso, ordre: ['ensemble', 'p-1'], defaut: 'ensemble' })
  fireEvent.click(screen.getByRole('button', { name: 'N’afficher que mes groupes' }))
  enregistrer()
  expect(sortie(f)).toEqual({ perso, ordre: ['p-1', 'p-2'], defaut: VUE_TOUT })
})

function fenetreNoms(onNoms: (n: Record<string, string>) => Promise<void>, noms: Record<string, string> = {}) {
  const onEnregistrer = vi.fn()
  render(<PersonnaliserGroupes config={CONFIG_ORIGINE} dispo={tous} noms={noms} onNoms={onNoms} onEnregistrer={onEnregistrer} onAnnuler={vi.fn()} />)
  return onEnregistrer
}

test('noms : sans onNoms, les noms saisis sont personnels et gardés dans le réglage', () => {
  const onEnregistrer = vi.fn()
  render(<PersonnaliserGroupes config={CONFIG_ORIGINE} dispo={tous} noms={{ ventes: 'Commun' }} onEnregistrer={onEnregistrer} onAnnuler={vi.fn()} />)
  expect(screen.getByRole('checkbox', { name: 'Afficher Commun' })).toBeInTheDocument()
  renommer('Commun', ' A moi ')
  expect(screen.getByRole('checkbox', { name: 'Afficher A moi' })).toBeInTheDocument()
  enregistrer()
  expect(onEnregistrer.mock.calls[0][0]).toEqual({ ...CONFIG_ORIGINE, noms: { ventes: 'A moi' } })
})

test('noms : un nom personnel vidé est retiré du réglage', () => {
  const f = fenetre({ ...CONFIG_ORIGINE, noms: { ventes: 'A moi' } })
  renommer('A moi', '')
  enregistrer()
  expect(sortie(f)).toEqual(CONFIG_ORIGINE)
})

test('noms : renommer un groupe puis enregistrer envoie le nom et applique le libellé', async () => {
  const onNoms = vi.fn().mockResolvedValue(undefined)
  const onEnregistrer = fenetreNoms(onNoms)
  renommer('Ventes, marge et commissions', '  Nouveau nom ')
  expect(screen.getByRole('checkbox', { name: 'Afficher Nouveau nom' })).toBeInTheDocument()
  enregistrer()
  await waitFor(() => expect(onEnregistrer).toHaveBeenCalled())
  expect(onNoms).toHaveBeenCalledWith({ ventes: 'Nouveau nom' })
})

test('noms : champ vidé, la clé est retirée ; sans changement, rien n’est envoyé', async () => {
  const onNoms = vi.fn().mockResolvedValue(undefined)
  const onEnregistrer = fenetreNoms(onNoms, { ventes: 'Chiffre', salaire: 'Paie' })
  renommer('Chiffre', '')
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
  renommer('Ventes, marge et commissions', 'X')
  enregistrer()
  expect(await screen.findByRole('alert')).toHaveTextContent('Les noms des groupes n’ont pas pu être enregistrés')
  expect(onEnregistrer).not.toHaveBeenCalled()
})

test('groupe d’origine : la modification montre ses graphiques sans cases à cocher, nom prérempli', () => {
  fenetre()
  expect(screen.queryByText(/Noms des groupes/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Modifier Ventes, marge et commissions' }))
  expect(screen.getByLabelText('Nom du groupe')).toHaveValue('Ventes, marge et commissions')
  expect(screen.getByText('CA par mois (FCFA)')).toBeInTheDocument()
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
})

test('afficher tous les groupes : décochée puis recochée, tous les groupes reviennent', () => {
  const f = fenetre()
  const caseTout = screen.getByRole('checkbox', { name: 'Afficher tous les groupes' })
  expect(caseTout).toBeChecked()
  fireEvent.click(caseTout)
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled()
  fireEvent.click(caseTout)
  enregistrer()
  expect(sortie(f)).toEqual(CONFIG_ORIGINE)
})
