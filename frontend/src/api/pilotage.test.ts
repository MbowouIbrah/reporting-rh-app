import { QueryClient } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import { apresImport } from './pilotage'

test('après un import ou son annulation, les saisies et les rapports se rechargent', () => {
  const qc = new QueryClient()
  const invalider = vi.spyOn(qc, 'invalidateQueries')
  apresImport(qc)
  const cles = invalider.mock.calls.map(([f]) => f?.queryKey?.[0])
  for (const k of ['donnees', 'saisie', 'saisies', 'pilotage', 'annuel', 'mensuel']) expect(cles).toContain(k)
})
