import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ecrirePref, lirePref, usePreference } from './preference'

const auth = vi.hoisted(() => ({ id: 1 as number | undefined }))
vi.mock('../auth/AuthContext', () => ({ useMonId: () => auth.id }))
// Serveur simulé : préférences par utilisateur (`<id>.<clé>`), `en_panne` pour l'injoignable.
const serveur = vi.hoisted(() => ({ prefs: new Map<string, unknown>(), en_panne: false, refus: false, envois: 0 }))
const Erreur = vi.hoisted(() => class extends Error { constructor(public status: number) { super(String(status)) } })
vi.mock('../api/client', () => ({
  ApiError: Erreur,
  api: async (chemin: string, init?: RequestInit) => {
    if (serveur.en_panne) throw new Error('réseau')
    const k = `${auth.id}.${chemin.split('/').pop()}`
    if (init?.method === 'PUT') {
      if (serveur.refus) throw new Erreur(422)
      serveur.envois++
      const v = (JSON.parse(String(init.body)) as { valeur: unknown }).valeur
      serveur.prefs.set(k, v)
      return { valeur: v }
    }
    return { valeur: serveur.prefs.get(k) ?? null }
  },
}))

// Réglage de test : une liste de textes (comme les anciens graphiques masqués).
const NOM = 'graphes.evolution'
const lire = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null)
const DEFAUT: string[] = []
const LOCAL = 'reporting-rh.pref.'
const utiliser = () => usePreference(NOM, lire, DEFAUT)

afterEach(() => {
  localStorage.clear()
  serveur.prefs.clear()
  serveur.en_panne = false
  serveur.refus = false
  serveur.envois = 0
  auth.id = 1
})

test('lirePref : valeur par défaut, copie illisible ou mal formée ignorée', () => {
  expect(lirePref(`1.${NOM}`, lire, DEFAUT)).toEqual([])
  localStorage.setItem(`${LOCAL}1.${NOM}`, '{pas du json')
  expect(lirePref(`1.${NOM}`, lire, DEFAUT)).toEqual([])
  localStorage.setItem(`${LOCAL}1.${NOM}`, JSON.stringify({ a: 1 }))
  expect(lirePref(`1.${NOM}`, lire, DEFAUT)).toEqual([])
  localStorage.setItem(`${LOCAL}1.${NOM}`, JSON.stringify(['ca', 3, null]))
  expect(lirePref(`1.${NOM}`, lire, DEFAUT)).toEqual(['ca'])
})

test('ecrirePref : enregistre par nom, efface la clé quand la valeur est celle par défaut', () => {
  ecrirePref(`1.${NOM}`, ['ca', 'marge'], DEFAUT)
  expect(lirePref(`1.${NOM}`, lire, DEFAUT)).toEqual(['ca', 'marge'])
  expect(lirePref('1.autre', lire, DEFAUT)).toEqual([])
  ecrirePref(`1.${NOM}`, [], DEFAUT)
  expect(localStorage.getItem(`${LOCAL}1.${NOM}`)).toBeNull()
})

test('usePreference : réglage propre à chaque utilisateur, suit un autre onglet', () => {
  localStorage.setItem(`${LOCAL}2.${NOM}`, JSON.stringify(['ca']))
  auth.id = 1
  const { result, rerender } = renderHook(utiliser)
  act(() => result.current[1](['marge']))
  expect(lirePref(`1.${NOM}`, lire, DEFAUT)).toEqual(['marge'])
  auth.id = 2
  rerender()
  expect(result.current[0]).toEqual(['ca'])
  act(() => {
    localStorage.setItem(`${LOCAL}2.${NOM}`, JSON.stringify(['ca', 'effectif']))
    window.dispatchEvent(new StorageEvent('storage', { key: `${LOCAL}2.${NOM}` }))
  })
  expect(result.current[0]).toEqual(['ca', 'effectif'])
})

test("usePreference : la valeur du serveur prime et suit l'utilisateur sur un autre poste", async () => {
  serveur.prefs.set(`1.${NOM}`, ['effectif'])
  localStorage.setItem(`${LOCAL}1.${NOM}`, JSON.stringify(['ca']))
  const { result } = renderHook(utiliser)
  await waitFor(() => expect(result.current[0]).toEqual(['effectif']))
  expect(lirePref(`1.${NOM}`, lire, DEFAUT)).toEqual(['effectif'])
  act(() => result.current[1](['effectif', 'ca']))
  await waitFor(() => expect(serveur.prefs.get(`1.${NOM}`)).toEqual(['effectif', 'ca']))
  act(() => result.current[1]([]))
  await waitFor(() => expect(serveur.prefs.get(`1.${NOM}`)).toEqual([]))
})

