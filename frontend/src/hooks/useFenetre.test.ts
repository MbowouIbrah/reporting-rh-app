import { describe, expect, it } from 'vitest'
import { tranche } from './useFenetre'

describe('tranche', () => {
  it('en haut : depuis la première ligne, marge comprise', () => {
    expect(tranche(0, 220, 22, 1400, 5)).toEqual({ debut: 0, fin: 15 })
  })

  it('au milieu : debut pair, marge de chaque côté', () => {
    // Lignes visibles 100 à 110 ; marge 5 → 95 ramené à 94 (pair), fin 115.
    expect(tranche(2200, 220, 22, 1400, 5)).toEqual({ debut: 94, fin: 115 })
  })

  it('jamais au-delà du total, même si le défilement n’est pas encore recadré', () => {
    expect(tranche(30000, 220, 22, 10, 5)).toEqual({ debut: 8, fin: 10 })
    expect(tranche(0, 220, 22, 0, 5)).toEqual({ debut: 0, fin: 0 })
  })

  it('défilement dans l’en-tête (négatif) : depuis la première ligne', () => {
    expect(tranche(-30, 220, 22, 1400, 5)).toEqual({ debut: 0, fin: 15 })
  })
})
