import { fireEvent, render, screen } from '@testing-library/react'
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
  fireEvent.click(screen.getByRole('checkbox', { name: 'Afficher Avantages' }))
  // ordre affiché : ensemble, salaire, ventes, ateliers ; « Ventes et marge » monte d’un cran
  fireEvent.click(screen.getByRole('button', { name: 'Monter Ventes et marge' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Ouvrir sur Ventes et marge' }))
  enregistrer()
  expect(sortie(f)).toEqual({ perso: [], ordre: ['ensemble', 'ventes', 'salaire', 'ateliers'], defaut: 'ventes' })
})

test('personnaliser : masquer le groupe d’ouverture le fait passer au premier groupe affiché', () => {
  const f = fenetre()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Afficher Vue d’ensemble' }))
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
  expect(screen.getByRole('checkbox', { name: 'Afficher Vue d’ensemble' })).not.toBeChecked()
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
