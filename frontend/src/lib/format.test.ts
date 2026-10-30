import { budgetValide, cls, clsCharge, comparer, compact, ecartAbsolu, fcfa, montantSigneValide, montantValide, moyenne, pct, signe, somme, valeurBrute } from './format'

test('fcfa : séparateur, absent et n/a', () => {
  expect(fcfa('1234567')).toBe('1\u00a0234\u00a0567')
  expect(fcfa(null)).toBe('—')
  expect(fcfa('n/a')).toBe('—')
  expect(pct('n/a')).toBe('—')
})

test('compact : K et M à une décimale, petits montants entiers', () => {
  expect(compact('125400000')).toBe('125,4 M')
  expect(compact('830000')).toBe('830 K')
  expect(compact(1500)).toBe('1,5 K')
  expect(compact('999960')).toBe('1 M')
  expect(compact('-2500000')).toMatch(/^-2,5 M$/)
  expect(compact('512')).toBe('512')
  expect(compact(null)).toBe('—')
  expect(compact('n/a')).toBe('—')
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

test('somme : addition décimale exacte, échelles différentes, absents ignorés', () => {
  expect(somme(['0.1', '0.2'])).toBe('0.3')
  expect(somme(['1000.500', '2.25', '-0.75'])).toBe('1002.000')
  expect(somme(['123456789012345.678', '0.001'])).toBe('123456789012345.679')
  expect(somme(['5', undefined, 'n/a'])).toBe('5')
  expect(somme([])).toBeNull()
  expect(somme([undefined])).toBeNull()
})

test('comparer, signe et écart absolu : exacts, sans flottant', () => {
  expect(comparer('1.10', '1.1')).toBe(0)
  expect(comparer('0.30000000000000004', '0.3')).toBe(1)
  expect(comparer('-2', '1')).toBe(-1)
  expect(signe('-0.001')).toBe(-1)
  expect(signe('0.000')).toBe(0)
  expect(ecartAbsolu('10.5', '12')).toBe('1.5')
  expect(ecartAbsolu('12', '10.5')).toBe('1.5')
})

test('montantValide : règle du serveur, 15 chiffres et 12 décimales, séparateurs tolérés', () => {
  expect(montantValide('1 234 567,5')).toBe(true)
  expect(montantValide('1,123456789012')).toBe(true)
  expect(montantValide('1,1234567890123')).toBe(false)
  expect(montantValide('123456789012345')).toBe(true)
  expect(montantValide('1234567890123456')).toBe(false)
  expect(montantValide('-1')).toBe(false)
  expect(montantValide('1,')).toBe(false)
  expect(montantSigneValide('-50 000')).toBe(true)
  expect(montantSigneValide('-1,1234567890123')).toBe(false)
})

test('budgetValide : trois décimales au plus', () => {
  expect(budgetValide('1 200,125')).toBe(true)
  expect(budgetValide('1200,1256')).toBe(false)
  expect(budgetValide('-5')).toBe(false)
})

test("écart d'une charge : dépasser le budget est rouge, rester en dessous est vert", () => {
  expect(clsCharge('1500')).toBe('num neg')
  expect(clsCharge('-200')).toBe('num bon')
  expect(clsCharge('0')).toBe('num')
  expect(clsCharge(null)).toBe('num')
  expect(clsCharge('n/a')).toBe('num')
})

describe('moyenne', () => {
  it('reste exacte, sans float', () => {
    expect(moyenne(['80', '90'])).toBe('85')
    expect(moyenne(['0.1', '0.2'])).toBe('0.15')
    expect(moyenne([])).toBeNull()
  })
})
