import { expect, test } from 'vitest'
import {
  CONFIG_ORIGINE, descGroupe, GRAPHES, GROUPES_ORIGINE, groupesAffiches, groupesDuMenu, lireConfig, lireNoms, nouvelId, retablirOrigine, tousLesGroupes, choisirVue, vueDuMenu,
} from './groupesGraphes'

const tous = new Set(GRAPHES.map((g) => g.id))
const sans = (...ids: string[]) => new Set([...tous].filter((x) => !ids.includes(x)))

test('groupes d’origine : 4 graphiques connus chacun, aucun graphique en double', () => {
  const ids = GROUPES_ORIGINE.flatMap((g) => g.graphes)
  expect(ids).toHaveLength(20)
  expect(new Set(ids)).toEqual(tous)
  for (const g of GROUPES_ORIGINE) expect(g.graphes.length).toBeLessThanOrEqual(4)
})

test('groupesAffiches : dans l’ordre du réglage, graphiques sans donnée retirés', () => {
  const g = groupesAffiches({ ...CONFIG_ORIGINE, ordre: ['ventes', 'ensemble'] }, sans('marge'))
  expect(g.map((x) => x.id)).toEqual(['ventes', 'ensemble'])
  expect(g[0].graphes).toEqual(['ca', 'commissions', 'ventes'])
})

test('groupesAffiches : groupe devenu vide retiré, identifiant inconnu et doublon ignorés', () => {
  const dispo = sans('clients', 'factures', 'productivite', 'or')
  const g = groupesAffiches({ ...CONFIG_ORIGINE, ordre: ['ateliers', 'inconnu', 'ensemble', 'ensemble'] }, dispo)
  expect(g.map((x) => x.id)).toEqual(['ensemble'])
})

test('groupesAffiches : groupe d’origine absent de l’ordre masqué, groupe perso affiché, graphique inconnu retiré', () => {
  const config = {
    perso: [{ id: 'p-1', nom: 'Mes ventes', graphes: ['ca', 'disparu', 'marge'] }],
    ordre: ['p-1'],
    defaut: 'p-1',
  }
  const g = groupesAffiches(config, tous)
  expect(g).toEqual([{ id: 'p-1', nom: 'Mes ventes', graphes: ['ca', 'marge'] }])
  expect(tousLesGroupes(config)).toHaveLength(6)
})

test('choisirVue : un groupe devient le seul coché, « tout » recoche tout sans doublon', () => {
  const trois = { ...CONFIG_ORIGINE, ordre: ['ventes', 'ensemble', 'salaire'], defaut: 'tout' }
  expect(choisirVue(trois, 'ateliers')).toMatchObject({ ordre: ['ateliers'], defaut: 'ateliers' })
  expect(choisirVue(trois, 'tout')).toMatchObject({ ordre: ['ventes', 'ensemble', 'salaire', 'avantages', 'ateliers'], defaut: 'tout' })
})

test('vueDuMenu : groupe seul, tout, ou aucune ligne pour une sélection', () => {
  const menu = groupesAffiches(CONFIG_ORIGINE, tous)
  expect(vueDuMenu(menu.slice(0, 1), menu)).toBe('ensemble')
  expect(vueDuMenu(menu, menu)).toBe('tout')
  expect(vueDuMenu(menu.slice(0, 3), menu)).toBe('')
})

test('descGroupe : noms courts séparés par des virgules', () => {
  expect(descGroupe(GROUPES_ORIGINE[0])).toBe('Masse salariale, Rémunération, Effectif, Absences')
  expect(descGroupe({ graphes: ['inconnu', 'ca'] })).toBe('CA')
})

