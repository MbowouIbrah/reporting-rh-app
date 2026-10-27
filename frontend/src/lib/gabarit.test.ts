import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { viderCache } from './cacheSession'
import { useGabarit } from './gabarit'

describe('useGabarit', () => {
  it("garde la dernière réponse fraîche pour l'ouverture suivante, oubliée au changement de session", () => {
    const d = { lignes: [{ rubrique: 'Salaire', m: '1200.05' }] }
    renderHook(() => useGabarit('annuel', d, true))
    expect(renderHook(() => useGabarit('annuel', undefined, false)).result.current).toEqual(d)
    viderCache()
    expect(renderHook(() => useGabarit('annuel', undefined, false)).result.current).toBeUndefined()
  })
})
