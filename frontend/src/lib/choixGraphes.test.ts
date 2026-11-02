import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ecrireMasques, lireMasques, useChoixGraphes } from './choixGraphes'

const auth = vi.hoisted(() => ({ id: 1 as number | undefined }))
vi.mock('../auth/AuthContext', () => ({ useMonId: () => auth.id }))

afterEach(() => localStorage.clear())

test('lireMasques : liste vide par défaut, valeur illisible ou mal formée ignorée', () => {
  expect(lireMasques('evolution')).toEqual([])
  localStorage.setItem('reporting-rh.graphes.evolution', '{pas du json')
  expect(lireMasques('evolution')).toEqual([])
  localStorage.setItem('reporting-rh.graphes.evolution', JSON.stringify(['ca', 3, null]))
  expect(lireMasques('evolution')).toEqual(['ca'])
})

test('ecrireMasques : enregistre par page, efface la clé quand tout est affiché', () => {
  ecrireMasques('evolution', ['ca', 'marge'])
  expect(lireMasques('evolution')).toEqual(['ca', 'marge'])
  expect(lireMasques('autre')).toEqual([])
  ecrireMasques('evolution', [])
  expect(localStorage.getItem('reporting-rh.graphes.evolution')).toBeNull()
})

test('useChoixGraphes : choix propre à chaque utilisateur, suit un autre onglet', () => {
  localStorage.setItem('reporting-rh.graphes.2.evolution', JSON.stringify(['ca']))
  auth.id = 1
  const { result, rerender } = renderHook(() => useChoixGraphes())
  act(() => result.current.basculer('marge'))
  expect(lireMasques('1.evolution')).toEqual(['marge'])
  auth.id = 2
  rerender()
  expect(result.current.masques).toEqual(['ca'])
  act(() => {
    localStorage.setItem('reporting-rh.graphes.2.evolution', JSON.stringify(['ca', 'effectif']))
    window.dispatchEvent(new StorageEvent('storage', { key: 'reporting-rh.graphes.2.evolution' }))
  })
  expect(result.current.visible('effectif')).toBe(false)
})
