import { api, ApiError, setUnauthorizedHandler } from './client'

const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status })

afterEach(() => vi.restoreAllMocks())

test('401 puis refresh puis nouvel essai', async () => {
  const f = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(json(401))
    .mockResolvedValueOnce(json(200)) // refresh
    .mockResolvedValueOnce(json(200, { ok: 1 }))
  expect(await api('/rapports/periodes')).toEqual({ ok: 1 })
  expect(f.mock.calls[1][0]).toContain('/auth/refresh')
})

test('deux 401 simultanés : un seul refresh', async () => {
  let refreshes = 0
  const vus = new Set<string>()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const u = String(url)
    if (u.includes('/auth/refresh')) {
      refreshes++
      return json(200)
    }
    if (!vus.has(u)) {
      vus.add(u)
      return json(401)
    }
    return json(200, {})
  })
  await Promise.all([api('/a'), api('/b')])
  expect(refreshes).toBe(1)
})

test('refresh refusé : déconnexion déclenchée', async () => {
  const out = vi.fn()
  setUnauthorizedHandler(out)
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(401))
  await expect(api('/x')).rejects.toMatchObject({ status: 401 })
  expect(out).toHaveBeenCalled()
})

test('403 : erreur typée sans déconnexion', async () => {
  const out = vi.fn()
  setUnauthorizedHandler(out)
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(403, { detail: 'Interdit' }))
  await expect(api('/x')).rejects.toBeInstanceOf(ApiError)
  expect(out).not.toHaveBeenCalled()
})
