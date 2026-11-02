import { exerciceDe, libelleCumul, libelleExercice, ordreMois } from './exercice'

test('exercice : en fiscal, janvier à mars appartiennent à l\'exercice commencé l\'année d\'avant', () => {
  expect(exerciceDe(2026, 2, 'fiscal')).toBe(2025)
  expect(exerciceDe(2026, 4, 'fiscal')).toBe(2026)
  expect(exerciceDe(2026, 2, 'civil')).toBe(2026)
})

test('libellés : « 2026-27 » et cumul aux vrais mois', () => {
  expect(libelleExercice(2026)).toBe('2026')
  expect(libelleExercice(2026, 'fiscal')).toBe('2026-27')
  expect(libelleExercice(2099, 'fiscal')).toBe('2099-00')
  expect(libelleCumul(2026, 3)).toBe('Cumul de janvier à mars 2026')
  expect(libelleCumul(2026, 2, 'fiscal')).toBe("Cumul d'avril 2026 à février 2027")
  expect(libelleCumul(2026, 11, 'fiscal')).toBe("Cumul d'avril 2026 à novembre 2026")
})

test("ordre des mois de l'exercice", () => {
  expect(ordreMois()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  expect(ordreMois('fiscal')).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3])
})
