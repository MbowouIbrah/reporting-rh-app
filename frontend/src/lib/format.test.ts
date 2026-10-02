import { cls, fcfa, pct } from './format'

test('fcfa : séparateur, absent et n/a', () => {
  expect(fcfa('1234567')).toMatch(/^1\s234\s567$/)
  expect(fcfa(null)).toBe('—')
  expect(fcfa('n/a')).toBe('n/a')
})

test('pct : multiplie le ratio par 100', () => {
  expect(pct('0.05')).toMatch(/^5,0\s%$/)
  expect(pct('-0.172')).toMatch(/^-17,2\s%$/)
  expect(pct(null)).toBe('—')
})

test('cls : négatif en rouge seulement', () => {
  expect(cls('-1')).toBe('num neg')
  expect(cls('1')).toBe('num')
  expect(cls('n/a')).toBe('num')
  expect(cls(null)).toBe('num')
})
