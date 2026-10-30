import type { Pilotage } from '../../../api/pilotage'
import { repartirColonnes, verifier } from './budgets'

const cols = (...h: number[]) => repartirColonnes(h.map((x, i) => ({ id: String.fromCharCode(97 + i), h: x })))

test('colonnes équilibrées quel que soit le nombre de lignes', () => {
  expect(cols(10, 10, 10)).toEqual([['a'], ['b'], ['c']]) // tableaux voisins : un par colonne
  expect(cols(20, 8, 10)).toEqual([['a'], ['b', 'c']]) // un long tableau face aux deux courts empilés
  expect(cols(4, 3, 20)).toEqual([['a', 'b'], ['c']])
  expect(cols(7)).toEqual([['a']])
})

const cible = (cible_id: number, libelle: string, valeur: string | null = null, actif = true) =>
  ({ cible_id, libelle, actif, exclue: false, valeur })
const VUE: Pilotage = {
  annee: 2026, mois: 3, periode_id: 1, ca: null, marge: null, taux_marge: null,
  budgets: {
    rubrique: [cible(1, 'Brut', '1000.000'), cible(2, 'Transport', '400.000'), cible(3, 'Ancien', null, false)],
    service: [cible(1, 'SAV', '1400.000')],
    site: [],
  },
  totaux: { rubrique: null, service: null, site: null },
  reprise: null,
}

test('vérification : changements et points d’attention', () => {
  const v = verifier(VUE, { 'rubrique:1': '10 000', 'rubrique:2': '', 'rubrique:3': '0', 'service:1': '1 400,000' })
  expect(v.changements.map((c) => [c.libelle, c.apres])).toEqual([['Brut', '10000'], ['Transport', null], ['Ancien', '0']])
  expect([v.ajouts.length, v.modifs.length, v.effaces.length]).toEqual([1, 1, 1])
  expect(v.totaux.rubrique).toEqual({ avant: '1400.000', apres: '10000' })
  expect(v.points.map((p) => p.code)).toEqual(['EFFACE', 'TOTAUX', 'MANQUANT', 'ECART', 'ZERO', 'INACTIF'])
  expect(v.points.find((p) => p.code === 'ECART')!.lignes).toEqual(['Brut (types de charge) : 1 000 → 10 000'])
})

test('vérification sans point : totaux cohérents, montants proches', () => {
  const v = verifier(VUE, { 'rubrique:1': '1100', 'rubrique:2': '300', 'rubrique:3': '', 'service:1': '1400' })
  expect(v.points).toEqual([])
  expect(v.modifs.map((c) => c.libelle)).toEqual(['Brut', 'Transport'])
})
