import { expect, test } from 'vitest'
import {
  CONFIG_ORIGINE, descGroupe, GRAPHES, GROUPES_ORIGINE, groupesAffiches, lireConfig, lireNoms, nouvelId, retablirOrigine, tousLesGroupes, vueInitiale,
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

test('vueInitiale : réglage par défaut, « tout », sinon premier groupe affiché', () => {
  const affiches = groupesAffiches(CONFIG_ORIGINE, tous)
  expect(vueInitiale(CONFIG_ORIGINE, affiches)).toBe('ensemble')
  expect(vueInitiale({ ...CONFIG_ORIGINE, defaut: 'tout' }, affiches)).toBe('tout')
  expect(vueInitiale({ ...CONFIG_ORIGINE, defaut: 'ventes' }, affiches.slice(1, 3))).toBe('salaire')
  expect(vueInitiale({ ...CONFIG_ORIGINE, defaut: 'ventes' }, [])).toBe('tout')
})

test('descGroupe : titres séparés par des virgules, sans « (FCFA) »', () => {
  expect(descGroupe(GROUPES_ORIGINE[0])).toBe('Masse salariale mensuelle, Rémunération globale, Effectif, Absences par mois (jours)')
  expect(descGroupe({ graphes: ['inconnu', 'ca'] })).toBe('CA par mois')
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

test('noms personnels : lus depuis le réglage et prioritaires sur les noms communs', () => {
  const c = lireConfig({ ...CONFIG_ORIGINE, noms: { ventes: ' A moi ', bad: 3 } })
  expect(c?.noms).toEqual({ ventes: 'A moi' })
  const g = tousLesGroupes(c!, { ventes: 'Commun', salaire: 'Paie' })
  expect(g.find((x) => x.id === 'ventes')?.nom).toBe('A moi')
  expect(g.find((x) => x.id === 'salaire')?.nom).toBe('Paie')
  expect(lireConfig(CONFIG_ORIGINE)).toEqual(CONFIG_ORIGINE)
})
