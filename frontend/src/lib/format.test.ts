import { cls, fcfa, pct, valeurBrute } from './format'

test('fcfa : séparateur, absent et n/a', () => {
  expect(fcfa('1234567')).toBe('1\u00a0234\u00a0567')
  expect(fcfa(null)).toBe('—')
  expect(fcfa('n/a')).toBe('—')
  expect(pct('n/a')).toBe('—')
})

test('pct : multiplie le ratio par 100', () => {
  expect(pct('0.05')).toMatch(/^5\s%$/)
  expect(pct('-0.172')).toMatch(/^-17,2\s%$/)
  expect(pct(null)).toBe('—')
})

test('cls : négatif en rouge seulement', () => {
  expect(cls('-1')).toBe('num neg')
  expect(cls('1')).toBe('num')
  expect(cls('n/a')).toBe('num')
  expect(cls(null)).toBe('num')
})

test('valeurBrute : décimal exact, sans flottant, vide si absent', () => {
  expect(valeurBrute(undefined)).toBe('')
  expect(valeurBrute('0.000')).toBe('0')
  expect(valeurBrute('1000.500')).toBe('1\u00a0000,5')
  expect(valeurBrute('-2.250')).toBe('-2,25')
  expect(valeurBrute('123456789012345.678')).toBe('123\u00a0456\u00a0789\u00a0012\u00a0345,678')
})
