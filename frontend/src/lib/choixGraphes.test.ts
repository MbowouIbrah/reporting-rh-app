import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ecrireMasques, lireMasques, useChoixGraphes } from './choixGraphes'

const auth = vi.hoisted(() => ({ id: 1 as number | undefined }))
vi.mock('../auth/AuthContext', () => ({ useMonId: () => auth.id }))
// Serveur simulé : préférences par utilisateur (`<id>.<clé>`), `en_panne` pour l'injoignable.
const serveur = vi.hoisted(() => ({ prefs: new Map<string, string[]>(), en_panne: false, envois: 0 }))
vi.mock('../api/client', () => ({
  api: async (chemin: string, init?: RequestInit) => {
    if (serveur.en_panne) throw new Error('réseau')
    const k = `${auth.id}.${chemin.split('/').pop()}`
    if (init?.method === 'PUT') {
      serveur.envois++
      const v = (JSON.parse(String(init.body)) as { valeur: string[] }).valeur
      serveur.prefs.set(k, v)
      return { valeur: v }
    }
    return { valeur: serveur.prefs.get(k) ?? null }
  },
}))

afterEach(() => {
  localStorage.clear()
  serveur.prefs.clear()
  serveur.en_panne = false
  serveur.envois = 0
  auth.id = 1
})

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

test("useChoixGraphes : le choix du serveur prime et suit l'utilisateur sur un autre poste", async () => {
  serveur.prefs.set('1.graphes.evolution', ['effectif'])
  localStorage.setItem('reporting-rh.graphes.1.evolution', JSON.stringify(['ca']))
  const { result } = renderHook(() => useChoixGraphes())
  await waitFor(() => expect(result.current.masques).toEqual(['effectif']))
  expect(lireMasques('1.evolution')).toEqual(['effectif'])
  act(() => result.current.basculer('ca'))
  await waitFor(() => expect(serveur.prefs.get('1.graphes.evolution')).toEqual(['effectif', 'ca']))
  act(() => result.current.toutAfficher())
  await waitFor(() => expect(serveur.prefs.get('1.graphes.evolution')).toEqual([]))
})

test("useChoixGraphes : « Tout afficher » fait ailleurs l'emporte sur une vieille copie locale", async () => {
  serveur.prefs.set('1.graphes.evolution', [])
  localStorage.setItem('reporting-rh.graphes.1.evolution', JSON.stringify(['ca']))
  const { result } = renderHook(() => useChoixGraphes())
  await waitFor(() => expect(result.current.masques).toEqual([]))
  expect(serveur.envois).toBe(0)
  expect(localStorage.getItem('reporting-rh.graphes.1.evolution')).toBeNull()
})

test('useChoixGraphes : ancien choix du navigateur repris sur le serveur ; serveur injoignable sans perte', async () => {
  localStorage.setItem('reporting-rh.graphes.1.evolution', JSON.stringify(['ca']))
  renderHook(() => useChoixGraphes())
  await waitFor(() => expect(serveur.prefs.get('1.graphes.evolution')).toEqual(['ca']))
  serveur.en_panne = true
  auth.id = 2
  localStorage.setItem('reporting-rh.graphes.2.evolution', JSON.stringify(['marge']))
  const { result } = renderHook(() => useChoixGraphes())
  act(() => result.current.basculer('ca'))
  await new Promise((r) => setTimeout(r, 0))
  expect(result.current.masques).toEqual(['marge', 'ca'])
  expect(lireMasques('2.evolution')).toEqual(['marge', 'ca'])
})

test('useChoixGraphes : changement fait avant la réponse du serveur gardé', async () => {
  serveur.prefs.set('1.graphes.evolution', ['effectif'])
  const { result } = renderHook(() => useChoixGraphes())
  act(() => result.current.basculer('ca'))
  await waitFor(() => expect(serveur.envois).toBe(1))
  await new Promise((r) => setTimeout(r, 0))
  expect(result.current.masques).toEqual(['ca'])
})

test("useChoixGraphes : un envoi échoué n'est pas écrasé par le serveur au chargement suivant", async () => {
  serveur.prefs.set('1.graphes.evolution', ['ca'])
  const a = renderHook(() => useChoixGraphes())
  await waitFor(() => expect(a.result.current.masques).toEqual(['ca']))
  serveur.en_panne = true
  act(() => a.result.current.basculer('marge'))
  await waitFor(() => expect(localStorage.getItem('reporting-rh.graphes.1.evolution.attente')).toBe('1'))
  a.unmount()
  serveur.en_panne = false
  const b = renderHook(() => useChoixGraphes())
  await waitFor(() => expect(serveur.prefs.get('1.graphes.evolution')).toEqual(['ca', 'marge']))
  expect(b.result.current.masques).toEqual(['ca', 'marge'])
  await waitFor(() => expect(localStorage.getItem('reporting-rh.graphes.1.evolution.attente')).toBeNull())
})

test('useChoixGraphes : deux bascules avant le rendu suivant sont gardées toutes les deux', async () => {
  const { result } = renderHook(() => useChoixGraphes())
  act(() => {
    result.current.basculer('ca')
    result.current.basculer('marge')
  })
  expect(result.current.masques).toEqual(['ca', 'marge'])
  await waitFor(() => expect(serveur.prefs.get('1.graphes.evolution')).toEqual(['ca', 'marge']))
})
