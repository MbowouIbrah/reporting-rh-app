import { screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { monter } from '../pages/admin/testSupport'
import AdminNav from './AdminNav'

afterEach(() => vi.restoreAllMocks())

const onglets = () => screen.getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])

test('les trois onglets avec tous les droits, Données actif sur /admin', async () => {
  monter(<AdminNav />, ['saisie:write', 'referentiel:write'], () => ({}))
  await screen.findByRole('link', { name: 'Sites, services et colonnes' })
  expect(onglets()).toEqual([
    ['Données', '/admin'],
    ['Employés', '/admin/employes'],
    ['Sites, services et colonnes', '/admin/referentiels'],
  ])
  expect(screen.getByRole('link', { name: 'Données' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('link', { name: 'Employés' })).not.toHaveAttribute('aria-current')
  expect(screen.getByRole('heading', { name: 'ADMINISTRATION DES DONNÉES' })).toBeInTheDocument()
})

test('un onglet est masqué sans le droit qu’exige son API', async () => {
  monter(<AdminNav />, ['saisie:write'], () => ({}))
  await screen.findByRole('link', { name: 'Employés' })
  expect(onglets().map((o) => o[0])).toEqual(['Données', 'Employés'])
  expect(screen.queryByRole('link', { name: 'Sites, services et colonnes' })).toBeNull()
})
