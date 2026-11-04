import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { GROUPES_ORIGINE } from '../lib/groupesGraphes'
import MenuGroupes from './MenuGroupes'

function menu(vue = 'ensemble') {
  const onVue = vi.fn()
  const onPersonnaliser = vi.fn()
  const r = render(<MenuGroupes groupes={GROUPES_ORIGINE.slice(0, 3)} vue={vue} defaut="ensemble" onVue={onVue} onPersonnaliser={onPersonnaliser} />)
  return { ...r, onVue, onPersonnaliser, details: r.container.querySelector('details')! }
}

test('menu des groupes : le groupe courant est annoncé, chaque groupe a sa description et « par défaut » est signalé', () => {
  menu()
  expect(screen.getByText('Groupe : Vue d’ensemble', { selector: 'summary' })).toBeInTheDocument()
  expect(screen.getByText('Masse salariale mensuelle, Rémunération globale, Effectif, Absences par mois (jours)')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Vue d’ensemble/ })).toHaveAttribute('aria-current', 'true')
  expect(screen.getByRole('button', { name: /Avantages/ })).not.toHaveAttribute('aria-current')
  expect(screen.getAllByText('par défaut')).toHaveLength(1)
})

test('menu des groupes : choisir un groupe change la vue et ferme le menu', () => {
  const { onVue, details } = menu()
  details.open = true
  fireEvent.click(screen.getByRole('button', { name: /Avantages/ }))
  expect(onVue).toHaveBeenCalledWith('avantages')
  expect(details.open).toBe(false)
})

test('menu des groupes : « Tout afficher » et « Personnaliser… »', () => {
  const { onVue, onPersonnaliser, details } = menu('tout')
  expect(screen.getByText('Tous les groupes', { selector: 'summary' })).toBeInTheDocument()
  details.open = true
  fireEvent.click(screen.getByRole('button', { name: /Tout afficher \(3 groupes\)/ }))
  expect(onVue).toHaveBeenCalledWith('tout')
  details.open = true
  fireEvent.click(screen.getByRole('button', { name: 'Personnaliser…' }))
  expect(onPersonnaliser).toHaveBeenCalledTimes(1)
  expect(details.open).toBe(false)
})

test('menu des groupes : fermé par Échap (focus rendu) et par un clic à côté', () => {
  const { details } = menu()
  details.open = true
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(details.open).toBe(false)
  expect(document.activeElement).toBe(details.querySelector('summary'))
  details.open = true
  fireEvent.mouseDown(screen.getByRole('button', { name: /Avantages/ }))
  expect(details.open).toBe(true)
  fireEvent.mouseDown(document.body)
  expect(details.open).toBe(false)
})
