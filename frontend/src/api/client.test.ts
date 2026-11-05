import { api, ApiError, ErreurReseau, setUnauthorizedHandler } from './client'

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

test('session restaurée au chargement : /auth/me en 401 passe par le refresh', async () => {
  const f = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(json(401))
    .mockResolvedValueOnce(json(200)) // refresh
    .mockResolvedValueOnce(json(200, { id: 1 }))
  expect(await api('/auth/me')).toEqual({ id: 1 })
  expect(f.mock.calls[1][0]).toContain('/auth/refresh')
})

test('/auth/me sans session valide : 401 rendu à l’appelant, sans vider le cache', async () => {
  const out = vi.fn()
  setUnauthorizedHandler(out)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(401))
  await expect(api('/auth/me')).rejects.toMatchObject({ status: 401 })
  expect(out).not.toHaveBeenCalled()
})

test('identifiants refusés : pas de refresh', async () => {
  const f = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(401))
  await expect(api('/auth/login', { method: 'POST' })).rejects.toMatchObject({ status: 401 })
  expect(f).toHaveBeenCalledTimes(1)
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
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(401))
  await expect(api('/x')).rejects.toMatchObject({ status: 401 })
  expect(out).toHaveBeenCalled()
})

test('403 : erreur typée sans déconnexion', async () => {
  const out = vi.fn()
  setUnauthorizedHandler(out)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(403, { detail: 'Interdit' }))
  await expect(api('/x')).rejects.toBeInstanceOf(ApiError)
  expect(out).not.toHaveBeenCalled()
})

test('refresh en erreur serveur (500) : la session reste ouverte, erreur rendue', async () => {
  const out = vi.fn()
  setUnauthorizedHandler(out)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => (String(url).endsWith('/auth/refresh') ? json(500) : json(401)))
  await expect(api('/x')).rejects.toMatchObject({ status: 500 })
  expect(out).not.toHaveBeenCalled()
})

test('réseau coupé : ErreurReseau, pas de déconnexion', async () => {
  const out = vi.fn()
  setUnauthorizedHandler(out)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new TypeError('Failed to fetch')
  })
  await expect(api('/x')).rejects.toBeInstanceOf(ErreurReseau)
  expect(out).not.toHaveBeenCalled()
})

test('annulation par l’appelant : pas une panne', async () => {
  const ctrl = new AbortController()
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    (_u, init) => new Promise((_, r) => init?.signal?.addEventListener('abort', () => r(new DOMException('abort', 'AbortError')))),
  )
  const p = api('/x', { signal: ctrl.signal })
  ctrl.abort()
  await expect(p).rejects.not.toBeInstanceOf(ErreurReseau)
})

test('204 : réponse sans corps rendue telle quelle', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, { status: 204 }))
  expect(await api('/x', { method: 'DELETE' })).toBeUndefined()
})

test('envoi long sans réponse : la sonde part après 8 s, sans annuler l’envoi', async () => {
  vi.useFakeTimers()
  try {
    const ctrl = new AbortController()
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_u, init) => new Promise((_, r) => init?.signal?.addEventListener('abort', () => r(new DOMException('abort', 'AbortError')))),
    )
    const p = api('/imports', { method: 'POST', body: new FormData(), signal: ctrl.signal })
    await vi.advanceTimersByTimeAsync(7_999)
    expect(f).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(String(f.mock.calls[1]?.[0])).toContain('/auth/me')
    expect((f.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(false)
    ctrl.abort()
    await expect(p).rejects.not.toBeInstanceOf(ErreurReseau)
    await vi.advanceTimersByTimeAsync(10_000)
  } finally {
    vi.useRealTimers()
  }
})
