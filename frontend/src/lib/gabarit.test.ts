import { describe, expect, it } from 'vitest'
import { gabarit } from './gabarit'

describe('gabarit', () => {
  it('garde la structure et les libellés, retire tous les chiffres', () => {
    const d = { mois: 3, lignes: [{ rubrique: 'Salaire', m: '1200.50', var_pct: '-0.125', exclu: false }], part: 'n/a', vide: null }
    expect(gabarit(d)).toEqual({ mois: 3, lignes: [{ rubrique: 'Salaire', m: null, var_pct: null, exclu: false }], part: 'n/a', vide: null })
  })
})
