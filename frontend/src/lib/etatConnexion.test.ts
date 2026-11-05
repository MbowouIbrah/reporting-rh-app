import { connexionPerdue, connexionRetablie, verifierConnexion } from './etatConnexion'

afterEach(() => {
  vi.restoreAllMocks()
  connexionRetablie()
})

test('passerelle sans serveur (502) : connexion perdue, puis rétablie par une réponse', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, { status: 502 }))
  expect(await verifierConnexion()).toBe(false)
  expect(connexionPerdue()).toBe(true)
  connexionRetablie()
  expect(connexionPerdue()).toBe(false)
})

test('401 sans session : le serveur répond, pas de panne', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, { status: 401 }))
  expect(await verifierConnexion()).toBe(true)
  expect(connexionPerdue()).toBe(false)
})

test('sonde lente en échec après une réponse réussie : pas de panne déclarée', async () => {
  let rejeter: (e: unknown) => void = () => {}
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise((_, r) => (rejeter = r)))
  const sonde = verifierConnexion()
  connexionRetablie()
  rejeter(new TypeError('Failed to fetch'))
  expect(await sonde).toBe(true)
  expect(connexionPerdue()).toBe(false)
})
