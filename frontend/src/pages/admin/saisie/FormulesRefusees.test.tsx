import { render, screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import FormulesRefusees from './FormulesRefusees'

test('formules refusées : tableau des cellules et marche à suivre', () => {
  render(<FormulesRefusees anomalies={[
    { ligne: 4, colonne: 'Bonus', code: 'LIAISON_ERREUR', gravite: 'bloquant', valeur: "='[paie.xlsx]Feuil1'!B2", message: 'La liaison donne #REF!.' },
    { ligne: 5, colonne: 'Formation', code: 'FORMULE_SANS_VALEUR', gravite: 'bloquant', valeur: '=A1*2', message: 'Formule sans valeur.' },
    { ligne: null, colonne: null, code: 'LIAISON_EXTERNE', gravite: 'avertissement', valeur: null, message: 'Autre.' },
  ]} />)
  const lignes = within(screen.getByRole('table', { name: 'Formules sans valeur utilisable' })).getAllByRole('row')
  expect(lignes.map((l) => l.textContent)).toEqual([
    'LigneColonneFormule ou contenuProblème',
    "4Bonus='[paie.xlsx]Feuil1'!B2La liaison donne #REF!.",
    '5Formation=A1*2Formule sans valeur.',
  ])
  expect(screen.getByText(/Mettre à jour les liaisons/)).toBeInTheDocument()
  expect(screen.getByText(/Collage spécial › Valeurs/)).toBeInTheDocument()
})