test('lireConfig : réglage valide repris, forme mauvaise rejetée', () => {
  const ok = { perso: [{ id: 'p-1', nom: ' Mes ventes ', graphes: ['ca'] }], ordre: ['p-1'], defaut: 'tout' }
  expect(lireConfig(ok)).toEqual({ perso: [{ id: 'p-1', nom: 'Mes ventes', graphes: ['ca'] }], ordre: ['p-1'], defaut: 'tout' })
  expect(lireConfig(null)).toBeNull()
  expect(lireConfig(['ca'])).toBeNull()
  expect(lireConfig({ ...ok, defaut: 3 })).toBeNull()
  expect(lireConfig({ ...ok, ordre: [1] })).toBeNull()
  expect(lireConfig({ ...ok, perso: 'x' })).toBeNull()
  expect(lireConfig({ ...ok, perso: [{ id: 'p', nom: 'X', graphes: ['a', 'b', 'c', 'd', 'e'] }] })).toBeNull()
  expect(lireConfig({ ...ok, perso: [{ id: 'p', nom: 'X', graphes: [] }] })).toBeNull()
  expect(lireConfig({ ...ok, perso: [{ id: 'p', nom: '  ', graphes: ['ca'] }] })).toBeNull()
  expect(lireConfig({ ...ok, perso: [{ id: 'p', nom: 'x'.repeat(61), graphes: ['ca'] }] })).toBeNull()
  expect(lireConfig({ ordre: [], defaut: 'tout' })).toBeNull()
})

test('nouvelId : préfixe p- et valeurs différentes', () => {
  expect(nouvelId()).toMatch(/^p-[a-z0-9]+$/)
  expect(nouvelId()).not.toBe(nouvelId())
})

test('retablirOrigine : groupes et ouverture d’origine, groupes perso gardés', () => {
  const perso = [{ id: 'p-1', nom: 'Mes ventes', graphes: ['ca'] }]
  expect(retablirOrigine({ perso, ordre: ['p-1'], defaut: 'p-1' })).toEqual({ ...CONFIG_ORIGINE, perso })
})

test('lireNoms : objet de noms valides, entrées invalides ignorées, autre forme refusée', () => {
  expect(lireNoms({ ventes: '  Mes ventes ', ensemble: '', salaire: 3, avantages: 'x'.repeat(61) })).toEqual({ ventes: 'Mes ventes' })
  expect(lireNoms({})).toEqual({})
  expect(lireNoms(null)).toBeNull()
  expect(lireNoms(['a'])).toBeNull()
  expect(lireNoms('texte')).toBeNull()
})

test('noms choisis : appliqués aux groupes d’origine seulement', () => {
  const config = { ...CONFIG_ORIGINE, perso: [{ id: 'ventes2', nom: 'Mes ventes', graphes: ['ca'] }], ordre: ['ventes', 'ventes2'] }
  const noms = { ventes: 'Chiffre', ventes2: 'Ignoré' }
  expect(tousLesGroupes(config, noms).map((g) => g.nom)).toContain('Chiffre')
  expect(tousLesGroupes(config).find((g) => g.id === 'ventes')?.nom).toBe('Ventes, marge et commissions')
  expect(groupesAffiches(config, tous, noms).map((g) => g.nom)).toEqual(['Chiffre', 'Mes ventes'])
})

test('groupesDuMenu : un groupe décoché reste proposé, après les cochés et sans doublon ; un groupe sans donnée non', () => {
  const config = { ...CONFIG_ORIGINE, ordre: ['ventes', 'ensemble'] }
  expect(groupesDuMenu(config, tous).map((g) => g.id)).toEqual(['ventes', 'ensemble', 'salaire', 'avantages', 'ateliers'])
  expect(groupesDuMenu(config, sans('salaire', 'primes', 'assurance', 'formation')).map((g) => g.id)).not.toContain('salaire')
})

test('noms personnels : lus depuis le réglage et prioritaires sur les noms communs', () => {
  const c = lireConfig({ ...CONFIG_ORIGINE, noms: { ventes: ' A moi ', bad: 3 } })
  expect(c?.noms).toEqual({ ventes: 'A moi' })
  const g = tousLesGroupes(c!, { ventes: 'Commun', salaire: 'Paie' })
  expect(g.find((x) => x.id === 'ventes')?.nom).toBe('A moi')
  expect(g.find((x) => x.id === 'salaire')?.nom).toBe('Paie')
  expect(lireConfig(CONFIG_ORIGINE)).toEqual(CONFIG_ORIGINE)
})
