import { fireEvent, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { modifierPartage, viderPartage } from '../lib/filtresPartages'
import { monter } from '../pages/admin/testSupport'
import ExportPdf from './ExportPdf'

afterEach(() => {
  vi.restoreAllMocks()
  viderPartage()
})

test('la page courante est cochée ; Tout le rapport ouvre toutes les parties avec les filtres', async () => {
  const ouvrir = vi.spyOn(window, 'open').mockReturnValue(null)
  modifierPartage({ annee: '2026', service: 'SAV PL' })
  monter(<ExportPdf />, ['nominatif:read'], () => ({}), '/charges')
  fireEvent.click(await screen.findByRole('button', { name: 'Exporter en PDF' }))
  // Droits chargés (/auth/me) : la partie Individuel apparaît
  await screen.findByRole('checkbox', { name: 'Individuel', hidden: true })
  expect(screen.getByRole('checkbox', { name: 'Répartition des charges', hidden: true })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Budget réalisé', hidden: true })).not.toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Tout le rapport', hidden: true }))
  fireEvent.click(screen.getByRole('button', { name: 'Exporter', hidden: true }))
  const url = String(ouvrir.mock.calls[0][0])
  expect(url).toContain('rapport?')
  expect(url).toContain('annee=2026')
  expect(url).toContain('service=SAV+PL')
  expect(url).toContain('sections=resume%2Cgraphes%2Ccharges%2Cindividuel')
})

test('sans droit nominatif, pas de partie Individuel', async () => {
  monter(<ExportPdf />, [], () => ({}), '/resume')
  fireEvent.click(await screen.findByRole('button', { name: 'Exporter en PDF' }))
  expect(screen.queryByRole('checkbox', { name: 'Individuel', hidden: true })).toBeNull()
})

test('page Graphes : deux choix ; Graphiques dynamiques ferme le menu et lance la sélection', async () => {
  const graphiques = vi.fn()
  monter(<ExportPdf onGraphiques={graphiques} />, [], () => ({}), '/graphes')
  fireEvent.click(await screen.findByRole('button', { name: 'Exporter' }))
  fireEvent.click(screen.getByRole('button', { name: /Budget réalisé PDF/, hidden: true }))
  expect(screen.getByRole('checkbox', { name: 'Graphes', hidden: true })).toBeChecked()
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: 'Exporter' }))
  fireEvent.click(screen.getByRole('button', { name: /Graphiques dynamiques/, hidden: true }))
  expect(graphiques).toHaveBeenCalledOnce()
  expect(screen.queryByRole('group', { name: 'Type d’export', hidden: true })).toBeNull()
})

test('aucun bouton sur l’administration', async () => {
  monter(<ExportPdf />, ['saisie:write'], () => ({}), '/admin')
  await new Promise((r) => setTimeout(r, 50))
  expect(screen.queryByRole('button', { name: 'Exporter en PDF' })).toBeNull()
})
