import { render, screen, within } from '@testing-library/react'
import type { AnomalieLot } from '../../../api/saisie'
import PointsAttention, { repartir } from './PointsAttention'

function anomalie(code: string, gravite: AnomalieLot['gravite'] = 'avertissement', message = code): AnomalieLot {
  return { ligne: 4, colonne: 'NOM', code, gravite, valeur: 'Jhon', message }
}

test('repartir : groupes dans l’ordre, codes inconnus dans « Autres points », groupes vides omis', () => {
  const groupes = repartir([anomalie('POSTE_NOUVEAU'), anomalie('INCONNU'), anomalie('NOM_SIMILAIRE'), anomalie('NOM_PROCHE')])
  expect(groupes.map((g) => [g.titre, g.lignes.length])).toEqual([
    ['Noms à vérifier', 2],
    ['Montants et référentiels', 1],
    ['Autres points', 1],
  ])
})

test('erreurs bloquantes à part avec la valeur ; noms à vérifier ouverts, autres groupes repliés', () => {
  const { container } = render(
    <PointsAttention
      afficherLigne
      anomalies={[
        anomalie('NOM_HOMONYME', 'bloquant', 'Nom porté par plusieurs employés'),
        anomalie('NOM_PROCHE', 'avertissement', 'Proche de John (E1)'),
        anomalie('NORMALISE', 'avertissement', 'Espaces retirés'),
      ]}
    />,
  )
  const sections = container.querySelectorAll('details')
  expect(sections).toHaveLength(3)
  const [erreurs, noms, corrigees] = sections

  expect(erreurs).toHaveAttribute('open')
  expect(within(erreurs).getByText('Erreurs à corriger (1)')).toBeInTheDocument()
  expect(within(erreurs).getByRole('columnheader', { name: 'Valeur' })).toBeInTheDocument()
  expect(within(erreurs).getByRole('row', { name: /4 NOM Jhon Nom porté par plusieurs employés/ })).toBeInTheDocument()

  expect(noms).toHaveAttribute('open')
  expect(within(noms).getByText('Noms à vérifier (1)')).toBeInTheDocument()
  expect(within(noms).queryByRole('columnheader', { name: 'Valeur' })).toBeNull()
  expect(within(noms).getByText('Proche de John (E1)')).toBeInTheDocument()

  expect(corrigees).not.toHaveAttribute('open')
  expect(within(corrigees).getByText('Valeurs corrigées automatiquement (1)')).toBeInTheDocument()
})

test('saisie en grille : pas de colonne Ligne', () => {
  render(<PointsAttention afficherLigne={false} anomalies={[anomalie('MUTATION')]} />)
  expect(screen.queryByRole('columnheader', { name: 'Ligne' })).toBeNull()
  expect(screen.getByText('Changements d’affectation (1)')).toBeInTheDocument()
})
