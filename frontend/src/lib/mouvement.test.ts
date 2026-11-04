import { describe, expect, it, vi } from 'vitest'
import { transitionPage } from './mouvement'

describe('transitionPage', () => {
  it('navigue directement sans View Transitions', () => {
    const naviguer = vi.fn()
    transitionPage(naviguer, document)
    expect(naviguer).toHaveBeenCalledOnce()
  })

  it('passe par startViewTransition quand il existe', () => {
    const naviguer = vi.fn()
    const start = vi.fn((maj: () => void) => maj())
    transitionPage(naviguer, { startViewTransition: start, documentElement: document.documentElement } as unknown as Document)
    expect(start).toHaveBeenCalledOnce()
    expect(naviguer).toHaveBeenCalledOnce()
  })

  it('navigue directement quand le mouvement est réduit', () => {
    const avant = window.matchMedia
    window.matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList)
    const start = vi.fn()
    const naviguer = vi.fn()
    transitionPage(naviguer, { startViewTransition: start, documentElement: document.documentElement } as unknown as Document)
    expect(start).not.toHaveBeenCalled()
    expect(naviguer).toHaveBeenCalledOnce()
    window.matchMedia = avant
  })
})
