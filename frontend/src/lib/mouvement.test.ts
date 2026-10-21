import { afterEach, describe, expect, it, vi } from 'vitest'
import { EFFET_PAR_DEFAUT, installerMouvement, transitionPage } from './mouvement'

const URL_BASE = 'http://localhost/reporting-rh/resume'

afterEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.mouvement
})

describe('installerMouvement', () => {
  it("pose l'effet par défaut", () => {
    expect(installerMouvement(document, URL_BASE)).toBe(EFFET_PAR_DEFAUT)
    expect(document.documentElement.dataset.mouvement).toBe(EFFET_PAR_DEFAUT)
  })

  it("mémorise l'effet demandé dans l'adresse, puis revient au défaut", () => {
    installerMouvement(document, `${URL_BASE}?mouvement=zoom`)
    expect(installerMouvement(document, URL_BASE)).toBe('zoom')
    expect(installerMouvement(document, `${URL_BASE}?mouvement=defaut`)).toBe(EFFET_PAR_DEFAUT)
    expect(installerMouvement(document, URL_BASE)).toBe(EFFET_PAR_DEFAUT)
  })

  it('ignore un effet inconnu', () => {
    expect(installerMouvement(document, `${URL_BASE}?mouvement=toupie`)).toBe(EFFET_PAR_DEFAUT)
  })
})

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

  it("navigue directement avec l'effet « aucun »", () => {
    document.documentElement.dataset.mouvement = 'aucun'
    const start = vi.fn()
    transitionPage(vi.fn(), { startViewTransition: start, documentElement: document.documentElement } as unknown as Document)
    expect(start).not.toHaveBeenCalled()
  })
})