test("usePreference : un retour au réglage par défaut fait ailleurs l'emporte sur une vieille copie locale", async () => {
  serveur.prefs.set(`1.${NOM}`, [])
  localStorage.setItem(`${LOCAL}1.${NOM}`, JSON.stringify(['ca']))
  const { result } = renderHook(utiliser)
  await waitFor(() => expect(result.current[0]).toEqual([]))
  expect(serveur.envois).toBe(0)
  expect(localStorage.getItem(`${LOCAL}1.${NOM}`)).toBeNull()
})

test('usePreference : ancienne copie du navigateur reprise sur le serveur ; serveur injoignable sans perte', async () => {
  localStorage.setItem(`${LOCAL}1.${NOM}`, JSON.stringify(['ca']))
  renderHook(utiliser)
  await waitFor(() => expect(serveur.prefs.get(`1.${NOM}`)).toEqual(['ca']))
  serveur.en_panne = true
  auth.id = 2
  localStorage.setItem(`${LOCAL}2.${NOM}`, JSON.stringify(['marge']))
  const { result } = renderHook(utiliser)
  act(() => result.current[1](['marge', 'ca']))
  await new Promise((r) => setTimeout(r, 0))
  expect(result.current[0]).toEqual(['marge', 'ca'])
  expect(lirePref(`2.${NOM}`, lire, DEFAUT)).toEqual(['marge', 'ca'])
})

test('usePreference : changement fait avant la réponse du serveur gardé', async () => {
  serveur.prefs.set(`1.${NOM}`, ['effectif'])
  const { result } = renderHook(utiliser)
  act(() => result.current[1](['ca']))
  await waitFor(() => expect(serveur.envois).toBe(1))
  await new Promise((r) => setTimeout(r, 0))
  expect(result.current[0]).toEqual(['ca'])
})

test("usePreference : un envoi échoué n'est pas écrasé par le serveur au chargement suivant", async () => {
  serveur.prefs.set(`1.${NOM}`, ['ca'])
  const a = renderHook(utiliser)
  await waitFor(() => expect(a.result.current[0]).toEqual(['ca']))
  serveur.en_panne = true
  act(() => a.result.current[1](['ca', 'marge']))
  await waitFor(() => expect(localStorage.getItem(`${LOCAL}1.${NOM}.attente`)).toBe('1'))
  a.unmount()
  serveur.en_panne = false
  const b = renderHook(utiliser)
  await waitFor(() => expect(serveur.prefs.get(`1.${NOM}`)).toEqual(['ca', 'marge']))
  expect(b.result.current[0]).toEqual(['ca', 'marge'])
  await waitFor(() => expect(localStorage.getItem(`${LOCAL}1.${NOM}.attente`)).toBeNull())
})

test('usePreference : deux changements avant le rendu suivant, le dernier est gardé et envoyé', async () => {
  const { result } = renderHook(utiliser)
  act(() => {
    result.current[1](['ca'])
    result.current[1](['ca', 'marge'])
  })
  expect(result.current[0]).toEqual(['ca', 'marge'])
  await waitFor(() => expect(serveur.prefs.get(`1.${NOM}`)).toEqual(['ca', 'marge']))
})

test('usePreference : valeur du serveur mal formée ignorée', async () => {
  serveur.prefs.set(`1.${NOM}`, { a: 1 })
  localStorage.setItem(`${LOCAL}1.${NOM}`, JSON.stringify(['ca']))
  const { result } = renderHook(utiliser)
  await new Promise((r) => setTimeout(r, 10))
  expect(result.current[0]).toEqual(['ca'])
})

test("usePreference : un envoi refusé par le serveur (forme rejetée) n'est pas renvoyé", async () => {
  const a = renderHook(utiliser)
  serveur.refus = true
  act(() => a.result.current[1](['ca']))
  await waitFor(() => expect(serveur.envois).toBe(0))
  await waitFor(() => expect(localStorage.getItem(`${LOCAL}1.${NOM}.attente`)).toBeNull())
  expect(a.result.current[0]).toEqual(['ca'])
})
