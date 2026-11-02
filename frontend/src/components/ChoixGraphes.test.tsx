import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import ChoixGraphes from './ChoixGraphes'

const choix = { masques: [], visible: () => true, basculer: () => {}, toutAfficher: () => {} }

test('menu des graphiques : fermé par Échap (focus rendu) et par un clic à côté', () => {
  const { container } = render(<ChoixGraphes graphes={[{ id: 'ms', titre: 'Masse salariale' }]} choix={choix} />)
  const menu = container.querySelector('details')!
  menu.open = true
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(menu.open).toBe(false)
  expect(document.activeElement).toBe(screen.getByText('Graphiques (1/1)').closest('summary'))
  menu.open = true
  fireEvent.mouseDown(screen.getByRole('checkbox'))
  expect(menu.open).toBe(true)
  fireEvent.mouseDown(document.body)
  expect(menu.open).toBe(false)
})
