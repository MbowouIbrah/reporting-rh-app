import {
  anneeEntiere, calendrierDe, cliqueMois, defautCmp, indice, libelle, libelleExercicePeriode, longueur, lireTexte, migrer,
  mois, plage, versTexte,
} from './periode'

const OCT_26 = indice(2026, 10)
const JANV_23 = indice(2023, 1)

test('libellés toujours complets', () => {
  expect(libelle(mois(OCT_26))).toBe('Octobre 2026')
  expect(libelle(plage(indice(2025, 1), indice(2025, 12)))).toBe('Janvier → décembre 2025')
  expect(libelle(plage(indice(2026, 1), OCT_26, OCT_26))).toBe('Janvier → octobre 2026')
  expect(libelle(plage(indice(2025, 4), indice(2026, 3)))).toBe('Avril 2025 → mars 2026')
})

test('année : janvier à décembre, ou janvier au dernier mois disponible', () => {
  expect(plage(indice(2025, 1), indice(2025, 12)).type).toBe('annee')
  expect(plage(indice(2026, 1), OCT_26, OCT_26).type).toBe('annee')
  expect(plage(indice(2026, 1), OCT_26).type).toBe('plage')
  expect(plage(indice(2025, 4), indice(2026, 3)).type).toBe('plage')
  expect(plage(OCT_26, indice(2026, 1), OCT_26)).toEqual({ type: 'annee', d: indice(2026, 1), f: OCT_26 })
  expect(anneeEntiere(2026, JANV_23, OCT_26)).toEqual({ type: 'annee', d: indice(2026, 1), f: OCT_26 })
  expect(anneeEntiere(2023, JANV_23, OCT_26)).toEqual({ type: 'annee', d: JANV_23, f: indice(2023, 12) })
})

test('comparaison par défaut : mois d\'avant, ou mêmes mois un an avant', () => {
  expect(defautCmp(mois(OCT_26))).toEqual(mois(indice(2026, 9)))
  expect(defautCmp(mois(indice(2026, 1)))).toEqual(mois(indice(2025, 12)))
  expect(libelle(defautCmp(plage(indice(2026, 1), OCT_26, OCT_26)))).toBe('Janvier → octobre 2025')
  expect(libelle(defautCmp(plage(indice(2025, 4), indice(2026, 3))))).toBe('Avril 2024 → mars 2025')
})

test('clics sur les mois : sélection, plage, désélection', () => {
  const a = indice(2026, 3)
  const b = indice(2026, 6)
  expect(cliqueMois(null, a)).toEqual(mois(a))
  expect(cliqueMois(mois(a), a)).toBeNull()
  expect(cliqueMois(mois(a), b)).toEqual({ type: 'plage', d: a, f: b })
  expect(cliqueMois(mois(b), a)).toEqual({ type: 'plage', d: a, f: b })
  expect(cliqueMois({ type: 'plage', d: a, f: b }, a)).toEqual(mois(b))
  expect(cliqueMois({ type: 'plage', d: a, f: b }, b)).toEqual(mois(a))
  expect(cliqueMois({ type: 'plage', d: a, f: b }, indice(2026, 9))).toEqual(mois(indice(2026, 9)))
  expect(cliqueMois(anneeEntiere(2025, JANV_23, OCT_26), a)).toEqual(mois(a))
})

test('texte d\'URL : aller-retour et valeurs refusées', () => {
  expect(versTexte(mois(OCT_26))).toBe('2026-10')
  const s = plage(indice(2025, 4), indice(2026, 3))
  expect(versTexte(s)).toBe('2025-04..2026-03')
  expect(lireTexte('2025-04..2026-03')).toEqual(s)
  expect(lireTexte('2026-10')).toEqual(mois(OCT_26))
  expect(lireTexte('2026-01..2026-10', OCT_26)?.type).toBe('annee')
  expect(lireTexte(undefined)).toBeNull()
  expect(lireTexte('n_importe')).toBeNull()
  expect(lireTexte('2026-13')).toBeNull()
  expect(lireTexte('2026-10..2026-03')).toBeNull()
  expect(lireTexte('2024-01..2025-01')).toBeNull()
})

test('longueur et exercice de base', () => {
  expect(longueur(mois(OCT_26))).toBe(1)
  expect(longueur(plage(indice(2025, 4), indice(2026, 3)))).toBe(12)
  expect(libelleExercicePeriode(plage(indice(2026, 1), OCT_26))).toBe('2026')
  expect(libelleExercicePeriode(plage(indice(2026, 1), OCT_26), -1)).toBe('2025')
  expect(libelleExercicePeriode(plage(indice(2025, 4), indice(2026, 3)))).toBe('2025-26')
  expect(libelleExercicePeriode(plage(indice(2025, 4), indice(2026, 3)), -1)).toBe('2024-25')
})

test('calendrier fiscal : une période qui commence en avril et passe sur l\'année suivante', () => {
  expect(calendrierDe(plage(indice(2025, 4), indice(2026, 3)))).toBe('fiscal')
  expect(calendrierDe(plage(indice(2025, 4), indice(2025, 9)))).toBe('civil')
  expect(calendrierDe(plage(indice(2025, 1), indice(2025, 12)))).toBe('civil')
})

test('anciens filtres : cumul, mois, trimestre, année, plage, exercice fiscal', () => {
  const der = { annee: 2026, mois: 5 }
  expect(migrer({}, der, OCT_26)).toBeNull()
  expect(migrer({ annee: '2026' }, der, indice(2026, 5))).toEqual({ type: 'annee', d: indice(2026, 1), f: indice(2026, 5) })
  expect(migrer({ annee: '2025' }, der, indice(2026, 5))).toEqual({ type: 'annee', d: indice(2025, 1), f: indice(2025, 12) })
  expect(migrer({ vue: 'mois', fin: '3' }, der, indice(2026, 5))).toEqual(mois(indice(2026, 3)))
  expect(migrer({ vue: 'trimestre', fin: '5' }, der, indice(2026, 5))).toEqual({ type: 'plage', d: indice(2026, 4), f: indice(2026, 6) })
  expect(migrer({ vue: 'plage', debut: '2', fin: '4' }, der, indice(2026, 5))).toEqual({ type: 'plage', d: indice(2026, 2), f: indice(2026, 4) })
  expect(migrer({ vue: 'annee', calendrier: 'fiscal', exercice: '2025' }, der, indice(2026, 5)))
    .toEqual({ type: 'plage', d: indice(2025, 4), f: indice(2026, 3) })
})
