import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CYCLE_SQUELETTE, DELAI_SQUELETTE, finAttente, useAttente } from './useAttente'

describe('finAttente', () => {
  it('réponse avant le délai : le squelette ne s’est jamais montré', () => {
    expect(finAttente(1000, 1000 + DELAI_SQUELETTE)).toBe(0)
  })
  it('squelette visible : fin du cycle en cours, au moins un cycle complet', () => {
    expect(finAttente(0, DELAI_SQUELETTE + 1)).toBe(DELAI_SQUELETTE + CYCLE_SQUELETTE)
    expect(finAttente(0, DELAI_SQUELETTE + CYCLE_SQUELETTE)).toBe(DELAI_SQUELETTE + CYCLE_SQUELETTE)
    expect(finAttente(0, DELAI_SQUELETTE + CYCLE_SQUELETTE + 1)).toBe(DELAI_SQUELETTE + 2 * CYCLE_SQUELETTE)
  })
})

describe('useAttente', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('réponse rapide : rendu immédiat, sans relais', () => {
    const h = renderHook(({ o }) => useAttente(o), { initialProps: { o: true } })
    expect(h.result.current).toEqual([true, false])
    act(() => vi.advanceTimersByTime(100))
    h.rerender({ o: false })
    expect(h.result.current).toEqual([false, false])
  })

  it('réponse lente : attente tenue jusqu’à la fin du cycle, puis relais', () => {
    const h = renderHook(({ o }) => useAttente(o), { initialProps: { o: true } })
    act(() => vi.advanceTimersByTime(DELAI_SQUELETTE + 200))
    h.rerender({ o: false })
    expect(h.result.current).toEqual([true, false])
    act(() => vi.advanceTimersByTime(CYCLE_SQUELETTE - 201))
    expect(h.result.current[0]).toBe(true)
    act(() => vi.advanceTimersByTime(1))
    expect(h.result.current).toEqual([false, true])
  })

  it('reprise pendant la fin de cycle : le squelette continue sans coupure', () => {
    const h = renderHook(({ o }) => useAttente(o), { initialProps: { o: true } })
    act(() => vi.advanceTimersByTime(DELAI_SQUELETTE + 100))
    h.rerender({ o: false })
    h.rerender({ o: true })
    act(() => vi.advanceTimersByTime(CYCLE_SQUELETTE))
    expect(h.result.current[0]).toBe(true)
  })
})
