import { afterEach, expect, test, vi } from 'vitest'
import { exporterGraphes } from './rapports'

afterEach(() => vi.restoreAllMocks())

test('export des graphes : rapport annuel filtré, en graphiques Excel', async () => {
  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Blob(['x']), { status: 200 }))
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  await exporterGraphes({ annee: 2026, mois: 2, service: 'SAV PL' } as Parameters<typeof exporterGraphes>[0])
  const url = String(spy.mock.calls[0][0])
  expect(url).toContain('/rapports/annuel/export?')
  expect(url).toContain('graphiques=true')
  expect(url).toContain('service=SAV+PL')
})
