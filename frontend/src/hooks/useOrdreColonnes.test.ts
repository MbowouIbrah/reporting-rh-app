import { describe, expect, it } from 'vitest'
import { deplacer, deposer, grouper } from './useOrdreColonnes'

describe('grouper', () => {
  it('met les colonnes exclues en tête, chaque bloc dans l’ordre reçu', () => {
    expect(grouper(['a', 'b', 'c', 'd'], new Set(['c', 'a']))).toEqual(['a', 'c', 'b', 'd'])
  })
})

describe('deplacer', () => {
  it('vers la droite : après la cible', () => {
    expect(deplacer(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd'])
  })
  it('vers la gauche : avant la cible', () => {
    expect(deplacer(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c'])
  })
  it('sans effet sur elle-même ou une colonne inconnue', () => {
    expect(deplacer(['a', 'b'], 'a', 'a')).toEqual(['a', 'b'])
    expect(deplacer(['a', 'b'], 'z', 'a')).toEqual(['a', 'b'])
  })
})

describe('deposer', () => {
  const ex = new Set(['a', 'b'])
  it('dans la même zone : seul l’ordre change', () => {
    expect(deposer(['a', 'b', 'c', 'd'], ex, 'd', 'c')).toEqual([
      { colonne: 'a', exclu: true }, { colonne: 'b', exclu: true },
      { colonne: 'd', exclu: false }, { colonne: 'c', exclu: false },
    ])
  })
  it('sur une colonne hachurée : la colonne sort du TOTAL', () => {
    expect(deposer(['a', 'b', 'c', 'd'], ex, 'c', 'b').find((x) => x.colonne === 'c')).toEqual({ colonne: 'c', exclu: true })
  })
  it('sur une colonne comptée : la colonne revient dans le TOTAL', () => {
    expect(deposer(['a', 'b', 'c', 'd'], ex, 'a', 'c').find((x) => x.colonne === 'a')).toEqual({ colonne: 'a', exclu: false })
  })
})
