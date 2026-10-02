import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import LienExport from './LienExport'

test('le lien reprend les filtres de la page et omet le vide', () => {
  render(<LienExport rapport="annuel" filtres={{ annee: 2026, mois: 6, service: 'SAV PL' }} />)
  const href = screen.getByRole('link', { name: 'Exporter (xlsx)' }).getAttribute('href') ?? ''
  expect(href).toContain('/rapports/annuel/export?')
  expect(href).toContain('annee=2026')
  expect(href).toContain('service=SAV+PL')
  expect(href).not.toContain('site=')
})
