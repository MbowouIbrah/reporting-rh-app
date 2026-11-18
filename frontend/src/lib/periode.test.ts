import { bornes, libelleBornes, libelleColonne, libelleComparee, lireCmp, lireVue, periodePrecedente, rang } from './periode'

test('bornes : chaque raccourci, en rangs de l\'exercice', () => {
  expect(bornes('cumul', 5)).toEqual({ debut: 1, fin: 5 })
  expect(bornes('cumul', 5, 3)).toEqual({ debut: 1, fin: 3 })
  expect(bornes('mois', 5)).toEqual({ debut: 5, fin: 5 })
  expect(bornes('trimestre', 5)).toEqual({ debut: 4, fin: 6 })
  expect(bornes('trimestre', 12, 3)).toEqual({ debut: 1, fin: 3 })
  expect(bornes('annee', 5)).toEqual({ debut: 1, fin: 12 })
  expect(bornes('plage', 5, 4, 2)).toEqual({ debut: 2, fin: 4 })
  // début après la fin : ramené à la fin
  expect(bornes('plage', 5, 3, 9)).toEqual({ debut: 3, fin: 3 })
})

test('valeurs inconnues : cumul et même période N-1', () => {
  expect(lireVue(undefined)).toBe('cumul')
  expect(lireVue('n_importe')).toBe('cumul')
  expect(lireVue('plage')).toBe('plage')
  expect(lireCmp('objectif')).toBe('')
  expect(lireCmp('prec')).toBe('prec')
})

test('rangs : en fiscal, avril est le 1er mois et mars le 12e', () => {
  expect(rang(4, 'fiscal')).toBe(1)
  expect(rang(3, 'fiscal')).toBe(12)
  expect(rang(3, 'civil')).toBe(3)
})

test('libellés de période aux vrais mois', () => {
  expect(libelleBornes(2026, { debut: 3, fin: 3 }, 'civil')).toBe('Mars 2026')
  expect(libelleBornes(2026, { debut: 4, fin: 6 }, 'civil')).toBe('Avr → juin 2026')
  expect(libelleBornes(2026, { debut: 8, fin: 11 }, 'fiscal')).toBe('Nov 2026 → fév 2027')
  expect(libelleBornes(2026, { debut: 1, fin: 12 }, 'fiscal')).toBe('Exercice 2026-27')
  expect(libelleBornes(2026, { debut: 1, fin: 12 }, 'civil')).toBe('Année 2026')
  expect(libelleColonne(2026, 'cumul', { debut: 1, fin: 5 }, 'civil')).toBe('2026')
  expect(libelleColonne(2026, 'mois', { debut: 5, fin: 5 }, 'civil')).toBe('Mai 2026')
})

test('période précédente : les mêmes nombre de mois juste avant, quitte à changer d\'année', () => {
  expect(periodePrecedente(2026, { debut: 1, fin: 3 }, 'civil')).toEqual({ debut: { annee: 2025, mois: 10 }, fin: { annee: 2025, mois: 12 } })
  expect(periodePrecedente(2026, { debut: 2, fin: 2 }, 'civil')).toEqual({ debut: { annee: 2026, mois: 1 }, fin: { annee: 2026, mois: 1 } })
  // fiscal 2026-27, rangs 10 à 12 = janvier à mars 2027 → octobre à décembre 2026
  expect(periodePrecedente(2026, { debut: 10, fin: 12 }, 'fiscal')).toEqual({ debut: { annee: 2026, mois: 10 }, fin: { annee: 2026, mois: 12 } })
})

test('libellé de la période comparée', () => {
  const b = { debut: 2, fin: 2 }
  expect(libelleComparee(2026, 'mois', b, 'civil', '')).toBe('Février 2025')
  expect(libelleComparee(2026, 'mois', b, 'civil', '', 2023)).toBe('Février 2023')
  expect(libelleComparee(2026, 'mois', b, 'civil', 'prec')).toBe('Janvier 2026')
  expect(libelleComparee(2026, 'cumul', { debut: 1, fin: 3 }, 'civil', 'prec')).toBe('Oct → déc 2025')
  expect(libelleComparee(2026, 'cumul', { debut: 1, fin: 3 }, 'civil', '')).toBe('2025')
  expect(libelleComparee(2026, 'cumul', b, 'civil', 'aucune')).toBe('Sans comparaison')
})
