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
  monter(<ExportPdf />, ['nominatif:read'], () => ({}), '/annuel')
  fireEvent.click(await screen.findByRole('button', { name: 'Exporter en PDF' }))
  // Droits chargés (/auth/me) : la partie Individuel apparaît
  await screen.findByRole('checkbox', { name: 'Individuel', hidden: true })
  expect(screen.getByRole('checkbox', { name: 'Annuel', hidden: true })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Résumé', hidden: true })).not.toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Tout le rapport', hidden: true }))
  fireEvent.click(screen.getByRole('button', { name: 'Exporter', hidden: true }))
  const url = String(ouvrir.mock.calls[0][0])
  expect(url).toContain('rapport?')
  expect(url).toContain('annee=2026')
  expect(url).toContain('service=SAV+PL')
  expect(url).toContain('sections=resume%2Cgraphes%2Cannuel%2Cmensuel%2Cindividuel')
})

test('sans droit nominatif, pas de partie Individuel', async () => {
  monter(<ExportPdf />, [], () => ({}), '/resume')
  fireEvent.click(await screen.findByRole('button', { name: 'Exporter en PDF' }))
  expect(screen.queryByRole('checkbox', { name: 'Individuel', hidden: true })).toBeNull()
})

test('aucun bouton sur l’administration', async () => {
  monter(<ExportPdf />, ['saisie:write'], () => ({}), '/admin')
  await new Promise((r) => setTimeout(r, 50))
  expect(screen.queryByRole('button', { name: 'Exporter en PDF' })).toBeNull()
})
